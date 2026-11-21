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

function sanitizeOverview(payload: unknown): { students: Record<string, unknown>[]; generated_at: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const source = payload as Record<string, unknown>;
  if (!Array.isArray(source.students) || typeof source.generated_at !== "string" ||
      !Number.isFinite(Date.parse(source.generated_at))) return null;

  const allowedActions = new Set([
    "lesson_started",
    "lesson_progress",
    "lesson_training_completed",
    "lesson_assessment_attempted",
    "lesson_mastered",
    "quiz_completed",
  ]);
  const readingStageIds = ["letter-sounds","digraphs","short-vowels","blends","cvc","magic-e","vowel-teams","r-controlled","diphthongs","syllables","practice"];
  const validReading = (value: unknown): value is string[] => Array.isArray(value) && value.length <= readingStageIds.length &&
    value.every((id: unknown, index: number) => id === readingStageIds[index]);
  const students: Record<string, unknown>[] = [];
  for (const value of source.students) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const student = value as Record<string, unknown>;
    const progress = student.progress;
    if ((student.display_name !== null && typeof student.display_name !== "string") ||
        (student.last_seen_at !== null && typeof student.last_seen_at !== "string") ||
        !progress || typeof progress !== "object" || Array.isArray(progress)) return null;

    const stats = progress as Record<string, unknown>;
    const validCount = (number: unknown) => Number.isSafeInteger(number) && (number as number) >= 0;
    const optionalIndex = (number: unknown) => number === null || (validCount(number) && (number as number) <= 99);
    const validIndexArray = (value: unknown): value is number[] => Array.isArray(value) && value.length <= 100 &&
      value.every((index: unknown) => validCount(index) && index <= 99);
    if (!validIndexArray(stats.mastered_indices) || !validIndexArray(stats.trained_indices) ||
        !validIndexArray(stats.started_indices) ||
        !validReading(stats.reading_completed) ||
        ![stats.saved_words_count, stats.foundation_saved_count, stats.review_words_count,
          stats.review_due_count, stats.missed_words_count, stats.quiz_attempts,
          stats.answers_count, stats.correct_answers_count, stats.active_days_count,
          stats.learning_streak].every(validCount) ||
        !(stats.best_quiz_score === null || (validCount(stats.best_quiz_score) && stats.best_quiz_score <= 100)) ||
        !(stats.vocab_level === null || (typeof stats.vocab_level === "string" && stats.vocab_level.length <= 24)) ||
        !validCount(stats.completed_count) || !validCount(stats.mastered_count) ||
        !validCount(stats.started_count) || !validCount(stats.trained_count) ||
        !(stats.xp === null || validCount(stats.xp)) ||
        !optionalIndex(stats.current_lesson_index) ||
        !optionalIndex(stats.current_word_index) ||
        !optionalIndex(stats.last_action_lesson_index) ||
        !optionalIndex(stats.last_action_word_index) ||
        !(stats.last_action === null || (typeof stats.last_action === "string" && allowedActions.has(stats.last_action))) ||
        !(stats.last_action_at === null || (typeof stats.last_action_at === "string" && Number.isFinite(Date.parse(stats.last_action_at))))) return null;

    // Explicit allowlist: unexpected database fields never leave this function.
    students.push({
      display_name: student.display_name,
      last_seen_at: student.last_seen_at,
      progress: {
        xp: stats.xp,
        completed_count: stats.completed_count,
        mastered_count: stats.mastered_count,
        started_count: stats.started_count,
        trained_count: stats.trained_count,
        mastered_indices: stats.mastered_indices,
        trained_indices: stats.trained_indices,
        started_indices: stats.started_indices,
        saved_words_count: stats.saved_words_count,
        foundation_saved_count: stats.foundation_saved_count,
        review_words_count: stats.review_words_count,
        review_due_count: stats.review_due_count,
        missed_words_count: stats.missed_words_count,
        quiz_attempts: stats.quiz_attempts,
        best_quiz_score: stats.best_quiz_score,
        answers_count: stats.answers_count,
        correct_answers_count: stats.correct_answers_count,
        active_days_count: stats.active_days_count,
        learning_streak: stats.learning_streak,
        vocab_level: stats.vocab_level,
        reading_completed: stats.reading_completed,
        current_lesson_index: stats.current_lesson_index,
        current_word_index: stats.current_word_index,
        last_action: stats.last_action,
        last_action_at: stats.last_action_at,
        last_action_lesson_index: stats.last_action_lesson_index,
        last_action_word_index: stats.last_action_word_index,
      },
    });
  }
  return { students, generated_at: source.generated_at };
}

export async function handleMentorOverview(req: Request): Promise<Response> {
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

    const safePayload = sanitizeOverview(payload);
    if (!safePayload) return response({ error: "Student overview unavailable" }, 503);
    return response(safePayload);
  } catch {
    return response({ error: "Request could not be completed" }, 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleMentorOverview);
}
