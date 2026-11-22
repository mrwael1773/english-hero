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

  function podium(host, rows, unit, emptyMessage, rankOffset = 0) {
    if (!Array.isArray(rows) || !rows.length) {
      empty(host, emptyMessage || 'لم تُسجّل نتائج لهذه البطولة بعد. ابدأ بالتعلّم وقد تكون أول الأبطال!');
      return;
    }
    const list = document.createElement('div');
    list.className = 'champion-podium';
    rows.slice(0, 3).forEach((row, index) => {
      const line = document.createElement('div');
      line.className = 'champion-podium-row';
      const rank = document.createElement('span');
      rank.className = 'champion-podium-rank';
      rank.textContent = rankIcons[index + rankOffset] || String(index + rankOffset + 1);
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
    const children = [name, score];
    if (rows.length > 1) {
      const list = document.createElement('div');
      podium(list, rows.slice(1), unit, undefined, 1);
      children.push(list);
    }
    host.replaceChildren(...children);
  }

  function validPayload(data) {
    if (!data || typeof data !== 'object') return false;
    return ['today_leaders','week_leaders','consistency_leaders']
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
      podium($('championsConsistency'), data.consistency_leaders, 'أيام مشاركة');
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

  function renderChallenge(data) {
    const host = $('championChallengeQuestions');
    if (!host || !Array.isArray(data?.questions) || data.questions.length !== 10 ||
        !data.questions.every(question => question && typeof question.prompt === 'string' &&
          Array.isArray(question.options) && question.options.length === 4 &&
          question.options.every(option => typeof option === 'string'))) {
      throw new Error('تعذر التحقق من أسئلة التحدي.');
    }
    const form = document.createElement('form');
    form.id = 'championChallengeForm';
    data.questions.forEach((question, index) => {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'champion-challenge-question';
      const legend = document.createElement('legend');
      legend.textContent = (index + 1) + '. ' + question.prompt;
      fieldset.append(legend);
      question.options.forEach((option, optionIndex) => {
        const label = document.createElement('label');
        label.className = 'champion-challenge-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'champion-question-' + index;
        radio.value = String(optionIndex);
        radio.required = true;
        const text = document.createElement('span');
        text.textContent = option;
        label.append(radio, text);
        fieldset.append(label);
      });
      form.append(fieldset);
    });
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn primary full champion-challenge-submit';
    submit.textContent = 'إرسال الإجابات وتصحيحها';
    form.append(submit);
    host.replaceChildren(form);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const answers = data.questions.map((_, index) => {
        const selected = form.querySelector('input[name="champion-question-' + index + '"]:checked');
        return selected ? Number(selected.value) : null;
      });
      if (answers.some(answer => !Number.isInteger(answer))) {
        if ($('championChallengeStatus')) $('championChallengeStatus').textContent = 'أجب عن الأسئلة العشرة قبل الإرسال.';
        return;
      }
      submit.disabled = true;
      const status = $('championChallengeStatus');
      if (status) status.textContent = 'جارٍ تصحيح الإجابات على الخادم...';
      try {
        const result = await window.EnglishHeroCloud.submitChampionChallenge(data.attempt_id, answers);
        if (result?.expired) {
          if (status) status.textContent = 'انتهت مدة المحاولة. ابدأ تحديًا جديدًا.';
          host.replaceChildren();
          return;
        }
        if (!result || !Number.isInteger(result.score) || result.total !== 10 || typeof result.passed !== 'boolean') {
          throw new Error('استجابة التصحيح غير صالحة.');
        }
        if (status) status.textContent = result.passed
          ? '🏆 نتيجة ' + result.score + '/10 — اجتزت التحدي. ' + (result.recorded ? 'سُجّل إتقان الدرس في البطولة.' : 'سبق تسجيل إتقان هذا الدرس.')
          : 'نتيجتك ' + result.score + '/10. تحتاج إلى ٨/١٠ على الأقل لتسجيل الإتقان. يمكنك التدريب والمحاولة لاحقًا.';
        host.replaceChildren();
        if (result.passed) load(true);
      } catch (error) {
        submit.disabled = false;
        if (status) status.textContent = error?.message || 'تعذر تصحيح التحدي. حاول مجددًا.';
      }
    });
  }

  async function startChampionChallenge() {
    const button = $('championChallengeStart');
    const status = $('championChallengeStatus');
    const host = $('championChallengeQuestions');
    if (!button || !status || !host) return;
    const lessonNumber = Number($('championChallengeLesson')?.value);
    if (!Number.isInteger(lessonNumber) || lessonNumber < 1 || lessonNumber > 84) {
      status.textContent = 'أدخل رقم درس من ١ إلى ٨٤.';
      return;
    }
    const cloud = window.EnglishHeroCloud;
    if (!cloud?.startChampionChallenge || !cloud?.submitChampionChallenge || !cloud.getUser?.()) {
      status.textContent = 'سجّل الدخول أولًا لبدء تحدي الأبطال.';
      return;
    }
    button.disabled = true;
    host.replaceChildren();
    status.textContent = 'جارٍ تجهيز أسئلة التحدي...';
    try {
      const data = await cloud.startChampionChallenge(lessonNumber - 1);
      if (typeof data?.attempt_id !== 'string') throw new Error('لم تصل بيانات المحاولة بصورة صحيحة.');
      renderChallenge(data);
      status.textContent = 'لديك ١٥ دقيقة للإجابة عن الأسئلة العشرة.';
    } catch (error) {
      status.textContent = error?.message || 'تعذر بدء التحدي. قد لا يكون بنك هذا الدرس جاهزًا بعد.';
    } finally {
      button.disabled = false;
    }
  }

  $('championsRefresh')?.addEventListener('click', () => load(true));
  $('championChallengeStart')?.addEventListener('click', startChampionChallenge);
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
