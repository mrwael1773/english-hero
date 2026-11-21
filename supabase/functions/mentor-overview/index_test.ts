import { handleMentorOverview, sanitizeOverview } from "./index.ts";

const origin = "https://mrwael1773.github.io";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}
const token = "a".repeat(64);

function request(auth = "Bearer " + token, requestOrigin = origin) {
  return new Request("https://project.example/functions/v1/mentor-overview", {
    method: "POST",
    headers: { authorization: auth, origin: requestOrigin },
    body: "{}",
  });
}

function withSupabaseMock(mock: typeof fetch) {
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const originalFetch = globalThis.fetch;
  Deno.env.set("SUPABASE_URL", "https://project.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-secret");
  globalThis.fetch = mock;
  return () => {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", oldUrl);
    if (oldKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
  };
}


Deno.test("sanitizes the complete mentor progress contract", () => {
  const sanitized = sanitizeOverview({
    generated_at: "2026-11-21T00:00:00Z",
    students: [{
      display_name: "Learner", last_seen_at: null,
      progress: {
        xp: 12, completed_count: 3, mastered_count: 2, started_count: 4, trained_count: 3,
        mastered_indices: [0, 1], trained_indices: [2], started_indices: [0, 1, 2, 3],
        saved_words_count: 5, foundation_saved_count: 2, review_words_count: 4,
        review_due_count: 1, missed_words_count: 1, quiz_attempts: 3,
        best_quiz_score: 90, answers_count: 10, correct_answers_count: 8,
        active_days_count: 5, learning_streak: 2, vocab_level: "all", vocab_position: 5,
        reading_completed: ["letter-sounds", "digraphs"],
        current_lesson_index: 3, current_word_index: 2,
        last_action: "lesson_progress", last_action_at: "2026-11-21T00:00:00Z",
        last_action_lesson_index: 3, last_action_word_index: 2
      }
    }]
  });
  assertEquals(sanitized !== null, true);
});

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

Deno.test("hashes the bearer token and returns only allowlisted student fields", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const restore = withSupabaseMock((async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Response.json({
      generated_at: "2026-11-21T00:00:00Z",
      internal_debug: "must-not-leak",
      students: [{
        username: "learner",
        display_name: "Learner",
        last_seen_at: null,
        email: "private@example.test",
        progress: {
          xp: 12, completed_count: 3, mastered_count: 2, started_count: 4, trained_count: 3,
          mastered_indices: [0, 1], trained_indices: [2], started_indices: [0, 1, 2, 3],
          saved_words_count: 5, foundation_saved_count: 2, review_words_count: 4,
          review_due_count: 1, missed_words_count: 1, quiz_attempts: 3,
          best_quiz_score: 90, answers_count: 10, correct_answers_count: 8,
          active_days_count: 5, learning_streak: 2, vocab_level: "all", vocab_position: 5,
          reading_completed: ["letter-sounds", "digraphs"],
          current_lesson_index: 3, current_word_index: 2,
          last_action: "lesson_progress", last_action_at: "2026-11-21T00:00:00Z",
          last_action_lesson_index: 3, last_action_word_index: 2,
          raw_answers: ["private"]
        },
      }],
    });
  }) as typeof fetch);
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
    assertEquals(output.students[0].display_name, "Learner");
    assertEquals("username" in output.students[0], false);
    assertEquals("email" in output.students[0], false);
    assertEquals("internal_debug" in output, false);
    assertEquals("raw_answers" in output.students[0].progress, false);
    assertEquals(output.students[0].progress.current_lesson_index, 3);
    assertEquals(output.students[0].progress.last_action, "lesson_progress");
    assertEquals(output.students[0].progress.saved_words_count, 5);
    assertEquals(output.students[0].progress.review_due_count, 1);
    assertEquals(output.students[0].progress.quiz_attempts, 3);
    assertEquals(output.students[0].progress.active_days_count, 5);
    assertEquals(output.students[0].progress.vocab_position, 5);
    assertEquals(output.students[0].progress.mastered_indices.length, 2);
    assertEquals(output.students[0].progress.reading_completed.length, 2);
    assertEquals(output.students[0].progress.reading_completed[1], "digraphs");
    assertEquals("raw_answers" in output.students[0].progress, false);
    assertEquals("email" in output.students[0].progress, false);
  } finally {
    restore();
  }
});

Deno.test("rejects malformed student records instead of returning partial data", async () => {
  const restore = withSupabaseMock((async () => Response.json({
    generated_at: "2026-11-21T00:00:00Z",
    students: [{ username: "learner", display_name: "Learner", last_seen_at: null,
      progress: { xp: 4, completed_count: -1, mastered_count: 1 } }],
  })) as typeof fetch);
  try {
    const response = await handleMentorOverview(request());
    assertEquals(response.status, 503);
    const body = await response.text();
    assertEquals(body.includes("Student overview unavailable"), true);
  } finally {
    restore();
  }
});

Deno.test("maps an expired or revoked token from the RPC to unauthorized", async () => {
  const restore = withSupabaseMock((async () => Response.json(
    { code: "28000", message: "Invalid or expired mentor link" },
    { status: 400 },
  )) as typeof fetch);
  try {
    const response = await handleMentorOverview(request());
    assertEquals(response.status, 401);
  } finally {
    restore();
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
  const restore = withSupabaseMock((async () => Response.json({ unexpected: true })) as typeof fetch);
  try {
    const response = await handleMentorOverview(request());
    assertEquals(response.status, 503);
    const body = await response.text();
    assertEquals(body.includes("Student overview unavailable"), true);
  } finally {
    restore();
  }
});

Deno.test("rejects an unknown learning activity action in the overview payload", async () => {
  const restore = withSupabaseMock((async () => Response.json({
    generated_at: "2026-11-21T00:00:00Z",
    students: [{
      username: "learner", display_name: "Learner", last_seen_at: null,
      progress: {
        xp: 4, completed_count: 1, mastered_count: 1, started_count: 1, trained_count: 0,
        mastered_indices: [0], trained_indices: [], started_indices: [0],
        saved_words_count: 0, foundation_saved_count: 0, review_words_count: 0,
        review_due_count: 0, missed_words_count: 0, quiz_attempts: 0,
        best_quiz_score: 0, answers_count: 0, correct_answers_count: 0,
        active_days_count: 0, learning_streak: 0, vocab_level: "all", vocab_position: null,
        reading_completed: [],
        current_lesson_index: null, current_word_index: null,
        last_action: "raw_answers_requested", last_action_at: "2026-11-21T00:00:00Z",
        last_action_lesson_index: null, last_action_word_index: null
      }
    }]
  })) as typeof fetch);
  try {
    const response = await handleMentorOverview(request());
    assertEquals(response.status, 503);
  } finally {
    restore();
  }
});
