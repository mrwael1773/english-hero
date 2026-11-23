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

const endpoint = `${API_URL}/functions/v1/student-champion-challenge`;
const suffix = Date.now().toString(36);
const password = `Local-Champion-${suffix}-Pass!`;
const learners = [
  { email: `champion-a-${suffix}@example.test`, username: `champion_a_${suffix}`, displayName: 'Local Champion Learner A' },
  { email: `champion-b-${suffix}@example.test`, username: `champion_b_${suffix}`, displayName: 'Local Champion Learner B' },
];
const users = [];

function psql(sql, variables = []) {
  return execFileSync('psql', [
    DB_URL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...variables, '-c', sql,
  ], { encoding: 'utf8' }).trim();
}

async function createLocalAuthUser(learner) {
  const response = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: learner.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: learner.displayName },
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Local Auth user creation failed: ${JSON.stringify(body)}`);
  const id = body.id || body.user?.id;
  assert.match(id || '', /^[0-9a-f-]{36}$/i, 'Local Auth did not return a user UUID');
  return { id, email: learner.email };
}

async function signIn(learner) {
  const response = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: learner.email, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Synthetic learner sign-in failed: ${JSON.stringify(body)}`);
  assert.ok(body.access_token, 'Local Auth must return an access token');
  return body.access_token;
}

