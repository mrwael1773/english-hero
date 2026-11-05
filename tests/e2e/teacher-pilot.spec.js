import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/teacher-pilot.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('pilot lesson can complete all six training words and advance through all 18 assessment questions', async ({ page }) => {
  for (let i = 0; i < 6; i++) {
    await page.locator('[data-trained]').nth(i).click();
  }
  await expect(page.locator('#trainingCount')).toContainText('6 من 6');
  await expect(page.locator('#startTest')).toBeEnabled();
  await page.locator('#finishTraining').click();
  await page.locator('#startTest').click();
  await expect(page.locator('#testArea')).toBeVisible();

  for (let i = 0; i < 18; i++) {
    const question = page.locator('#testArea .question');
    await expect(question).toBeVisible();
    const choices = page.locator('#testArea [data-choice]');
    if (await choices.count()) {
      await expect(choices).toHaveCount(4);
      const labels = await choices.allTextContents();
      expect(new Set(labels).size).toBe(4);
      await choices.first().click();
    } else {
      await page.locator('#typedAnswer').fill('not-the-answer');
      await page.locator('#typedAnswer').press('Enter');
    }
    await expect(page.locator('#nextQuestion')).toBeVisible();
    await expect(page.locator('#nextQuestion')).toBeEnabled();
    await page.locator('#nextQuestion').click();
  }
  await expect(page.locator('#resultArea')).toContainText('٪');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotMasteryV1')));
  expect(saved.attempts).toBe(1);
  expect(saved.lastAttempt.total).toBe(18);
  expect(saved.reviewDue).toBeTruthy();
});

test('writing assessment shows explicit correct and incorrect feedback and requires a non-empty answer', async ({ page }) => {
  for (let i = 0; i < 6; i++) await page.locator('[data-trained]').nth(i).click();
  await page.locator('#finishTraining').click();
  await page.locator('#startTest').click();

  // Advance to a writing question regardless of the shuffled question order.
  for (let i = 0; i < 18; i++) {
    if (await page.locator('#typedAnswer').count()) break;
    await page.locator('#testArea [data-choice]').first().click();
    await page.locator('#nextQuestion').click();
  }
  await expect(page.locator('#typedAnswer')).toBeVisible();
  await page.locator('#checkTypedAnswer').click();
  await expect(page.locator('#questionFeedback')).toContainText('اكتب إجابتك أولًا');
  await expect(page.locator('#nextQuestion')).toBeHidden();

  await page.locator('#typedAnswer').fill('definitely-wrong');
  await page.locator('#checkTypedAnswer').click();
  await expect(page.locator('#questionFeedback')).toContainText('✗');
  await expect(page.locator('#questionFeedback')).toContainText('الإجابة الصحيحة:');
  await expect(page.locator('#typedAnswer')).toBeDisabled();
  await expect(page.locator('#nextQuestion')).toBeVisible();

  await page.locator('#nextQuestion').click();
  for (let i = 0; i < 18 && !(await page.locator('#typedAnswer').count()); i++) {
    await page.locator('#testArea [data-choice]').first().click();
    await page.locator('#nextQuestion').click();
  }
  await expect(page.locator('#typedAnswer')).toBeVisible();
  const prompt = await page.locator('#testArea h3').textContent();
  const expectedByMeaning = {
    'اسم': 'Name', 'طالب': 'Student', 'من': 'From',
    'يسكن / يعيش': 'Live', 'يحب': 'Like', 'كرة القدم': 'Football',
  };
  const expectedAnswer = Object.entries(expectedByMeaning)
    .find(([meaning]) => prompt.includes(meaning))?.[1];
  expect(expectedAnswer).toBeTruthy();
  await page.locator('#typedAnswer').fill(expectedAnswer);
  await page.locator('#checkTypedAnswer').click();
  await expect(page.locator('#questionFeedback')).toContainText('✓ إجابة صحيحة');
  await expect(page.locator('#typedAnswer')).toBeDisabled();
  await expect(page.locator('#nextQuestion')).toBeVisible();
});

