import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const API_URL = process.env.API_URL;
const ANON_KEY = process.env.ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY;
const DB_URL = process.env.DB_URL;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';

for (const [name, value] of Object.entries({ API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL })) {
  assert.ok(value, `Missing required test environment variable: ${name}`);
}

const endpoint = `${API_URL}/functions/v1/student-username-login`;
const suffix = Date.now().toString(36);
const password = `Local-E2E-${suffix}-Pass!`;
const learners = [
  { username: `e2e_${suffix}`, displayName: 'Local Test Learner One', xp: 220 },
  { username: `e2e_${suffix}_b`, displayName: 'Local Test Learner Two', xp: 400 },
];

async function createLocalAuthUser(index) {
  const response = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: `student-${suffix}-${index}@example.test`,
      password,
      email_confirm: true,
      user_metadata: { full_name: learners[index].displayName },
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Local Auth user creation failed: ${JSON.stringify(body)}`);
  const userId = body.id || body.user?.id;
  assert.match(userId || '', /^[0-9a-f-]{36}$/i, 'Local Auth did not return a user UUID');
  return { id: userId, email: body.email || body.user?.email };
}

async function seedStudentRows(users) {
  const values = [];
  users.forEach((user, index) => {
    values.push(
      '-v', `user${index + 1}_id=${user.id}`,
      '-v', `user${index + 1}_username=${learners[index].username}`,
      '-v', `user${index + 1}_display_name=${learners[index].displayName}`,
      '-v', `user${index + 1}_xp=${learners[index].xp}`,
    );
  });
  const sql = `
    INSERT INTO public.student_profiles(user_id, username, display_name)
    VALUES
      (:'user1_id'::uuid, :'user1_username', :'user1_display_name'),
      (:'user2_id'::uuid, :'user2_username', :'user2_display_name');

    INSERT INTO private.student_login_lookup(user_id, username)
    VALUES
      (:'user1_id'::uuid, :'user1_username'),
      (:'user2_id'::uuid, :'user2_username');

    INSERT INTO public.learning_progress(user_id, progress)
    VALUES
      (:'user1_id'::uuid, jsonb_build_object('xp', :'user1_xp'::integer, 'rewardClaims', (SELECT jsonb_agg('claim-' || n) FROM generate_series(1, 19) n))),
      (:'user2_id'::uuid, jsonb_build_object('xp', :'user2_xp'::integer, 'rewardClaims', jsonb_build_array('second-learner-claim')))
    ON CONFLICT (user_id) DO UPDATE
      SET progress = EXCLUDED.progress, updated_at = now();
  `;
  execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', ...values, '-f', '-'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
}

async function callLogin(username, suppliedPassword = password, options = {}) {
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    Origin: options.origin || ALLOWED_ORIGIN,
    'Content-Type': 'application/json',
  };
  if (options.ip) headers['cf-connecting-ip'] = options.ip;
  const method = options.method || 'POST';
  return fetch(endpoint, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : {
      body: options.rawBody ?? JSON.stringify({ username, password: suppliedPassword }),
    }),
  });
}

async function signIn(username) {
  const response = await callLogin(username);
  const body = await response.json();
  assert.equal(response.status, 200, `Username login failed: ${JSON.stringify(body)}`);
  assert.ok(body.access_token && body.refresh_token, 'Login must return an Auth session');
  assert.ok(body.user?.id, 'Login must return the authenticated user');
  return { token: body.access_token, user: body.user };
}

async function restRequest(path, token, options = {}) {
  return fetch(`${API_URL}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

// Verify the function's HTTP boundary before creating test identities.
const preflight = await fetch(endpoint, {
  method: 'OPTIONS',
  headers: {
    Origin: ALLOWED_ORIGIN,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'apikey,content-type',
  },
});
assert.equal(preflight.status, 200, 'CORS preflight should succeed for the configured origin');

const blockedOrigin = await callLogin('invalid_user', password, { origin: 'https://untrusted.example' });
assert.equal(blockedOrigin.status, 403, 'Untrusted origins must be rejected');

const wrongMethod = await callLogin('invalid_user', password, { method: 'GET' });
assert.equal(wrongMethod.status, 405, 'Non-POST methods must be rejected');

const malformed = await callLogin('', password, { rawBody: '{' });
assert.equal(malformed.status, 400, 'Malformed JSON must be rejected');

const oversized = await callLogin('', password, { rawBody: ' '.repeat(2049) });
assert.equal(oversized.status, 413, 'Oversized request bodies must be rejected');

// Create disposable identities only in the local Supabase stack.
const users = await Promise.all([createLocalAuthUser(0), createLocalAuthUser(1)]);
await seedStudentRows(users);

const [firstSession, secondSession] = await Promise.all([
  signIn(learners[0].username),
  signIn(learners[1].username),
]);
assert.equal(firstSession.user.id, users[0].id, 'First username must resolve to its own Auth identity');
assert.equal(secondSession.user.id, users[1].id, 'Second username must resolve to its own Auth identity');

const wrongPassword = await callLogin(learners[0].username, 'incorrect-password');
const wrongPasswordBody = await wrongPassword.json();
assert.equal(wrongPassword.status, 401, 'Incorrect passwords must not authenticate');
assert.equal(wrongPasswordBody.error, 'اسم المستخدم أو كلمة المرور غير صحيحة.');

const unknownUsername = await callLogin(`missing_${suffix}`);
const unknownUsernameBody = await unknownUsername.json();
assert.equal(unknownUsername.status, 401, 'Unknown usernames must not authenticate');
assert.equal(unknownUsernameBody.error, wrongPasswordBody.error, 'Unknown usernames and wrong passwords must have the same public error');

// A fresh authenticated session can read its own persisted progress.
const firstRead = await restRequest('learning_progress?select=user_id,progress', firstSession.token);
assert.equal(firstRead.status, 200, 'Authenticated learner should read permitted progress');
const firstRows = await firstRead.json();
assert.equal(firstRows.length, 1, 'Learner must see exactly one own progress row');
assert.equal(firstRows[0].user_id, users[0].id, 'Learner must not see another identity');
assert.equal(firstRows[0].progress.xp, learners[0].xp);
assert.equal(firstRows[0].progress.rewardClaims.length, 19, 'All reward claim identifiers should persist');

const crossRead = await restRequest(
  `learning_progress?select=user_id,progress&user_id=eq.${users[1].id}`,
  firstSession.token,
);
assert.equal(crossRead.status, 200);
assert.deepEqual(await crossRead.json(), [], 'RLS must hide another learner\'s progress');

const crossWrite = await restRequest('learning_progress?on_conflict=user_id', firstSession.token, {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: {
    user_id: users[1].id,
    progress: { xp: 9999, rewardClaims: ['forged'] },
    updated_at: new Date().toISOString(),
  },
});
assert.ok([401, 403].includes(crossWrite.status), `Cross-user write must be denied, received ${crossWrite.status}`);

const secondRead = await restRequest(
  `learning_progress?select=user_id,progress&user_id=eq.${users[1].id}`,
  secondSession.token,
);
assert.equal(secondRead.status, 200);
const secondRows = await secondRead.json();
assert.equal(secondRows.length, 1);
assert.equal(secondRows[0].progress.xp, learners[1].xp, 'Rejected cross-user write must not alter the second learner');

const ownUpdate = await restRequest(
  `learning_progress?user_id=eq.${users[0].id}`,
  firstSession.token,
  {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: { progress: { xp: 225, rewardClaims: firstRows[0].progress.rewardClaims } },
  },
);
assert.equal(ownUpdate.status, 200, 'Learner should be able to update their own progress');
const refreshedSession = await signIn(learners[0].username);
const restoredRead = await restRequest(
  `learning_progress?select=user_id,progress&user_id=eq.${users[0].id}`,
  refreshedSession.token,
);
assert.equal(restoredRead.status, 200);
const restoredRows = await restoredRead.json();
assert.equal(restoredRows[0]?.progress?.xp, 225, 'Progress must persist across a new Auth session');
assert.equal(restoredRows[0]?.progress?.rewardClaims?.length, 19);

// The per-username bucket must throttle repeated guesses after five attempts.
const throttleUsername = `limit_${suffix}`;
for (let attempt = 1; attempt <= 6; attempt++) {
  const response = await callLogin(throttleUsername, password, { ip: `198.51.100.${attempt}` });
  assert.equal(response.status, attempt <= 5 ? 401 : 429, `Unexpected throttle response on attempt ${attempt}`);
}

console.log('Local username Auth HTTP, generic errors, CORS, request limits, RLS isolation, and progress persistence tests passed.');
