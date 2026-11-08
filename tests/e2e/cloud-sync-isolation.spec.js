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

  // cloud-sync.js reads the lesson catalog as a global lexical binding, as index.html does.
  // The privacy-page fixture must expose that binding explicitly; window.lessons alone is not the same setup as index.html.
  await page.addScriptTag({ content: 'const lessons = window.lessons;' });
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

test('account switch followed by sign-out backs up progress only for its actual owner', async ({ page }) => {
  await page.goto('/privacy.html');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="cloudStatus"></div><form id="cloudAuthForm"></form><button id="cloudGoogle"></button><button id="cloudSignIn"></button><button id="cloudSignUp"></button><input id="cloudEmail"><input id="cloudPassword"><button id="cloudSignOut"></button><button id="cloudSyncNow"></button><button id="cloudRestoreBackup"></button><div id="cloudUser"></div>';
    const local = {
      xp: 30, best: 25, quizzes: 1, completed: [2], masteredLessons: [2],
      lessonStarted: [2], lessonTrained: [2], saved: ['account-a-word'],
      foundationSaved: [], review: {}, misses: {}, daily: {}, lessonPositions: {},
      chatHistory: [], displayName: 'Account A'
    };
    localStorage.setItem('english-hero-academy-3', JSON.stringify(local));
    localStorage.setItem('english-hero-cloud-owner', 'account-A');
    window.state = local;
    window.lessons = [];
    window.defaults = () => ({
      xp: 0, best: 0, quizzes: 0, streak: 0, completed: [],
      masteredLessons: [], lessonStarted: [], lessonTrained: [], saved: [],
      foundationSaved: [], review: {}, misses: {}, daily: {}, lessonPositions: {},
      chatHistory: [], displayName: ''
    });
    window.normalizeMasteredLessons = values => values;
    window.mergeReviewProgress = () => ({});
    window.reconcileReviewMisses = () => ({});
    for (const name of ['renderStats','renderCourses','renderHome','renderProfile','renderReview']) window[name] = () => {};
    window.ENGLISH_HERO_CLOUD_CONFIG = {
      supabaseUrl: 'https://example-project.supabase.co',
      supabaseAnonKey: 'public-anon-key-that-is-long-enough-for-test'
    };
    window.__uploads = [];
    window.__releaseBRead = null;
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'account-A' } } }, error: null }),
          onAuthStateChange: callback => {
            window.__authStateCallback = callback;
            return { data: { subscription: { unsubscribe() {} } } };
          },
          signOut: async () => ({ error: null })
        },
        from: () => {
          let requestedUserId = null;
          return {
            select() { return this; },
            eq(_column, value) { requestedUserId = value; return this; },
            maybeSingle() {
              return {
                abortSignal() {
                  if (requestedUserId === 'account-B') {
                    return new Promise(resolve => {
                      window.__releaseBRead = () => resolve({ data: { progress: { xp: 900, completed: [8], saved: ['account-b-word'] } }, error: null });
                    });
                  }
                  return Promise.resolve({ data: { progress: { xp: 41, completed: [2], saved: ['account-a-cloud-word'] } }, error: null });
                }
              };
            },
            upsert(payload) {
              window.__uploads.push({ userId: payload.user_id, progress: payload.progress });
              return { abortSignal: () => Promise.resolve({ data: null, error: null }) };
            }
          };
        }
      })
    };
  });

  // Match index.html's global lexical lesson catalog in this privacy-page fixture.
  await page.addScriptTag({ content: 'const lessons = window.lessons;' });
  await page.addScriptTag({ path: 'cloud-sync.js' });
  await page.evaluate(() => window.EnglishHeroCloudReady);
  await expect.poll(() => page.evaluate(() => window.state.xp)).toBe(41);

  await page.evaluate(() => window.__authStateCallback('SIGNED_IN', { user: { id: 'account-B' } }));
  await expect.poll(() => page.evaluate(() => typeof window.__releaseBRead)).toBe('function');

  // B is now the authenticated identity, but the in-memory state still belongs to A.
  await page.evaluate(() => window.__authStateCallback('SIGNED_OUT', null));
  const duringLogout = await page.evaluate(() => ({
    backupA: JSON.parse(localStorage.getItem('english-hero-account-backup-account-A') || 'null'),
    backupB: localStorage.getItem('english-hero-account-backup-account-B'),
    owner: localStorage.getItem('english-hero-cloud-owner'),
    activeXp: window.state.xp
  }));
  expect(duringLogout.backupA.xp).toBe(41);
  expect(duringLogout.backupA.saved).toContain('account-a-cloud-word');
  expect(duringLogout.backupB).toBeNull();
  expect(duringLogout.owner).toBeNull();
  expect(duringLogout.activeXp).toBe(0);

  // A late response for B must not replace A's backup or upload A's state as B.
  await page.evaluate(() => window.__releaseBRead());
  await page.waitForTimeout(50);
  const afterLateResponse = await page.evaluate(() => ({
    backupA: JSON.parse(localStorage.getItem('english-hero-account-backup-account-A') || 'null'),
    backupB: localStorage.getItem('english-hero-account-backup-account-B'),
    activeXp: window.state.xp,
    uploads: window.__uploads
  }));
  expect(afterLateResponse.backupA.xp).toBe(41);
  expect(afterLateResponse.backupB).toBeNull();
  expect(afterLateResponse.activeXp).toBe(0);
  const uploadsAsB = afterLateResponse.uploads.filter(call => call.userId === 'account-B');
  expect(uploadsAsB.every(call => call.progress.xp !== 41 && !call.progress.saved?.includes('account-a-cloud-word'))).toBe(true);
});

