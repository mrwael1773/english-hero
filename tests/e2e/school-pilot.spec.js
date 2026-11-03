import { test, expect } from '@playwright/test';

test('school pilot has 20 words and 12 sessions', async ({ page }) => {
  await page.goto('/school-pilot.html');
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#wordGrid .word')).toHaveCount(0);
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  await expect(page.locator('#wordGrid .word')).toHaveCount(20);
  await expect(page.locator('#attendanceGrid .session')).toHaveCount(12);
});

test('encrypted vault persists participant data and hides plaintext from localStorage', async ({ page }) => {
  await page.goto('/school-pilot.html');
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  await page.locator('#code').fill('P01');
  await page.locator('#preListen').fill('7');
  await page.locator('#preUnderstand').fill('8');
  await page.locator('#preRecall').fill('6');
  await page.locator('#postListen').fill('9');
  await page.locator('#postUnderstand').fill('9');
  await page.locator('#postRecall').fill('8');
  await page.locator('#delayUnderstand').fill('8');
  await page.locator('#delayRecall').fill('7');
  await page.locator('.minutes[data-session="1"]').fill('20');
  await page.locator('#clarity').selectOption('yes');
  await page.locator('#participantForm button[type="submit"]').click();
  await expect(page.locator('#rows')).toContainText('P01');
  const raw = await page.evaluate(() => localStorage.getItem('ehSchoolPilotEncryptedV1'));
  expect(raw).toBeTruthy();
  expect(raw).not.toContain('P01');
  expect(raw).not.toContain('school-pilot-passphrase-2026');
  await page.locator('#vaultLock').click();
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  await expect(page.locator('#rows')).toContainText('P01');
});

test('rejects wrong password and invalid score values', async ({ page }) => {
  await page.goto('/school-pilot.html');
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  await page.locator('#vaultLock').click();
  await page.locator('#vaultPassword').fill('wrong-password-2026');
  await page.locator('#vaultOpen').click();
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#vaultStatus')).toContainText('تحقق من عبارة المرور');
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  await page.locator('#code').fill('P01');
  await page.locator('#preListen').fill('11');
  await page.locator('#preUnderstand').fill('5');
  await page.locator('#preRecall').fill('5');
  await page.locator('#participantForm button[type="submit"]').click();
  await expect(page.locator('#formStatus')).toContainText('من 0 إلى 10');
});

test('limits participants to 24 and prevents duplicate codes', async ({ page }) => {
  await page.goto('/school-pilot.html');
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  for (let i = 1; i <= 24; i++) {
    const code = 'P' + String(i).padStart(2, '0');
    await page.locator('#code').fill(code);
    await page.locator('#group').selectOption(i % 2 ? 'app' : 'control');
    await page.locator('#preListen').fill('5');
    await page.locator('#preUnderstand').fill('5');
    await page.locator('#preRecall').fill('5');
    await page.locator('#participantForm button[type="submit"]').click();
    await expect(page.locator('#rows tr')).toHaveCount(i);
  }
  await page.locator('#code').fill('P01');
  await page.locator('#preListen').fill('6');
  await page.locator('#participantForm button[type="submit"]').click();
  await expect(page.locator('#formStatus')).toContainText('مسجل مسبقًا');
  await expect(page.locator('#rows tr')).toHaveCount(24);
});
