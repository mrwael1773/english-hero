const test = require('node:test');
const assert = require('node:assert/strict');
const mentor = require('../../mentor-progression.js');

const start = Date.parse('2026-01-01T12:00:00.000Z');
const at = offset => start + offset;

test('mentor protocol has the five required stages in order', () => {
  assert.deepEqual(mentor.ORDER, ['listen', 'meaning', 'recall', 'context', 'retention', 'mastered']);
  assert.equal(mentor.REQUIRED, 4);
  assert.equal(mentor.TOTAL, 5);
});

test('3/5 fails and leaves the learner in the same stage', () => {
  const result = mentor.evaluate(mentor.initial(), 3, at(0));
  assert.equal(result.passed, false);
  assert.equal(result.progress.stage, 'listen');
  assert.equal(result.progress.attempts.listen, 1);
});

test('4/5 passes and advances to the next stage', () => {
  const result = mentor.evaluate(mentor.initial(), 4, at(0));
  assert.equal(result.passed, true);
  assert.equal(result.progress.stage, 'meaning');
  assert.equal(result.progress.attempts.listen, 1);
});

test('48-hour recall is blocked one millisecond early and due exactly at the boundary', () => {
  const afterMeaning = mentor.evaluate({ stage: 'meaning' }, 4, at(0)).progress;
  assert.equal(afterMeaning.stage, 'recall');
  assert.equal(Date.parse(afterMeaning.due), at(48 * 60 * 60 * 1000));
  assert.equal(mentor.isDue(afterMeaning, at(48 * 60 * 60 * 1000 - 1)), false);
  assert.equal(mentor.isDue(afterMeaning, at(48 * 60 * 60 * 1000)), true);
  const blocked = mentor.evaluate(afterMeaning, 5, at(48 * 60 * 60 * 1000 - 1));
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.progress.stage, 'recall');
});

test('seven-day retention is blocked until the exact due timestamp', () => {
  const afterContext = mentor.evaluate({ stage: 'context' }, 4, at(0)).progress;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  assert.equal(afterContext.stage, 'retention');
  assert.equal(Date.parse(afterContext.due), at(sevenDays));
  assert.equal(mentor.isDue(afterContext, at(sevenDays - 1)), false);
  assert.equal(mentor.isDue(afterContext, at(sevenDays)), true);
});

test('successful retention is the only stage that marks mastery', () => {
  const result = mentor.evaluate({ stage: 'retention' }, 4, at(0));
  assert.equal(result.progress.stage, 'mastered');
  assert.equal(result.progress.due, '');
});

test('normalization keeps only bounded, valid progression history', () => {
  const history = Array.from({ length: 45 }, (_, i) => ({ stage: 'listen', score: i % 6, at: new Date(at(i)).toISOString() }));
  const normalized = mentor.normalize({ stage: 'not-a-stage', attempts: [], history, lastScore: 8 });
  assert.equal(normalized.stage, 'listen');
  assert.equal(normalized.history.length, 40);
  assert.equal(normalized.lastScore, null);
});
