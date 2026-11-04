import { test, expect } from '@playwright/test';

async function openVault(page) {
  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => {
    const proto = Object.getPrototypeOf(crypto.subtle);
    const original = proto.deriveKey;
    Object.defineProperty(window, '__schoolPilotDeriveKeyCalls', { value: 0, writable: true });
    proto.deriveKey = function (...args) {
      window.__schoolPilotDeriveKeyCalls += 1;
      return original.apply(this, args);
    };
  });
  await page.goto('/school-pilot.html');
  const setup = await page.locator('#vaultOpen').evaluate(el => ({
    handler: typeof el.onclick,
    disabled: el.disabled,
    passwordInput: !!document.getElementById('vaultPassword')
  }));
  expect(setup).toEqual({ handler: 'function', disabled: false, passwordInput: true });
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  try {
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 30000 });
  } catch (error) {
    const status = await page.locator('#vaultStatus').textContent();
    const state = await page.locator('#vaultOpen').evaluate(el => ({ disabled: el.disabled, status: document.getElementById('vaultStatus').textContent }));
    throw new Error('Vault did not open. Status: ' + status + '. Button state: ' + JSON.stringify(state) + '. Derive calls: ' + await page.evaluate(() => window.__schoolPilotDeriveKeyCalls) + '. Page errors: ' + pageErrors.join(' | ') + '. Console errors: ' + consoleErrors.join(' | '));
  }
  expect(await page.evaluate(() => window.__schoolPilotDeriveKeyCalls)).toBe(1);
  await expect(page.locator('#vaultPassword')).toBeDisabled();
  await expect(page.locator('#vaultPassword')).toHaveValue('');
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
  await expect(page.locator('#wordGrid .word:visible')).toHaveCount(0);
  await openVault(page);
  await expect(page.locator('#wordGrid .word')).toHaveCount(20);
  await expect(page.locator('#attendanceGrid .session')).toHaveCount(12);
  await expect(page.locator('#outageGrid .session')).toHaveCount(12);
  await expect(page.locator('.minutes').first()).toHaveAttribute('max', '20');
  await expect(page.locator('.outage').first()).toHaveAttribute('max', '20');
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
  const initialIv = await page.evaluate(() => JSON.parse(localStorage.getItem('ehSchoolPilotEncryptedV1')).iv);
  const raw = await page.evaluate(() => localStorage.getItem('ehSchoolPilotEncryptedV1'));
  expect(raw).toBeTruthy();
  expect(raw).not.toContain('P01');
  expect(raw).not.toContain('school-pilot-passphrase-2026');
  // A second read is not a second encryption. Trigger an explicit save,
  // then verify that each actual save rotates the AES-GCM IV.
  await page.locator('.outage').first().fill('0');
  await page.locator('#saveOutages').click();
  await expect(page.locator('#outageStatus')).toContainText('حُفظ سجل أعطال الجلسات');
  const savedIv = await page.evaluate(() => JSON.parse(localStorage.getItem('ehSchoolPilotEncryptedV1')).iv);
  expect(savedIv).not.toBe(initialIv);
  expect(await page.evaluate(() => window.__schoolPilotDeriveKeyCalls)).toBe(1);

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
  expect(await page.evaluate(() => window.__schoolPilotDeriveKeyCalls)).toBe(1);
  await expect(page.locator('#rows')).toBeEmpty();
  await expect(page.locator('#summary')).toBeEmpty();
  await expect(page.locator('#wordGrid')).toBeEmpty();
  await expect(page.locator('#itemScoreRows')).toBeEmpty();
  await expect(page.locator('#code')).toHaveValue('');
  await expect(page.locator('#preListen')).toHaveValue('');
  await expect(page.locator('#approvalState')).toContainText('المراجعة غير مكتملة');
  await expect(page.locator('#readiness')).toContainText('السجل مقفل');
  await page.locator('#vaultPassword').fill('school-pilot-passphrase-2026');
  await page.locator('#vaultOpen').click();
  await expect(page.locator('#rows')).toContainText('P01');
  await expect(page.locator('#group')).toHaveValue('app');
  await expect(page.locator('#pair')).toHaveValue('1');
  expect(await page.evaluate(() => window.__schoolPilotDeriveKeyCalls)).toBe(2);
});

