import { test, expect } from '@playwright/test';

async function openFirstLesson(page) {
  await page.goto('/');
  await page.evaluate(() => window.page('courses'));
  const firstLesson = page.locator('#courseGrid button').first();
  await expect(firstLesson).toBeVisible();
  await firstLesson.click();

  const translations = new Map();
  for (let i = 0; i < 6; i++) {
    const english = (await page.locator('#wordEnglish').innerText()).trim();
    const arabic = (await page.locator('#wordArabic').innerText()).trim();
    translations.set(english, arabic);
    translations.set(arabic, english);
    await page.locator('#nextWord').click();
  }
  await expect(page.locator('#quizArea')).toBeVisible();
  await expect(page.locator('#quizCounter')).toContainText('من 18');
  return translations;
}

async function answerAllCorrectly(page, translations) {
  let typedQuestions = 0;
  for (let i = 0; i < 18; i++) {
    const question = (await page.locator('#question').innerText()).trim();
    const input = page.locator('#answerArea input');
    if (await input.count()) {
      typedQuestions++;
      const answer = translations.get(question);
      expect(answer, 'Typed question should map to a known lesson word').toBeTruthy();
      await input.fill(answer);
      await page.locator('#answerArea button').click();
    } else {
      let answer;
      if (question.includes('Listen and choose')) {
        const label = await page.locator('#quizListenButton').getAttribute('aria-label');
        answer = label?.replace('استمع إلى نطق ', '').trim();
      } else {
        answer = translations.get(question);
      }
      expect(answer, 'Question should map to a known lesson word').toBeTruthy();
      await page.locator('#answerArea button.answer').filter({ hasText: answer }).first().click();
    }
    await expect(page.locator('#quizFeedback')).toBeVisible();
    await expect(page.locator('#quizFeedback')).toContainText(/ممتاز|سبق احتساب/);
    await page.locator('#quizNext').click();
  }
  expect(typedQuestions).toBeGreaterThan(0);
}

test('mastery XP and reward claims survive cloud upload and a fresh page load', async ({ page }) => {
  // This test uses the real cloud-sync.js with a deterministic in-browser Supabase
  // test double. No real Supabase project or student account is contacted.
  await page.route('**/cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.supabase = {
        createClient: () => {
          const resolved = value => {
            const promise = Promise.resolve(value);
            promise.abortSignal = () => promise;
            return promise;
          };
          return {
            auth: {
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              getSession: async () => ({
                data: { session: { user: { id: 'cloud-e2e-student', user_metadata: { full_name: 'Cloud E2E' } } } },
                error: null
              })
            },
            from: () => ({
              select() { return this; },
              eq() { return this; },
              maybeSingle() {
                return resolved({ data: JSON.parse(localStorage.getItem('__e2e_cloud_progress') || 'null'), error: null });
              },
              upsert(row) {
                localStorage.setItem('__e2e_cloud_progress', JSON.stringify(row));
                return resolved({ data: row, error: null });
              }
            }),
            rpc: async () => ({ data: null, error: null })
          };
        }
      };
    `
  }));

  await page.addInitScript(() => {
    if (!localStorage.getItem('__e2e_cloud_test_initialized')) {
      localStorage.setItem('__e2e_cloud_test_initialized', '1');
      localStorage.setItem('english-hero-cloud-owner', 'cloud-e2e-student');
    }
  });

  const translations = await openFirstLesson(page);
  await answerAllCorrectly(page, translations);
  await expect(page.locator('#quizArea')).toContainText('أتقنت الدرس');

  await page.waitForFunction(() => {
    const row = JSON.parse(localStorage.getItem('__e2e_cloud_progress') || 'null');
    return row?.user_id === 'cloud-e2e-student'
      && row?.progress?.xp === 220
      && row?.progress?.rewardClaims?.length === 19
      && row?.progress?.masteredLessons?.includes(0);
  });

  const cloudSnapshot = await page.evaluate(() => {
    const row = JSON.parse(localStorage.getItem('__e2e_cloud_progress') || 'null');
    return {
      xp: row.progress.xp,
      rewardClaims: row.progress.rewardClaims,
      masteredLessons: row.progress.masteredLessons
    };
  });

  // Simulate a fresh device/page state while retaining only the mocked cloud row.
  await page.evaluate(() => localStorage.removeItem('english-hero-academy-3'));
  await page.reload();

  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}');
    return saved.xp === 220
      && Array.isArray(saved.rewardClaims)
      && saved.rewardClaims.length === 19
      && Array.isArray(saved.masteredLessons)
      && saved.masteredLessons.includes(0);
  });

  const restored = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('english-hero-academy-3') || '{}');
    return {
      xp: saved.xp,
      rewardClaims: saved.rewardClaims,
      masteredLessons: saved.masteredLessons
    };
  });
  expect(restored).toEqual(cloudSnapshot);
});
