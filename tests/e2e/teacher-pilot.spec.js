import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes('isolates local records between teacher accounts')) return;
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
    if (i < 17) await page.locator('#nextQuestion').click();
    else await page.locator('#nextQuestion').click();
  }
  await expect(page.locator('#resultArea')).toContainText('٪');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotMasteryV1')));
  expect(saved.attempts).toBe(1);
  expect(saved.lastAttempt.total).toBe(18);
});

test('school pilot validates anonymous participant data and exports a CSV file', async ({ page }) => {
  await page.locator('[data-tab="pilot"]').click();
  await page.locator('#pCode').fill('STUDENT NAME');
  await page.locator('#pPre').fill('70');
  await page.locator('#pPost').fill('85');
  await page.locator('#pAttendance').fill('16');
  await page.locator('#addParticipant').click();
  await expect(page.locator('#pilotMessage')).toContainText('تحقق');
  await expect(page.locator('#pilotRows tr')).toHaveCount(0);

  await page.locator('#pCode').fill('P02');
  await page.locator('#pPre').fill('');
  await page.locator('#pPost').fill('85');
  await page.locator('#addParticipant').click();
  await expect(page.locator('#pilotMessage')).toContainText('تحقق');
  await expect(page.locator('#pilotRows tr')).toHaveCount(0);

  await page.locator('#pCode').fill('P02');
  await page.locator('#pPre').fill('70.5');
  await page.locator('#pPost').fill('85');
  await page.locator('#addParticipant').click();
  await expect(page.locator('#pilotMessage')).toContainText('تحقق');
  await expect(page.locator('#pilotRows tr')).toHaveCount(0);

  await page.locator('#pCode').fill('P01');
  await page.locator('#pPre').fill('70');
  await page.locator('#pPost').fill('85');
  await page.locator('#pDelay').fill('80');
  await page.locator('#pAttendance').fill('16');
  await page.locator('#addParticipant').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotCohortV1')));
  expect(saved[0]).toMatchObject({code: 'P01', pre: 70, post: 85, delay: 80, attendance: 16});

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportPilot').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('english-hero-pilot-results.csv');
});