test('a seven-day retention quiz remains available even when the first attempt had no mistakes', async ({ page }) => {
  const due = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await page.evaluate((reviewDue) => {
    localStorage.setItem('ehTeacherPilotMasteryV1', JSON.stringify({
      started: true,
      trained: [0, 1, 2, 3, 4, 5],
      attempts: 1,
      mastered: true,
      lastAttempt: { date: new Date().toISOString(), score: 100, correct: 18, total: 18 },
      reviewDue,
      wrong: [],
    }));
  }, due);
  await page.reload();
  await page.locator('[data-tab="review"]').click();
  await expect(page.locator('#reviewList')).toContainText('حان موعد مراجعة الاحتفاظ بالتعلم');
  await page.locator('#reviewQuiz').click();
  await expect(page.locator('#testArea')).toBeVisible();
  await expect(page.locator('#testArea .question')).toContainText('1 / 18');
});

test('a partial retention quiz preserves the full mastery attempt after reload', async ({ page }) => {
  const due = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await page.evaluate((reviewDue) => {
    localStorage.setItem('ehTeacherPilotMasteryV1', JSON.stringify({
      started: true,
      trained: [0, 1, 2, 3, 4, 5],
      attempts: 1,
      mastered: true,
      lastAttempt: { date: new Date().toISOString(), score: 89, correct: 16, total: 18 },
      reviewDue,
      wrong: ['Name'],
    }));
  }, due);
  await page.reload();
  await expect(page.locator('#lessonState')).toContainText('أتقن الدرس');
  await page.locator('[data-tab="review"]').click();
  await page.locator('#reviewQuiz').click();
  await expect(page.locator('#testArea .question')).toContainText('1 / 3');

  for (let i = 0; i < 3; i++) {
    const prompt = await page.locator('#testArea h3').textContent();
    if (await page.locator('#typedAnswer').count()) {
      await page.locator('#typedAnswer').fill('Name');
      await page.locator('#checkTypedAnswer').click();
    } else if (prompt.includes('ما معنى كلمة Name')) {
      await page.getByRole('button', { name: 'اسم', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Name', exact: true }).click();
    }
    await expect(page.locator('#nextQuestion')).toBeVisible();
    await page.locator('#nextQuestion').click();
  }

  await expect(page.locator('#resultArea')).toContainText('100٪');
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotMasteryV1')));
  expect(saved.mastered).toBe(true);
  expect(saved.lastAttempt.total).toBe(18);
  expect(saved.lastRetention.total).toBe(3);
  expect(saved.lastRetention.passed).toBe(true);

  await page.reload();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotMasteryV1')));
  expect(saved.mastered).toBe(true);
  expect(saved.lastAttempt.total).toBe(18);
  expect(saved.lastRetention.total).toBe(3);
  expect(saved.lastRetention.passed).toBe(true);
});

test('a failed partial retention quiz keeps the historical mastery but flags review', async ({ page }) => {
  const due = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await page.evaluate((reviewDue) => {
    localStorage.setItem('ehTeacherPilotMasteryV1', JSON.stringify({
      started: true,
      trained: [0, 1, 2, 3, 4, 5],
      attempts: 1,
      mastered: true,
      lastAttempt: { date: new Date().toISOString(), score: 89, correct: 16, total: 18 },
      reviewDue,
      wrong: ['Name'],
    }));
  }, due);
  await page.reload();
  await page.locator('[data-tab="review"]').click();
  await page.locator('#reviewQuiz').click();

  for (let i = 0; i < 3; i++) {
    const prompt = await page.locator('#testArea h3').textContent();
    if (await page.locator('#typedAnswer').count()) {
      await page.locator('#typedAnswer').fill('not-the-answer');
      await page.locator('#checkTypedAnswer').click();
    } else if (prompt.includes('ما معنى كلمة Name')) {
      await page.locator('#testArea [data-choice]').filter({ hasNotText: 'اسم' }).first().click();
    } else {
      await page.locator('#testArea [data-choice]').filter({ hasNotText: 'Name' }).first().click();
    }
    await page.locator('#nextQuestion').click();
  }

  await expect(page.locator('#resultArea')).toContainText('يحتاج التعلم إلى مراجعة إضافية');
  await expect(page.locator('#lessonState')).toContainText('أتقن الدرس سابقًا • يحتاج مراجعة');
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotMasteryV1')));
  expect(saved.mastered).toBe(true);
  expect(saved.lastAttempt.total).toBe(18);
  expect(saved.lastRetention.total).toBe(3);
  expect(saved.lastRetention.passed).toBe(false);
  expect(saved.wrong).toContain('Name');

  await page.reload();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotMasteryV1')));
  expect(saved.mastered).toBe(true);
  expect(saved.lastRetention.passed).toBe(false);
  await expect(page.locator('#lessonState')).toContainText('يحتاج مراجعة');
});

test('invalid saved lesson state cannot unlock mastery or retention questions', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('ehTeacherPilotMasteryV1', JSON.stringify({
      started: true,
      trained: [99, 100, 101, 102, 103, 104],
      attempts: 999999,
      mastered: true,
      lastAttempt: { date: 'not-a-date', score: 100, correct: 999, total: 999 },
      reviewDue: 'not-a-date',
      wrong: ['<img src=x onerror=alert(1)>'],
    }));
  });
  await page.reload();
  await expect(page.locator('#trainingCount')).toContainText('0 من 6');
  await expect(page.locator('#startTest')).toBeDisabled();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotMasteryV1')));
  expect(saved.mastered).toBe(false);
  expect(saved.trained).toEqual([]);
  expect(saved.wrong).toEqual([]);
  expect(saved.reviewDue).toBeNull();
  expect(saved.attempts).toBe(10000);
});


