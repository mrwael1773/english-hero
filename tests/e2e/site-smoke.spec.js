import { test, expect } from '@playwright/test';

test('home page loads with a mobile viewport declaration', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/);
  await expect(page.locator('html')).toHaveAttribute('lang', /.+/);
});

for (const route of ['/privacy.html', '/contact.html']) {
  test(`${route} loads successfully`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('title')).toHaveCount(1);
  });
}

test('home page renders at a narrow mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/);
});


test('measurable learning pilot is available in the vocabulary library', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  await page.locator('[data-nav="courses"]').click();
  await expect(page.locator('#measuredPilot')).toBeVisible();
  await expect(page.locator('#measuredPilot')).toContainText('مسار البداية');
  await expect(page.locator('#measuredPilot')).toContainText('٨٠٪');
});
