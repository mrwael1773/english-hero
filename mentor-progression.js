/* Mentor-guided lesson progression. Pure functions; dates use local calendar days. */
(function (root) {
  'use strict';
  const ORDER = ['listen', 'recall', 'recall_retest', 'context', 'retention', 'mastered'];
  const REQUIRED = 4;
  const TOTAL = 5;
  function localDate(value) {
    const d = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }
  function addDays(date, count) {
    const d = new Date(String(date || localDate()).slice(0, 10) + 'T12:00:00');
    d.setDate(d.getDate() + count);
    return localDate(d);
  }
  function initial() { return { stage: 'listen', due: '', attempts: {}, lastScore: null, updatedAt: '' }; }
  function normalize(value) {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const stage = ORDER.includes(v.stage) ? v.stage : 'listen';
    const attempts = v.attempts && typeof v.attempts === 'object' && !Array.isArray(v.attempts) ? v.attempts : {};
    return { stage, due: typeof v.due === 'string' ? v.due : '', attempts, lastScore: Number.isFinite(v.lastScore) ? v.lastScore : null, updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : '' };
  }
  function isDue(progress, today) { const p = normalize(progress); return !p.due || p.due <= String(today || localDate()); }
  function evaluate(progress, score, today) {
    const p = normalize(progress);
    const day = String(today || localDate());
    const numeric = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    p.lastScore = numeric;
    p.attempts[p.stage] = (Number(p.attempts[p.stage]) || 0) + 1;
    p.updatedAt = new Date().toISOString();
    if (numeric < REQUIRED / TOTAL * 100) return { progress: p, passed: false, required: REQUIRED, total: TOTAL, nextDue: p.due };
    const next = { listen: 'recall', recall: 'recall_retest', recall_retest: 'context', context: 'retention', retention: 'mastered' }[p.stage];
    p.stage = next || p.stage;
    p.due = next === 'recall_retest' ? addDays(day, 2) : next === 'retention' ? addDays(day, 7) : '';
    return { progress: p, passed: true, required: REQUIRED, total: TOTAL, nextDue: p.due };
  }
  root.EnglishHeroMentorProgression = Object.freeze({ ORDER, REQUIRED, TOTAL, localDate, addDays, initial, normalize, isDue, evaluate });
})(window);
