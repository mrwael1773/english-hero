import { assertEquals, assert } from "jsr:@std/assert@1";
import { prepareChallenge, validAnswers } from "./index.ts";

Deno.test("challenge selection hides answer keys and preserves randomized correct choices", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    prompt: `Question ${index}`,
    options: [`wrong-a-${index}`, `wrong-b-${index}`, `correct-${index}`, `wrong-c-${index}`],
    correct_option: 2,
  }));
  const prepared = prepareChallenge(rows);
  assert(prepared);
  assertEquals(prepared.questions.length, 10);
  assertEquals(prepared.answerKey.length, 10);
  prepared.questions.forEach((question, index) => {
    const source = rows.find((row) => row.prompt === question.prompt);
    assert(source);
    assertEquals(question.options.length, 4);
    assertEquals(question.options[prepared.answerKey[index]], source.options[source.correct_option]);
    assertEquals(Object.keys(question).sort(), ["options", "prompt"]);
  });
});

Deno.test("invalid and insufficient question banks fail closed", () => {
  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    prompt: "Question",
    options: ["A", "B", "C", "D"],
    correct_option: 0,
  };
  assertEquals(prepareChallenge(Array(9).fill(row)), null);
  assertEquals(prepareChallenge(Array.from({ length: 10 }, (_, i) => ({
    ...row, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    options: ["same", "same", "C", "D"],
  }))), null);
  assertEquals(prepareChallenge(Array.from({ length: 10 }, (_, i) => ({
    ...row, id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    prompt: "Repeated prompt",
  }))), null);
});

Deno.test("answers must contain exactly ten valid option indexes", () => {
  assert(validAnswers(Array(10).fill(0)));
  assertEquals(validAnswers(Array(9).fill(0)), false);
  assertEquals(validAnswers([...Array(9).fill(0), 4]), false);
  assertEquals(validAnswers([...Array(9).fill(0), "0"]), false);
});
