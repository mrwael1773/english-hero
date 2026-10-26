// Supabase Edge Function: english-coach
// Configure OPENAI_API_KEY as a Supabase Function secret before deployment.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://mrwael1773.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  let anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!anonKey) {
    // Newer Supabase projects may expose a map of publishable-key env-var names.
    try {
      const keyNames = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}") as Record<string, string>;
      const keyName = keyNames.default || Object.values(keyNames)[0];
      if (keyName) anonKey = Deno.env.get(keyName) || undefined;
    } catch (_) { /* fall through to a clear configuration error */ }
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

  const history = Array.isArray(body.history) ? body.history.slice(-10).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { role?: unknown; content?: unknown };
    if (!["user", "assistant"].includes(String(row.role)) || typeof row.content !== "string") return [];
    return [{ role: row.role as "user" | "assistant", content: row.content.slice(0, 1200) }];
  }) : [];

  const instructions = `You are English Hero, a friendly English conversation coach for Arabic-speaking learners, often beginners.
Speak naturally and keep replies short and encouraging. Continue the conversation based on the learner's message.
When the learner writes or says English with a mistake, gently show a corrected version and explain the key correction briefly in Arabic, then ask one simple follow-up question in English. If their English is correct, praise them briefly and continue with one natural question in English. If they write Arabic, help them express it in simple English and invite them to try. Adapt difficulty gradually; never overwhelm the learner with multiple questions. Do not claim to hear audio: you receive a text transcript. `;

  try {
    const aiController = new AbortController();
    const aiTimeout = setTimeout(() => aiController.abort(), 18000);
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openAIKey}`, "Content-Type": "application/json" },
        signal: aiController.signal,
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          instructions,
          input: [...history, { role: "user", content: message }],
          max_output_tokens: 350,
        }),
      });
    } catch (requestError) {
      if (aiController.signal.aborted) return json({ error: "The AI response took too long. Please try again." }, 504);
      throw requestError;
    } finally {
      clearTimeout(aiTimeout);
    }
    const result = await response.json();
    if (!response.ok) {
      const apiError = result?.error && typeof result.error === "object" ? result.error : {};
      const errorCode = String(apiError.code || "");
      console.error("OpenAI Responses API error", response.status, JSON.stringify(result).slice(0, 1000));
      if (response.status === 429 && ["insufficient_quota", "credit_balance_exhausted"].includes(errorCode)) {
        return json({ error: "خدمة المحادثة متوقفة مؤقتًا لأن رصيد OpenAI API غير كافٍ. يجب تجديد الرصيد من لوحة فوترة OpenAI حتى تعود الردود." }, 503);
      }
      if (response.status === 429) {
        return json({ error: "وصلت خدمة المحادثة إلى حد الطلبات مؤقتًا. انتظر قليلًا ثم حاول مرة أخرى." }, 429);
      }
      return json({ error: "The AI service could not answer right now. Please try again shortly." }, 502);
    }
    const reply = typeof result.output_text === "string" ? result.output_text.trim() : "";
    if (!reply) return json({ error: "The AI returned an empty reply. Please try again." }, 502);
    return json({ reply });
  } catch (error) {
    console.error("English coach request failed", error);
    return json({ error: "Could not reach the AI service. Check the server connection and try again." }, 502);
  }
});
