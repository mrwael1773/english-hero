import { test, expect } from '@playwright/test';

async function installAuthMock(page) {
  await page.route('**/cloud-sync.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      let user=null, profile=null, ready=true;
      const setMockUser=(id,hasProfile=true)=>{
        user=id?{id}:null;
        profile=user&&hasProfile?{username:'mock_student',display_name:'طالب تجريبي'}:null;
        window.dispatchEvent(new CustomEvent('englishhero:authstate',{detail:{event:user?'SIGNED_IN':'SIGNED_OUT',user}}));
      };
      window.__setMockUser=id=>setMockUser(id,true);
      window.__setMockUserWithoutProfile=id=>setMockUser(id,false);
      window.EnglishHeroCloudReady=Promise.resolve(true);
      window.EnglishHeroCloud={
        isConfigured:()=>true,
        getUser:()=>user,
        getProfile:async()=>{
          if(window.__profileReadFails)throw new Error('temporary profile read failure');
          const requestedProfile=profile;
          if(window.__delayProfileRead)await new Promise(resolve=>{window.__releaseProfileRead=resolve;});
          return requestedProfile;
        },
        signInWithUsername:async()=>{setMockUser('mock-student',true);return user;},
        signInWithGoogle:async(nextPath)=>{window.__googleNextPath=nextPath;setMockUser('google-student',false);},
        isReady:()=>ready,
        setPassword:async()=>{},
        sendPasswordRecovery:async(email)=>{window.__recoveryEmail=email;},
        updateRecoveredPassword:async(password)=>{window.__recoveredPassword=password;},
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
 
test('signing out relocks the learning gateway and hides learning screens', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.locator('#authLoginUsername').fill('mock_student');
  await page.locator('#authLoginPassword').fill('safe-password-123');
  await page.locator('#authLoginForm button[type="submit"]').click();
  await expect(page.locator('#authGateway')).toBeHidden();
  await expect(page.locator('#home')).toBeVisible();

  await page.evaluate(() => window.__setMockUser(null));
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('#authLoginPane')).toBeVisible();
  await expect(page.locator('#home')).not.toBeVisible();
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


test('an account without a student profile cannot open onboarding without registration intent', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.evaluate(() => window.__setMockUserWithoutProfile('unregistered-session'));
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('#authLoginPane')).toBeVisible();
  await expect(page.locator('#authOnboardingPane')).toBeHidden();
  await expect(page.locator('#authGatewayMessage')).toContainText('لا يملك ملف طالب مسجلًا');
});

test('Google sign-in is available in login and registration keeps its onboarding flow', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await expect(page.locator('#authLoginPane [data-google-auth]')).toHaveCount(1);
  await page.locator('#authLoginPane [data-auth-mode="register"]').click();
  await expect(page.locator('#authRegisterPane [data-google-auth]')).toHaveCount(1);
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
test('a stale profile response cannot reopen learning after sign-out', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.locator('#authLoginUsername').fill('mock_student');
  await page.locator('#authLoginPassword').fill('safe-password-123');
  await page.locator('#authLoginForm button[type="submit"]').click();
  await expect(page.locator('#authGateway')).toBeHidden();

  await page.evaluate(() => {
    window.__delayProfileRead = true;
    window.dispatchEvent(new CustomEvent('englishhero:authstate', {
      detail: { event: 'TOKEN_REFRESHED', user: { id: 'mock-student' } }
    }));
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseProfileRead)).toBe('function');

  await page.evaluate(() => window.__setMockUser(null));
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('#home')).not.toBeVisible();

  await page.evaluate(() => window.__releaseProfileRead());
  await page.waitForTimeout(50);
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('#home')).not.toBeVisible();
});
 
test('profile lookup errors fail closed instead of opening onboarding', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.evaluate(() => { window.__profileReadFails = true; });
  await page.locator('#authLoginUsername').fill('mock_student');
  await page.locator('#authLoginPassword').fill('safe-password-123');
  await page.locator('#authLoginForm button[type="submit"]').click();
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('#authLoginPane')).toBeVisible();
  await expect(page.locator('#authOnboardingPane')).toBeHidden();
  await expect(page.locator('#authGatewayMessage')).toContainText('تعذر التحقق من ملف الحساب');
});

