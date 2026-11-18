import { test, expect } from '@playwright/test';

// This is a contract-level mock of the database's documented RLS policy.
// It deliberately uses ONE shared table store and enforces auth.uid() = user_id
// independently of client-supplied filters. It is not a substitute for a live
// Supabase/Postgres RLS integration test.
const rlsMock = `(() => {
  const STORAGE_KEY = '__ehRlsContractRows';
  const USER_KEY = '__ehRlsContractUser';
  const listeners = [];
  const readRows = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const writeRows = rows => localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  const readUser = () => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  };
  const matches = (row, filters) => filters.every(([key, value]) => row[key] === value);
  const denied = () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } });

  const makeQuery = () => {
    let action = 'select';
    let filters = [];
    let payload = null;
    let returning = false;
    const query = {
      select() { if (action !== 'select') returning = true; return this; },
      eq(column, value) { filters.push([column, value]); return this; },
      upsert(rows) { action = 'upsert'; payload = Array.isArray(rows) ? rows : [rows]; return this; },
      update(values) { action = 'update'; payload = values; return this; },
      delete() { action = 'delete'; return this; },
      then(resolve, reject) {
        try {
          const user = readUser();
          if (!user?.id) return Promise.resolve({ data: null, error: { code: '42501', message: 'authentication required' } }).then(resolve, reject);
          const uid = user.id;
          let rows = readRows();
          let result;

          if (action === 'select') {
            result = { data: rows.filter(row => row.user_id === uid && matches(row, filters)), error: null };
          } else if (action === 'upsert') {
            if (payload.some(row => row.user_id !== uid)) {
              result = denied();
            } else {
              for (const row of payload) {
                const index = rows.findIndex(item => item.user_id === uid && item.code === row.code);
                if (index >= 0) rows[index] = { ...rows[index], ...row };
                else rows.push(row);
              }
              writeRows(rows);
              result = { data: payload, error: null };
            }
          } else if (action === 'update') {
            const indexes = [];
            rows.forEach((row, index) => {
              if (row.user_id === uid && matches(row, filters)) indexes.push(index);
            });
            if (indexes.some(index => ({ ...rows[index], ...payload }).user_id !== uid)) {
              result = denied();
            } else {
              const changed = indexes.map(index => {
                rows[index] = { ...rows[index], ...payload };
                return rows[index];
              });
              writeRows(rows);
              result = { data: returning ? changed : null, error: null };
            }
          } else {
            const removed = rows.filter(row => row.user_id === uid && matches(row, filters));
            rows = rows.filter(row => !(row.user_id === uid && matches(row, filters)));
            writeRows(rows);
            result = { data: returning ? removed : null, error: null };
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
        const id = String(email || '').toLowerCase().startsWith('teacher-b') ? 'teacher-b' : 'teacher-a';
        const user = { id, email, user_metadata: {} };
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        listeners.forEach(callback => callback('SIGNED_IN', { user }));
        return { data: { user, session: { user } }, error: null };
      },
      async signOut() {
        localStorage.removeItem(USER_KEY);
        listeners.forEach(callback => callback('SIGNED_OUT', null));
        return { error: null };
      }
    },
    from() { return makeQuery(); }
  };

  window.__ehRlsContract = {
    client,
    setUser(id) { localStorage.setItem(USER_KEY, JSON.stringify({ id })); },
    rows() { return readRows(); }
  };
  window.supabase = { createClient: () => client };
})();`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(rlsMock);
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2*', route => route.abort());
  await page.goto('/teacher-pilot.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('shared-table RLS contract blocks cross-teacher reads, updates, deletes, and spoofed inserts', async ({ page }) => {
  const outcome = await page.evaluate(async () => {
    const client = window.__ehRlsContract.client;
    window.__ehRlsContract.setUser('teacher-a');
    const inserted = await client.from('teacher_pilot_results').upsert({
      user_id: 'teacher-a',
      code: 'P91',
      pre_score: 61,
      post_score: 78,
      retention_score: null,
      sessions_attended: 2
    });
    window.__ehRlsContract.setUser('teacher-b');

    const crossRead = await client.from('teacher_pilot_results').select('*')
      .eq('user_id', 'teacher-a').eq('code', 'P91');
    const crossUpdate = await client.from('teacher_pilot_results')
      .update({ post_score: 99 }).eq('user_id', 'teacher-a').eq('code', 'P91').select();
    const crossDelete = await client.from('teacher_pilot_results').delete()
      .eq('user_id', 'teacher-a').eq('code', 'P91').select();
    const spoofedInsert = await client.from('teacher_pilot_results').upsert({
      user_id: 'teacher-a',
      code: 'P92',
      pre_score: 50,
      post_score: 50,
      retention_score: null,
      sessions_attended: 0
    });

    window.__ehRlsContract.setUser('teacher-a');
    const ownerRead = await client.from('teacher_pilot_results').select('*')
      .eq('user_id', 'teacher-a').eq('code', 'P91');
    return {
      insertedError: inserted.error,
      crossRead: crossRead.data,
      crossUpdate: crossUpdate.data,
      crossDelete: crossDelete.data,
      spoofedInsertError: spoofedInsert.error,
      ownerRows: ownerRead.data,
      allRows: window.__ehRlsContract.rows()
    };
  });

  expect(outcome.insertedError).toBeNull();
  expect(outcome.crossRead).toEqual([]);
  expect(outcome.crossUpdate).toEqual([]);
  expect(outcome.crossDelete).toEqual([]);
  expect(outcome.spoofedInsertError?.code).toBe('42501');
  expect(outcome.ownerRows).toHaveLength(1);
  expect(outcome.ownerRows[0]).toMatchObject({ user_id: 'teacher-a', code: 'P91', post_score: 78 });
  expect(outcome.allRows).toHaveLength(1);
  expect(outcome.allRows[0].code).toBe('P91');
});

test('shared-table RLS contract prevents a teacher from transferring ownership of their own row', async ({ page }) => {
  const outcome = await page.evaluate(async () => {
    const client = window.__ehRlsContract.client;
    window.__ehRlsContract.setUser('teacher-a');
    await client.from('teacher_pilot_results').upsert({
      user_id: 'teacher-a',
      code: 'P93',
      pre_score: 70,
      post_score: 80,
      retention_score: null,
      sessions_attended: 1
    });
    const reassignment = await client.from('teacher_pilot_results')
      .update({ user_id: 'teacher-b' })
      .eq('user_id', 'teacher-a').eq('code', 'P93').select();
    const ownerRead = await client.from('teacher_pilot_results').select('*')
      .eq('user_id', 'teacher-a').eq('code', 'P93');
    return { error: reassignment.error, rows: ownerRead.data };
  });

  expect(outcome.error?.code).toBe('42501');
  expect(outcome.rows).toHaveLength(1);
  expect(outcome.rows[0]).toMatchObject({ user_id: 'teacher-a', code: 'P93', post_score: 80 });
});
