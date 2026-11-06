import { test, expect } from '@playwright/test';

test('teacher pilot progress is isolated to the current tab and survives reload', async ({ page }) => {
  await page.goto('/teacher-pilot.html');
  await expect(page.locator('#trainingCount')).toContainText('0 من 6');

  await page.locator('[data-trained="0"]').click();
  await expect(page.locator('#trainingCount')).toContainText('1 من 6');

  const stored = await page.evaluate(() =>
    Object.keys(localStorage).some(key => key.includes('ehTeacherPilot'))
  );
  expect(stored).toBe(false);

  await page.reload();
  await expect(page.locator('#trainingCount')).toContainText('1 من 6');
  await expect(page.locator('#lessonState')).toContainText('بدأ الدرس');
});

test('legacy shared-device pilot data is removed and never restored', async ({ page }) => {
  await page.goto('/privacy.html');
  await page.evaluate(() => {
    localStorage.setItem('ehTeacherPilotMasteryV1', JSON.stringify({
      trained: [0, 1, 2, 3, 4, 5], mastered: true,
      lastAttempt: { date: new Date().toISOString(), score: 100, correct: 18, total: 18 }
    }));
  });

  await page.goto('/teacher-pilot.html');
  await expect(page.locator('#trainingCount')).toContainText('0 من 6');
  const legacy = await page.evaluate(() => localStorage.getItem('ehTeacherPilotMasteryV1'));
  expect(legacy).toBeNull();
});

test('teacher pilot progress does not appear in a separate tab', async ({ page, context }) => {
  await page.goto('/teacher-pilot.html');
  await page.locator('[data-trained="0"]').click();
  await expect(page.locator('#trainingCount')).toContainText('1 من 6');

  const secondTab = await context.newPage();
  await secondTab.goto('/teacher-pilot.html');
  await expect(secondTab.locator('#trainingCount')).toContainText('0 من 6');
  await expect(secondTab.locator('#lessonState')).toContainText('لم يبدأ الدرس');
  await secondTab.close();
});

test('teacher pilot provides an explicit end-session control', async ({ page }) => {
  await page.goto('/teacher-pilot.html');
  page.on('dialog', dialog => dialog.accept());

  await page.locator('[data-trained="0"]').click();
  await page.locator('#clearSession').click();
  await expect(page.locator('#trainingCount')).toContainText('0 من 6');
  await expect(page.locator('#lessonState')).toContainText('لم يبدأ الدرس');
  const stored = await page.evaluate(() => sessionStorage.getItem('ehTeacherPilotMasterySessionV1'));
  expect(stored).toBeNull();
});
