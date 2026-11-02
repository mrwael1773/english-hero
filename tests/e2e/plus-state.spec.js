import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('corrupted Plus local state is normalized before rendering', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('ehPlusV1', JSON.stringify({
      known: '<img src=x onerror=alert(1)>',
      missed: ['<svg onload=alert(1)>'],
      quizKnown: ['w:' + '<script>alert(1)</script>'],
      recentQuestions: ['<img src=x>'],
      done: '<img src=x onerror=alert(1)>',
      streak: '<svg onload=alert(1)>',
      last: '<script>alert(1)</script>',
      points: '<img src=x onerror=alert(1)>',
      theme: 'broken theme',
      avatar: '<svg onload=alert(1)>',
      title: '<img src=x onerror=alert(1)>',
    }));
  });
  await page.reload();
  await page.locator('[data-nav="heroLab"]').click();
  await page.locator('[data-ehp-tab="leaders"]').click();
  await expect(page.locator('#ehpContent')).toContainText('0 XP');
  await expect(page.locator('#ehpContent img, #ehpContent svg, #ehpContent script')).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehPlusV1')));
  expect(saved.known).toEqual([]);
  expect(saved.missed).toEqual([]);
  expect(saved.points).toBe(0);
  expect(saved.streak).toBe(0);
  expect(saved.theme).toBe('default');
  expect(saved.avatar).toBe('🧑‍🎓');
  expect(saved.title).toBe('متعلّم');
});

test('valid Plus learning progress survives state normalization', async ({ page }) => {
  await page.evaluate(() => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem('ehPlusV1', JSON.stringify({
      known: ['improve', 'unknown-word'],
      missed: ['usually', 'not-a-word'],
      quizKnown: ['w:improve'],
      recentQuestions: ['improve', 'unknown-word'],
      done: { [today]: { quiz: true, game: false, scenario: true, quiz_claimed: true } },
      streak: 3,
      last: today,
      points: 45,
      theme: 'ocean',
      avatar: '🦊',
      title: 'مستكشف',
    }));
  });
  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehPlusV1')));
  expect(saved.known).toEqual(['improve']);
  expect(saved.missed).toEqual(['usually']);
  expect(saved.points).toBe(45);
  expect(saved.streak).toBe(3);
  expect(saved.theme).toBe('ocean');
  expect(saved.avatar).toBe('🦊');
  expect(saved.title).toBe('مستكشف');
});
