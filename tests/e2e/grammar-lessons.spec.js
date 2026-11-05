import { test, expect } from '@playwright/test';

async function openLearningSection(page, section) {
  await page.goto('/');
  await page.locator('.launch-card[data-page="learningHub"]').click();
  await expect(page.locator('#learningHub')).toHaveClass(/active/);
  await page.locator('#learningHub [data-page="' + section + '"]').click();
  await expect(page.locator('#' + section)).toHaveClass(/active/);
}

test('grammar categories lead to dedicated pages and all lessons are accessible', async ({ page }) => {
  await page.goto('/grammar-library.html?type=grammar');
  const groups = page.locator('#groups .card');
  await expect(groups).toHaveCount(9);
  await expect(groups.filter({ hasText: 'قواعد الماضي' })).toHaveCount(1);
  await groups.filter({ hasText: 'قواعد الماضي' }).click();
  await expect(page).toHaveURL(/grammar-category\.html\?type=grammar&group=past$/);
  const lessons = page.locator('#lessons .lesson');
  await expect(lessons).toHaveCount(2);
  await expect(lessons.first()).toContainText('الماضي البسيط');
  await lessons.first().click();
  await expect(page).toHaveURL(/grammar-lesson\.html#g-past-simple$/);
  await expect(page.locator('#lessonRoot h1')).toContainText('الماضي البسيط');
  const lessonUrl = page.url();
  await page.getByRole('button', { name: 'ابدأ التعلّم' }).click();
  await expect(page).toHaveURL(lessonUrl);
  await expect(page.locator('#concept')).toBeVisible();
  await page.locator('#lessonSteps [data-step-index="2"]').click();
  await expect(page.locator('.formula-ar')).toBeVisible();
  await expect(page.locator('#lessonRoot')).not.toContainText('لم نعثر على هذا الدرس');
});

test('tense categories show present, past, and future lessons', async ({ page }) => {
  await page.goto('/grammar-library.html?type=tenses');
  const groups = page.locator('#groups .card');
  await expect(groups).toHaveCount(3);
  await groups.filter({ hasText: 'أزمنة الماضي' }).click();
  await expect(page).toHaveURL(/grammar-category\.html\?type=tenses&group=past$/);
  await expect(page.locator('#lessons .lesson')).toHaveCount(3);
  await expect(page.locator('#lessons')).toContainText('Past Perfect');
});

test('the home grammar entry opens the dedicated category library', async ({ page }) => {
  await openLearningSection(page, 'grammarView');
  const entry = page.locator('#grammarView a.grammar-entry');
  await expect(entry).toHaveAttribute('href', './grammar-library.html?type=grammar');
  await entry.click();
  await expect(page).toHaveURL(/grammar-library\.html\?type=grammar$/);
  await expect(page.locator('#groups .card')).toHaveCount(9);
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
    await expect(page.locator('#lessonSteps button')).toHaveCount(7);
    await page.locator('#lessonSteps [data-step-index="1"]').click();
    await expect(page.locator('#deep-guide .guide-card')).toHaveCount(5);
    await expect(page.locator('#deep-guide')).toContainText('متى أستخدمها؟');
    await page.locator('#lessonSteps [data-step-index="2"]').click();
    await expect(page.locator('.formula-ar')).toBeVisible();
    await expect(page.locator('.formula-ar')).not.toBeEmpty();
  }
});

test('all 47 lessons provide their own detailed beginner guide', async ({ page }) => {
  await page.goto('/grammar-lesson.html#g-subject-pronouns');
  const guideAudit = await page.evaluate(() => window.EnglishHeroLessons.all.map(item => ({
    slug: item.slug,
    guide: item.guide && {
      idea: item.guide.idea,
      use: item.guide.use,
      build: item.guide.build,
      compare: item.guide.compare,
      watch: item.guide.watch
    }
  })));
  expect(guideAudit).toHaveLength(47);
  for (const item of guideAudit) {
    expect(item.guide, item.slug + ' missing guide').toBeTruthy();
    expect(item.guide.idea.length, item.slug + ' missing idea').toBeGreaterThan(25);
    expect(item.guide.use.length, item.slug + ' missing usage context').toBeGreaterThan(20);
    expect(item.guide.build.length, item.slug + ' missing build steps').toBeGreaterThanOrEqual(3);
    expect(item.guide.compare.length, item.slug + ' missing comparison').toBeGreaterThan(20);
    expect(item.guide.watch.length, item.slug + ' missing common pitfall').toBeGreaterThan(20);
  }
});