test("clears only the active account's local data without deleting cloud progress or other accounts", async ({ page }) => {
  await page.goto('/privacy.html');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="cloudStatus"></div><form id="cloudAuthForm"></form><button id="cloudGoogle"></button><button id="cloudSignIn"></button><button id="cloudSignUp"></button><input id="cloudEmail"><input id="cloudPassword"><button id="cloudSignOut"></button><button id="cloudSyncNow"></button><button id="cloudRestoreBackup"></button><button id="cloudClearLocalData"></button><div id="cloudUser"></div>';
    const active = { xp: 55, best: 50, quizzes: 2, completed: [1], masteredLessons: [1], saved: ['account-a-word'], chatHistory: [{who:'me',text:'private practice message'}] };
    localStorage.setItem('english-hero-academy-3', JSON.stringify(active));
    localStorage.setItem('english-hero-cloud-owner', 'account-A');
    localStorage.setItem('english-hero-account-backup-account-A', JSON.stringify(active));
    localStorage.setItem('english-hero-account-backup-account-B', JSON.stringify({xp:90}));
    localStorage.setItem('ehPlusV2:account-A', JSON.stringify({points:45,avatar:'🦊'}));
    localStorage.setItem('ehPlusV2:account-B', JSON.stringify({points:90,avatar:'🐼'}));
    localStorage.setItem('englishHeroStudentTasksV1:account-A', JSON.stringify([{id:'a',text:'A task'}]));
    localStorage.setItem('englishHeroStudentTasksV1:account-B', JSON.stringify([{id:'b',text:'B task'}]));
    localStorage.setItem('eh-scenarios-done:account-A', JSON.stringify({0:5}));
    localStorage.setItem('eh-scenarios-done:account-B', JSON.stringify({0:2}));
    localStorage.setItem('english-hero-unclaimed-local-backup', JSON.stringify({xp:12}));
    localStorage.setItem('english-hero-unclaimed-local-backup-123', JSON.stringify({xp:13}));
    localStorage.setItem('sb-example-auth-token', 'sdk-managed-session');
    sessionStorage.setItem('ehTeacherPilotMasterySessionV1', JSON.stringify({started:true}));
    window.state = active;
    window.defaults = () => ({xp:0,best:0,quizzes:0,completed:[],masteredLessons:[],saved:[],chatHistory:[]});
    window.replaceProgress = value => { window.state = {...window.defaults(),...value}; };
    window.mergeProgress = value => { window.state = {...window.state,...value}; };
    window.lessons = [];
    window.normalizeMasteredLessons = values => values;
    window.mergeReviewProgress = () => ({});
    window.reconcileReviewMisses = () => ({});
    for (const name of ['renderStats','renderCourses','renderHome','renderProfile','renderReview']) window[name] = () => {};
    window.ENGLISH_HERO_CLOUD_CONFIG = {
      supabaseUrl: 'https://example-project.supabase.co',
      supabaseAnonKey: 'public-anon-key-that-is-long-enough-for-test'
    };
    window.__signOutScope = null;
    window.__cloudDeleteCalls = 0;
    window.__upsertCalls = [];
    window.__cleanupConfirmText = '';
    window.confirm = message => { window.__cleanupConfirmText = message; return true; };
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({data:{session:{user:{id:'account-A'}}},error:null}),
          onAuthStateChange: callback => {
            window.__authStateCallback = callback;
            return {data:{subscription:{unsubscribe(){}}}};
          },
          signOut: async options => {
            window.__signOutScope = options?.scope || 'default';
            window.__authStateCallback?.('SIGNED_OUT', null);
            localStorage.removeItem('sb-example-auth-token');
            return {error:null};
          }
        },
        from: () => ({
          select(){return this;},
          eq(){return this;},
          maybeSingle(){return this;},
          upsert(payload){window.__upsertCalls.push(payload);return this;},
          delete(){window.__cloudDeleteCalls++;return this;},
          abortSignal(){return Promise.resolve({data:null,error:null});}
        })
      })
    };
  });

  await page.addScriptTag({path:'cloud-sync.js'});
  await page.evaluate(() => window.EnglishHeroCloudReady);
  await expect(page.locator('#cloudClearLocalData')).toBeEnabled();
  await page.locator('#cloudClearLocalData').click();
  await expect(page.locator('#cloudStatus')).toContainText('تم حذف البيانات المحلية');

  const result = await page.evaluate(() => ({
    keys: Object.keys(localStorage).sort(),
    state: window.state,
    signOutScope: window.__signOutScope,
    cloudDeleteCalls: window.__cloudDeleteCalls,
    sdkSession: localStorage.getItem('sb-example-auth-token'),
    teacherSession: sessionStorage.getItem('ehTeacherPilotMasterySessionV1'),
    owner: localStorage.getItem('english-hero-cloud-owner'),
    upsertCount: window.__upsertCalls.length,
    confirmText: window.__cleanupConfirmText
  }));
  expect(result.signOutScope).toBe('local');
  expect(result.cloudDeleteCalls).toBe(0);
  expect(result.sdkSession).toBeNull();
  expect(result.teacherSession).not.toBeNull();
  expect(result.owner).toBeNull();
  expect(result.state.xp).toBe(0);
  expect(result.upsertCount).toBe(1); // Initial sync only; cleanup must not upload a blank progress record.
  expect(result.confirmText).toContain('تغييرات لم تكتمل مزامنتها بعد ستُحذف');
  for (const key of [
    'english-hero-academy-3',
    'english-hero-account-backup-account-A',
    'ehPlusV2:account-A',
    'englishHeroStudentTasksV1:account-A',
    'eh-scenarios-done:account-A'
  ]) expect(result.keys).not.toContain(key);
  for (const key of [
    'english-hero-account-backup-account-B',
    'ehPlusV2:account-B',
    'englishHeroStudentTasksV1:account-B',
    'eh-scenarios-done:account-B',
    'english-hero-unclaimed-local-backup',
    'english-hero-unclaimed-local-backup-123'
  ]) expect(result.keys).toContain(key);
});

