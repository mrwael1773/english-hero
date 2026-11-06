import { test, expect } from '@playwright/test';

async function installGuardAuthMock(page) {
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.__guardAuthStateCallback = null;
      window.supabase = {
        createClient: () => ({
          auth: {
            onAuthStateChange(callback) {
              window.__guardAuthStateCallback = callback;
              callback('INITIAL_SESSION', { user: { id: 'student-one' } });
              return { data: { subscription: { unsubscribe() {} } } };
            },
            getSession: async () => ({ data: { session: { user: { id: 'student-one' } } }, error: null })
          },
          from: () => ({
            select() { return this; },
            eq() { return this; },
            maybeSingle: async () => ({ data: { user_id: 'student-one' }, error: null })
          })
        })
      };
    `
  }));
  await page.route('**/config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.ENGLISH_HERO_CLOUD_CONFIG={supabaseUrl:'https://example-project.supabase.co',supabaseAnonKey:'public-anon-key-for-guard-test'};`
  }));
}

test('a protected lesson redirects to the gateway after sign-out in another tab', async ({ page }) => {
  await installGuardAuthMock(page);
  // Keep this test focused on the guard redirect contract, without booting the
  // full gateway or its separate cloud-sync initialization.
  await page.route('**/index.html*', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="ar"><head><title>بوابة الدخول</title></head><body><main id="authGateway">بوابة الدخول</main></body></html>'
  }));

  await page.goto('/english-basics.html');
  await expect.poll(() => page.locator('html').evaluate(el => el.classList.contains('eh-auth-pending'))).toBe(false);

  await page.evaluate(() => {
    window.__guardAuthStateCallback?.('SIGNED_OUT', null);
  });

  await expect(page).toHaveURL(/\/index\.html\?next=/);
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('body')).toContainText('بوابة الدخول');
});
