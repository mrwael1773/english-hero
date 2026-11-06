import { test as base, expect } from '@playwright/test';

// Learning-flow tests run against an isolated authenticated student.
// The gateway-specific suite imports @playwright/test directly and supplies its own auth states.
export const test = base.extend({
  authenticatedStudent: [async ({ page }, use) => {
    await page.route('**/cloud-sync.js', route => route.fulfill({
      contentType: 'application/javascript',
      body: `window.EnglishHeroCloudReady=Promise.resolve(true);
        window.EnglishHeroCloud={getUser:()=>({id:'e2e-student'}),isConfigured:()=>true,
        getProfile:async()=>({username:'e2e_student',display_name:'E2E Student'})};`
    }));
    await page.route('**/cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => route.fulfill({
      contentType: 'application/javascript',
      body: `window.supabase={createClient:()=>({
        auth:{getSession:async()=>({data:{session:{user:{id:'e2e-student'}}},error:null})},
        from:()=>({select(){return this;},eq(){return this;},
          maybeSingle:async()=>({data:{user_id:'e2e-student'},error:null})})
      })};`
    }));
    await use();
  }, { auto: true }]
});
export { expect };