test('local-only student data is isolated by account on shared devices', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/privacy.html');
  await page.evaluate(() => {
    localStorage.setItem('englishHeroStudentTasksV1', JSON.stringify([
      { id: 'legacy-task', subject: 'قديم', text: 'مهمة قديمة غير مرتبطة بحساب', done: false }
    ]));
    localStorage.setItem('eh-scenarios-done', JSON.stringify({ 0: 5 }));
    localStorage.setItem('ehPlusV1', JSON.stringify({
      known: ['improve'], missed: [], quizKnown: [], done: {}, streak: 9,
      last: '2026-11-06', points: 999, theme: 'default', avatar: '🐼', title: 'الخبير'
    }));
    localStorage.setItem('englishHeroStudentTasksV1:student-a', JSON.stringify([
      { id: 'a-task', subject: 'علوم', text: 'مهمة الطالب A', done: false }
    ]));
    localStorage.setItem('eh-scenarios-done:student-a', JSON.stringify({ 0: 5 }));
    localStorage.setItem('ehPlusV2:student-a', JSON.stringify({
      known: ['improve'], missed: [], quizKnown: [], done: {}, streak: 3,
      last: '2026-11-06', points: 999, theme: 'default', avatar: '👑', title: 'الخبير'
    }));
    localStorage.setItem('englishHeroStudentTasksV1:mock-student', JSON.stringify([
      { id: 'b-task', subject: 'رياضيات', text: 'مهمة الطالب B', done: false }
    ]));
    localStorage.setItem('eh-scenarios-done:mock-student', JSON.stringify({}));
    localStorage.setItem('ehPlusV2:mock-student', JSON.stringify({
      known: [], missed: [], quizKnown: [], done: {}, streak: 0,
      last: '', points: 10, theme: 'default', avatar: '🦊', title: 'متعلّم'
    }));
  });
  await page.goto('/');
  await page.locator('#authLoginUsername').fill('mock_student');
  await page.locator('#authLoginPassword').fill('safe-password-123');
  await page.locator('#authLoginForm button[type="submit"]').click();

  await expect(page.locator('#studentTaskList')).toContainText('مهمة الطالب B');
  await expect(page.locator('#studentTaskList')).not.toContainText('مهمة الطالب A');
  await expect(page.locator('#studentTaskList')).not.toContainText('مهمة قديمة');
  await expect(page.locator('#scenarioList')).not.toContainText('أفضل نتيجة');
  await expect(page.locator('#ehpAvatar')).toHaveText('🦊');

  await page.evaluate(() => window.__setMockUser('student-a'));
  await expect(page.locator('#studentTaskList')).toContainText('مهمة الطالب A');
  await expect(page.locator('#studentTaskList')).not.toContainText('مهمة الطالب B');
  await expect(page.locator('#scenarioList')).toContainText('أفضل نتيجة: 5/5');
  await expect(page.locator('#ehpAvatar')).toHaveText('👑');
});

test('a stale profile response from the previous account cannot unlock the next account', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.locator('#authLoginUsername').fill('mock_student');
  await page.locator('#authLoginPassword').fill('safe-password-123');
  await page.locator('#authLoginForm button[type="submit"]').click();
  await expect(page.locator('#authGateway')).toBeHidden();

  // Leave an account-A profile request in flight, then switch to account B.
  await page.evaluate(() => {
    window.__delayProfileRead = true;
    window.dispatchEvent(new CustomEvent('englishhero:authstate', {
      detail: { event: 'TOKEN_REFRESHED', user: { id: 'mock-student' } }
    }));
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseProfileRead)).toBe('function');

  await page.evaluate(() => {
    window.__delayProfileRead = false;
    sessionStorage.setItem('englishHeroGoogleAuthIntent', 'register');
    window.__setMockUserWithoutProfile('second-student');
  });
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('#authOnboardingPane')).toBeVisible();

  // The old account-A response must not replace account B's onboarding state.
  await page.evaluate(() => window.__releaseProfileRead());
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('#authOnboardingPane')).toBeVisible();
  await expect(page.locator('#authLoginPane')).toBeHidden();
});

test('password recovery request sends a reset email without revealing whether an account exists', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.locator('#authForgotPassword').click();
  await expect(page.locator('#authRecoveryRequestPane')).toBeVisible();
  await page.locator('#authRecoveryEmail').fill('student@example.com');
  await page.locator('#authRecoveryRequestForm button[type="submit"]').click();
  await expect(page.locator('#authGatewayMessage')).toContainText('إذا كان البريد مرتبطًا بحساب');
});

