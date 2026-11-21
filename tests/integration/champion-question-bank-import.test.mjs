import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateQuestionBank, importQuestionBank } from "../../scripts/import-champion-question-bank.mjs";

function validBank() {
  return Array.from({ length: 84 * 10 }, (_, i) => {
    const lesson_index = Math.floor(i / 10);
    const n = i % 10;
    return {
      lesson_index,
      prompt: `Lesson ${lesson_index + 1} question ${n + 1}`,
      options: [`Correct ${i}`, `Option A ${i}`, `Option B ${i}`, `Option C ${i}`],
      correct_option: 0,
    };
  });
}

function withBankFile(t, bank = validBank()) {
  const dir = mkdtempSync(join(tmpdir(), "english-hero-champions-"));
  const filePath = join(dir, "private-question-bank.json");
  writeFileSync(filePath, JSON.stringify(bank), { mode: 0o600 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return filePath;
}

test("accepts exactly ten unique four-option questions for each lesson", () => {
  assert.deepEqual(validateQuestionBank(validBank()), []);
});

test("rejects a partial bank", () => {
  assert.match(validateQuestionBank(validBank().slice(0, 839))[0], /exactly 840/);
});

test("rejects duplicate options", () => {
  const bank = validBank();
  bank[0].options[3] = bank[0].options[0];
  assert.ok(validateQuestionBank(bank).some(error => /four distinct/.test(error)));
});

test("rejects duplicate prompts within one lesson", () => {
  const bank = validBank();
  bank[1].prompt = bank[0].prompt;
  assert.ok(validateQuestionBank(bank).some(error => /duplicates a prompt/.test(error)));
});

test("rejects a lesson with the wrong question count", () => {
  const bank = validBank();
  bank[0].lesson_index = 1;
  assert.ok(validateQuestionBank(bank).some(error => /Lesson 1 must have exactly 10/.test(error)));
});

test("dry-run validates a complete private file without calling the network", async t => {
  const filePath = withBankFile(t);
  const result = await importQuestionBank({
    filePath,
    env: { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "test-only" },
    fetchImpl: async () => { throw new Error("Network must not be called in dry-run."); },
    dryRun: true,
  });
  assert.deepEqual(result, { dryRun: true, questions: 840, lessons: 84, projectRef: "local" });
});

test("blocks the production project unless explicitly authorized", async t => {
  const filePath = withBankFile(t);
  await assert.rejects(
    importQuestionBank({
      filePath,
      env: { SUPABASE_URL: "https://cajevfsdhtbhtzcphbsz.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
      dryRun: true,
    }),
    /Production import is blocked/,
  );
});

test("posts the private payload once and never prints the service key", async t => {
  const filePath = withBankFile(t);
  let request;
  const result = await importQuestionBank({
    filePath,
    env: { SUPABASE_URL: "https://knjcyuvhaoievxkzcdog.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret-test-value" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response("840", { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(request.url, "https://knjcyuvhaoievxkzcdog.supabase.co/rest/v1/rpc/import_student_champion_question_bank");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.authorization, "Bearer secret-test-value");
  assert.equal(JSON.parse(request.options.body).p_questions.length, 840);
  assert.deepEqual(result, { imported: 840, lessons: 84, projectRef: "knjcyuvhaoievxkzcdog" });
});
