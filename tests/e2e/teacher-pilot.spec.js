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

test('attendance records 16 individual sessions, updates a participant, and exports weekly CSV data', async ({ page }) => {
  await page.locator('[data-tab="pilot"]').click();

  await page.locator('#pCode').fill('STUDENT NAME');
  await page.locator('#pPre').fill('70');
  await page.locator('#pPost').fill('85');
  await page.locator('#addParticipant').click();
  await expect(page.locator('#pilotMessage')).toContainText('تحقق');
  await expect(page.locator('#pilotRows tr')).toHaveCount(0);

  await page.locator('#pCode').fill('P01');
  await page.locator('#pPre').fill('70');
  await page.locator('#pPost').fill('85');
  await page.locator('#pDelay').fill('80');
  for (const session of [1, 3, 5, 9, 16]) {
    await page.locator(`.pilot-session[value="${session}"]`).check();
  }
  await page.locator('#addParticipant').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(1);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotCohortV1')));
  expect(saved[0]).toMatchObject({
    code: 'P01', pre: 70, post: 85, delay: 80,
    attendance: 5, sessions: [1, 3, 5, 9, 16],
  });
  await expect(page.locator('#pilotRows tr').first()).toContainText('5/16');
  await expect(page.locator('#pilotRows tr').first()).toContainText('أ1 2، أ2 1، أ3 1، أ4 1');

  // Re-saving the same anonymous code must update, not duplicate, the participant.
  await page.locator('#pCode').fill('P01');
  await page.locator('#pPre').fill('72');
  await page.locator('#pPost').fill('88');
  await page.locator('#pDelay').fill('83');
  for (const session of [2, 8, 15]) {
    await page.locator(`.pilot-session[value="${session}"]`).check();
  }
  await page.locator('#addParticipant').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(1);
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotCohortV1')));
  expect(saved[0]).toMatchObject({
    code: 'P01', pre: 72, post: 88, delay: 83,
    attendance: 3, sessions: [2, 8, 15],
  });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportPilot').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('english-hero-pilot-results.csv');
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString('utf8');
  expect(csv).toContain('session_log');
  expect(csv).toContain('week_1');
  expect(csv).toContain('week_4');
  expect(csv).toContain('2|8|15');
});

test('attendance survives page reload without exposing another teacher account', async ({ page }) => {
  await page.locator('[data-tab="pilot"]').click();
  await page.locator('#pCode').fill('P02');
  await page.locator('#pPre').fill('60');
  await page.locator('#pPost').fill('75');
  await page.locator('.pilot-session[value="4"]').check();
  await page.locator('#addParticipant').click();
  await page.reload();
  await page.locator('[data-tab="pilot"]').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(1);
  await expect(page.locator('#pilotRows tr').first()).toContainText('P02');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotCohortV1')));
  expect(saved[0].sessions).toEqual([4]);
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

test('unclaimed local pilot records are actually cleared and do not reappear after reload', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.removeItem('ehTeacherPilotOwnerV1');
    localStorage.setItem('ehTeacherPilotCohortV1', '[]');
    localStorage.setItem('ehTeacherPilotCohortV1-unclaimed', JSON.stringify([{
      code: 'P03', pre: 70, post: 80, delay: null, attendance: 1,
      sessions: [], updated_at: new Date().toISOString(),
    }]));
  });
  await page.reload();
  await page.locator('[data-tab="pilot"]').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#clearPilot').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(0);
  await page.reload();
  await page.locator('[data-tab="pilot"]').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(0);
  const backup = await page.evaluate(() => localStorage.getItem('ehTeacherPilotCohortV1-unclaimed'));
  expect(backup).toBeNull();
});

test('tampered local participant values are rejected before rendering', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('ehTeacherPilotCohortV1', JSON.stringify([{
      code: 'P04', pre: '<img src=x onerror=alert(1)>', post: 90,
      delay: null, attendance: 1, sessions: [1],
    }]));
  });
  await page.reload();
  await page.locator('[data-tab="pilot"]').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(0);
  await expect(page.locator('#pilotRows img')).toHaveCount(0);
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