test('failed local cleanup sign-out preserves all account data and restores the signed-in state', async ({ page }) => {
  await page.goto('/privacy.html');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="cloudStatus"></div><form id="cloudAuthForm"></form><button id="cloudGoogle"></button><button id="cloudSignIn"></button><button id="cloudSignUp"></button><input id="cloudEmail"><input id="cloudPassword"><button id="cloudSignOut"></button><button id="cloudSyncNow"></button><button id="cloudRestoreBackup"></button><button id="cloudClearLocalData"></button><div id="cloudUser"></div>';
    const active = {xp:55,best:50,quizzes:2,completed:[1],masteredLessons:[1],saved:['account-a-word']};
    localStorage.setItem('english-hero-academy-3',JSON.stringify(active));
    localStorage.setItem('english-hero-cloud-owner','account-A');
    localStorage.setItem('english-hero-account-backup-account-A',JSON.stringify(active));
    localStorage.setItem('ehPlusV2:account-A',JSON.stringify({points:45}));
    window.state=active;
    window.defaults=()=>({xp:0,best:0,quizzes:0,completed:[],masteredLessons:[],saved:[]});
    window.replaceProgress=value=>{window.state={...window.defaults(),...value};};
    window.mergeProgress=value=>{window.state={...window.state,...value};};
    window.lessons=[];
    window.normalizeMasteredLessons=values=>values;
    window.mergeReviewProgress=()=>({});
    window.reconcileReviewMisses=()=>({});
    for(const name of ['renderStats','renderCourses','renderHome','renderProfile','renderReview'])window[name]=()=>{};
    window.ENGLISH_HERO_CLOUD_CONFIG={supabaseUrl:'https://example-project.supabase.co',supabaseAnonKey:'public-anon-key-that-is-long-enough-for-test'};
    window.confirm=()=>true;
    window.supabase={createClient:()=>({
      auth:{
        getSession:async()=>({data:{session:{user:{id:'account-A'}}},error:null}),
        onAuthStateChange:callback=>{window.__authStateCallback=callback;return{data:{subscription:{unsubscribe(){}}}};},
        signOut:async options=>({error:new Error('simulated sign-out failure')})
      },
      from:()=>({select(){return this;},eq(){return this;},maybeSingle(){return this;},upsert(){return this;},abortSignal(){return Promise.resolve({data:null,error:null});}})
    })};
  });
  await page.addScriptTag({path:'cloud-sync.js'});
  await page.evaluate(()=>window.EnglishHeroCloudReady);
  await page.locator('#cloudClearLocalData').click();
  await expect(page.locator('#cloudStatus')).toContainText('لم نحذف بيانات الحساب المحلية');
  await expect(page.locator('#cloudClearLocalData')).toBeEnabled();
  const preserved=await page.evaluate(()=>({
    user:window.EnglishHeroCloud.getUser()?.id,
    ready:window.EnglishHeroCloud.isReady(),
    owner:localStorage.getItem('english-hero-cloud-owner'),
    active:JSON.parse(localStorage.getItem('english-hero-academy-3')||'null'),
    backup:JSON.parse(localStorage.getItem('english-hero-account-backup-account-A')||'null'),
    plus:JSON.parse(localStorage.getItem('ehPlusV2:account-A')||'null')
  }));
  expect(preserved.user).toBe('account-A');
  expect(preserved.ready).toBe(true);
  expect(preserved.owner).toBe('account-A');
  expect(preserved.active.xp).toBe(55);
  expect(preserved.backup.xp).toBe(55);
  expect(preserved.plus.points).toBe(45);
});

