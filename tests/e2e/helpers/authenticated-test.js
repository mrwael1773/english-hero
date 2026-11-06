import { test as base, expect } from '@playwright/test';

const cloudMock = `
  window.EnglishHeroCloudReady = Promise.resolve(true);
  window.EnglishHeroCloud = Object.freeze({
    isConfigured: () => true,
    getUser: () => ({ id: 'e2e-student' }),
    getProfile: async () => ({ username: 'e2e_student', display_name: 'E2E Student' })
  });
`;

const supabaseGuardMock = `
  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: 'e2e-student' } } },
          error: null
        })
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { user_id: 'e2e-student' },
              error: null
            })
          })
        })
      })
    })
  };
`;

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/cloud-sync.js*', route => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: cloudMock
    }));
    await page.route('**/supabase-js@2*', route => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: supabaseGuardMock
    }));
    await use(page);
  }
});

export { expect };
