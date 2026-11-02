import { test, expect } from '@playwright/test';

test('tampered scenario scores are normalized before HTML rendering', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => {
    localStorage.setItem('eh-scenarios-done', JSON.stringify({
      0: '<img src=x onerror=alert(1)>',
      1: 999,
      2: -20,
      3: 3.9,
    }));
  });
  await page.reload();
  await page.locator('[data-nav="practice"]').click();
  await expect(page.locator('#scenarioList img, #scenarioList svg, #scenarioList script')).toHaveCount(0);
  const cards = page.locator('#scenarioList button');
  await expect(cards.nth(0)).toContainText('٥ أسئلة');
  await expect(cards.nth(1)).toContainText('أفضل نتيجة: 5/5');
  await expect(cards.nth(2)).toContainText('٥ أسئلة');
  await expect(cards.nth(3)).toContainText('أفضل نتيجة: 3/5');
});
