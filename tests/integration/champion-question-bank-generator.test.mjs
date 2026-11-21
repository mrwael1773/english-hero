import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractLessons, buildQuestionBank } from "../../scripts/build-champion-question-bank.mjs";
import { validateQuestionBank } from "../../scripts/import-champion-question-bank.mjs";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const lessons = extractLessons(html);
const bank = buildQuestionBank(lessons);

test("extracts all 84 current lessons with six source words each", () => {
  assert.equal(lessons.length, 84);
  assert.ok(lessons.every(lesson => lesson.words.length === 6));
  assert.deepEqual(lessons[83].words, [
    { en: "bring", ar: "يحضر" },
    { en: "carry", ar: "يحمل" },
    { en: "put", ar: "يضع" },
    { en: "keep", ar: "يحتفظ" },
    { en: "find", ar: "يجد" },
    { en: "lose", ar: "يفقد" },
  ]);
});

test("generates ten unique, four-option questions per lesson", () => {
  assert.equal(bank.length, 840);
  assert.deepEqual(validateQuestionBank(bank), []);
  for (let lesson = 0; lesson < 84; lesson++) {
    const questions = bank.filter(question => question.lesson_index === lesson);
    assert.equal(questions.length, 10);
    assert.equal(new Set(questions.map(question => question.prompt.toLocaleLowerCase())).size, 10);
    assert.ok(questions.every(question => question.options.length === 4));
  }
});

test("includes six English-to-Arabic and four Arabic-to-English questions per lesson", () => {
  for (let lesson = 0; lesson < 84; lesson++) {
    const questions = bank.filter(question => question.lesson_index === lesson);
    assert.equal(questions.filter(question => question.prompt.startsWith("What does ")).length, 6);
    assert.equal(questions.filter(question => question.prompt.startsWith("ما الكلمة الإنجليزية")).length, 4);
  }
});

test("reverse questions do not use a translation shared by multiple words", () => {
  for (let lesson = 0; lesson < 84; lesson++) {
    const words = lessons[lesson].words;
    const reverse = bank.filter(question => question.lesson_index === lesson && question.prompt.startsWith("ما الكلمة الإنجليزية"));
    for (const question of reverse) {
      const translation = question.prompt.match(/"([^"]+)"\؟$/)?.[1];
      assert.ok(translation);
      assert.equal(words.filter(word => word.ar.toLocaleLowerCase() === translation.toLocaleLowerCase()).length, 1);
    }
  }
});
