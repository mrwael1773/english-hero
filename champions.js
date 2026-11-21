/* English Hero student champions. Renders only sanitized aggregate fields from the authenticated RPC. */
(() => {
  'use strict';
  const root = document.getElementById('champions');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const rankIcons = ['🥇','🥈','🥉'];
  let loading = false;
  let loadedAt = 0;

  function empty(host, message) {
    const node = document.createElement('div');
    node.className = 'champion-empty';
    node.textContent = message;
    host.replaceChildren(node);
  }

  function podium(host, rows, unit) {
    if (!Array.isArray(rows) || !rows.length) {
      empty(host, 'لم تُسجّل نتائج لهذه البطولة بعد. ابدأ بالتعلّم وقد تكون أول الأبطال!');
      return;
    }
    const list = document.createElement('div');
    list.className = 'champion-podium';
    rows.slice(0, 3).forEach((row, index) => {
      const line = document.createElement('div');
      line.className = 'champion-podium-row';
      const rank = document.createElement('span');
      rank.className = 'champion-podium-rank';
      rank.textContent = rankIcons[index] || String(index + 1);
      const name = document.createElement('strong');
      name.className = 'champion-podium-name';
      name.dir = 'auto';
      name.textContent = String(row.display_name || 'طالب');
      const score = document.createElement('span');
      score.className = 'champion-podium-score';
      score.textContent = String(Number(row.score) || 0) + ' ' + unit;
      line.append(rank, name, score);
      list.append(line);
    });
    host.replaceChildren(list);
  }

  function feature(host, rows, unit, emptyMessage) {
    if (!Array.isArray(rows) || !rows.length) {
      empty(host, emptyMessage);
      return;
    }
    const winner = rows[0];
    const name = document.createElement('div');
    name.className = 'champion-winner';
    name.dir = 'auto';
    name.textContent = String(winner.display_name || 'طالب');
    const score = document.createElement('div');
    score.className = 'champion-score';
    score.textContent = String(Number(winner.score) || 0) + ' ' + unit;
    const list = document.createElement('div');
    podium(list, rows, unit);
    host.replaceChildren(name, score, list);
  }

  function validPayload(data) {
    if (!data || typeof data !== 'object') return false;
    return ['today_leaders','week_leaders','mastery_leaders','consistency_leaders','improvement_leaders']
      .every(key => Array.isArray(data[key]) && data[key].every(row =>
        row && typeof row.display_name === 'string' &&
        Number.isSafeInteger(row.score) && row.score >= 0
      ));
  }

  async function load(force = false) {
    if (loading || (!force && Date.now() - loadedAt < 45000)) return;
    loading = true;
    const status = $('championsStatus');
    if (status) status.textContent = 'جارٍ تحديث البطولات...';
    try {
      await (window.EnglishHeroCloudReady || Promise.resolve(false));
      const cloud = window.EnglishHeroCloud;
      if (!cloud || !cloud.getUser || !cloud.getStudentChampions) {
        if (status) status.textContent = 'خدمة المنافسة غير متاحة حاليًا.';
        return;
      }
      if (!cloud.getUser() || !cloud.isReady()) {
        if (status) status.textContent = 'سجّل الدخول لعرض منافسة جميع الطلاب.';
        return;
      }
      const data = await cloud.getStudentChampions();
      if (!validPayload(data)) throw new Error('Invalid champions response');
      feature($('championsToday'), data.today_leaders, 'درسًا جديدًا متقنًا',
        'لم يُتقن أي درس جديد اليوم حتى الآن. ابدأ رحلتك!');
      feature($('championsWeek'), data.week_leaders, 'درسًا جديدًا متقنًا',
        'بطولة الأسبوع بدأت للتو. الفرصة متاحة للجميع!');
      podium($('championsMastery'), data.mastery_leaders, 'درسًا متقنًا');
      podium($('championsConsistency'), data.consistency_leaders, 'أيام نشاط');
      podium($('championsImprovement'), data.improvement_leaders, 'درسًا صافيًا فوق الفترة السابقة');
      podium($('championsImprovement'), data.improvement_leaders, 'درسًا إضافيًا');
      if (status) {
        const stamp = data.generated_at ? new Date(data.generated_at) : new Date();
        status.textContent = 'آخر تحديث: ' + stamp.toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }) + ' · الأسبوع من الأحد إلى السبت';
      }
      loadedAt = Date.now();
    } catch (error) {
      console.warn('English Hero champions:', error?.message || error);
      if (status) status.textContent = 'تعذر تحميل النتائج الآن. حاول التحديث بعد قليل.';
    } finally {
      loading = false;
    }
  }

  $('championsRefresh')?.addEventListener('click', () => load(true));
  const observer = new MutationObserver(() => {
    if (root.classList.contains('active')) load();
  });
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  document.querySelectorAll('[data-page="champions"]').forEach(button =>
    button.addEventListener('click', () => setTimeout(() => load(true), 0))
  );
  window.addEventListener('pageshow', () => {
    if (root.classList.contains('active')) load(true);
  });
})();