async function challengeRequest(token, body, origin = ALLOWED_ORIGIN) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Origin: origin,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function deleteLocalAuthUser(user) {
  if (!user?.id) return;
  const response = await fetch(`${API_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  assert.ok([200, 204].includes(response.status), `Local synthetic user cleanup failed: HTTP ${response.status}`);
}

// The local migration reset intentionally contains no private production question bank.
// Seed a disposable, deterministic lesson bank in this ephemeral CI database only.
const bankSql = Array.from({ length: 10 }, (_, index) => {
  const prompt = `E2E champion ${suffix} question ${index + 1}`;
  const options = JSON.stringify([
    `Correct answer ${index + 1}`,
    `Distractor A ${index + 1}`,
    `Distractor B ${index + 1}`,
    `Distractor C ${index + 1}`,
  ]).replaceAll("'", "''");
  return `(0, '${prompt}', '${options}'::jsonb, 0, true)`;
}).join(',\n');

try {
  psql(`
    INSERT INTO public.student_champion_question_bank
      (lesson_index, prompt, options, correct_option, active)
    VALUES ${bankSql};
  `);

  // Check the HTTP boundary before provisioning disposable Auth identities.
  const preflight = await fetch(endpoint, {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,apikey,content-type',
    },
  });
  assert.equal(preflight.status, 200, 'Allowed CORS preflight must succeed');

  const blockedOrigin = await challengeRequest(null, { action: 'start', lesson_index: 0 }, 'https://untrusted.example');
  assert.equal(blockedOrigin.status, 403, 'Untrusted origins must be rejected');

  const missingAuth = await challengeRequest(null, { action: 'start', lesson_index: 0 });
  assert.equal(missingAuth.status, 401, 'Requests without a bearer token must be rejected');

  for (const learner of learners) users.push(await createLocalAuthUser(learner));

  const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
  psql(`
    INSERT INTO public.student_profiles(user_id, username, display_name)
    VALUES
      ('${users[0].id}'::uuid, ${sqlLiteral(learners[0].username)}, ${sqlLiteral(learners[0].displayName)}),
      ('${users[1].id}'::uuid, ${sqlLiteral(learners[1].username)}, ${sqlLiteral(learners[1].displayName)});
  `);

  const [tokenA, tokenB] = await Promise.all(learners.map(signIn));

  const invalidLesson = await challengeRequest(tokenA, { action: 'start', lesson_index: 84 });
  assert.equal(invalidLesson.status, 400, 'Out-of-range lesson indices must be rejected');

  const started = await challengeRequest(tokenA, { action: 'start', lesson_index: 0 });
  const challenge = await started.json();
  assert.equal(started.status, 200, `A valid challenge should start: ${JSON.stringify(challenge)}`);
  assert.equal(challenge.lesson_index, 0);
  assert.match(challenge.attempt_id || '', /^[0-9a-f-]{36}$/i);
  assert.equal(challenge.questions?.length, 10, 'A challenge must contain exactly ten questions');

  const bankRows = JSON.parse(psql(`
    SELECT COALESCE(json_agg(json_build_object(
      'prompt', prompt, 'options', options, 'correct_option', correct_option
    ) ORDER BY prompt), '[]'::json)::text
    FROM public.student_champion_question_bank
    WHERE lesson_index = 0 AND prompt LIKE 'E2E champion ${suffix} %';
  `));
  const bankByPrompt = new Map(bankRows.map((row) => [row.prompt, row]));

  const answers = challenge.questions.map((question, index) => {
    assert.deepEqual(Object.keys(question).sort(), ['options', 'prompt'], 'Question payload must expose only prompt and shuffled options');
    const bankRow = bankByPrompt.get(question.prompt);
    assert.ok(bankRow, 'Every returned question must originate from the seeded lesson bank');
    const correctText = bankRow.options[bankRow.correct_option];
    const correctIndex = question.options.indexOf(correctText);
    assert.notEqual(correctIndex, -1, 'The correct option must be present after option shuffling');
    return index < 8 ? correctIndex : (correctIndex + 1) % 4;
  });

  const exposed = JSON.stringify(challenge);
  for (const forbidden of ['correct_option', 'answer_key', 'question_bank', 'question_id']) {
    assert.ok(!exposed.includes(forbidden), `Challenge response leaked forbidden field marker: ${forbidden}`);
  }

  const crossAccountSubmit = await challengeRequest(tokenB, {
    action: 'submit', attempt_id: challenge.attempt_id, answers,
  });
  assert.equal(crossAccountSubmit.status, 404, 'A different learner must not submit another learner\'s attempt');

  const submitted = await challengeRequest(tokenA, {
    action: 'submit', attempt_id: challenge.attempt_id, answers,
  });
  const result = await submitted.json();
  assert.equal(submitted.status, 200, `A valid challenge submission should succeed: ${JSON.stringify(result)}`);
  assert.equal(result.score, 8, 'The server must calculate the score from its private answer key');
  assert.equal(result.total, 10);
  assert.equal(result.passed, true, 'Eight of ten answers must meet the mastery threshold');
  assert.equal(result.recorded, true, 'A passing challenge must create a mastery event');

  const replay = await challengeRequest(tokenA, {
    action: 'submit', attempt_id: challenge.attempt_id, answers,
  });
  assert.equal(replay.status, 409, 'A submitted challenge must not be reusable');

  const masteryCount = Number(psql(`
    SELECT count(*) FROM public.student_mastery_events
    WHERE user_id = '${users[0].id}'::uuid AND lesson_index = 0;
  `));
  assert.equal(masteryCount, 1, 'A passing challenge must create exactly one mastery event');

  const expiredStarted = await challengeRequest(tokenA, { action: 'start', lesson_index: 0 });
  const expiredChallenge = await expiredStarted.json();
  assert.equal(expiredStarted.status, 200, 'A second challenge should start for expiry testing');
  assert.match(expiredChallenge.attempt_id || '', /^[0-9a-f-]{36}$/i);

  const expiredAnswers = expiredChallenge.questions.map((question) => {
    const bankRow = bankByPrompt.get(question.prompt);
    assert.ok(bankRow, 'Expired challenge questions must still come from the seeded bank');
    const correctText = bankRow.options[bankRow.correct_option];
    const correctIndex = question.options.indexOf(correctText);
    assert.notEqual(correctIndex, -1, 'The correct option must be present in the expired challenge');
    return correctIndex;
  });

  const expiredRows = Number(psql(`
    WITH updated AS (
      UPDATE public.student_champion_attempts
      SET expires_at = now() - interval '1 second'
      WHERE id = '${expiredChallenge.attempt_id}'::uuid
        AND user_id = '${users[0].id}'::uuid
        AND submitted_at IS NULL
      RETURNING 1
    )
    SELECT count(*) FROM updated;
  `));
  assert.equal(expiredRows, 1, 'The test must expire exactly its own unsubmitted attempt');

  const expiredSubmission = await challengeRequest(tokenA, {
    action: 'submit', attempt_id: expiredChallenge.attempt_id, answers: expiredAnswers,
  });
  const expiredResult = await expiredSubmission.json();
  assert.equal(expiredSubmission.status, 200, 'An expired challenge should return a handled expiry result');
  assert.equal(expiredResult.expired, true, 'The server must identify an expired challenge');
  assert.equal(expiredResult.score, 0);
  assert.equal(expiredResult.passed, false);
  assert.equal(expiredResult.recorded, false);

  const expiredReplay = await challengeRequest(tokenA, {
    action: 'submit', attempt_id: expiredChallenge.attempt_id, answers: expiredAnswers,
  });
  assert.equal(expiredReplay.status, 409, 'An expired challenge must also be non-reusable');

  const masteryAfterExpiry = Number(psql(`
    SELECT count(*) FROM public.student_mastery_events
    WHERE user_id = '${users[0].id}'::uuid AND lesson_index = 0;
  `));
  assert.equal(masteryAfterExpiry, 1, 'An expired challenge must not create another mastery event');

  const leaderboardResponse = await fetch(`${API_URL}/rest/v1/rpc/get_student_champions`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(leaderboardResponse.status, 200, 'An authenticated learner must be able to read champion aggregates');
  const leaderboard = await leaderboardResponse.json();
  const leaderboardText = JSON.stringify(leaderboard);
  assert.ok(leaderboardText.includes(learners[0].displayName), 'The leaderboard must show the student-selected display name');
  for (const privateField of ['user_id', 'username', 'email']) {
    assert.ok(!leaderboardText.includes(privateField), `Leaderboard response leaked private identity field: ${privateField}`);
  }

  const anonymousLeaderboard = await fetch(`${API_URL}/rest/v1/rpc/get_student_champions`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.ok([401, 403].includes(anonymousLeaderboard.status), 'Anonymous clients must not read the champion leaderboard');

  console.log('Local champion challenge HTTP integration passed: CORS, auth, lesson validation, private answer keys, scoring, mastery recording, ownership isolation, replay protection, and aggregate-only leaderboard access.');
} finally {
  for (const user of users) await deleteLocalAuthUser(user);
  psql(`
    DELETE FROM public.student_champion_question_bank
    WHERE prompt LIKE 'E2E champion ${suffix} %';
  `);
}