test('refuses cleanup when the stored owner belongs to another account', async ({ page }) => {
  await page.goto('/privacy.html');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="cloudStatus"></div><form id="cloudAuthForm"></form><button id="cloudGoogle"></button><button id="cloudSignIn"></button><button id="cloudSignUp"></button><input id="cloudEmail"><input id="cloudPassword"><button id="cloudSignOut"></button><button id="cloudSyncNow"></button><button id="cloudRestoreBackup"></button><button id="cloudClearLocalData"></button><div id="cloudUser"></div>';
    const active={xp:55,completed:[1],saved:['local-word']};
    localStorage.setItem('english-hero-academy-3',JSON.stringify(active));
    localStorage.setItem('english-hero-cloud-owner','account-A');
    window.state=active;
    window.defaults=()=>({xp:0,completed:[],saved:[]});
    window.replaceProgress=value=>{window.state={...window.defaults(),...value};};
    window.mergeProgress=value=>{window.state={...window.state,...value};};
    window.lessons=[];
    window.normalizeMasteredLessons=values=>values;
    window.mergeReviewProgress=()=>({});
    window.reconcileReviewMisses=()=>({});
    for(const name of ['renderStats','renderCourses','renderHome','renderProfile','renderReview'])window[name]=()=>{};
    window.ENGLISH_HERO_CLOUD_CONFIG={supabaseUrl:'https://example-project.supabase.co',supabaseAnonKey:'public-anon-key-that-is-long-enough-for-test'};
    window.confirm=()=>true;
    window.__signOutCalls=0;
    window.supabase={createClient:()=>({
      auth:{
        getSession:async()=>({data:{session:{user:{id:'account-A'}}},error:null}),
        onAuthStateChange:callback=>{window.__authStateCallback=callback;return{data:{subscription:{unsubscribe(){}}}};},
        signOut:async()=>{window.__signOutCalls++;return{error:null};}
      },
      from:()=>({select(){return this;},eq(){return this;},maybeSingle(){return this;},upsert(){return this;},abortSignal(){return Promise.resolve({data:null,error:null});}})
    })};
  });
  await page.addScriptTag({path:'cloud-sync.js'});
  await page.evaluate(()=>window.EnglishHeroCloudReady);
  // Simulate an inconsistent owner marker after the current account's state is ready.
  await page.evaluate(()=>localStorage.setItem('english-hero-cloud-owner','account-B'));
  await page.locator('#cloudClearLocalData').click();
  await expect(page.locator('#cloudStatus')).toContainText('لم نحذف بيانات الحساب المحلية');
  const result=await page.evaluate(()=>({
    user:window.EnglishHeroCloud.getUser()?.id,
    ready:window.EnglishHeroCloud.isReady(),
    owner:localStorage.getItem('english-hero-cloud-owner'),
    active:JSON.parse(localStorage.getItem('english-hero-academy-3')||'null'),
    signOutCalls:window.__signOutCalls
  }));
  expect(result.user).toBe('account-A');
  expect(result.ready).toBe(true);
  expect(result.owner).toBe('account-B');
  expect(result.active.xp).toBe(55);
  expect(result.signOutCalls).toBe(0);
});

