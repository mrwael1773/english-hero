import { test, expect } from './fixtures.js';

test('champions view shows daily and weekly winners plus achievement categories', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-page="champions"]').click();

  await expect(page.locator('#champions')).toHaveClass(/active/);
  await expect(page.locator('#championsToday')).toContainText('بطلة الاختبار');
  await expect(page.locator('#championsWeek')).toContainText('بطل الأسبوع');
  await expect(page.locator('#championsMastery')).toContainText('الأكثر إتقانًا');
  await expect(page.locator('#championsConsistency')).toContainText('نجم الاستمرارية');
  await expect(page.locator('#championsStatus')).toContainText('الأسبوع من الأحد إلى السبت');
});

test('champions view never renders account identifiers from the aggregate response', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-page="champions"]').click();

  const content = await page.locator('#champions').innerText();
  expect(content).not.toContain('e2e_student');
  expect(content).not.toContain('e2e-student');
  expect(content).not.toContain('@');
});