test('rejects wrong password, invalid scores, and missing item-level baseline entries', async ({ page }) => {
  await openVault(page);
  await page.locator('#vaultLock').click();
  await page.locator('#vaultPassword').fill('wrong-password-2026');
  await page.locator('#vaultOpen').click();
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#vaultStatus')).toContainText('تعذر الفتح:');

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
  await page.locator('#preForm').selectOption('A');
  await page.locator('#postForm').selectOption('B');
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
    await page.locator('#preForm').selectOption(i % 2 === 0 ? 'A' : 'B');
    await page.locator('#postForm').selectOption(i % 2 === 0 ? 'B' : 'A');
    await page.locator('#preListen').fill('5');
    await page.locator('#preUnderstand').fill('5');
    await page.locator('#preRecall').fill('5');
    await page.locator('#preUse').fill('5');
    await markItems(page, 'pre', 0);
    await page.locator('#participantForm button[type="submit"]').click();
    await expect(page.locator('#rows tr')).toHaveCount(i);
  }
  expect(await page.evaluate(() => window.__schoolPilotDeriveKeyCalls)).toBe(1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#randomizePairs').click();
  await expect(page.locator('#formStatus')).toContainText('اكتملت القرعة');
  const assigned = await page.locator('#rows tr').evaluateAll(rows => rows.map(row => row.children[1].textContent));
  expect(assigned.filter(group => group === 'التطبيق')).toHaveLength(12);
  expect(assigned.filter(group => group === 'المقارنة')).toHaveLength(12);
  await expect(page.locator('#randomizePairs')).toBeDisabled();
  await expect(page.locator('#group')).toBeDisabled();
  await expect(page.locator('#pair')).toBeDisabled();
  await expect(page.locator('#preForm')).toBeDisabled();
  await expect(page.locator('#postForm')).toBeDisabled();
  await expect(page.locator('#summary')).toContainText('12/12');
  const members = await page.locator('#rows tr').evaluateAll(rows => rows.map(row => ({ code: row.children[0].textContent, group: row.children[1].textContent === 'التطبيق' ? 'app' : 'control' })));
  const formOrders = { app: [], control: [] };
  for (const member of members) {
    await page.locator('[data-edit="' + member.code + '"]').click();
    formOrders[member.group].push(await page.locator('#preForm').inputValue() + await page.locator('#postForm').inputValue());
  }
  for (const group of ['app', 'control']) {
    expect(formOrders[group].filter(order => order === 'AB')).toHaveLength(6);
    expect(formOrders[group].filter(order => order === 'BA')).toHaveLength(6);
  }

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


test('aggregates retention using pooled item counts rather than averaging participant percentages', async ({ page }) => {
  await openVault(page);
  const add = async (code, postCorrect, delayedCorrect, pair) => {
    await page.locator('#code').fill(code);
    await page.locator('#group').selectOption('app');
    await page.locator('#pair').selectOption(String(pair));
    await page.locator('#preForm').selectOption('A');
    await page.locator('#postForm').selectOption('B');
    for (const id of ['preListen','preUnderstand','preRecall','preUse','postListen','postUnderstand','postRecall','postUse','delayListen','delayUnderstand','delayRecall','delayUse']) {
      await page.locator('#' + id).fill('5');
    }
    await page.locator('.item-score[data-time="pre"]').evaluateAll(els => els.forEach(el => el.value = '0'));
    await page.locator('.item-score[data-time="post"]').evaluateAll((els, count) => els.forEach((el, i) => el.value = i < count ? '1' : '0'), postCorrect);
    await page.locator('.item-score[data-time="delay"]').evaluateAll((els, count) => els.forEach((el, i) => el.value = i < count ? '1' : '0'), delayedCorrect);
    await page.locator('#participantForm button[type="submit"]').click();
  };
  await add('P01', 1, 1, 1);   // 1/1 retained
  await add('P02', 20, 0, 2);  // 0/20 retained
  await expect(page.locator('#summary')).toContainText('4.8% (1/21)');
  await expect(page.locator('#summary')).toContainText('نسبة الاحتفاظ بالبنود المتقنة');
  await expect(page.locator('#summary')).toContainText('نسبة الاحتفاظ بالمفردات المكتسبة');
});


test('shows retention as uncomputable when the pooled denominator is zero', async ({ page }) => {
  await openVault(page);
  await page.locator('#code').fill('P01');
  await page.locator('#group').selectOption('app');
  await page.locator('#pair').selectOption('1');
  await page.locator('#preForm').selectOption('A');
  await page.locator('#postForm').selectOption('B');
  for (const id of ['preListen','preUnderstand','preRecall','preUse','postListen','postUnderstand','postRecall','postUse','delayListen','delayUnderstand','delayRecall','delayUse']) {
    await page.locator('#' + id).fill('5');
  }
  for (const time of ['pre','post','delay']) {
    await page.locator('.item-score[data-time="' + time + '"]').evaluateAll(els => els.forEach(el => el.value = '0'));
  }
  await page.locator('#participantForm button[type="submit"]').click();
  await expect(page.locator('#summary')).toContainText('غير قابل للحساب (0/0)');
  await expect(page.locator('#rows')).toContainText('غير قابل للحساب (0/0)');
});


test('shows the candidate vocabulary in the teachers document order and avoids unapproved automatic expansion gates', async ({ page }) => {
  await openVault(page);
  const words = await page.locator('#wordGrid .word').evaluateAll(cards => cards.map(card => ({
    word: card.querySelector('strong')?.textContent?.trim(),
    week: card.querySelector('.tag')?.textContent?.trim()
  })));
  expect(words).toEqual([
    { word: 'library', week: 'الأسبوع 1' },
    { word: 'borrow', week: 'الأسبوع 1' },
    { word: 'return', week: 'الأسبوع 1' },
    { word: 'friend', week: 'الأسبوع 1' },
    { word: 'teacher', week: 'الأسبوع 1' },
    { word: 'quiet', week: 'الأسبوع 2' },
    { word: 'early', week: 'الأسبوع 2' },
    { word: 'late', week: 'الأسبوع 2' },
    { word: 'arrive', week: 'الأسبوع 2' },
    { word: 'leave', week: 'الأسبوع 2' },
    { word: 'morning', week: 'الأسبوع 3' },
    { word: 'evening', week: 'الأسبوع 3' },
    { word: 'breakfast', week: 'الأسبوع 3' },
    { word: 'lunch', week: 'الأسبوع 3' },
    { word: 'water', week: 'الأسبوع 3' },
    { word: 'bread', week: 'الأسبوع 4' },
    { word: 'ticket', week: 'الأسبوع 4' },
    { word: 'station', week: 'الأسبوع 4' },
    { word: 'open', week: 'الأسبوع 4' },
    { word: 'close', week: 'الأسبوع 4' }
  ]);
  await expect(page.locator('#readiness')).toContainText('لا توجد عتبات نجاح أو قرار توسع آلي معتمد');
  await expect(page.locator('#readiness')).not.toContainText('12/12 متحققة');
});