test('reports partial cleanup when browser storage refuses deletion', async ({ page }) => {
  await page.goto('/privacy.html');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="cloudStatus"></div><form id="cloudAuthForm"></form><button id="cloudGoogle"></button><button id="cloudSignIn"></button><button id="cloudSignUp"></button><input id="cloudEmail"><input id="cloudPassword"><button id="cloudSignOut"></button><button id="cloudSyncNow"></button><button id="cloudRestoreBackup"></button><button id="cloudClearLocalData"></button><div id="cloudUser"></div>';
    const active={xp:55,completed:[1],saved:['local-word']};
    localStorage.setItem('english-hero-academy-3',JSON.stringify(active));
    localStorage.setItem('english-hero-cloud-owner','account-A');
    localStorage.setItem('english-hero-account-backup-account-A',JSON.stringify(active));
    localStorage.setItem('ehPlusV2:account-A',JSON.stringify({points:45}));
    localStorage.setItem('englishHeroStudentTasksV1:account-A',JSON.stringify([{id:'a',text:'A task'}]));
    localStorage.setItem('eh-scenarios-done:account-A',JSON.stringify({0:5}));
    const nativeRemove=Storage.prototype.removeItem;
    Storage.prototype.removeItem=function(key){
      if(key==='ehPlusV2:account-A')throw new Error('simulated storage removal failure');
      return nativeRemove.call(this,key);
    };
    window.state=active;
    window.defaults=()=>({xp:0,completed:[],saved:[]});
    window.replaceProgress=value=>{window.state={...window.defaults(),...value};};
    window.mergeProgress=value=>{window.state={...window.state,...value};};
    window.lessons=[];
    window.normalizeMasteredLessons=values=>values;
    window.mergeReviewProgress=()=>({});
    window.reconcileReviewMisses=()=>({});
    for(const name of ['renderStats','renderCourses','renderHome','renderProfile','renderReview'])window[name]=()=>{};
    window.ENGLISH_HERO_CLOUD_CONFIG={supabaseUrl:'https://example-project.supabase.co',supabaseAnonKey:'public-anon-key-that-is-long-enough-for-test'};
    window.confirm=()=>true;
    window.supabase={createClient:()=>({
      auth:{
        getSession:async()=>({data:{session:{user:{id:'account-A'}}},error:null}),
        onAuthStateChange:callback=>{window.__authStateCallback=callback;return{data:{subscription:{unsubscribe(){}}}};},
        signOut:async()=>{window.__authStateCallback?.('SIGNED_OUT',null);return{error:null};}
      },
      from:()=>({select(){return this;},eq(){return this;},maybeSingle(){return this;},upsert(){return this;},abortSignal(){return Promise.resolve({data:null,error:null});}})
    })};
  });
  await page.addScriptTag({path:'cloud-sync.js'});
  await page.evaluate(()=>window.EnglishHeroCloudReady);
  await page.locator('#cloudClearLocalData').click();
  await expect(page.locator('#cloudStatus')).toContainText('تعذر حذف بعض البيانات المحلية');
  const result=await page.evaluate(()=>({
    user:window.EnglishHeroCloud.getUser()?.id||null,
    active:localStorage.getItem('english-hero-academy-3'),
    backup:localStorage.getItem('english-hero-account-backup-account-A'),
    plus:localStorage.getItem('ehPlusV2:account-A'),
    tasks:localStorage.getItem('englishHeroStudentTasksV1:account-A'),
    scenarios:localStorage.getItem('eh-scenarios-done:account-A')
  }));
  expect(result.user).toBeNull();
  expect(result.active).toBeNull();
  expect(result.backup).toBeNull();
  expect(result.plus).not.toBeNull();
  expect(result.tasks).toBeNull();
  expect(result.scenarios).toBeNull();
});


