// Supabase Edge Function: english-coach
// Required secret: OPENAI_API_KEY. Configure it in Supabase Function secrets; never commit it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://mrwael1773.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

const requestWindows = new Map<string, { startedAt: number; count: number }>();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  let anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!anonKey) {
    try {
      const keyNames = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}") as Record<string, string>;
      const keyName = keyNames.default || Object.values(keyNames)[0];
      if (keyName) anonKey = Deno.env.get(keyName) || undefined;
    } catch (_) { /* handled below */ }
  }
  const openAIKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "Supabase function configuration is incomplete." }, 500);
  if (!openAIKey) return json({ error: "OPENAI_API_KEY is not configured in Supabase function secrets." }, 503);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Please sign in to use the English coach." }, 401);
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const accessToken = auth.slice("Bearer ".length).trim();
  const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return json({ error: "Your session is invalid. Please sign in again." }, 401);

  let body: { message?: unknown; history?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 1200) : "";
  if (!message) return json({ error: "Write or say a message first." }, 400);
  // Best-effort per-user rate limit to reduce accidental loops and API-cost abuse.
  // This in-memory guard applies per running Edge Function instance.
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequestsPerWindow = 8;
  for (const [id, window] of requestWindows) {
    if (now - window.startedAt >= windowMs) requestWindows.delete(id);
  }
  let usage = requestWindows.get(user.id);
  if (!usage || now - usage.startedAt >= windowMs) {
    usage = { startedAt: now, count: 0 };
    requestWindows.set(user.id, usage);
  }
  if (usage.count >= maxRequestsPerWindow) {
    return json({ error: "وصلت الخدمة إلى حد الطلبات مؤقتًا. انتظر دقيقة ثم حاول مجددًا." }, 429);
  }
  usage.count += 1;
  if (requestWindows.size > 5000) {
    const oldest = requestWindows.keys().next().value;
    if (oldest) requestWindows.delete(oldest);
  }

  const history = Array.isArray(body.history) ? body.history.slice(-10).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { role?: unknown; content?: unknown };
    if (!["user", "assistant"].includes(String(row.role)) || typeof row.content !== "string") return [];
    return [{ role: row.role as "user" | "assistant", content: row.content.slice(0, 1200) }];
  }) : [];

  const instructions = `You are English Hero, a friendly English conversation coach for Arabic-speaking learners, often beginners.
Speak naturally and keep replies short and encouraging. Continue the conversation based on the learner's message.
When the learner writes or says English with a mistake, gently show a corrected version and explain the key correction briefly in Arabic, then ask one simple follow-up question in English. If their English is correct, praise them briefly and continue with one natural question in English. If they write Arabic, help them express it in simple English and invite them to try. Adapt difficulty gradually; never overwhelm the learner with multiple questions. Do not claim to hear audio: you receive a text transcript.`;

  const aiController = new AbortController();
  const aiTimeout = setTimeout(() => aiController.abort(), 15000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: aiController.signal,
      headers: { "Authorization": `Bearer ${openAIKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        instructions,
        input: [...history, { role: "user", content: message }],
        max_output_tokens: 350,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = String(result?.error?.code || "");
      const messageText = String(result?.error?.message || "");
      console.error("OpenAI Responses API error", response.status, code, messageText.slice(0, 300));
      if (code.includes("insufficient_quota") || code.includes("billing") || /quota|billing|credit balance/i.test(messageText)) {
        return json({ error: "رصيد OpenAI API غير كافٍ أو أن الفوترة غير مفعّلة. تحقق من إعدادات الفوترة في حساب OpenAI API." }, 503);
      }
      if (response.status === 429) return json({ error: "وصلت الخدمة إلى حد الطلبات مؤقتًا. انتظر قليلًا ثم حاول مجددًا." }, 429);
      return json({ error: "The AI service could not answer right now. Please try again shortly." }, 502);
    }
    const reply = typeof result.output_text === "string" ? result.output_text.trim() : "";
    if (!reply) return json({ error: "The AI returned an empty reply. Please try again." }, 502);
    return json({ reply });
  } catch (error) {
    if (aiController.signal.aborted) return json({ error: "انتهت مهلة الرد بعد 15 ثانية. حاول مرة أخرى." }, 504);
    console.error("English coach request failed", error);
    return json({ error: "Could not reach the AI service. Check the server connection and try again." }, 502);
  } finally {
    clearTimeout(aiTimeout);
  }
});
