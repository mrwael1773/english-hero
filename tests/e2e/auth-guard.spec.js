import { test, expect } from '@playwright/test';

async function installGuardAuthMock(page) {
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.__guardAuthStateCallback = null;
      window.__guardCurrentUser = 'student-one';
      window.__guardPendingProfileReads = {};
      window.__guardSetUser = id => {
        window.__guardCurrentUser = id;
        window.__guardAuthStateCallback?.('SIGNED_IN', { user: { id } });
      };
      window.supabase = { createClient: () => ({
        auth: {
          onAuthStateChange(callback) {
            window.__guardAuthStateCallback = callback;
            callback('INITIAL_SESSION', { user: { id: window.__guardCurrentUser } });
            return { data: { subscription: { unsubscribe() {} } } };
          },
          getSession: async () => ({ data: { session: { user: { id: window.__guardCurrentUser } } }, error: null })
        },
        from: () => ({ select() { return this; }, eq(_column, id) { this.userId = id; return this; },
          maybeSingle: async function() {
            const requestedUserId = this.userId;
            if (window.__guardDelayProfileReads) {
              await new Promise(resolve => {
                (window.__guardPendingProfileReads[requestedUserId] ||= []).push(resolve);
              });
            }
            if (window.__guardProfileError) return { data: null, error: { message: 'temporary profile read failure' } };
            return requestedUserId === 'student-one'
              ? { data: { user_id: requestedUserId }, error: null }
              : { data: null, error: null };
          }
        })
      })};`
  }));
  await page.route('**/config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: "window.ENGLISH_HERO_CLOUD_CONFIG={supabaseUrl:'https://example-project.supabase.co',supabaseAnonKey:'public-anon-key-for-guard-test'};"
  }));
}

async function installGatewayRoute(page) {
  await page.route('**/index.html*', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>بوابة الدخول</title></head><body><main id="authGateway">بوابة الدخول</main></body></html>'
  }));
}

test('a protected lesson redirects to the gateway after sign-out', async ({ page }) => {
  await installGuardAuthMock(page);
  await installGatewayRoute(page);
  await page.goto('/grammar-lesson.html#g-subject-pronouns');
  await expect.poll(() => page.locator('html').evaluate(el => el.classList.contains('eh-auth-pending'))).toBe(false);

  await page.evaluate(() => window.__guardAuthStateCallback?.('SIGNED_OUT', null));

  await expect(page).toHaveURL(/\/index\.html\?next=/);
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('body')).toContainText('بوابة الدخول');
});

test('a protected lesson revalidates the profile when a different account signs in', async ({ page }) => {
  await installGuardAuthMock(page);
  await installGatewayRoute(page);
  await page.goto('/grammar-lesson.html#g-subject-pronouns');
  await expect.poll(() => page.locator('html').evaluate(el => el.classList.contains('eh-auth-pending'))).toBe(false);

  await page.evaluate(() => window.__guardSetUser('student-two'));

  await expect(page).toHaveURL(/\/index\.html\?next=/);
  await expect(page.locator('#authGateway')).toBeVisible();
});


test('a transient profile read failure fails closed and redirects to the gateway', async ({ page }) => {
  await page.addInitScript(() => { window.__guardProfileError = true; });
  await installGuardAuthMock(page);
  await installGatewayRoute(page);
  await page.goto('/grammar-lesson.html#g-subject-pronouns');

  await expect(page).toHaveURL(/\/index\.html\?next=/);
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('body')).toContainText('بوابة الدخول');
});


test('a stale protected-page profile response cannot authorize a newly signed-in account', async ({ page }) => {
  await installGuardAuthMock(page);
  await installGatewayRoute(page);
  await page.goto('/grammar-lesson.html#g-subject-pronouns');
  await expect.poll(() => page.locator('html').evaluate(el => el.classList.contains('eh-auth-pending'))).toBe(false);

  // Start a delayed profile check for account A, then switch to account B.
  await page.evaluate(() => {
    window.__guardDelayProfileReads = true;
    window.__guardAuthStateCallback?.('TOKEN_REFRESHED', { user: { id: 'student-one' } });
  });
  await expect.poll(() => page.evaluate(() => window.__guardPendingProfileReads['student-one']?.length || 0)).toBe(1);

  await page.evaluate(() => window.__guardSetUser('student-two'));
  await expect.poll(() => page.evaluate(() => window.__guardPendingProfileReads['student-two']?.length || 0)).toBe(1);
  await expect.poll(() => page.locator('html').evaluate(el => el.classList.contains('eh-auth-pending'))).toBe(true);

  // Account A has a valid profile, but its late response must not authorize B.
  await page.evaluate(() => window.__guardPendingProfileReads['student-one'].shift()());
  await expect(page).toHaveURL(/\/grammar-lesson\.html/);
  await expect.poll(() => page.locator('html').evaluate(el => el.classList.contains('eh-auth-pending'))).toBe(true);

  // Account B has no profile, so only B's own response may decide the outcome.
  await page.evaluate(() => window.__guardPendingProfileReads['student-two'].shift()());
  await expect(page).toHaveURL(/\/index\.html\?next=/);
  await expect(page.locator('#authGateway')).toBeVisible();
});