test('a missing cloud row never silently restores an owned local snapshot', async ({ page }) => {
  await page.goto('/privacy.html');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="cloudStatus"></div><form id="cloudAuthForm"></form><button id="cloudGoogle"></button><button id="cloudSignIn"></button><button id="cloudSignUp"></button><input id="cloudEmail"><input id="cloudPassword"><button id="cloudSignOut"></button><button id="cloudSyncNow"></button><button id="cloudRestoreBackup"></button><div id="cloudUser"></div>';
    const local = {xp:200,best:100,quizzes:2,completed:[0,1],masteredLessons:[0,1],saved:['word-a','word-b'],foundationSaved:[],review:{},misses:{},daily:{},lessonPositions:{}};
    localStorage.setItem('english-hero-academy-3',JSON.stringify(local));
    localStorage.setItem('english-hero-cloud-owner','same-student');
    window.state=local;
    window.lessons=[];
    window.defaults=()=>({xp:0,best:0,quizzes:0,streak:0,completed:[],masteredLessons:[],lessonStarted:[],lessonTrained:[],saved:[],foundationSaved:[],review:{},misses:{},daily:{},lessonPositions:{},chatHistory:[],displayName:''});
    window.normalizeMasteredLessons=values=>values;
    window.mergeReviewProgress=()=>({});
    window.reconcileReviewMisses=()=>({});
    for(const name of ['renderStats','renderCourses','renderHome','renderProfile','renderReview'])window[name]=()=>{};
    window.ENGLISH_HERO_CLOUD_CONFIG={supabaseUrl:'https://example-project.supabase.co',supabaseAnonKey:'public-anon-key-that-is-long-enough-for-test'};
    window.__confirmMessage='';
    window.confirm=message=>{window.__confirmMessage=message;return false;};
    window.__uploadedProgress=null;
    window.supabase={createClient:()=>({
      auth:{
        getSession:async()=>({data:{session:{user:{id:'same-student'}}},error:null}),
        onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
      },
      from:()=>({select(){return this;},eq(){return this;},maybeSingle(){return this;},upsert(payload){window.__uploadedProgress=payload.progress;return this;},abortSignal(){return Promise.resolve({data:null,error:null});}})
    })};
  });
  await page.addScriptTag({path:'cloud-sync.js'});
  await page.evaluate(()=>window.EnglishHeroCloudReady);
  const result=await page.evaluate(()=>({
    currentXp:window.state.xp,
    backupXp:JSON.parse(localStorage.getItem('english-hero-account-backup-same-student')||'null')?.xp,
    uploadedXp:window.__uploadedProgress?.xp,
    prompt:window.__confirmMessage
  }));
  expect(result.currentXp).toBe(0);
  expect(result.backupXp).toBe(200);
  expect(result.uploadedXp).toBe(0);
  expect(result.prompt).toContain('200 XP');
});

