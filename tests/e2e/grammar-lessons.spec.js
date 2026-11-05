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
  await expect(page.locator('#lessonStepStatus')).toContainText('الخطوة 1 من 6');
  await expect(page.locator('#concept')).toBeVisible();
  await expect(page.locator('#formula')).toBeHidden();

  await page.locator('#lessonSteps [data-step-index="2"]').click();
  await expect(page.locator('#examples')).toBeVisible();
  const firstReveal = page.locator('#examples .example').first().locator('.reveal');
  await expect(firstReveal).toHaveAttribute('aria-expanded', 'false');
  await firstReveal.click();
  await expect(page.locator('#examples .example').first().locator('.example-ar')).toBeVisible();
  await expect(firstReveal).toHaveAttribute('aria-expanded', 'true');
  await firstReveal.click();
  await expect(page.locator('#examples .example').first().locator('.example-ar')).toBeHidden();

  await page.locator('#lessonSteps [data-step-index="5"]').click();
  await expect(page.locator('#challenge')).toBeVisible();
  const options = page.locator('#challenge .option');
  const next = page.locator('#challenge .quiz-footer button');
  await options.nth(0).click();
  await expect(page.locator('#challenge .feedback')).toContainText('صحيح');
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator('#challenge .quiz-count').nth(1)).toHaveText('السؤال 2 من 3');
  await options.nth(0).click();
  await expect(page.locator('#challenge .feedback')).toContainText('ليست الإجابة الصحيحة');
  await expect(page.locator('#challenge .feedback')).toContainText('نستخدم She');
  await next.click();
  await expect(page.locator('#challenge .quiz-count').nth(1)).toHaveText('السؤال 3 من 3');
  await options.nth(1).click();
  await expect(page.locator('#challenge .feedback')).toContainText('صحيح');
  await next.click();
  await expect(page.locator('#challenge .quiz-result .score')).toHaveText('2 / 3');
  await page.getByRole('button', { name: 'إعادة التحدي' }).click();
  await expect(page.locator('#challenge .quiz-count').nth(1)).toHaveText('السؤال 1 من 3');
  await expect(page.locator('#challenge .option')).toHaveCount(3);
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

test('all 47 grammar and tense lesson slugs resolve to their own page content', async ({ page }) => {
  await page.goto('/grammar-lesson.html#g-subject-pronouns');
  const lessons = await page.evaluate(() => window.EnglishHeroLessons.all.map(item => ({
    slug: item.slug,
    title: item.title
  })));
  expect(lessons).toHaveLength(47);
  expect(new Set(lessons.map(item => item.slug)).size).toBe(47);

  for (const lesson of lessons) {
    await page.evaluate(slug => { window.location.hash = slug; }, lesson.slug);
    await expect(page.locator('#lessonRoot h1')).toHaveText(lesson.title);
    await expect(page.locator('#examples .example')).toHaveCount(3);
    await expect(page.locator('#challenge .option')).toHaveCount(3);
  }
});

test('lesson navigation labels match their actual home-page destinations', async ({ page }) => {
  // First lesson: only the previous control returns home; the next control opens lesson 2.
  await page.goto('/grammar-lesson.html#g-subject-pronouns');
  await expect(page.locator('.hero-actions .secondary')).toHaveText('الرئيسية');
  const firstPrevious = page.locator('.bottom-nav .lesson-neighbor').first();
  const firstNext = page.locator('.bottom-nav .lesson-neighbor').last();
  await expect(firstPrevious).toContainText('العودة إلى الرئيسية');
  await expect(firstPrevious).toHaveAttribute('href', './index.html');
  await expect(firstNext).toContainText('فعل be: am / is / are');
  await expect(firstNext).toHaveAttribute('href', './grammar-lesson.html#g-be-verb');
  await expect(page.locator('.hero-actions .secondary')).toHaveAttribute('href', './index.html');

  // Final lesson: only the next control returns home; the previous control opens lesson 46.
  await page.goto('/grammar-lesson.html#t-present-perfect-continuous');
  const lastPrevious = page.locator('.bottom-nav .lesson-neighbor').first();
  const lastNext = page.locator('.bottom-nav .lesson-neighbor').last();
  await expect(lastPrevious).toContainText('الدرس السابق');
  await expect(lastPrevious).toHaveAttribute('href', './grammar-lesson.html#t-future-continuous');
  await expect(lastNext).toContainText('العودة إلى الرئيسية');
  await expect(lastNext).toHaveAttribute('href', './index.html');
});

test('grammar lesson guides the student through six focused steps', async ({ page }) => {
  await page.goto('/grammar-lesson.html#g-present-simple');
  const steps = page.locator('#lessonSteps button');
  await expect(steps).toHaveCount(6);
  await expect(page.locator('#concept')).toBeVisible();
  await expect(page.locator('#formula')).toBeHidden();

  await page.locator('.step-controls button').last().click();
  await expect(page.locator('#formula')).toBeVisible();
  await expect(page.locator('#concept')).toBeHidden();
  await expect(page.locator('#lessonStepStatus')).toContainText('الخطوة 2 من 6');

  await steps.nth(3).click();
  await expect(page.locator('#mistake')).toBeVisible();
  await expect(page.locator('#examples')).toBeHidden();

  await page.locator('.step-controls button').first().click();
  await expect(page.locator('#examples')).toBeVisible();
  await expect(page.locator('#lessonSteps button[aria-current="step"]')).toContainText('شاهد الأمثلة');
});
