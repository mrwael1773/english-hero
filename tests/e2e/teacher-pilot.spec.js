import { test, expect } from '@playwright/test';

const mockSupabaseScript = `(() => {
  const readUser = () => {
    try { return JSON.parse(localStorage.getItem('ehMockTeacherAuthUser') || 'null'); }
    catch { return null; }
  };
  const listeners = [];
  const makeQuery = () => {
    let action = 'select';
    let filterUser = null;
    let payload = [];
    const query = {
      select() { action = 'select'; return this; },
      eq(column, value) { if (column === 'user_id') filterUser = value; return this; },
      upsert(rows) { action = 'upsert'; payload = rows; return this; },
      delete() { action = 'delete'; return this; },
      abortSignal() { return this; },
      then(resolve, reject) {
        try {
          const user = readUser();
          const uid = filterUser || user?.id || 'none';
          const key = 'ehMockPilotRows:' + uid;
          let rows = JSON.parse(localStorage.getItem(key) || '[]');
          let result;
          if (action === 'select') {
            result = { data: rows.filter(row => !filterUser || row.user_id === filterUser), error: null };
          } else if (action === 'upsert') {
            for (const row of payload) {
              const index = rows.findIndex(item => item.user_id === row.user_id && item.code === row.code);
              if (index >= 0) rows[index] = row;
              else rows.push(row);
            }
            localStorage.setItem(key, JSON.stringify(rows));
            result = { data: payload, error: null };
          } else {
            rows = rows.filter(row => !filterUser || row.user_id !== filterUser);
            localStorage.setItem(key, JSON.stringify(rows));
            result = { data: null, error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      }
    };
    return query;
  };
  const client = {
    auth: {
      async getSession() {
        const user = readUser();
        return { data: { session: user ? { user } : null }, error: null };
      },
      onAuthStateChange(callback) {
        listeners.push(callback);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async signInWithPassword({ email }) {
        const normalized = String(email || '').toLowerCase();
        const id = normalized.startsWith('teacher-b') ? 'teacher-b' : 'teacher-a';
        const user = { id, email: normalized, user_metadata: { full_name: id } };
        const session = { user };
        localStorage.setItem('ehMockTeacherAuthUser', JSON.stringify(user));
        listeners.forEach(callback => callback('SIGNED_IN', session));
        return { data: { user, session }, error: null };
      },
      async signOut() {
        localStorage.removeItem('ehMockTeacherAuthUser');
        listeners.forEach(callback => callback('SIGNED_OUT', null));
        return { error: null };
      }
    },
    from() { return makeQuery(); }
  };
  window.supabase = { createClient: () => client };
})();`;

async function signInTeacher(page, email = 'teacher-a@example.test') {
  await page.locator('#pilotCloudEmail').fill(email);
  await page.locator('#pilotCloudPassword').fill('mock-password');
  await page.locator('#pilotCloudLogin').click();
  await expect(page.locator('#addParticipant')).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  // Install the deterministic Supabase mock before page scripts execute. The CDN
  // is blocked so CI never depends on an external network response.
  await page.addInitScript(mockSupabaseScript);
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2*', route => route.abort());
  await page.goto('/teacher-pilot.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#addParticipant')).toBeDisabled();
});

test('pilot lesson can complete all six training words and advance through all 18 assessment questions', async ({ page }) => {
  for (let i = 0; i < 6; i++) {
    await page.locator('[data-trained]').nth(i).click();
  }
  await expect(page.locator('#trainingCount')).toContainText('6 من 6');
  await expect(page.locator('#startTest')).toBeEnabled();
  await page.locator('#finishTraining').click();
  await page.locator('#startTest').click();
  await expect(page.locator('#testArea')).toBeVisible();

  for (let i = 0; i < 18; i++) {
    const question = page.locator('#testArea .question');
    await expect(question).toBeVisible();
    const choices = page.locator('#testArea [data-choice]');
    if (await choices.count()) {
      await expect(choices).toHaveCount(4);
      const labels = await choices.allTextContents();
      expect(new Set(labels).size).toBe(4);
      await choices.first().click();
    } else {
      await page.locator('#typedAnswer').fill('not-the-answer');
      await page.locator('#typedAnswer').press('Enter');
    }
    await expect(page.locator('#nextQuestion')).toBeVisible();
    await expect(page.locator('#nextQuestion')).toBeEnabled();
    await page.locator('#nextQuestion').click();
  }
  await expect(page.locator('#resultArea')).toContainText('٪');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotMasteryV1')));
  expect(saved.attempts).toBe(1);
  expect(saved.lastAttempt.total).toBe(18);
  expect(saved.reviewDue).toBeTruthy();
});

