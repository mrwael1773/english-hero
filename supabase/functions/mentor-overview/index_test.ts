import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { handleMentorOverview } from "./index.ts";

const origin = "https://mrwael1773.github.io";
const token = "a".repeat(64);

function request(auth = "Bearer " + token, requestOrigin = origin) {
  return new Request("https://project.example/functions/v1/mentor-overview", {
    method: "POST",
    headers: { authorization: auth, origin: requestOrigin },
    body: "{}",
  });
}

Deno.test("rejects a malformed bearer token without contacting Supabase", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (() => {
    called = true;
    throw new Error("fetch should not run");
  }) as typeof fetch;
  try {
    const response = await handleMentorOverview(request("Bearer invalid"));
    assertEquals(response.status, 401);
    assertEquals(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("hashes the bearer token and sends only the hash to the atomic RPC", async () => {
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  Deno.env.set("SUPABASE_URL", "https://project.supabase.co/");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-secret");
  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Response.json({ students: [], generated_at: "2026-11-21T00:00:00Z" });
  }) as typeof fetch;
  try {
    const response = await handleMentorOverview(request());
    assertEquals(response.status, 200);
    assertEquals(capturedUrl, "https://project.supabase.co/rest/v1/rpc/mentor_get_student_overview");
    const body = JSON.parse(String(capturedInit?.body));
    const expectedHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
      byte => byte.toString(16).padStart(2, "0"),
    ).join("");
    assertEquals(body.p_token_hash, expectedHash);
    assertEquals(JSON.stringify(body).includes(token), false);
    assertEquals((capturedInit?.headers as Record<string, string>).Authorization, "Bearer server-only-test-secret");
    const output = await response.json();
    assertEquals(Array.isArray(output.students), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", oldUrl);
    if (oldKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
  }
});

Deno.test("maps an expired or revoked token from the RPC to unauthorized", async () => {
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const originalFetch = globalThis.fetch;
  Deno.env.set("SUPABASE_URL", "https://project.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-secret");
  globalThis.fetch = (async () => Response.json(
    { code: "28000", message: "Invalid or expired mentor link" },
    { status: 400 },
  )) as typeof fetch;
  try {
    const response = await handleMentorOverview(request());
    assertEquals(response.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", oldUrl);
    if (oldKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
  }
});

Deno.test("rejects requests from an unapproved origin", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (() => {
    called = true;
    throw new Error("fetch should not run");
  }) as typeof fetch;
  try {
    const response = await handleMentorOverview(request("Bearer " + token, "https://attacker.example"));
    assertEquals(response.status, 403);
    assertEquals(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("returns unavailable when the RPC response is malformed", async () => {
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const originalFetch = globalThis.fetch;
  Deno.env.set("SUPABASE_URL", "https://project.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-secret");
  globalThis.fetch = (async () => Response.json({ unexpected: true })) as typeof fetch;
  try {
    const response = await handleMentorOverview(request());
    assertEquals(response.status, 503);
    const body = await response.text();
    assertStringIncludes(body, "Student overview unavailable");
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", oldUrl);
    if (oldKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
  }
});
