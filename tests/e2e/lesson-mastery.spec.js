import { test, expect } from '@playwright/test';

async function openFirstLesson(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => window.page('courses'));
  await page.locator('#courseGrid button').first().click();
  for (let i = 0; i < 6; i++) {
    await expect(page.locator('#wordEnglish')).toBeVisible();
    await page.locator('#nextWord').click();
  }
  await expect(page.locator('#quizHeading')).toContainText('الاستماع');
  await expect(page.locator('#quizCounter')).toContainText('من 5');
}

test('a lesson starts with a five-item mentor listening stage, not the legacy 18-question quiz', async ({ page }) => {
  await openFirstLesson(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}'));
  expect(saved.mentorMastery?.[0]?.stage).toBe('listen');
  expect(saved.masteredLessons || []).not.toContain(0);
  await expect(page.locator('#answerArea button.answer')).toHaveCount(4);
});

test('mentor stage attempts persist and cannot grant mastery from a single stage', async ({ page }) => {
  await openFirstLesson(page);
  for (let i = 0; i < 5; i++) {
    await page.locator('#answerArea button.answer').first().click();
    await expect(page.locator('#quizNext')).toBeVisible();
    await page.locator('#quizNext').click();
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}'));
  expect(saved.mentorMastery?.[0]?.history).toHaveLength(1);
  expect(saved.mentorMastery?.[0]?.history[0]?.total).toBe(5);
  expect(saved.masteredLessons || []).not.toContain(0);
  await page.reload();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}'));
  expect(restored.mentorMastery?.[0]?.history).toHaveLength(1);
});

test('legacy percentage-based mastery is not accepted as mentor-verified mastery', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('english-hero-academy-3', JSON.stringify({
      completed: [0, 1],
      masteredLessons: [0, 1],
      lessonStarted: [],
      lessonTrained: [],
      saved: []
    }));
  });
  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}'));
  expect(saved.masteredLessons || []).toEqual([]);
  expect(saved.completed || []).toEqual([]);
  await page.evaluate(() => window.page('courses'));
  await expect(page.locator('#courseGrid button').nth(1)).toBeDisabled();
});

test('context stage always hides the target word and offers four lesson-based choices', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('english-hero-academy-3', JSON.stringify({
      completed: [], masteredLessons: [], lessonStarted: [], lessonTrained: [], saved: [],
      mentorMastery: { 0: { stage: 'context', attempts: {}, history: [] } }
    }));
  });
  await page.reload();
  await page.evaluate(() => window.page('courses'));
  await page.locator('#courseGrid button').first().click();
  for (let i = 0; i < 6; i++) await page.locator('#nextWord').click();
  await expect(page.locator('#quizHeading')).toContainText('الاستخدام في السياق');
  await expect(page.locator('#question')).toContainText('_____');
  await expect(page.locator('#answerArea button.answer')).toHaveCount(4);
});
