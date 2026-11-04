import { test, expect } from '@playwright/test';

test('school assessment page clearly states the classroom evaluation is external and collects no student data', async ({ page }) => {
  const externalRequests = [];
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4173/')) externalRequests.push(request.url());
  });
  await page.goto('/school-pilot.html');
  await expect(page.locator('h1')).toContainText('التقييم المدرسي يتم حضوريًا خارج الموقع');
  await expect(page.locator('main')).toContainText('الموقع لا يجمع هذه النتائج ولا يزامنها');
  await expect(page.locator('form')).toHaveCount(0);
  await expect(page.locator('input, textarea, select, button')).toHaveCount(0);
  await expect(page.locator('script')).toHaveCount(0);
  expect(externalRequests).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