test('restoring local progress after a missing cloud row requires explicit confirmation', async ({ page }) => {
  await page.goto('/privacy.html');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="cloudStatus"></div><form id="cloudAuthForm"></form><button id="cloudGoogle"></button><button id="cloudSignIn"></button><button id="cloudSignUp"></button><input id="cloudEmail"><input id="cloudPassword"><button id="cloudSignOut"></button><button id="cloudSyncNow"></button><button id="cloudRestoreBackup"></button><div id="cloudUser"></div>';
    const local = {xp:3600,best:100,quizzes:12,completed:[0,1],masteredLessons:[0,1],saved:[],foundationSaved:[],review:{},misses:{},daily:{},lessonPositions:{}};
    localStorage.setItem('english-hero-academy-3',JSON.stringify(local));
    localStorage.setItem('english-hero-cloud-owner','same-student');
    window.state=local;
    window.lessons=[];
    window.defaults=()=>({xp:0,best:0,quizzes:0,streak:0,completed:[],masteredLessons:[],lessonStarted:[],lessonTrained:[],saved:[],foundationSaved:[],review:{},misses:{},daily:{},lessonPositions:{},chatHistory:[],displayName:''});
    window.normalizeMasteredLessons=values=>values;
    window.mergeReviewProgress=()=>({});
    window.reconcileReviewMisses=()=>({});
    for(const name of ['renderStats','renderCourses','renderHome','renderProfile','renderReview'])window[name]=()=>{};
    window.ENGLISH_HERO_CLOUD_CONFIG={supabaseUrl:'https://example-project.supabase.co',supabaseAnonKey:'public-anon-key-that-is-long-enough-for-test'};
    window.confirm=message=>message.includes('3600 XP');
    window.__uploadedProgress=null;
    window.supabase={createClient:()=>({
      auth:{
        getSession:async()=>({data:{session:{user:{id:'same-student'}}},error:null}),
        onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
      },
      from:()=>({select(){return this;},eq(){return this;},maybeSingle(){return this;},upsert(payload){window.__uploadedProgress=payload.progress;return this;},abortSignal(){return Promise.resolve({data:null,error:null});}})
    })};
  });
  await page.addScriptTag({path:'cloud-sync.js'});
  await page.evaluate(()=>window.EnglishHeroCloudReady);
  const result=await page.evaluate(()=>({
    currentXp:window.state.xp,
    backupXp:JSON.parse(localStorage.getItem('english-hero-account-backup-same-student')||'null')?.xp,
    uploadedXp:window.__uploadedProgress?.xp
  }));
  expect(result.currentXp).toBe(3600);
  expect(result.backupXp).toBe(3600);
  expect(result.uploadedXp).toBe(3600);
});