test('present simple explains both subject groups and all s/es/ies spelling rules', async ({ page }) => {
  await page.goto('/grammar-lesson.html#g-present-simple');
  await page.locator('#lessonSteps [data-step-index="2"]').click();
  const explanation = page.locator('#formula');
  await expect(explanation).toContainText('I / you / we / they');
  await expect(explanation).toContainText('he / she / it');
  await expect(explanation).toContainText('اسم مفرد');
  await expect(explanation).toContainText('watch → watches');
  await expect(explanation).toContainText('study → studies');
  await expect(explanation).toContainText('play → plays');
  await expect(explanation).toContainText('doesn’t play');
  await expect(explanation).toContainText('Does he play?');
  await expect(explanation.locator('.step')).toHaveCount(12);

  await page.locator('#lessonSteps [data-step-index="6"]').click();

  const rounds = [
    { question: 'My brother', feedback: 'My brother شخص واحد' },
    { question: 'Mona', feedback: 'Mona اسم مفرد' },
    { question: 'They', feedback: 'They من المجموعة الأولى' },
    { question: 'He doesn’t', feedback: 'بعد doesn’t' },
    { question: 'your sister', feedback: 'your sister مفرد' },
    { question: 'اختر الجملة الصحيحة', feedback: 'مع she في الإثبات' }
  ];

  for (let index = 0; index < rounds.length; index++) {
    const round = rounds[index];
    await expect(page.locator('#challenge .question')).toContainText(round.question);
    await expect(page.locator('#challenge .option')).toHaveCount(3);
    await expect(page.locator('#challenge .quiz-header .quiz-count').nth(1))
      .toHaveText('السؤال ' + (index + 1) + ' من 6');
    await page.locator('#challenge .option').nth(1).click();
    await expect(page.locator('#challenge .feedback')).toContainText(round.feedback);

    if (index < rounds.length - 1) {
      await page.getByRole('button', { name: 'السؤال التالي' }).click();
    }
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

test('grammar lesson guides the student through seven focused steps', async ({ page }) => {
  await page.goto('/grammar-lesson.html#g-present-simple');
  const steps = page.locator('#lessonSteps button');
  await expect(steps).toHaveCount(7);
  await expect(page.locator('#concept')).toBeVisible();
  await expect(page.locator('#formula')).toBeHidden();

  await page.locator('.step-controls button').last().click();
  await expect(page.locator('#deep-guide')).toBeVisible();
  await page.locator('.step-controls button').last().click();
  await expect(page.locator('#formula')).toBeVisible();
  await expect(page.locator('#concept')).toBeHidden();
  await expect(page.locator('#lessonStepStatus')).toContainText('الخطوة 3 من 7');

  await steps.nth(4).click();
  await expect(page.locator('#mistake')).toBeVisible();
  await expect(page.locator('#examples')).toBeHidden();

  await steps.nth(3).click();
  await expect(page.locator('#examples')).toBeVisible();
  await expect(page.locator('#lessonSteps button[aria-current="step"]')).toContainText('شاهد الأمثلة');
});

test('challenge feedback and retry remain functional after category navigation changes', async ({ page }) => {
  await page.goto('/grammar-lesson.html#g-subject-pronouns');
  await page.locator('#lessonSteps [data-step-index="6"]').click();
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
  await options.nth(1).click();
  await expect(page.locator('#challenge .feedback')).toContainText('صحيح');
  await next.click();
  await expect(page.locator('#challenge .quiz-result .score')).toHaveText('2 / 3');
  await page.getByRole('button', { name: 'إعادة التحدي' }).click();
  await expect(page.locator('#challenge .quiz-count').nth(1)).toHaveText('السؤال 1 من 3');
  await expect(page.locator('#challenge .option')).toHaveCount(3);
});

test('continuous and perfect tense formulas include Arabic explanations', async ({ page }) => {
  for (const slug of ['t-present-continuous','t-past-continuous','t-present-perfect']) {
    await page.goto('/grammar-lesson.html#' + slug);
    await page.locator('#lessonSteps [data-step-index="2"]').click();
    await expect(page.locator('.formula-ar')).toBeVisible();
    await expect(page.locator('.formula-ar')).not.toBeEmpty();
  }
});


test('every grammar and tense category opens a populated page with valid lesson links', async ({ page }) => {
  const cases = [
    { type: 'grammar', groups: [
      ['basics', 6], ['present', 6], ['past', 2], ['future', 2],
      ['perfect', 2], ['questions', 4], ['nouns', 6], ['describing', 4], ['advanced', 5]
    ]},
    { type: 'tenses', groups: [['present', 4], ['past', 3], ['future', 3]] }
  ];

  for (const collection of cases) {
    await page.goto('/grammar-library.html?type=' + collection.type);
    for (const [group, expectedCount] of collection.groups) {
      await page.goto('/grammar-category.html?type=' + collection.type + '&group=' + group);
      const cards = page.locator('#lessons .lesson');
      await expect(cards).toHaveCount(expectedCount);
      const hrefs = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
      expect(hrefs.every(href => /^\.\/grammar-lesson\.html#(?:g|t)-[a-z0-9-]+$/.test(href))).toBeTruthy();
      expect(new Set(hrefs).size).toBe(expectedCount);
      for (const href of hrefs) {
        await page.goto(href);
        await expect(page.locator('#lessonRoot h1')).toBeVisible();
        await expect(page.locator('#lessonRoot h1')).not.toBeEmpty();
      }
    }
  }
});
