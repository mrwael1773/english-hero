import { test, expect } from '@playwright/test';

const validToken = 'a'.repeat(64);

async function openWithToken(page) {
  await page.route('**/config.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.ENGLISH_HERO_CLOUD_CONFIG = {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'public-anon-test-key'
    };`
  }));
  await page.goto('/mentor-dashboard.html#' + validToken);
}

test('mentor dashboard removes the bearer token from the address bar before any request', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/functions/v1/mentor-overview', route => {
    requestCount++;
    return route.fulfill({ json: { students: [], generated_at: '2026-11-18T04:00:00Z' } });
  });

  await openWithToken(page);

  await expect(page.locator('#accessStatus')).toContainText('تم استلام رمز الوصول');
  expect(new URL(page.url()).hash).toBe('');
  expect(requestCount).toBe(0);
  await expect(page.locator('#dashboard')).toBeHidden();
});

test('mentor dashboard sends the token only in Authorization and renders a minimal student summary', async ({ page }) => {
  let capturedRequest;
  await page.route('**/functions/v1/mentor-overview', async route => {
    capturedRequest = {
      method: route.request().method(),
      authorization: route.request().headers()['authorization'],
      body: route.request().postData(),
      url: route.request().url()
    };
    await route.fulfill({
      json: {
        generated_at: '2026-11-18T04:00:00Z',
        students: [{
          username: 'student_one',
          display_name: '<img src=x onerror=alert(1)>',
          last_seen_at: '2026-11-18T03:55:00Z',
          progress: {
            xp: 120, completed_count: 2, mastered_count: 1, started_count: 2, trained_count: 1,
            mastered_indices: [1], trained_indices: [0], started_indices: [0, 1],
            saved_words_count: 5, foundation_saved_count: 2, review_words_count: 4,
            review_due_count: 1, missed_words_count: 1, quiz_attempts: 3,
            best_quiz_score: 90, answers_count: 10, correct_answers_count: 8,
            active_days_count: 4, learning_streak: 2, vocab_level: 'all', vocab_position: 5,
            reading_completed: ['letter-sounds', 'digraphs'],
            current_lesson_index: 1, current_word_index: 2,
            last_action: 'lesson_progress', last_action_at: '2026-11-18T03:54:00Z',
            last_action_lesson_index: 1, last_action_word_index: 2
          }
        }]
      }
    });
  });

  await openWithToken(page);
  await page.locator('#openDashboard').click();

  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#total')).toHaveText('1');
  await expect(page.locator('#seen')).toHaveText('1');
  await expect(page.locator('#notSeen')).toHaveText('0');
  await expect(page.locator('#students tr')).toHaveCount(1);
  await expect(page.locator('#students')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#students img')).toHaveCount(0);
  await expect(page.locator('#students tr td')).toHaveCount(5);
  await expect(page.locator('#students tr td').nth(2)).toHaveText('120 نقطة');
  await expect(page.locator('#students tr td').nth(3)).toContainText('تابع التعلّم في درس روتيني اليوم');
  await expect(page.locator('#students tr td').nth(4)).toContainText('روتيني اليوم');
  await page.locator('#students .progress-disclosure summary').click();
  const details = page.locator('#students .progress-details');
  await expect(details).toContainText('المفردات والمراجعة');
  await expect(details).toContainText('أضاف للمراجعة: 5 كلمة');
  await expect(details).toContainText('المحاولات المسجلة: 3');
  await expect(details).toContainText('اجتاز 2 من 11 مرحلة');
  await expect(details).toContainText('أصوات الحروف');
  await expect(details).toContainText('الحروف المركبة');
  await expect(details).not.toContainText('القواعد والأزمنة');
  await expect(page.locator('#students')).not.toContainText('student_one');

  expect(capturedRequest.method).toBe('POST');
  expect(capturedRequest.authorization).toBe('Bearer ' + validToken);
  expect(capturedRequest.body).toBe('{}');
  expect(capturedRequest.url).not.toContain(validToken);
  expect(new URL(page.url()).hash).toBe('');
});

test('mentor dashboard does not display student data when the access link is invalid', async ({ page }) => {
  await page.route('**/config.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.ENGLISH_HERO_CLOUD_CONFIG = {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'public-anon-test-key'
    };`
  }));
  await page.route('**/functions/v1/mentor-overview', route => route.fulfill({
    status: 401,
    json: { error: 'Invalid or expired link' }
  }));

  await page.goto('/mentor-dashboard.html#' + validToken);
  await page.locator('#openDashboard').click();

  await expect(page.locator('#dashboard')).toBeHidden();
  await expect(page.locator('#status')).toContainText('الرابط غير صالح');
  await expect(page.locator('#students tr')).toHaveCount(0);
});

