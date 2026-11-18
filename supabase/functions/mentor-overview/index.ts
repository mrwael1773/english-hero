import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigin = "https://mrwael1773.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store, private" },
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin) return response({ error: "Origin not allowed" }, 403);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!/^[0-9a-f]{64}$/.test(token)) return response({ error: "Invalid or expired link" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return response({ error: "Server configuration error" }, 500);

  const api = supabaseUrl.replace(/\/$/, "") + "/rest/v1/";
  const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" };

  try {
    const tokenHash = await sha256(token);
    const tokenQuery = new URLSearchParams({
      select: "token_hash,expires_at,revoked_at",
      token_hash: "eq." + tokenHash,
      revoked_at: "is.null",
      expires_at: "gt." + new Date().toISOString(),
      limit: "1",
    });
    const tokenRes = await fetch(api + "mentor_link_tokens?" + tokenQuery, { headers, cache: "no-store" });
    if (!tokenRes.ok) return response({ error: "Authorization unavailable" }, 503);
    const tokenRows = await tokenRes.json();
    if (!Array.isArray(tokenRows) || tokenRows.length !== 1) return response({ error: "Invalid or expired link" }, 401);

    const updateRes = await fetch(api + "mentor_link_tokens?token_hash=eq." + tokenHash + "&revoked_at=is.null", {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    });
    if (!updateRes.ok) return response({ error: "Could not validate access" }, 503);

    const [profilesRes, progressRes, activityRes] = await Promise.all([
      fetch(api + "student_profiles?select=user_id,username,display_name&order=display_name.asc", { headers, cache: "no-store" }),
      fetch(api + "learning_progress?select=user_id,progress", { headers, cache: "no-store" }),
      fetch(api + "student_activity?select=user_id,last_seen_at", { headers, cache: "no-store" }),
    ]);
    if (!profilesRes.ok || !progressRes.ok || !activityRes.ok) {
      return response({ error: "Student overview unavailable" }, 503);
    }

    const [profiles, progressRows, activityRows] = await Promise.all([
      profilesRes.json(), progressRes.json(), activityRes.json(),
    ]);
    const progressByUser = new Map(progressRows.map((row: any) => [row.user_id, row.progress || {}]));
    const activityByUser = new Map(activityRows.map((row: any) => [row.user_id, row.last_seen_at]));
    const students = profiles.map((profile: any) => {
      const progress: any = progressByUser.get(profile.user_id) || {};
      return {
        username: profile.username || null,
        display_name: profile.display_name || null,
        last_seen_at: activityByUser.get(profile.user_id) || null,
        progress: {
          xp: typeof progress.xp === "number" ? progress.xp : null,
          completed: Array.isArray(progress.completed) ? progress.completed : [],
          masteredLessons: Array.isArray(progress.masteredLessons) ? progress.masteredLessons : [],
        },
      };
    });
    return response({ students, generated_at: new Date().toISOString() });
  } catch {
    return response({ error: "Request could not be completed" }, 500);
  }
});
