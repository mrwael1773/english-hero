import { test, expect } from '@playwright/test';

async function openLearningSection(page, section) {
  await page.goto('/');
  await page.locator('.launch-card[data-page="learningHub"]').click();
  await expect(page.locator('#learningHub')).toHaveClass(/active/);
  await page.locator('#learningHub [data-page="' + section + '"]').click();
  await expect(page.locator('#' + section)).toHaveClass(/active/);
}

test('grammar cards open a dedicated lesson with an interactive challenge', async ({ page }) => {
  await openLearningSection(page, 'grammarView');

  const cards = page.locator('#grammarLibrary .learning-rule-card');
  await expect(cards).toHaveCount(37);
  await expect(cards.first()).toContainText('ضمائر الفاعل');
  await expect(cards.first()).toHaveAttribute('href', /grammar-lesson\.html#g-subject-pronouns/);

  await cards.first().click();
  await expect(page).toHaveURL(/grammar-lesson\.html#g-subject-pronouns$/);
  await expect(page.locator('#lessonRoot h1')).toHaveText('ضمائر الفاعل');
  await expect(page.locator('#concept')).toBeVisible();
  await expect(page.locator('#formula')).toContainText('Subject + verb');
  await expect(page.locator('#examples .example')).toHaveCount(3);
  await expect(page.locator('#challenge .option')).toHaveCount(3);

  await page.locator('#challenge .option').first().click();
  await expect(page.locator('#challenge .feedback')).toContainText('صحيح');
  await expect(page.locator('#challenge .quiz-footer button')).toBeEnabled();
});

test('tense cards open dedicated tense pages', async ({ page }) => {
  await openLearningSection(page, 'tensesView');

  const cards = page.locator('#tensesLibrary .learning-rule-card');
  await expect(cards).toHaveCount(10);
  await expect(cards.first()).toContainText('Present Simple');
  await cards.first().click();

  await expect(page).toHaveURL(/grammar-lesson\.html#t-present-simple$/);
  await expect(page.locator('#lessonRoot h1')).toContainText('Present Simple');
  await expect(page.locator('#challenge .option')).toHaveCount(3);
});

test('the foundation path also opens the same dedicated lesson pages', async ({ page }) => {
  await openLearningSection(page, 'grammarView');
  const starter = page.locator('#grammarAcademyGrid a').first();
  await expect(starter).toHaveAttribute('href', /grammar-lesson\.html#g-subject-pronouns/);
  await starter.click();
  await expect(page).toHaveURL(/grammar-lesson\.html#g-subject-pronouns$/);
});

test('dedicated grammar lesson fits a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const response = await page.goto('/grammar-lesson.html#g-subject-pronouns');
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator('#lessonRoot h1')).toHaveText('ضمائر الفاعل');
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('unknown lesson slugs show a safe fallback instead of a broken page', async ({ page }) => {
  await page.goto('/grammar-lesson.html#not-a-real-lesson');
  await expect(page.locator('#lessonRoot')).toContainText('لم نعثر على هذا الدرس');
  await expect(page.locator('#lessonRoot a')).toHaveAttribute('href', './index.html');
});
