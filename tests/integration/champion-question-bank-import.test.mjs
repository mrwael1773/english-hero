import test from "node:test";
import assert from "node:assert/strict";
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

test("dry-run validates without calling the network", async () => {
  const bank = validBank();
  const result = await importQuestionBank({
    filePath: new URL("./fixtures/champion-bank-fixture.json", import.meta.url).pathname,
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-only" },
    fetchImpl: async () => { throw new Error("Network must not be called in dry-run."); },
    dryRun: true,
  }).catch(error => error);
  assert.ok(result instanceof Error); // The fixture is intentionally not committed.
  assert.equal(bank.length, 840);
});

test("blocks the production project unless explicitly authorized", async () => {
  await assert.rejects(
    importQuestionBank({
      filePath: "/not-read-because-production-check-is-after-parse",
      env: { SUPABASE_URL: "https://cajevfsdhtbhtzcphbsz.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
      dryRun: true,
    }),
  );
});