test('mentor dashboard rejects a missing token without calling the data endpoint', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/functions/v1/mentor-overview', route => {
    requestCount++;
    return route.fulfill({ json: { students: [] } });
  });

  await page.goto('/mentor-dashboard.html');
  await expect(page.locator('#openDashboard')).toBeDisabled();
  await expect(page.locator('#status')).toContainText('الرابط غير مكتمل');
  expect(requestCount).toBe(0);
});

test('mentor dashboard does not render data when the service is unavailable', async ({ page }) => {
  await page.route('**/config.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.ENGLISH_HERO_CLOUD_CONFIG = {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'public-anon-test-key'
    };`
  }));
  await page.route('**/functions/v1/mentor-overview', route => route.fulfill({
    status: 503,
    json: { error: 'Student overview unavailable' }
  }));

  await page.goto('/mentor-dashboard.html#' + validToken);
  await page.locator('#openDashboard').click();

  await expect(page.locator('#dashboard')).toBeHidden();
  await expect(page.locator('#status')).toContainText('تعذر تحميل البيانات');
  await expect(page.locator('#students tr')).toHaveCount(0);
});

test('mentor dashboard rejects malformed student fields without showing the dashboard', async ({ page }) => {
  await page.route('**/config.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.ENGLISH_HERO_CLOUD_CONFIG = {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'public-anon-test-key'
    };`
  }));
  await page.route('**/functions/v1/mentor-overview', route => route.fulfill({
    json: {
      generated_at: '2026-11-18T04:00:00Z',
      students: [{ username: 42, display_name: 'Invalid record', last_seen_at: null, progress: {} }]
    }
  }));

  await page.goto('/mentor-dashboard.html#' + validToken);
  await page.locator('#openDashboard').click();

  await expect(page.locator('#dashboard')).toBeHidden();
  await expect(page.locator('#accessPanel')).toBeVisible();
  await expect(page.locator('#status')).toContainText('استجابة الخدمة غير مكتملة');
  await expect(page.locator('#students tr')).toHaveCount(0);
});

test('mentor dashboard returns to the access panel if a refresh fails after a successful load', async ({ page }) => {
  let requests = 0;
  await page.route('**/config.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.ENGLISH_HERO_CLOUD_CONFIG = {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'public-anon-test-key'
    };`
  }));
  await page.route('**/functions/v1/mentor-overview', route => {
    requests++;
    if (requests === 1) {
      return route.fulfill({ json: { students: [], generated_at: '2026-11-18T04:00:00Z' } });
    }
    return route.fulfill({ status: 503, json: { error: 'unavailable' } });
  });

  await page.goto('/mentor-dashboard.html#' + validToken);
  await page.locator('#openDashboard').click();
  await expect(page.locator('#dashboard')).toBeVisible();

  await page.locator('#refresh').click();
  await expect(page.locator('#dashboard')).toBeHidden();
  await expect(page.locator('#accessPanel')).toBeVisible();
  await expect(page.locator('#status')).toContainText('تعذر تحميل البيانات');
  await expect(page.locator('#students tr')).toHaveCount(0);
});
