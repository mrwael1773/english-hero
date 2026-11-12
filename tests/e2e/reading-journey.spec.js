import { test, expect } from './fixtures.js';

test('reading journey locks later stages until the previous check is passed', async ({ page }) => {
  await page.goto('/reading.html');
  await expect(page.locator('.stage-card')).toHaveCount(11);
  await expect(page.locator('.stage-card.stage-locked')).toHaveCount(10);

  await page.goto('/reading-digraphs.html');
  await expect(page.locator('.activity-card')).toContainText('هذه المرحلة لم تُفتح بعد');

  await page.goto('/reading-letter-sounds.html');
  await expect(page.locator('.reading-hero h1')).toContainText('أصوات الحروف');
  await page.locator('[data-choice="1"]').click();
  await expect(page.locator('#quizFeedback')).toContainText('تم حفظ اجتياز المرحلة');

  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('englishHeroReadingProgressV1:e2e-student'))
  );
  expect(saved).toEqual({ version: 1, completed: ['letter-sounds'] });

  await page.goto('/reading-digraphs.html');
  await expect(page.locator('.reading-hero h1')).toContainText('الحروف المركبة');
});

test('reading audio button requests the complete example word once', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'englishHeroReadingProgressV1:e2e-student',
      JSON.stringify({ version: 1, completed: [] })
    );
    window.__readingSpoken = [];
    class MockUtterance {
      constructor(text) { this.text = text; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockUtterance
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        speak(utterance) { window.__readingSpoken.push(utterance.text); }
      }
    });
  });

  await page.goto('/reading-letter-sounds.html');
  await page.locator('.example [data-speak]').first().click();
  await expect.poll(() => page.evaluate(() => window.__readingSpoken)).toEqual(['Apple']);
});


test('legacy alphabet URL now opens the letter-sounds lesson without teaching letter names', async ({ page }) => {
  await page.goto('/reading-letters.html');
  await expect(page.locator('.reading-hero h1')).toContainText('أصوات الحروف');
  await expect(page.locator('.mini-lesson').filter({ hasText: 'متى يكون C مثل K؟' })).toHaveCount(1);
  await expect(page.locator('.alphabet-grid')).toHaveCount(0);
  const exampleWords = await page.locator('.example-word').evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
  expect(exampleWords).not.toContain('Aa');
});


test('bottom navigation opens the reading journey', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'مسار القراءة' }).click();
  await expect(page).toHaveURL(/\/reading\.html$/);
  await expect(page.locator('#readingRoot')).toBeVisible();
});

test('consonant digraph highlighted words are spoken as whole words', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'englishHeroReadingProgressV1:e2e-student',
      JSON.stringify({ version: 1, completed: ['letter-sounds'] })
    );
    window.__readingSpoken = [];
    class MockUtterance {
      constructor(text) { this.text = text; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockUtterance
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        speak(utterance) { window.__readingSpoken.push(utterance.text); }
      }
    });
  });

  await page.goto('/reading-digraphs.html');
  const exampleCard = page.locator('.lesson-card').filter({
    has: page.getByRole('heading', { name: '👀 أمثلة مع تحديد الجزء المستهدف' })
  });
  const buttons = exampleCard.locator('.example-grid [data-speak]');
  await expect(buttons).toHaveCount(18);
  for (let i = 0; i < 18; i++) await buttons.nth(i).click();
  await expect.poll(() => page.evaluate(() => window.__readingSpoken)).toEqual([
    'Ship', 'shop', 'Fish', 'dish', 'Chair', 'lunch', 'Think', 'bath', 'This', 'mother', 'Phone', 'graph', 'Sing', 'ring', 'Duck', 'black', 'Whale', 'wheel'
  ]);
  await expect.poll(() => buttons.evaluateAll(nodes => nodes.map(node => node.dataset.speak))).toEqual([
    'Ship', 'shop', 'Fish', 'dish', 'Chair', 'lunch', 'Think', 'bath', 'This', 'mother', 'Phone', 'graph', 'Sing', 'ring', 'Duck', 'black', 'Whale', 'wheel'
  ]);
});



test('letter sounds lesson explains common sound changes across multiple letters', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'englishHeroReadingProgressV1:e2e-student',
      JSON.stringify({ version: 1, completed: [] })
    );
  });

  await page.goto('/reading-letter-sounds.html');
  for (const pattern of [
    'حرف G له صوتان شائعان',
    'حرف S قد يكون /s/ أو /z/',
    'حرف X له أكثر من نطق',
    'حرف Y قد يكون ساكنًا أو حرف علة',
    'حرف Q يأتي غالبًا مع U',
    'حروف لها صوت أساسي شائع',
    'الحركات الخمس لها أصوات متعددة',
    'كيف أستخدم القاعدة؟',
    'هل القواعد تنطبق دائمًا؟'
  ]) {
    await expect(page.locator('.mini-lesson').filter({ hasText: pattern })).toHaveCount(1);
  }
  for (const word of ['Game', 'Gem', 'Get', 'Rose', 'Exam', 'Xylophone', 'Happy', 'Queen']) {
    await expect(page.locator('.example-word').filter({ hasText: word }).first()).toContainText(word);
  }
});

test('letter sounds lesson shows its visual pronunciation map', async ({ page }) => {
  await page.goto('/reading-letter-sounds.html');
  await expect(page.locator('.sound-map-grid .sound-rule-card')).toHaveCount(6);
  await expect(page.locator('.sound-rule-card.sound-c')).toContainText('CENT');
  await expect(page.locator('.sound-rule-card.sound-g')).toContainText('GET');
  await expect(page.locator('.sound-rule-card.sound-x')).toContainText('XYLOPHONE');
});

test('legacy alphabet completion does not count as phonics mastery', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'englishHeroReadingProgressV1:e2e-student',
      JSON.stringify({ version: 1, completed: ['letters'] })
    );
  });
  await page.goto('/reading.html');
  await expect(page.locator('.stage-card')).toHaveCount(11);
  await expect(page.locator('.stage-card').first()).not.toHaveClass(/stage-locked/);
  await expect(page.locator('.stage-card').nth(1)).toHaveClass(/stage-locked/);
  await page.goto('/reading-letter-sounds.html');
  await expect(page.locator('.reading-meta')).toContainText('لم تُجتز بعد');
});

test('letter sounds lesson teaches hard and soft C with examples and a mastery check', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'englishHeroReadingProgressV1:e2e-student',
      JSON.stringify({ version: 1, completed: [] })
    );
  });

  await page.goto('/reading-letter-sounds.html');
  await expect(page.locator('.mini-lesson').filter({ hasText: 'متى يكون C مثل K؟' })).toHaveCount(1);
  await expect(page.locator('.mini-lesson').filter({ hasText: 'متى يكون C مثل S؟' })).toHaveCount(1);
  for (const word of ['Cold', 'City', 'Cent', 'Cycle']) {
    await expect(page.locator('.example-word').filter({ hasText: word }).first()).toContainText(word);
  }
  await page.locator('[data-choice="1"]').click();
  await expect(page.locator('#quizFeedback')).toContainText('تم حفظ اجتياز المرحلة');
});
