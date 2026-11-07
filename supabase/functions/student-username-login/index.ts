import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ENGLISH_HERO_ALLOWED_ORIGIN") ?? "https://mrwael1773.github.io";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Authentication service unavailable" }, 503);
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 2048) return json({ error: "Request too large" }, 413);
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid request" }, 400);
  }

  const payload = body as { username?: unknown; password?: unknown };
  const username = typeof payload.username === "string" ? payload.username.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 8 || password.length > 128) {
    return json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." }, 400);
  }

  // Username throttling is authoritative. Treat the edge-provided CF header as
  // an optional secondary signal only; never trust a client-supplied X-Forwarded-For.
  const candidateIp = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  const ip = candidateIp.length > 0 && candidateIp.length <= 64 ? candidateIp : null;
  const attemptKey = await sha256(`${username}\n${ip ?? "no-ip"}`);
  const usernameAttemptKey = await sha256(`username\n${username}`);
  const ipAttemptKey = ip ? await sha256(`ip\n${ip}`) : null;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: allowed, error: rateError } = await admin.rpc("consume_student_login_attempt", {
    p_attempt_key: attemptKey,
  });
  if (rateError) return json({ error: "Authentication service unavailable" }, 503);
  if (allowed !== true) return json({ error: "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مجددًا." }, 429);

  const { data: usernameAllowed, error: usernameRateError } = await admin.rpc("consume_student_login_username_attempt", {
    p_attempt_key: usernameAttemptKey,
  });
  if (usernameRateError) return json({ error: "Authentication service unavailable" }, 503);
  if (usernameAllowed !== true) return json({ error: "محاولات كثيرة لهذا المستخدم. انتظر 15 دقيقة ثم حاول مجددًا." }, 429);

  if (ipAttemptKey) {
    const { data: ipAllowed, error: ipRateError } = await admin.rpc("consume_student_login_ip_attempt", {
      p_attempt_key: ipAttemptKey,
    });
    if (ipRateError) return json({ error: "Authentication service unavailable" }, 503);
    if (ipAllowed !== true) return json({ error: "محاولات كثيرة من هذا الاتصال. انتظر 15 دقيقة ثم حاول مجددًا." }, 429);
  }

  const { data: userId, error: lookupError } = await admin.rpc("resolve_student_login_user_id", {
    p_username: username,
  });
  if (lookupError) return json({ error: "Authentication service unavailable" }, 503);

  // Resolve the current email from Auth at sign-in time; no email copy is kept in the profile lookup table.
  const lookupId = typeof userId === "string" ? userId : "00000000-0000-0000-0000-000000000000";
  const userResult = await admin.auth.admin.getUserById(lookupId);
  if (typeof userId === "string" && userResult.error) {
    return json({ error: "Authentication service unavailable" }, 503);
  }

  // Keep the response generic so callers cannot distinguish unknown usernames from bad passwords.
  const loginEmail = userResult.data.user?.email ?? `unregistered-${attemptKey.slice(0, 16)}@invalid.example`;
  const { data, error } = await auth.auth.signInWithPassword({ email: loginEmail, password });
  if (error || !data.session) {
    return json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." }, 401);
  }

  return json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    token_type: data.session.token_type,
    user: data.user,
  });
});