test('switching between two signed-in accounts loads each account progress without cross-merging', async ({ page }) => {
  await page.goto('/privacy.html');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="cloudStatus"></div><form id="cloudAuthForm"></form><button id="cloudGoogle"></button><button id="cloudSignIn"></button><button id="cloudSignUp"></button><input id="cloudEmail"><input id="cloudPassword"><button id="cloudSignOut"></button><button id="cloudSyncNow"></button><button id="cloudRestoreBackup"></button><div id="cloudUser"></div>';
    const local = { xp: 0, best: 0, quizzes: 0, completed: [], masteredLessons: [], lessonStarted: [], lessonTrained: [], saved: [], foundationSaved: [], review: {}, misses: {}, daily: {}, lessonPositions: {}, chatHistory: [], displayName: '' };
    localStorage.setItem('english-hero-academy-3', JSON.stringify(local));
    window.state = local;
    // The production normalizer discards lesson indexes outside the loaded lesson catalog.
    // Provide a representative catalog so this account-isolation test exercises valid IDs.
    window.lessons = Array.from({ length: 10 }, (_, index) => ({ id: index }));
    window.defaults = () => ({ xp: 0, best: 0, quizzes: 0, streak: 0, completed: [], masteredLessons: [], lessonStarted: [], lessonTrained: [], saved: [], foundationSaved: [], review: {}, misses: {}, daily: {}, lessonPositions: {}, chatHistory: [], displayName: '' });
    window.normalizeMasteredLessons = values => values;
    window.mergeReviewProgress = () => ({});
    window.reconcileReviewMisses = () => ({});
    for (const name of ['renderStats','renderCourses','renderHome','renderProfile','renderReview']) window[name] = () => {};
    window.ENGLISH_HERO_CLOUD_CONFIG = { supabaseUrl: 'https://example-project.supabase.co', supabaseAnonKey: 'public-anon-key-that-is-long-enough-for-test' };
    window.__uploads = [];
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'account-A' } } }, error: null }),
          onAuthStateChange: callback => { window.__authStateCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
          signOut: async () => ({ error: null })
        },
        from: () => {
          let requestedUserId = null;
          return {
            select() { return this; },
            eq(_column, value) { requestedUserId = value; return this; },
            maybeSingle() {
              const progress = requestedUserId === 'account-A'
                ? { xp: 3600, completed: [3], saved: ['email-account-word'] }
                : { xp: 200, completed: [1], saved: ['google-account-word'] };
              return { abortSignal: () => Promise.resolve({ data: { progress }, error: null }) };
            },
            upsert(payload) {
              window.__uploads.push({ userId: payload.user_id, progress: payload.progress });
              return { abortSignal: () => Promise.resolve({ data: null, error: null }) };
            }
          };
        }
      })
    };
  });

  await page.addScriptTag({ path: 'cloud-sync.js' });
  await page.evaluate(() => window.EnglishHeroCloudReady);
  await expect.poll(() => page.evaluate(() => window.state.xp)).toBe(3600);
  expect(await page.evaluate(() => window.state.saved)).toContain('email-account-word');

  await page.evaluate(() => window.__authStateCallback('SIGNED_IN', { user: { id: 'account-B' } }));
  await expect.poll(() => page.evaluate(() => window.state.xp)).toBe(200);
  const accountB = await page.evaluate(() => ({
    owner: localStorage.getItem('english-hero-cloud-owner'),
    backupA: JSON.parse(localStorage.getItem('english-hero-account-backup-account-A') || 'null'),
    saved: window.state.saved,
    completed: window.state.completed
  }));
  expect(accountB.owner).toBe('account-B');
  expect(accountB.backupA.xp).toBe(3600);
  expect(accountB.saved).toEqual(['google-account-word']);
  expect(accountB.completed).toEqual([1]);

  await page.evaluate(() => window.__authStateCallback('SIGNED_IN', { user: { id: 'account-A' } }));
  await expect.poll(() => page.evaluate(() => window.state.xp)).toBe(3600);
  const accountA = await page.evaluate(() => ({
    owner: localStorage.getItem('english-hero-cloud-owner'),
    backupB: JSON.parse(localStorage.getItem('english-hero-account-backup-account-B') || 'null'),
    saved: window.state.saved,
    completed: window.state.completed
  }));
  expect(accountA.owner).toBe('account-A');
  expect(accountA.backupB.xp).toBe(200);
  expect(accountA.saved).toEqual(['email-account-word']);
  expect(accountA.completed).toEqual([3]);

  const uploads = await page.evaluate(() => window.__uploads);
  expect(uploads.filter(call => call.userId === 'account-A').every(call => call.progress.xp === 3600 && !call.progress.saved?.includes('google-account-word'))).toBe(true);
  expect(uploads.filter(call => call.userId === 'account-B').every(call => call.progress.xp === 200 && !call.progress.saved?.includes('email-account-word'))).toBe(true);
});
