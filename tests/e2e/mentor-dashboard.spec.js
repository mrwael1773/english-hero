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
          progress: { xp: 120, completed_count: 2, mastered_count: 1 }
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
  await expect(page.locator('#students tr td').nth(3)).toHaveText('2');
  await expect(page.locator('#students tr td').nth(4)).toHaveText('1');

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
