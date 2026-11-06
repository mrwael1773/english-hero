import { test, expect } from '@playwright/test';

async function installAuthMock(page) {
  await page.route('**/cloud-sync.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      let user=null, profile=null, ready=true;
      window.EnglishHeroCloudReady=Promise.resolve(true);
      window.EnglishHeroCloud={
        isConfigured:()=>true,
        getUser:()=>user,
        getProfile:async()=>profile,
        signInWithUsername:async()=>{user={id:'mock-student'};profile={username:'mock_student',display_name:'طالب تجريبي'};return user;},
        signInWithGoogle:async(nextPath)=>{window.__googleNextPath=nextPath;user={id:'google-student'};profile=null;window.dispatchEvent(new CustomEvent('englishhero:authstate'));},
        isReady:()=>ready,
        setPassword:async()=>{},
        claimProfile:async(username,displayName)=>{profile={username,display_name:displayName};return profile;}
      };
      window.__setCloudReady=value=>{ready=value;};
    `
  }));
}

test('first visit is gated by the login and registration portal', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('#authLoginForm')).toBeVisible();
  await expect(page.locator('#home')).not.toBeVisible();
  await expect(page.locator('#authLoginUsername')).toBeVisible();
});

test('username sign-in opens the learning site after authentication', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.locator('#authLoginUsername').fill('mock_student');
  await page.locator('#authLoginPassword').fill('safe-password-123');
  await page.locator('#authLoginForm button[type="submit"]').click();
  await expect(page.locator('#authGateway')).toBeHidden();
  await expect(page.locator('#home')).toBeVisible();
});

test('gateway stays closed until the signed-in account progress is ready', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.evaluate(() => window.__setCloudReady(false));
  await page.locator('#authLoginUsername').fill('mock_student');
  await page.locator('#authLoginPassword').fill('safe-password-123');
  await page.locator('#authLoginForm button[type="submit"]').click();
  await expect(page.locator('#authGateway')).toBeVisible();
  await page.evaluate(() => {
    window.__setCloudReady(true);
    window.dispatchEvent(new CustomEvent('englishhero:authready'));
  });
  await expect(page.locator('#authGateway')).toBeHidden();
});

test('Google sign-in preserves a validated learning destination after gateway cleanup', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/?next=%2Fenglish-basics.html');
  await page.locator('#authLoginPane [data-auth-mode="register"]').click();
  await page.locator('#authRegisterPane [data-google-auth]').click();
  await expect.poll(() => page.evaluate(() => window.__googleNextPath)).toBe('/english-basics.html');
  expect(new URL(page.url()).searchParams.has('next')).toBe(false);
});

test('Google registration continues to profile and password setup', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.locator('#authRegisterPane').waitFor({ state: 'attached' });
  await page.locator('#authLoginPane [data-auth-mode="register"]').click();
  await page.locator('#authRegisterPane [data-google-auth]').click();
  await expect(page.locator('#authOnboardingPane')).toBeVisible();
  await page.locator('#authDisplayName').fill('طالب تجريبي');
  await page.locator('#authNewUsername').fill('student_2026');
  await page.locator('#authNewPassword').fill('safe-password-123');
  await page.locator('#authConfirmPassword').fill('safe-password-123');
  await page.locator('#authOnboardingForm button[type="submit"]').click();
  await expect(page.locator('#authGateway')).toBeHidden();
  await expect(page.locator('#home')).toBeVisible();
});

test('authentication gateway rejects an external post-login redirect target', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/?next=https%3A%2F%2Fevil.example%2Fcollect');
  await page.locator('#authLoginUsername').fill('mock_student');
  await page.locator('#authLoginPassword').fill('safe-password-123');
  await page.locator('#authLoginForm button[type="submit"]').click();
  await expect(page.locator('#authGateway')).toBeHidden();
  expect(new URL(page.url()).pathname).toMatch(/\/(?:index\.html)?$/);
  expect(new URL(page.url()).hostname).not.toBe('evil.example');
  expect(page.url()).not.toContain('evil.example');
});
