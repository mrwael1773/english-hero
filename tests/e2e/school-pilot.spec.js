import { test, expect } from '@playwright/test';

async function openVault(page) {
  await page.goto('/school-pilot.html');
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  await expect(page.locator('#workspace')).toBeVisible();
}

async function markItems(page, time, value) {
  await page.locator('.item-score[data-time="' + time + '"]').evaluateAll(
    (els, v) => els.forEach(el => { el.value = String(v); }),
    value
  );
}

test('school pilot keeps teacher keys out of public HTML and has the approved 20-word, 12-session structure', async ({ page }) => {
  const externalRequests = [];
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4173/')) externalRequests.push(request.url());
  });
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
  await expect(page.locator('#workspace details')).toHaveCount(0);
  await expect(page.locator('#workspace')).toContainText('لا تُضمّن في مصدر HTML العام');
  await expect(page.locator('#workspace')).not.toContainText('Omar goes to the library on Monday');
  await expect(page.locator('#itemScoreRows tr')).toHaveCount(20);
  await expect(page.locator('.item-score')).toHaveCount(60);
  await expect(page.locator('#workspace')).toContainText('6 للاستماع وربط المعنى');
  await expect(page.locator('#workspace')).toContainText('6 للاستدعاء والاستخدام في سياق');
});

test('encrypted vault stores four assessment domains and item-level retention without plaintext leakage', async ({ page }) => {
  await openVault(page);
  await page.locator('#code').fill('P01');
  await page.locator('#preForm').selectOption('A');
  await page.locator('#postForm').selectOption('B');
  await page.locator('#preListen').fill('7');
  await page.locator('#preUnderstand').fill('8');
  await page.locator('#preRecall').fill('6');
  await page.locator('#preUse').fill('6');
  await page.locator('#postListen').fill('9');
  await page.locator('#postUnderstand').fill('9');
  await page.locator('#postRecall').fill('8');
  await page.locator('#postUse').fill('8');
  await page.locator('#delayListen').fill('8');
  await page.locator('#delayUnderstand').fill('8');
  await page.locator('#delayRecall').fill('7');
  await page.locator('#delayUse').fill('7');
  await markItems(page, 'pre', 0);
  await markItems(page, 'post', 1);
  await markItems(page, 'delay', 1);
  await page.locator('.minutes[data-session="1"]').fill('20');
  await page.locator('#clarity').selectOption('yes');
  await page.locator('#help').selectOption('no');
  await page.locator('#participantForm button[type="submit"]').click();
  await expect(page.locator('#rows')).toContainText('P01');
  await expect(page.locator('#rows')).toContainText('100.0% (20/20)');
  const raw = await page.evaluate(() => localStorage.getItem('ehSchoolPilotEncryptedV1'));
  expect(raw).toBeTruthy();
  expect(raw).not.toContain('P01');
  expect(raw).not.toContain('school-pilot-passphrase-2026');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportCsv').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString('utf8');
  expect(csv).toContain('pre_use_context');
  expect(csv).toContain('vocab_pre_01');
  expect(csv).toContain('vocab_delay_20');

  await page.locator('#vaultLock').click();
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  await expect(page.locator('#rows')).toContainText('P01');
});

test('rejects wrong password, invalid scores, and missing item-level baseline entries', async ({ page }) => {
  await openVault(page);
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
  await page.locator('#preUse').fill('5');
  await page.locator('#participantForm button[type="submit"]').click();
  await expect(page.locator('#formStatus')).toContainText('من 0 إلى 10');

  await page.locator('#preListen').fill('5');
  await page.locator('#participantForm button[type="submit"]').click();
  await expect(page.locator('#formStatus')).toContainText('البنود العشرين');
});

test('limits participants to 24, randomizes within each pair, and prevents duplicate codes', async ({ page }) => {
  test.setTimeout(120_000);
  await openVault(page);
  for (let i = 1; i <= 24; i++) {
    const code = 'P' + String(i).padStart(2, '0');
    await page.locator('#code').fill(code);
    await page.locator('#group').selectOption('app');
    await page.locator('#pair').selectOption(String(Math.ceil(i / 2)));
    await page.locator('#preListen').fill('5');
    await page.locator('#preUnderstand').fill('5');
    await page.locator('#preRecall').fill('5');
    await page.locator('#preUse').fill('5');
    await markItems(page, 'pre', 0);
    await page.locator('#participantForm button[type="submit"]').click();
    await expect(page.locator('#rows tr')).toHaveCount(i);
  }
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#randomizePairs').click();
  await expect(page.locator('#formStatus')).toContainText('اكتملت القرعة');
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
  await page.locator('#preUse').fill('5');
  await markItems(page, 'pre', 0);
  await page.locator('#participantForm button[type="submit"]').click();
  await expect(page.locator('#formStatus')).toContainText('مسجل مسبقًا');
  await expect(page.locator('#rows tr')).toHaveCount(24);
});

test('reports domain gains, item-level retention, delayed vocabulary performance, and outages', async ({ page }) => {
  await openVault(page);
  for (let i = 0; i < 12; i++) {
    await page.locator('.outage[data-outage="' + i + '"]').fill(i === 0 ? '6' : '0');
  }
  await page.locator('#saveOutages').click();

  const add = async (code, group, preL, postL, preV, postV, delayedV, pair = 1) => {
    await page.locator('#code').fill(code);
    await page.locator('#group').selectOption(group);
    await page.locator('#pair').selectOption(String(pair));
    await page.locator('#preForm').selectOption('A');
    await page.locator('#postForm').selectOption('B');
    await page.locator('#preListen').fill(String(preL));
    await page.locator('#preUnderstand').fill(String(preV / 2));
    await page.locator('#preRecall').fill(String(preV / 2));
    await page.locator('#preUse').fill('5');
    await markItems(page, 'pre', 0);
    await page.locator('#postListen').fill(String(postL));
    await page.locator('#postUnderstand').fill(String(postV / 2));
    await page.locator('#postRecall').fill(String(postV / 2));
    await page.locator('#postUse').fill(group === 'app' ? '7' : '6');
    await markItems(page, 'post', 1);
    if (delayedV !== null) {
      await page.locator('#delayListen').fill(String(postL));
      await page.locator('#delayUnderstand').fill(String(delayedV / 2));
      await page.locator('#delayRecall').fill(String(delayedV / 2));
      await page.locator('#delayUse').fill(group === 'app' ? '7' : '6');
      await markItems(page, 'delay', 1);
    }
    const before = await page.locator('#rows tr').count();
    await page.locator('#participantForm button[type="submit"]').click();
    await expect(page.locator('#rows tr')).toHaveCount(before + 1);
  };

  await add('P01', 'app', 5, 7, 10, 14, 14);
  await add('P02', 'control', 5, 6, 10, 12, 14);
  await add('P03', 'app', 5, 8, 10, 16, null, 2);
  await expect(page.locator('#summary')).toContainText('25.0');
  await expect(page.locator('#summary')).toContainText('15.0');
  await expect(page.locator('#summary')).toContainText('100.0%');
  await expect(page.locator('#summary')).toContainText('70.0');
  await expect(page.locator('#summary')).toContainText('11/12');
});
