import { test as base, expect } from '@playwright/test';

// Learning-flow tests run against an isolated authenticated student.
// The auth mock mirrors the Supabase session used by auth-guard.js and reading progress sync.
export const test = base.extend({
  authenticatedStudent: [async ({ page }, use) => {
    await page.route('**/cloud-sync.js*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `window.EnglishHeroCloudReady=Promise.resolve(true);
        window.EnglishHeroCloud={getUser:()=>({id:'e2e-student'}),isConfigured:()=>true,
        getProfile:async()=>({username:'e2e_student',display_name:'E2E Student'}),isReady:()=>true,
        getStudentChampions:async()=>({generated_at:'2026-11-21T10:00:00Z',timezone:'Asia/Riyadh',today_leaders:[{display_name:'بطلة الاختبار',score:2},{display_name:'وصيفة اليوم',score:1},{display_name:'المركز الثالث',score:1}],week_leaders:[{display_name:'بطل الأسبوع',score:4},{display_name:'وصيف الأسبوع',score:3}],mastery_leaders:[{display_name:'الأكثر إتقانًا',score:5}],consistency_leaders:[{display_name:'نجم الاستمرارية',score:6}],improvement_leaders:[{display_name:'الأكثر تطورًا',score:3}]})};`
    }));
    await page.route('**/cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => route.fulfill({
      contentType: 'application/javascript',
      body: `window.supabase={createClient:()=>({
        auth:{
          onAuthStateChange(callback){
            callback('INITIAL_SESSION',{user:{id:'e2e-student'},access_token:'e2e-access-token'});
            return {data:{subscription:{unsubscribe(){}}}};
          },
          getSession:async()=>({data:{session:{user:{id:'e2e-student'},access_token:'e2e-access-token'}},error:null})
        },
        from:()=>({select(){return this;},eq(){return this;},
          maybeSingle:async()=>({data:{user_id:'e2e-student',progress:{}},error:null})})
      })};`
    }));
    // Keep reading RPCs isolated: tests never contact a real Supabase project.
    await page.route('**/rest/v1/rpc/get_my_reading_progress', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]'
    }));
    await page.route('**/rest/v1/rpc/save_my_reading_progress', async route => {
      const payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(payload?.p_completed) ? payload.p_completed : [])
      });
    });
    await use();
  }, { auto: true }]
});
export { expect };