test('attendance records 16 individual sessions, updates a participant, and exports weekly CSV data', async ({ page }) => {
  await page.locator('[data-tab="pilot"]').click();
  await expect(page.locator('#addParticipant')).toBeDisabled();

  await signInTeacher(page);
  await page.locator('#pCode').fill('STUDENT NAME');
  await page.locator('#pPre').fill('70');
  await page.locator('#pPost').fill('85');
  await page.locator('#addParticipant').click();
  await expect(page.locator('#pilotMessage')).toContainText('تحقق');
  await expect(page.locator('#pilotRows tr')).toHaveCount(0);

  await page.locator('#pCode').fill('P01');
  await page.locator('#pPre').fill('70');
  await page.locator('#pPost').fill('85');
  await page.locator('#pDelay').fill('80');
  for (const session of [1, 3, 5, 9, 16]) {
    await page.locator(`.pilot-session[value="${session}"]`).check();
  }
  await page.locator('#addParticipant').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(1);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotCohortV1')));
  expect(saved[0]).toMatchObject({
    code: 'P01', pre: 70, post: 85, delay: 80,
    attendance: 5, sessions: [1, 3, 5, 9, 16],
  });
  await expect(page.locator('#pilotRows tr').first()).toContainText('5/16');
  await expect(page.locator('#pilotRows tr').first()).toContainText('أ1 2، أ2 1، أ3 1، أ4 1');

  // Re-saving the same anonymous code must update, not duplicate, the participant.
  await page.locator('#pCode').fill('P01');
  await page.locator('#pPre').fill('72');
  await page.locator('#pPost').fill('88');
  await page.locator('#pDelay').fill('83');
  for (const session of [2, 8, 15]) {
    await page.locator(`.pilot-session[value="${session}"]`).check();
  }
  await page.locator('#addParticipant').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(1);
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotCohortV1')));
  expect(saved[0]).toMatchObject({
    code: 'P01', pre: 72, post: 88, delay: 83,
    attendance: 3, sessions: [2, 8, 15],
  });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportPilot').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('english-hero-pilot-results.csv');
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString('utf8');
  expect(csv).toContain('session_log');
  expect(csv).toContain('week_1');
  expect(csv).toContain('week_4');
  expect(csv).toContain('2|8|15');
});

test('teacher data stays isolated when two teachers switch accounts on the same device', async ({ page }) => {
  await page.locator('[data-tab="pilot"]').click();
  await signInTeacher(page, 'teacher-a@example.test');
  await page.locator('#pCode').fill('P02');
  await page.locator('#pPre').fill('60');
  await page.locator('#pPost').fill('75');
  await page.locator('.pilot-session[value="4"]').check();
  await page.locator('#addParticipant').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ehMockPilotRows:teacher-a') || '[]').length)).toBe(1);

  await page.locator('#pilotCloudSignOut').click();
  await expect(page.locator('#addParticipant')).toBeDisabled();
  await signInTeacher(page, 'teacher-b@example.test');
  await page.locator('[data-tab="pilot"]').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(0);
  const oldTeacherBackup = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotCohortV1-account-teacher-a') || '[]'));
  expect(oldTeacherBackup).toHaveLength(1);
  expect(oldTeacherBackup[0].code).toBe('P02');

  await page.locator('#pilotCloudSignOut').click();
  await signInTeacher(page, 'teacher-a@example.test');
  await page.locator('[data-tab="pilot"]').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(1);
  await expect(page.locator('#pilotRows tr').first()).toContainText('P02');
});

test('unclaimed local student records remain hidden until safely associated with a teacher account', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.removeItem('ehTeacherPilotOwnerV1');
    localStorage.setItem('ehTeacherPilotCohortV1', JSON.stringify([{
      code: 'P03', pre: 70, post: 80, delay: null, attendance: 1,
      sessions: [1], updated_at: new Date().toISOString(),
    }]));
  });
  await page.reload();
  await page.locator('[data-tab="pilot"]').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(0);
  await expect(page.locator('#addParticipant')).toBeDisabled();
  const backup = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotCohortV1-unclaimed') || '[]'));
  expect(backup).toHaveLength(1);
  expect(backup[0].code).toBe('P03');
});

test('tampered local participant values are rejected before rendering', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('ehMockTeacherAuthUser', JSON.stringify({
      id: 'teacher-a', email: 'teacher-a@example.test', user_metadata: { full_name: 'teacher-a' },
    }));
    localStorage.setItem('ehTeacherPilotOwnerV1', 'teacher-a');
    localStorage.setItem('ehTeacherPilotCohortV1-account-teacher-a', JSON.stringify([{
      code: 'P04', pre: '<img src=x onerror=alert(1)>', post: 90,
      delay: null, attendance: 1, sessions: [1],
    }]));
  });
  await page.reload();
  await expect(page.locator('#addParticipant')).toBeEnabled();
  await page.locator('[data-tab="pilot"]').click();
  await expect(page.locator('#pilotRows tr')).toHaveCount(0);
  await expect(page.locator('#pilotRows img')).toHaveCount(0);
});

test('a seven-day retention quiz remains available even when the first attempt had no mistakes', async ({ page }) => {
  const due = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await page.evaluate((reviewDue) => {
    localStorage.setItem('ehTeacherPilotMasteryV1', JSON.stringify({
      started: true,
      trained: [0, 1, 2, 3, 4, 5],
      attempts: 1,
      mastered: true,
      lastAttempt: { date: new Date().toISOString(), score: 100, correct: 18, total: 18 },
      reviewDue,
      wrong: [],
    }));
  }, due);
  await page.reload();
  await page.locator('[data-tab="review"]').click();
  await expect(page.locator('#reviewList')).toContainText('حان موعد مراجعة الاحتفاظ بالتعلم');
  await page.locator('#reviewQuiz').click();
  await expect(page.locator('#testArea')).toBeVisible();
  await expect(page.locator('#testArea .question')).toContainText('1 / 18');
});

test('invalid saved lesson state cannot unlock mastery or retention questions', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('ehTeacherPilotMasteryV1', JSON.stringify({
      started: true,
      trained: [99, 100, 101, 102, 103, 104],
      attempts: 999999,
      mastered: true,
      lastAttempt: { date: 'not-a-date', score: 100, correct: 999, total: 999 },
      reviewDue: 'not-a-date',
      wrong: ['<img src=x onerror=alert(1)>'],
    }));
  });
  await page.reload();
  await expect(page.locator('#trainingCount')).toContainText('0 من 6');
  await expect(page.locator('#startTest')).toBeDisabled();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ehTeacherPilotMasteryV1')));
  expect(saved.mastered).toBe(false);
  expect(saved.trained).toEqual([]);
  expect(saved.wrong).toEqual([]);
  expect(saved.reviewDue).toBeNull();
  expect(saved.attempts).toBe(10000);
});
