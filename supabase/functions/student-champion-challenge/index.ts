import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("ENGLISH_HERO_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ENGLISH_HERO_ALLOWED_ORIGIN") ?? "https://mrwael1773.github.io";
const QUESTION_COUNT = 10;
const ATTEMPT_MINUTES = 15;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store, private" },
  });
}

type BankRow = {
  id: string;
  prompt: string;
  options: unknown;
  correct_option: number;
};

function randomIndex(max: number): number {
  if (!Number.isInteger(max) || max < 1) throw new Error("Invalid random range");
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function prepareChallenge(rows: BankRow[]) {
  const valid: BankRow[] = [];
  const seenIds = new Set<string>();
  const seenPrompts = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !/^[0-9a-f-]{36}$/i.test(row.id)) continue;
    if (typeof row.prompt !== "string" || row.prompt.trim().length < 1 || row.prompt.length > 300) continue;
    if (!Array.isArray(row.options) || row.options.length !== 4) continue;
    if (!row.options.every((option) => typeof option === "string" && option.trim().length > 0 && option.length <= 120)) continue;
    if (new Set((row.options as string[]).map((option) => option.trim().toLocaleLowerCase())).size !== 4) continue;
    if (!Number.isInteger(row.correct_option) || row.correct_option < 0 || row.correct_option > 3) continue;
    const promptKey = row.prompt.trim().toLocaleLowerCase();
    if (seenIds.has(row.id) || seenPrompts.has(promptKey)) continue;
    seenIds.add(row.id);
    seenPrompts.add(promptKey);
    valid.push(row);
  }
  if (valid.length < QUESTION_COUNT) return null;

  const selected = shuffle(valid).slice(0, QUESTION_COUNT);
  const answerKey: number[] = [];
  const questions = selected.map((row) => {
    const options = (row.options as string[]).map((text, originalIndex) => ({ text, originalIndex }));
    const randomized = shuffle(options);
    answerKey.push(randomized.findIndex((option) => option.originalIndex === row.correct_option));
    return { prompt: row.prompt.trim(), options: randomized.map((option) => option.text) };
  });
  return { questions, answerKey };
}

export function validAnswers(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === QUESTION_COUNT &&
    value.every((answer) => Number.isInteger(answer) && answer >= 0 && answer < 4);
}

export async function handleChampionChallenge(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("origin") !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "خدمة تحديات الأبطال غير مهيأة حاليًا." }, 503);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!token || token.length > 4096) return json({ error: "سجّل الدخول أولًا." }, 401);

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 8192) return json({ error: "الطلب أكبر من الحجم المسموح." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "طلب غير صالح." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "طلب غير صالح." }, 400);
  const payload = body as { action?: unknown; lesson_index?: unknown; attempt_id?: unknown; answers?: unknown };

  const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "انتهت جلسة الدخول. سجّل الدخول مجددًا." }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (payload.action === "start") {
    const lessonIndex = payload.lesson_index;
    if (!Number.isInteger(lessonIndex) || (lessonIndex as number) < 0 || (lessonIndex as number) > 83) {
      return json({ error: "رقم الدرس غير صالح." }, 400);
    }

    const { data: bankRows, error: bankError } = await admin.from("student_champion_question_bank")
      .select("id,prompt,options,correct_option")
      .eq("lesson_index", lessonIndex)
      .eq("active", true);
    if (bankError) {
      console.error("Champion question bank query failed", { code: bankError.code, message: bankError.message });
      return json({ error: "تعذر تحميل بنك التحديات." }, 503);
    }
    const prepared = prepareChallenge((bankRows ?? []) as BankRow[]);
    if (!prepared) return json({ error: "تحدي هذا الدرس غير متاح بعد. اختر درسًا آخر لاحقًا." }, 409);

    const expiresAt = new Date(Date.now() + ATTEMPT_MINUTES * 60 * 1000).toISOString();
    const { data: attemptId, error: reserveError } = await admin.rpc("start_student_champion_attempt", {
      p_user_id: authData.user.id,
      p_lesson_index: lessonIndex,
      p_answer_key: prepared.answerKey,
      p_expires_at: expiresAt,
    });
    if (reserveError) {
      console.error("Champion attempt reservation failed", { code: reserveError.code, message: reserveError.message });
      if (reserveError.code === "P0001" && reserveError.message?.includes("rate limit")) {
        return json({ error: "وصلت إلى حد المحاولات المؤقت. حاول بعد ساعة." }, 429);
      }
      return json({ error: "تعذر بدء التحدي. حاول مجددًا." }, 503);
    }
    if (typeof attemptId !== "string") return json({ error: "تعذر بدء التحدي. حاول مجددًا." }, 503);

    return json({
      attempt_id: attemptId,
      lesson_index: lessonIndex,
      expires_at: expiresAt,
      questions: prepared.questions,
    });
  }

  if (payload.action === "submit") {
    if (typeof payload.attempt_id !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.attempt_id) || !validAnswers(payload.answers)) {
      return json({ error: "الإجابات أو رقم المحاولة غير صالح." }, 400);
    }
    const { data, error } = await admin.rpc("complete_student_champion_attempt", {
      p_attempt_id: payload.attempt_id,
      p_user_id: authData.user.id,
      p_answers: payload.answers,
    });
    if (error) {
      console.error("Champion attempt completion failed", { code: error.code, message: error.message });
      if (error.code === "22023") return json({ error: "انتهت صلاحية المحاولة أو سبق إرسالها." }, 409);
      if (error.code === "42501") return json({ error: "المحاولة غير موجودة لهذا الحساب." }, 404);
      return json({ error: "تعذر تصحيح التحدي. حاول لاحقًا." }, 503);
    }
    return json(data);
  }

  return json({ error: "نوع الطلب غير معروف." }, 400);
}

if (import.meta.main) Deno.serve(handleChampionChallenge);
