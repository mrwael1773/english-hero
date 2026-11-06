import { test, expect } from '@playwright/test';

test('anonymous device progress is backed up and never merged into a new student account', async ({ page }) => {
  await page.setContent('<div id="cloudStatus"></div><form id="cloudAuthForm"></form><button id="cloudGoogle"></button><button id="cloudSignIn"></button><button id="cloudSignUp"></button><input id="cloudEmail"><input id="cloudPassword"><button id="cloudSignOut"></button><button id="cloudSyncNow"></button><button id="cloudRestoreBackup"></button><div id="cloudUser"></div>');

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
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'new-student-account' } } }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
        },
        from: () => ({
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: null, error: null }),
          upsert: async payload => { window.__uploadedProgress = payload.progress; return { error: null }; }
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
});
