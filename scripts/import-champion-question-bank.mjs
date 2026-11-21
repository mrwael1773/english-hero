#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_QUESTIONS = 840;
const LESSON_COUNT = 84;
const QUESTIONS_PER_LESSON = 10;
const PRODUCTION_PROJECT_REF = "cajevfsdhtbhtzcphbsz";

export function validateQuestionBank(questions) {
  const errors = [];
  if (!Array.isArray(questions) || questions.length !== EXPECTED_QUESTIONS) {
    return [`Expected exactly ${EXPECTED_QUESTIONS} questions.`];
  }

  const lessonCounts = new Map();
  const prompts = new Set();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q || typeof q !== "object" || Array.isArray(q)) {
      errors.push(`Question ${i + 1} must be an object.`);
      continue;
    }
    if (!Number.isInteger(q.lesson_index) || q.lesson_index < 0 || q.lesson_index >= LESSON_COUNT) {
      errors.push(`Question ${i + 1} has an invalid lesson_index.`);
      continue;
    }
    lessonCounts.set(q.lesson_index, (lessonCounts.get(q.lesson_index) ?? 0) + 1);

    if (typeof q.prompt !== "string" || q.prompt.trim().length < 1 || q.prompt.trim().length > 300) {
      errors.push(`Question ${i + 1} has an invalid prompt.`);
    } else {
      const key = `${q.lesson_index}:${q.prompt.trim().toLocaleLowerCase()}`;
      if (prompts.has(key)) errors.push(`Question ${i + 1} duplicates a prompt in its lesson.`);
      prompts.add(key);
    }

    if (!Array.isArray(q.options) || q.options.length !== 4 ||
        !q.options.every(option => typeof option === "string" && option.trim().length > 0 && option.trim().length <= 120) ||
        new Set(q.options.map(option => option.trim().toLocaleLowerCase())).size !== 4) {
      errors.push(`Question ${i + 1} must have four distinct, non-empty options.`);
    }

    if (!Number.isInteger(q.correct_option) || q.correct_option < 0 || q.correct_option > 3) {
      errors.push(`Question ${i + 1} has an invalid correct_option.`);
    }
  }

  for (let lesson = 0; lesson < LESSON_COUNT; lesson++) {
    if (lessonCounts.get(lesson) !== QUESTIONS_PER_LESSON) {
      errors.push(`Lesson ${lesson + 1} must have exactly ${QUESTIONS_PER_LESSON} questions.`);
    }
  }
  return errors;
}

function projectRefFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1") return "local";
    return host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  } catch {
    return null;
  }
}

export async function importQuestionBank({ filePath, env = process.env, fetchImpl = fetch, dryRun = false }) {
  if (!filePath) throw new Error("Provide the private question-bank JSON file path.");
  const questions = JSON.parse(readFileSync(resolve(filePath), "utf8"));
  const errors = validateQuestionBank(questions);
  if (errors.length) throw new Error(`Question bank validation failed:\n- ${errors.slice(0, 20).join("\n- ")}`);

  const supabaseUrl = env.SUPABASE_URL ?? "";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the server-side environment.");
  }
  const projectRef = projectRefFromUrl(supabaseUrl);
  if (!projectRef) throw new Error("SUPABASE_URL must be a valid Supabase project URL.");
  if (projectRef === PRODUCTION_PROJECT_REF && env.ENGLISH_HERO_ALLOW_PRODUCTION_IMPORT !== "YES") {
    throw new Error("Production import is blocked. A separate explicit authorization flag is required.");
  }
  if (dryRun) return { dryRun: true, questions: questions.length, lessons: LESSON_COUNT, projectRef };

  const response = await fetchImpl(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/import_student_champion_question_bank`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_questions: questions }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Private question-bank import failed (HTTP ${response.status}): ${detail}`);
  }
  const inserted = await response.json();
  if (inserted !== EXPECTED_QUESTIONS) {
    throw new Error(`Import returned an unexpected inserted-row count: ${String(inserted)}`);
  }
  return { imported: inserted, lessons: LESSON_COUNT, projectRef };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find(arg => !arg.startsWith("--"));
  try {
    const result = await importQuestionBank({ filePath, dryRun });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Question-bank import failed.");
    process.exitCode = 1;
  }
}
