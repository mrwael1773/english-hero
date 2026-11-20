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
  if (origin !== allowedOrigin) return response({ error: "Origin not allowed" }, 403);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!/^[0-9a-f]{64}$/.test(token)) return response({ error: "Invalid or expired link" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return response({ error: "Server configuration error" }, 500);

  try {
    const tokenHash = await sha256(token);
    const rpcResponse = await fetch(
      supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/mentor_get_student_overview",
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: "Bearer " + serviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_token_hash: tokenHash }),
        cache: "no-store",
      },
    );

    const payload = await rpcResponse.json().catch(() => null);
    if (!rpcResponse.ok) {
      if (payload?.code === "28000") {
        return response({ error: "Invalid or expired link" }, 401);
      }
      return response({ error: "Student overview unavailable" }, 503);
    }

    if (!payload || !Array.isArray(payload.students) || typeof payload.generated_at !== "string") {
      return response({ error: "Student overview unavailable" }, 503);
    }

    return response(payload);
  } catch {
    return response({ error: "Request could not be completed" }, 500);
  }
});
