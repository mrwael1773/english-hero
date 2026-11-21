#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LESSON_COUNT = 84;
const WORDS_PER_LESSON = 6;
const QUESTIONS_PER_LESSON = 10;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function extractLessons(html) {
  const lessonBlock = html.match(/const lessons=\[([\s\S]*?)\]\.map\(\(l,i\)=>/);
  const extraBlock = html.match(/const extraVocabulary = `([\s\S]*?)`\.trim\(\)\.split/);
  if (!lessonBlock || !extraBlock) throw new Error("Could not locate the current lesson vocabulary source.");

  const lessons = lessonBlock[1].split("\n")
    .filter(line => line.trim().startsWith("['"))
    .map((line, index) => {
      const triples = [...line.matchAll(/\['([^']*)','([^']*)','([^']*)'\]/g)].map(match => ({
        en: match[1].trim(),
        ar: match[2].trim(),
      }));
      const words = triples;
      if (words.length !== WORDS_PER_LESSON) throw new Error(`Source lesson ${index + 1} does not contain six words.`);
      return { lesson_index: index, words };
    });

  const extra = [...new Map(
    extraBlock[1].trim().split("\n")
      .map(line => line.split("|"))
      .filter(pair => pair.length === 2 && pair[0].trim() && pair[1].trim())
      .map(pair => [pair[0].trim().toLocaleLowerCase(), { en: pair[0].trim(), ar: pair[1].trim() }])
  ).values()].slice(0, 432);

  if (extra.length !== 432 || extra.length % WORDS_PER_LESSON !== 0) {
    throw new Error("The source must provide exactly 432 unique additional vocabulary pairs.");
  }
  for (let offset = 0; offset < extra.length; offset += WORDS_PER_LESSON) {
    lessons.push({
      lesson_index: lessons.length,
      words: extra.slice(offset, offset + WORDS_PER_LESSON),
    });
  }
  if (lessons.length !== LESSON_COUNT || lessons.some(lesson => lesson.words.length !== WORDS_PER_LESSON)) {
    throw new Error("The current course must contain exactly 84 lessons with six words each.");
  }
  return lessons;
}

export function buildQuestionBank(lessons) {
  if (!Array.isArray(lessons) || lessons.length !== LESSON_COUNT) {
    throw new Error("Exactly 84 lesson records are required.");
  }
  const bank = [];
  for (const lesson of lessons) {
    const distinctTranslations = [...new Map(lesson.words.map(word => [word.ar.toLocaleLowerCase(), word])).values()];
    for (const word of lesson.words) {
      const options = [word.ar, ...distinctTranslations
        .filter(candidate => candidate.ar.toLocaleLowerCase() !== word.ar.toLocaleLowerCase())
        .map(candidate => candidate.ar)
        .slice(0, 3)];
      if (options.length !== 4 || new Set(options.map(option => option.toLocaleLowerCase())).size !== 4) {
        throw new Error(`Lesson ${lesson.lesson_index + 1} lacks enough distinct Arabic options.`);
      }
      bank.push({
        lesson_index: lesson.lesson_index,
        prompt: `What does "${word.en}" mean?`,
        options,
        correct_option: 0,
      });
    }

    for (const word of distinctTranslations.slice(0, 4)) {
      const options = [word.en, ...distinctTranslations
        .filter(candidate => candidate.ar.toLocaleLowerCase() !== word.ar.toLocaleLowerCase())
        .map(candidate => candidate.en)
        .slice(0, 3)];
      if (options.length !== 4 || new Set(options.map(option => option.toLocaleLowerCase())).size !== 4) {
        throw new Error(`Lesson ${lesson.lesson_index + 1} lacks enough distinct English options.`);
      }
      bank.push({
        lesson_index: lesson.lesson_index,
        prompt: `ما الكلمة الإنجليزية التي تعني "${word.ar}"؟`,
        options,
        correct_option: 0,
      });
    }
  }

  if (bank.length !== LESSON_COUNT * QUESTIONS_PER_LESSON) {
    throw new Error("Question generation did not produce exactly 840 questions.");
  }
  return bank;
}

export function writePrivateBank(bank, outputPath) {
  const target = resolve(outputPath);
  const rel = relative(REPO_ROOT, target);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`))) {
    throw new Error("The private question bank must be written outside the repository.");
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, JSON.stringify(bank, null, 2), { mode: 0o600, flag: "wx" });
  chmodSync(target, 0o600);
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const outputPath = process.argv[2] ?? resolve(REPO_ROOT, "../english-hero-private/champion-question-bank.json");
    const html = readFileSync(resolve(REPO_ROOT, "index.html"), "utf8");
    const lessons = extractLessons(html);
    const bank = buildQuestionBank(lessons);
    const target = writePrivateBank(bank, outputPath);
    console.log(JSON.stringify({
      output: target,
      lessons: lessons.length,
      questions: bank.length,
      questionsPerLesson: QUESTIONS_PER_LESSON,
      note: "Private answer keys are outside the repository; do not upload this file to public Git."
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Private question-bank generation failed.");
    process.exitCode = 1;
  }
}
