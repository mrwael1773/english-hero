import { test, expect } from '@playwright/test';

async function openFirstLesson(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => window.page('courses'));
  const firstLesson = page.locator('#courseGrid button').first();
  await expect(firstLesson).toBeVisible();
  await firstLesson.click();
  const translations = new Map();
  for (let i = 0; i < 6; i++) {
    const en = (await page.locator('#wordEnglish').innerText()).trim();
    const ar = (await page.locator('#wordArabic').innerText()).trim();
    translations.set(en, ar);
    translations.set(ar, en);
    const next = page.locator('#nextWord');
    if (i < 5) await next.click();
    else await next.click();
  }
  await expect(page.locator('#quizArea')).toBeVisible();
  await expect(page.locator('#quizCounter')).toContainText('من 18');
  return translations;
}

async function answerAll(page, translations, shouldPass, wrongIndices = []) {
  const wrongSet = new Set(Array.isArray(wrongIndices) ? wrongIndices : Number.isInteger(wrongIndices) && wrongIndices >= 0 ? [wrongIndices] : []);
  for (let i = 0; i < 18; i++) {
    const question = (await page.locator('#question').innerText()).trim();
    const passThis = shouldPass && !wrongSet.has(i);
    const input = page.locator('#answerArea input');
    if (await input.count()) {
      const correct = translations.get(question);
      expect(correct, 'Arabic prompt should map to its English word').toBeTruthy();
      await input.fill(passThis ? correct : 'definitely-wrong');
      await page.locator('#answerArea button').click();
    } else {
      let correct;
      if (question.includes('Listen and choose')) {
        const label = await page.locator('#quizListenButton').getAttribute('aria-label');
        correct = label?.replace('استمع إلى نطق ', '').trim();
      } else {
        correct = translations.get(question);
      }
      expect(correct, 'Question should map to a correct answer').toBeTruthy();
      const options = page.locator('#answerArea button.answer');
      const optionCount = await options.count();
      expect(optionCount).toBeGreaterThan(1);
      let target = options.filter({ hasText: correct }).first();
      if (!passThis) {
        target = options.filter({ hasNotText: correct }).first();
      }
      await target.click();
    }
    await expect(page.locator('#quizNext')).toBeVisible();
    await page.locator('#quizNext').click();
  }
}

test('lesson does not become mastered or unlock the next lesson below 80%', async ({ page }) => {
  const translations = await openFirstLesson(page);
  await answerAll(page, translations, false);
  await expect(page.locator('#quizArea')).toContainText('لم يتحقق الإتقان بعد');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}'));
  expect(saved.masteredLessons || []).not.toContain(0);
  await page.evaluate(() => window.page('courses'));
  await expect(page.locator('#courseGrid button').nth(1)).toBeDisabled();
});

test('a score above 80% records mastery and unlocks the next lesson', async ({ page }) => {
  const translations = await openFirstLesson(page);
  await answerAll(page, translations, true);
  await expect(page.locator('#quizArea')).toContainText('أتقنت الدرس');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}'));
  expect(saved.masteredLessons || []).toContain(0);
  await page.reload();
  await page.evaluate(() => window.page('courses'));
  await expect(page.locator('#courseGrid button').nth(1)).toBeEnabled();
  await expect(page.locator('#done')).toHaveText(/^1\/\d+$/);
});



test('14 of 18 correct stays below the 80% mastery threshold', async ({ page }) => {
  const translations = await openFirstLesson(page);
  await answerAll(page, translations, true, [0, 1, 2, 3]);
  await expect(page.locator('#quizArea')).toContainText('لم يتحقق الإتقان بعد');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}'));
  expect(saved.masteredLessons || []).not.toContain(0);
});

test('15 of 18 correct passes the 80% mastery threshold', async ({ page }) => {
  const translations = await openFirstLesson(page);
  await answerAll(page, translations, true, [0, 1, 2]);
  await expect(page.locator('#quizArea')).toContainText('أتقنت الدرس');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}'));
  expect(saved.masteredLessons || []).toContain(0);
});

test('a word missed in one part remains in review even if its other answers are correct', async ({ page }) => {
  const translations = await openFirstLesson(page);
  await answerAll(page, translations, true, 0);
  await expect(page.locator('#quizArea')).toContainText('أتقنت الدرس');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}'));
  expect(Object.keys(saved.misses || {})).toHaveLength(1);
  const missedId = Object.keys(saved.misses)[0];
  expect(saved.review?.[missedId]?.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('legacy completed records do not count as mastery or unlock later lessons', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('english-hero-academy-3', JSON.stringify({
      completed: [0, 1, 2],
      masteredLessons: [],
      lessonStarted: [],
      lessonTrained: []
    }));
  });
  await page.reload();
  await page.evaluate(() => window.page('courses'));
  await expect(page.locator('#done')).toHaveText(/^0\/\d+$/);
  await expect(page.locator('#courseGrid button').nth(1)).toBeDisabled();
});


test('legacy completions and broken mastery records cannot inflate progress or skip lessons', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('english-hero-academy-3', JSON.stringify({
      completed: [0, 1, 2, 3],
      masteredLessons: [0, 2, 3],
      saved: []
    }));
  });
  await page.reload();
  await expect(page.locator('#done')).toHaveText(/^1\\/\\d+$/);
  await page.evaluate(() => window.page('courses'));
  await expect(page.locator('#courseGrid button').nth(1)).toBeEnabled();
  await expect(page.locator('#courseGrid button').nth(2)).toBeDisabled();
  await page.evaluate(() => window.page('profile'));
  await expect(page.locator('#profileDone')).toHaveText('1');
  await expect(page.locator('#badges .badgeitem').first()).not.toHaveClass(/locked/);
  await page.evaluate(() => window.page('home'));
  await page.locator('#continueBtn').click();
  await expect(page.locator('#lessonTag')).toContainText('الدرس 2');
});

test('imported progress normalizes mastery to a continuous verified path', async ({ page }) => {
  await page.goto('/');
  page.on('dialog', dialog => dialog.accept());
  const backup = {
    version: 3,
    data: {
      completed: [0, 1, 2],
      masteredLessons: [0, 2],
      lessonStarted: [0, 2],
      lessonTrained: [],
      saved: []
    }
  };
  await page.locator('#importFile').setInputFiles({
    name: 'english-hero-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator('#done')).toHaveText(/^1\\/\\d+$/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}'));
  expect(saved.masteredLessons).toEqual([0]);
  await page.evaluate(() => window.page('courses'));
  await expect(page.locator('#courseGrid button').nth(1)).toBeEnabled();
  await expect(page.locator('#courseGrid button').nth(2)).toBeDisabled();
});

test('continue button shows completion instead of reopening lesson one when all lessons are mastered', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.page('courses'));
  const totalLessons = await page.locator('#courseGrid button').count();
  await page.evaluate(total => {
    localStorage.setItem('english-hero-academy-3', JSON.stringify({
      completed: Array.from({length: total}, (_, i) => i),
      masteredLessons: Array.from({length: total}, (_, i) => i),
      saved: []
    }));
  }, totalLessons);
  await page.reload();
  await page.locator('#continueBtn').click();
  await expect(page.locator('#toast')).toContainText('أتقنت جميع الدروس');
  await expect(page.locator('#lessonTag')).toBeHidden();
});
