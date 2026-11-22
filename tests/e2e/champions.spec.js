import { test, expect } from './fixtures.js';

test('champions view shows the four retained categories only', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-page="champions"]').click();

  await expect(page.locator('#champions')).toHaveClass(/active/);
  await expect(page.locator('#championsToday')).toContainText('بطلة الاختبار');
  const todayRows = page.locator('#championsToday .champion-podium-row');
  await expect(todayRows).toHaveCount(2);
  await expect(todayRows.nth(0)).toContainText('🥈');
  await expect(todayRows.nth(0)).toContainText('وصيفة اليوم');
  await expect(todayRows.nth(0)).not.toContainText('بطلة الاختبار');
  await expect(todayRows.nth(1)).toContainText('🥉');
  await expect(page.locator('#championsWeek')).toContainText('بطل الأسبوع');
  await expect(page.locator('#championsConsistency')).toContainText('نجم الاستمرارية');
  await expect(page.locator('#championsMastery')).toHaveCount(0);
  await expect(page.locator('#championsImprovement')).toHaveCount(0);
  await expect(page.locator('#champions')).not.toContainText('الأكثر إتقانًا');
  await expect(page.locator('#champions')).not.toContainText('الأكثر تطورًا');
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

test('champion challenge validates the lesson range before making a server request', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-page="champions"]').click();

  await expect(page.locator('#championChallengeStart')).toBeVisible();
  await page.locator('#championChallengeLesson').fill('85');
  await page.locator('#championChallengeStart').click();
  await expect(page.locator('#championChallengeStatus')).toContainText('أدخل رقم درس من ١ إلى ٨٤');
});

test('champion challenge renders ten questions and displays the server result', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-page="champions"]').click();

  await page.locator('#championChallengeLesson').fill('1');
  await page.locator('#championChallengeStart').click();

  const questions = page.locator('#championChallengeForm .champion-challenge-question');
  await expect(questions).toHaveCount(10);
  await expect(page.locator('#championChallengeStatus')).toContainText('لديك ١٥ دقيقة');

  for (let index = 0; index < 10; index++) {
    await questions.nth(index).locator('input[type="radio"]').first().check();
  }
  await page.locator('#championChallengeForm button[type="submit"]').click();

  await expect(page.locator('#championChallengeStatus')).toContainText('اجتزت التحدي');
  await expect(page.locator('#championChallengeForm')).toHaveCount(0);
});


test('signing out clears the champions leaderboard from the current page', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-page="champions"]').click();
  await expect(page.locator('#championsToday')).toContainText('بطلة الاختبار');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('englishhero:authstate', {
    detail: { event: 'SIGNED_OUT', user: null }
  })));

  await expect(page.locator('#championsToday')).toBeEmpty();
  await expect(page.locator('#championsWeek')).toBeEmpty();
  await expect(page.locator('#championsConsistency')).toBeEmpty();
  await expect(page.locator('#championsStatus')).toContainText('سجّل الدخول');
});

test('signing out clears an in-progress champion challenge', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-page="champions"]').click();
  await page.locator('#championChallengeLesson').fill('1');
  await page.locator('#championChallengeStart').click();
  await expect(page.locator('#championChallengeForm .champion-challenge-question')).toHaveCount(10);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('englishhero:authstate', {
    detail: { event: 'SIGNED_OUT', user: null }
  })));

  await expect(page.locator('#championChallengeForm')).toHaveCount(0);
  await expect(page.locator('#championChallengeStatus')).toContainText('سجّل الدخول');
});