test('pilot word and listening controls invoke English speech playback', async ({ page }) => {
  await page.addInitScript(() => {
    window.__spokenUtterances = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speaking: false,
        pending: false,
        cancel() { this.speaking = false; this.pending = false; },
        resume() {},
        getVoices() { return [{name: 'Test English', lang: 'en-US', localService: true}]; },
        speak(utterance) {
          window.__spokenUtterances.push({text: utterance.text, lang: utterance.lang, rate: utterance.rate});
        }
      }
    });
    window.SpeechSynthesisUtterance = class {
      constructor(text) { this.text = text; }
    };
  });
  await page.reload();
  await page.locator('[data-listen="0"]').click();
  await expect.poll(() => page.evaluate(() => window.__spokenUtterances.length)).toBe(1);
  expect(await page.evaluate(() => window.__spokenUtterances[0])).toMatchObject({
    text: 'Name', lang: 'en-US', rate: 0.88
  });

  for (let i = 0; i < 6; i++) await page.locator('[data-trained]').nth(i).click();
  await page.locator('#finishTraining').click();
  await page.locator('#startTest').click();
  for (let i = 0; i < 18 && !(await page.locator('#playQuestion').count()); i++) {
    if (await page.locator('#typedAnswer').count()) {
      await page.locator('#typedAnswer').fill('incorrect');
      await page.locator('#checkTypedAnswer').click();
    } else {
      await page.locator('#testArea [data-choice]').first().click();
    }
    await page.locator('#nextQuestion').click();
  }
  await expect(page.locator('#playQuestion')).toBeVisible();
  await page.locator('#playQuestion').click();
  await expect.poll(() => page.evaluate(() => window.__spokenUtterances.length)).toBe(2);
  const utterances = await page.evaluate(() => window.__spokenUtterances);
  expect(utterances[1].lang).toBe('en-US');
  expect(['Name', 'Student', 'From', 'Live', 'Like', 'Football']).toContain(utterances[1].text);
});
