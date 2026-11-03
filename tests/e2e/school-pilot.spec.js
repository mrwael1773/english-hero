import { test, expect } from '@playwright/test';

test('school pilot has 20 words and 12 sessions without external scripts or requests', async ({ page }) => {
  const externalRequests = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173/')) externalRequests.push(request.url()); });
  await page.goto('/school-pilot.html');
  await expect(page.locator('script[src]')).toHaveCount(0);
  expect(externalRequests).toEqual([]);
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#wordGrid .word')).toHaveCount(20);
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  await expect(page.locator('#wordGrid .word')).toHaveCount(20);
  await expect(page.locator('#attendanceGrid .session')).toHaveCount(12);
  await expect(page.locator('#outageGrid .session')).toHaveCount(12);
  await expect(page.locator('#workspace details')).toContainText('Omar goes to the library on Monday');
  await expect(page.locator('#workspace details')).toContainText('The bus leaves the station at seven');
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
  await page.locator('#help').selectOption('no');
  await page.locator('#participantForm button[type="submit"]').click();
  await expect(page.locator('#rows')).toContainText('P01');
  await expect(page.locator('#rows')).toContainText('مستوفٍ');
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
  test.setTimeout(120_000);
  await page.goto('/school-pilot.html');
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  for (let i = 1; i <= 24; i++) {
    const code = 'P' + String(i).padStart(2, '0');
    await page.locator('#code').fill(code);
    await page.locator('#group').selectOption('app');
    await page.locator('#pair').selectOption(String(Math.ceil(i / 2)));
    await page.locator('#preListen').fill('5');
    await page.locator('#preUnderstand').fill('5');
    await page.locator('#preRecall').fill('5');
    await page.locator('#participantForm button[type="submit"]').click();
    await expect(page.locator('#rows tr')).toHaveCount(i);
  }
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#randomizePairs').click();
  const assigned = await page.locator('#rows tr').evaluateAll(rows => rows.map(row => row.children[1].textContent));
  expect(assigned.filter(group => group === 'التطبيق')).toHaveLength(12);
  expect(assigned.filter(group => group === 'المقارنة')).toHaveLength(12);
  await expect(page.locator('#randomizePairs')).toBeDisabled();
  await expect(page.locator('#group')).toBeDisabled();
  await expect(page.locator('#pair')).toBeDisabled();
  await expect(page.locator('#summary')).toContainText('12/12');
  await page.locator('#code').fill('P01');
  await page.locator('#preListen').fill('6');
  await page.locator('#preUnderstand').fill('5');
  await page.locator('#preRecall').fill('5');
  await page.locator('#participantForm button[type="submit"]').click();
  await expect(page.locator('#formStatus')).toContainText('مسجل مسبقًا');
  await expect(page.locator('#rows tr')).toHaveCount(24);
});

test('reports normalized percentage-point gains and session outage counts', async ({ page }) => {
  await page.goto('/school-pilot.html');
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  for (let i = 0; i < 12; i++) {
    await page.locator('.outage[data-outage="' + i + '"]').fill(i === 0 ? '6' : '0');
  }
  await page.locator('#saveOutages').click();
  const add = async (code, group, preL, postL, preV, postV, delayedV) => {
    await page.locator('#code').fill(code);
    await page.locator('#group').selectOption(group);
    await page.locator('#pair').selectOption('1');
    await page.locator('#preListen').fill(String(preL));
    await page.locator('#preUnderstand').fill(String(preV / 2));
    await page.locator('#preRecall').fill(String(preV / 2));
    await page.locator('#postListen').fill(String(postL));
    await page.locator('#postUnderstand').fill(String(postV / 2));
    await page.locator('#postRecall').fill(String(postV / 2));
    await page.locator('#delayUnderstand').fill(String(delayedV / 2));
    await page.locator('#delayRecall').fill(String(delayedV / 2));
    await page.locator('#participantForm button[type="submit"]').click();
  };
  await add('P01', 'app', 5, 7, 10, 14, 12);
  await add('P02', 'control', 5, 6, 10, 12, 12);
  await add('P03', 'app', 5, 8, 10, 16, 10);
  await expect(page.locator('#summary')).toContainText('25.0');
  await expect(page.locator('#summary')).toContainText('10.0');
  await expect(page.locator('#summary')).toContainText('11/12');
});
