import { test, expect } from '@playwright/test';

test('anonymous device progress is backed up and never merged into a new student account', async ({ page }) => {
  // Use a real same-origin document: about:blank/setContent has an opaque origin
  // in Chromium and intentionally blocks localStorage access.
  await page.goto('/privacy.html');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="cloudStatus"></div><form id="cloudAuthForm"></form><button id="cloudGoogle"></button><button id="cloudSignIn"></button><button id="cloudSignUp"></button><input id="cloudEmail"><input id="cloudPassword"><button id="cloudSignOut"></button><button id="cloudSyncNow"></button><button id="cloudRestoreBackup"></button><div id="cloudUser"></div>';
  });

  await page.evaluate(() => {
    const original = {
      xp: 90, best: 80, quizzes: 3, completed: [4],
      masteredLessons: [4], lessonStarted: [4], lessonTrained: [4],
      saved: ['word-from-previous-student'], foundationSaved: [],
      review: { oldStudent: true }, misses: {}, daily: {}, lessonPositions: {},
      chatHistory: [], displayName: 'Previous student'
    };
    localStorage.setItem('english-hero-academy-3', JSON.stringify(original));
    window.state = original;
    window.lessons = [];
    window.defaults = () => ({
      xp: 0, best: 0, quizzes: 0, streak: 0, completed: [],
      masteredLessons: [], lessonStarted: [], lessonTrained: [],
      saved: [], foundationSaved: [], review: {}, misses: {}, daily: {},
      lessonPositions: {}, chatHistory: [], displayName: ''
    });
    window.normalizeMasteredLessons = values => values;
    window.mergeReviewProgress = () => ({});
    window.reconcileReviewMisses = () => ({});
    for (const name of ['renderStats','renderCourses','renderHome','renderProfile','renderReview']) window[name] = () => {};
    window.ENGLISH_HERO_CLOUD_CONFIG = {
      supabaseUrl: 'https://example-project.supabase.co',
      supabaseAnonKey: 'public-anon-key-that-is-long-enough-for-test'
    };
    window.__confirmCalled = false;
    window.confirm = () => { window.__confirmCalled = true; return true; };
    window.__uploadedProgress = null;
    window.__upsertCalls = [];
    window.__delayNextUpsert = false;
    window.__releaseDelayedUpsert = null;
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'new-student-account' } } }, error: null }),
          onAuthStateChange: callback => {
            window.__authStateCallback=callback;
            return { data: { subscription: { unsubscribe() {} } } };
          },
          signOut: async () => {
            window.__authStateCallback?.('SIGNED_OUT',null);
            return {error:null};
          }
        },
        from: () => ({
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return this; },
          upsert(payload) { window.__uploadedProgress = payload.progress; window.__upsertCalls.push(payload.progress); return this; },
          abortSignal() {
            if (window.__delayNextUpsert) {
              window.__delayNextUpsert = false;
              return new Promise(resolve => { window.__releaseDelayedUpsert = () => resolve({ data: null, error: null }); });
            }
            return Promise.resolve({ data: null, error: null });
          }
        })
      })
    };
  });

  await page.addScriptTag({ path: 'cloud-sync.js' });
  await page.evaluate(() => window.EnglishHeroCloudReady);

  const result = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(key => key.startsWith('english-hero-unclaimed-local-backup-'));
    return {
      currentXp: window.state.xp,
      currentCompleted: window.state.completed,
      currentSaved: window.state.saved,
      backupCount: keys.length,
      backupXp: keys.length ? JSON.parse(localStorage.getItem(keys[0])).xp : null,
      confirmCalled: window.__confirmCalled,
      uploadedXp: window.__uploadedProgress?.xp
    };
  });

  expect(result.currentXp).toBe(0);
  expect(result.currentCompleted).toEqual([]);
  expect(result.currentSaved).toEqual([]);
  expect(result.backupCount).toBe(1);
  expect(result.backupXp).toBe(90);
  expect(result.confirmCalled).toBe(false);
  expect(result.uploadedXp).toBe(0);

  // A newer progress snapshot must be written after an older in-flight request,
  // rather than being lost behind a delayed upsert.
  await page.evaluate(() => {
    window.__delayNextUpsert = true;
    window.state.xp = 10;
    window.queueCloudSave();
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseDelayedUpsert)).toBe('function');
  await page.evaluate(() => {
    window.state.xp = 20;
    window.queueCloudSave();
  });
  await page.waitForTimeout(1100);
  const firstWrite = await page.evaluate(() => window.__upsertCalls.map(progress => progress.xp));
  expect(firstWrite.at(-1)).toBe(10);
  await page.evaluate(() => window.__releaseDelayedUpsert());
  await expect.poll(() => page.evaluate(() => window.__upsertCalls.filter(progress => progress.xp === 20).length)).toBe(1);
  const orderedWrites = await page.evaluate(() => window.__upsertCalls.map(progress => progress.xp));
  expect(orderedWrites.slice(-2)).toEqual([10, 20]);

  // Exercise the real cloud-sync sign-out button and its auth-state cleanup.
  await page.evaluate(() => {
    window.state.xp=55;
    localStorage.setItem('english-hero-cloud-owner','new-student-account');
  });
  await page.locator('#cloudSignOut').click();
  await expect.poll(() => page.evaluate(() => window.state.xp)).toBe(0);
  const logout = await page.evaluate(() => ({
    backup: JSON.parse(localStorage.getItem('english-hero-account-backup-new-student-account')||'null'),
    owner: localStorage.getItem('english-hero-cloud-owner'),
    signOutDisabled: document.getElementById('cloudSignOut').disabled,
    completed: window.state.completed
  }));
  expect(logout.backup.xp).toBe(55);
  expect(logout.owner).toBeNull();
  expect(logout.signOutDisabled).toBe(true);
  expect(logout.completed).toEqual([]);
});
