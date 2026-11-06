import { test, expect } from '@playwright/test';

test('teacher pilot progress stays in page memory and is cleared on reload', async ({ page }) => {
  await page.goto('/teacher-pilot.html');
  await expect(page.locator('#trainingCount')).toContainText('0 من 6');

  await page.locator('[data-trained="0"]').click();
  await expect(page.locator('#trainingCount')).toContainText('1 من 6');

  const stored = await page.evaluate(() =>
    Object.keys(localStorage).some(key => key.includes('ehTeacherPilot'))
  );
  expect(stored).toBe(false);

  await page.reload();
  await expect(page.locator('#trainingCount')).toContainText('0 من 6');
  await expect(page.locator('#lessonState')).toContainText('لم يبدأ الدرس');
});

test('teacher pilot provides an explicit end-session control', async ({ page }) => {
  await page.goto('/teacher-pilot.html');
  page.on('dialog', dialog => dialog.accept());

  await page.locator('#clearSession').click();
  await expect(page.locator('#trainingCount')).toContainText('0 من 6');
  await expect(page.locator('#lessonState')).toContainText('لم يبدأ الدرس');
});
