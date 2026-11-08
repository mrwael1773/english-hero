import { test, expect } from './fixtures.js';

test('reading journey locks later stages until the previous check is passed', async ({ page }) => {
  await page.goto('/reading.html');
  await expect(page.locator('.stage-card')).toHaveCount(12);
  await expect(page.locator('.stage-card.stage-locked')).toHaveCount(11);

  await page.goto('/reading-letter-sounds.html');
  await expect(page.locator('.activity-card')).toContainText('هذه المرحلة لم تُفتح بعد');

  await page.goto('/reading-letters.html');
  await page.locator('[data-choice="0"]').click();
  await expect(page.locator('#quizFeedback')).toContainText('تم حفظ اجتياز المرحلة');

  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('englishHeroReadingProgressV1:e2e-student'))
  );
  expect(saved).toEqual({ version: 1, completed: ['letters'] });

  await page.goto('/reading-letter-sounds.html');
  await expect(page.locator('.reading-hero h1')).toContainText('أصوات الحروف');

  await page.goto('/reading-digraphs.html');
  await expect(page.locator('.activity-card')).toContainText('هذه المرحلة لم تُفتح بعد');
});

test('reading audio button requests the complete example word once', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'englishHeroReadingProgressV1:e2e-student',
      JSON.stringify({ version: 1, completed: ['letters'] })
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
