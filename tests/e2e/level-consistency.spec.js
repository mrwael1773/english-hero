import { test, expect } from './fixtures.js';

test('learning-path level and progress bar use the same XP thresholds', async ({ page }) => {
  await page.goto('/');
  const at200 = await page.evaluate(() => {
    state.xp = 200;
    renderInsights();
    return {
      label: document.querySelector('#pathLevel')?.textContent || '',
      width: Number.parseFloat(document.querySelector('#pathProgress')?.style.width || '0')
    };
  });
  expect(at200.label).toContain('المستوى 2');
  expect(at200.label).toContain('200 XP');
  expect(at200.width).toBeCloseTo(66.6667, 1);

  const at3600 = await page.evaluate(() => {
    state.xp = 3600;
    renderInsights();
    return {
      label: document.querySelector('#pathLevel')?.textContent || '',
      width: Number.parseFloat(document.querySelector('#pathProgress')?.style.width || '0')
    };
  });
  expect(at3600.label).toContain('المستوى 11');
  expect(at3600.label).toContain('3600 XP');
  expect(at3600.width).toBeCloseTo(58.3333, 1);
});
