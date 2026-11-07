import { test, expect } from './fixtures.js';

test('progress reset clears current learning data but preserves the account backup', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('english-hero-academy-3', JSON.stringify({
      displayName: 'Synthetic Student',
      xp: 120,
      completed: [0],
      masteredLessons: [0],
      saved: [],
      chatHistory: [{ who: 'me', text: 'synthetic private note' }]
    }));
    localStorage.setItem('english-hero-account-backup-e2e-student', JSON.stringify({
      displayName: 'Synthetic Student',
      xp: 120
    }));
  });

  await page.goto('/');
  await page.locator('[data-nav="profile"]').click();
  await expect(page.locator('#resetData')).toHaveText('إعادة ضبط التقدم');

  let confirmation = '';
  page.on('dialog', async dialog => {
    confirmation = dialog.message();
    await dialog.accept();
  });
  await page.locator('#resetData').click();
  await expect(page.locator('#toast')).toHaveText('تمت إعادة ضبط التقدم الحالي');

  const stored = await page.evaluate(() => ({
    progress: JSON.parse(localStorage.getItem('english-hero-academy-3')),
    backup: JSON.parse(localStorage.getItem('english-hero-account-backup-e2e-student'))
  }));
  expect(confirmation).toContain('لن تُحذف النسخ الاحتياطية المحلية');
  expect(stored.progress.xp).toBe(0);
  expect(stored.progress.completed).toEqual([]);
  expect(stored.progress.chatHistory).toEqual([]);
  expect(stored.backup.xp).toBe(120);
});