test('verified password recovery updates the password and restores the signed-in student', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.evaluate(() => {
    window.__setMockUser('mock-student', true);
    window.dispatchEvent(new CustomEvent('englishhero:authstate', {
      detail: { event: 'PASSWORD_RECOVERY', user: { id: 'mock-student' } }
    }));
  });
  await expect(page.locator('#authRecoveryCompletePane')).toBeVisible();
  await page.locator('#authRecoveryNewPassword').fill('new-safe-password-456');
  await page.locator('#authRecoveryConfirmPassword').fill('new-safe-password-456');
  await page.locator('#authRecoveryCompleteForm button[type="submit"]').click();
  await expect(page.locator('#authGateway')).toBeHidden();
  await expect(page.locator('#home')).toBeVisible();
});

test('legacy verified email account can finish onboarding after password recovery', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.evaluate(() => {
    window.__setMockUserWithoutProfile('legacy-email-student');
    window.dispatchEvent(new CustomEvent('englishhero:authstate', {
      detail: { event: 'PASSWORD_RECOVERY', user: { id: 'legacy-email-student' } }
    }));
  });
  await expect(page.locator('#authRecoveryCompletePane')).toBeVisible();

  await page.locator('#authRecoveryNewPassword').fill('legacy-new-password-789');
  await page.locator('#authRecoveryConfirmPassword').fill('legacy-new-password-789');
  await page.locator('#authRecoveryCompleteForm button[type="submit"]').click();

  // Existing accounts without a gateway profile must be sent to onboarding,
  // not treated as a brand-new Auth identity or shown the learning screens.
  await expect(page.locator('#authOnboardingPane')).toBeVisible();
  await expect(page.locator('#home')).not.toBeVisible();

  await page.locator('#authDisplayName').fill('طالب قديم');
  await page.locator('#authNewUsername').fill('legacy_student');
  await page.locator('#authNewPassword').fill('legacy-new-password-789');
  await page.locator('#authConfirmPassword').fill('legacy-new-password-789');
  await page.locator('#authOnboardingForm button[type="submit"]').click();

  await expect(page.locator('#authGateway')).toBeHidden();
  await expect(page.locator('#home')).toBeVisible();
});

test('password recovery remains the active gateway state after a page reload', async ({ page }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('englishHeroPasswordRecovery', '1'));
  await page.reload();
  await expect(page.locator('#authGateway')).toBeVisible();
  await expect(page.locator('#authRecoveryCompletePane')).toBeVisible();
  await expect(page.locator('#home')).not.toBeVisible();
});


test('account settings keep sync controls but contain no legacy sign-in interface or handlers', async ({ page, request }) => {
  await installAuthMock(page);
  await page.goto('/');
  await page.locator('#authLoginUsername').fill('mock_student');
  await page.locator('#authLoginPassword').fill('safe-password-123');
  await page.locator('#authLoginForm button[type="submit"]').click();
  await expect(page.locator('#authGateway')).toBeHidden();

  await page.locator('[data-nav="profile"]').click();
  await expect(page.locator('#cloudStatus')).toBeVisible();
  await expect(page.locator('#cloudSyncNow')).toBeVisible();
  await expect(page.locator('#cloudSignOut')).toBeVisible();

  for (const selector of ['#cloudAuthForm','#cloudEmail','#cloudPassword','#cloudSignIn','#cloudSignUp','#cloudGoogle']) {
    await expect(page.locator(selector)).toHaveCount(0);
  }

  // Use APIRequestContext so the page's auth mock route cannot replace the source file.
  const cloudResponse = await request.get('http://127.0.0.1:4173/cloud-sync.js?v=7');
  expect(cloudResponse.ok()).toBe(true);
  const cloudSource = await cloudResponse.text();
  expect(cloudSource).not.toContain('client.auth.signInWithPassword');
  expect(cloudSource).not.toContain('client.auth.signUp(');
  expect(cloudSource).not.toContain("$cloud('cloudAuthForm')");
  expect(cloudSource).not.toContain("$cloud('cloudGoogle')");
  expect(cloudSource).toContain('async signInWithUsername(username,password)');
  expect(cloudSource).toContain('async signInWithGoogle(nextPath=null)');
});
