import { test, expect } from '@playwright/test';

test('offers direct section navigation on long guide pages', async ({ page }) => {
  await page.goto('/english-tenses-guide.html');
  const quickNav = page.getByRole('navigation', { name: 'التنقل السريع داخل الصفحة' });
  await expect(quickNav).toBeVisible();
  await expect(quickNav.getByRole('link')).toHaveCount(7);

  const targetLink = quickNav.getByRole('link', { name: /الماضي البسيط/ });
  const targetId = await targetLink.getAttribute('href');
  await targetLink.click();
  await expect(page.locator(targetId)).toBeInViewport();
});

test('keeps quick navigation compact and horizontally usable on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/english-basics.html');
  const quickNav = page.getByRole('navigation', { name: 'التنقل السريع داخل الصفحة' });
  await expect(quickNav).toBeVisible();
  await expect(quickNav.locator('.quick-nav-list')).toHaveCSS('overflow-x', 'auto');
  await expect(quickNav.getByRole('link').first()).toBeVisible();
});

test('refreshes quick navigation when the student changes app sections', async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto('/');
  const quickNav = page.getByRole('navigation', { name: 'التنقل السريع داخل الصفحة' });
  await expect(quickNav).toBeVisible();
  await expect(quickNav.getByRole('link', { name: /مكتب الطالب/ })).toBeVisible();

  await page.locator('[data-nav="profile"]').click();
  await expect(quickNav.getByRole('link', { name: /إحصائيات التعلّم/ })).toBeVisible();
  await expect(quickNav.getByRole('link', { name: /سجل الاختبارات/ })).toBeVisible();
});
