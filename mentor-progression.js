/* Canonical mentor progression rules. Uses exact elapsed-time delays. */
(function (root) {
  'use strict';
  const ORDER = ['listen', 'meaning', 'recall', 'context', 'retention', 'mastered'];
  const REQUIRED = 4;
  const TOTAL = 5;
  const DELAYS = Object.freeze({ recall: 48 * 60 * 60 * 1000, retention: 7 * 24 * 60 * 60 * 1000 });
  function asTime(value) {
    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isFinite(time) ? time : null;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function initial() {
    return { stage: 'listen', due: '', attempts: {}, history: [], lastScore: null, updatedAt: '' };
  }
  function normalize(value) {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const stage = ORDER.includes(v.stage) ? v.stage : 'listen';
    const attempts = v.attempts && typeof v.attempts === 'object' && !Array.isArray(v.attempts) ? v.attempts : {};
    const history = Array.isArray(v.history) ? v.history.filter(x => x && typeof x === 'object').slice(-40) : [];
    return {
      ...v,
      stage,
      due: typeof v.due === 'string' ? v.due : '',
      attempts: { ...attempts },
      history,
      lastScore: Number.isInteger(v.lastScore) ? Math.max(0, Math.min(TOTAL, v.lastScore)) : null,
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : ''
    };
  }
  function isDue(progress, now = Date.now()) {
    const p = normalize(progress);
    if (!p.due) return true;
    const dueTime = asTime(p.due);
    const currentTime = asTime(now);
    // Fail closed: a malformed due timestamp must never unlock a delayed stage.
    return dueTime !== null && currentTime !== null && currentTime >= dueTime;
  }
  function evaluate(progress, correct, now = Date.now()) {
    const p = normalize(progress);
    const time = asTime(now);
    if (time === null || !isDue(p, time)) {
      return { progress: p, passed: false, blocked: true, required: REQUIRED, total: TOTAL, nextDue: p.due };
    }
    const rawScore = Number(correct);
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(TOTAL, Math.trunc(rawScore))) : 0;
    const stage = p.stage;
    p.lastScore = score;
    p.attempts[stage] = (Number(p.attempts[stage]) || 0) + 1;
    p.updatedAt = new Date(time).toISOString();
    const passed = score >= REQUIRED;
    p.history.push({ stage, score, total: TOTAL, passed, at: p.updatedAt });
    p.history = p.history.slice(-40);
    if (!passed) return { progress: p, passed: false, blocked: false, required: REQUIRED, total: TOTAL, nextDue: p.due };
    const next = { listen: 'meaning', meaning: 'recall', recall: 'context', context: 'retention', retention: 'mastered' }[stage] || stage;
    p.stage = next;
    p.due = next === 'recall' ? new Date(time + DELAYS.recall).toISOString()
      : next === 'retention' ? new Date(time + DELAYS.retention).toISOString()
      : '';
    return { progress: p, passed: true, blocked: false, required: REQUIRED, total: TOTAL, nextDue: p.due };
  }
  root.EnglishHeroMentorProgression = Object.freeze({ ORDER, REQUIRED, TOTAL, DELAYS, initial, normalize, isDue, evaluate });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.EnglishHeroMentorProgression;
})(typeof window !== 'undefined' ? window : globalThis);
