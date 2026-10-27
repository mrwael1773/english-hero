/* English Hero expansion: progressive levels, prizes, timed exams, richer grammar and preferences. No AI services. */
'use strict';
(function () {
  const $ = id => document.getElementById(id);
  let examTimer = null;
  let examSeconds = 0;
  let activeExam = false;
  const rewards = [
    {level:2, emoji:'🧭', title:'شارة المستكشف', detail:'وصلت إلى المستوى الثاني'},
    {level:3, emoji:'📘', title:'إطار المتعلّم', detail:'واصل بناء أساسك'},
    {level:4, emoji:'⚡', title:'لقب المجتهد', detail:'أصبحت أكثر التزامًا'},
    {level:5, emoji:'🎯', title:'شارة الدقّة', detail:'تقدّم ثابت في التعلّم'},
    {level:6, emoji:'🚀', title:'لقب المتقدّم', detail:'تحديات أصعب بانتظارك'},
    {level:8, emoji:'💠', title:'شارة المثابرة', detail:'إنجاز يستحق الفخر'},
    {level:10, emoji:'🏅', title:'وسام الخبير', detail:'بلغت مرحلة متقدمة'},
    {level:12, emoji:'🌟', title:'لقب النجم', detail:'استمر في رفع مستواك'},
    {level:15, emoji:'🛡️', title:'درع الإتقان', detail:'تقدّم قوي في الرحلة'},
    {level:20, emoji:'💎', title:'وسام الماس', detail:'إنجاز نادر'},
    {level:25, emoji:'👑', title:'تاج البطل', detail:'مستوى استثنائي'},
    {level:30, emoji:'🏆', title:'كأس الطلاقة', detail:'واصل التعلّم والممارسة'},
    {level:40, emoji:'🔥', title:'أسطورة التعلّم', detail:'مستوى نخبة المتعلمين'},
    {level:50, emoji:'🌌', title:'بطل English Hero', detail:'أعلى مستوى في الرحلة'}
  ];
  const levelStart = level => {
    const n = Math.max(1, Math.floor(Number(level) || 1)) - 1;
    return 100 * n + 25 * n * Math.max(0, n - 1);
  };
  const levelInfo = xpValue => {
    const xp = Math.max(0, Math.floor(Number(xpValue) || 0));
    let level = 1;
    while (level < 50 && xp >= levelStart(level + 1)) level++;
    const start = levelStart(level);
    const next = level >= 50 ? start : levelStart(level + 1);
    return {level, xp, start, next, progress: level >= 50 ? 100 : Math.max(0, Math.min(100, (xp - start) / Math.max(1, next - start) * 100)), into: xp - start, needed: Math.max(0, next - xp)};
  };
  const safeState = () => typeof state !== 'undefined' && state && typeof state === 'object';
  const ensureState = () => {
    if (!safeState()) return;
    if (!Number.isFinite(Number(state.xp)) || Number(state.xp) < 0) state.xp = 0;
    state.xp = Math.floor(Number(state.xp));
    if (!Array.isArray(state.quizHistory)) state.quizHistory = [];
  };
  const addStyles = () => {
    if ($('ehExpansionStyles')) return;
    const style = document.createElement('style');
    style.id = 'ehExpansionStyles';
    style.textContent = `
      .eh-rewards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}
      .eh-reward{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--stroke);border-radius:14px;background:var(--surface2);min-width:0}
      .eh-reward.locked{opacity:.58}.eh-reward-icon{font-size:25px;flex:0 0 auto}
      .eh-reward b{display:block;font-size:13px}.eh-reward small{display:block;color:var(--muted);font-size:11px;line-height:1.5;margin-top:3px}
      .eh-exam-clock{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--stroke);border-radius:12px;background:var(--surface2);font-weight:900;font-variant-numeric:tabular-nums}
      .eh-exam-clock.urgent{color:var(--red);border-color:var(--red)}
      .eh-grammar-detail{grid-column:1/-1;line-height:1.85;background:var(--surface2);border:1px solid var(--stroke);border-radius:14px;padding:14px;margin-top:8px}
      .eh-grammar-detail[hidden]{display:none}.eh-example{direction:ltr;text-align:left;border-left:3px solid var(--a);padding:8px 12px;margin:8px 0;background:var(--surface);border-radius:8px}
      .eh-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}
      .eh-setting{padding:12px;border:1px solid var(--stroke);border-radius:13px;background:var(--surface2);display:grid;gap:8px}
      .eh-setting label{font-weight:800;font-size:13px}.eh-setting .field{width:100%}
      .eh-report-note{grid-column:1/-1;padding:13px;border-radius:13px;background:var(--surface2);color:var(--muted);line-height:1.8;font-size:13px}
      @media(max-width:460px){.eh-rewards,.eh-settings-grid{grid-template-columns:1fr}.eh-reward{padding:10px}}
      @media(prefers-reduced-motion:reduce){.eh-reward,.eh-grammar-detail{animation:none!important;transition:none!important}}
    `;
    document.head.append(style);
  };
  const renderRewards = () => {
    if (!safeState()) return;
    const info = levelInfo(state.xp);
    let panel = $('levelRewardsPanel');
    if (!panel) {
      const progress = $('levelProgressBar');
      const host = progress && progress.closest('.panel');
      if (!host) return;
      panel = document.createElement('div');
      panel.id = 'levelRewardsPanel';
      panel.className = 'section';
      const heading = document.createElement('h3');
      heading.textContent = '🎁 جوائز المستويات';
      const summary = document.createElement('p');
      summary.id = 'levelRewardSummary';
      summary.className = 'muted small';
      const grid = document.createElement('div');
      grid.id = 'levelRewardsGrid';
      grid.className = 'eh-rewards';
      panel.append(heading, summary, grid);
      host.append(panel);
    }
    const summary = $('levelRewardSummary');
    if (summary) summary.textContent = info.level >= 50 ? 'وصلت إلى أعلى مستوى! كل الجوائز مفتوحة.' : 'الجائزة التالية عند المستوى ' + (info.level + 1) + '، وتحتاج إلى ' + info.needed + ' XP. الجوائز رمزية داخل الموقع ولا تمنح نقاطًا إضافية.';
    const grid = $('levelRewardsGrid');
    if (!grid) return;
    grid.replaceChildren(...rewards.map(reward => {
      const unlocked = info.level >= reward.level;
      const card = document.createElement('div');
      card.className = 'eh-reward' + (unlocked ? '' : ' locked');
      const icon = document.createElement('span'); icon.className = 'eh-reward-icon'; icon.textContent = unlocked ? reward.emoji : '🔒';
      const copy = document.createElement('div');
      const title = document.createElement('b'); title.textContent = 'مستوى ' + reward.level + ': ' + reward.title;
      const detail = document.createElement('small'); detail.textContent = unlocked ? '✓ تم فتح الجائزة — ' + reward.detail : 'تُفتح عند الوصول إلى ' + reward.levelStart;
      if (!unlocked) detail.textContent = 'تُفتح عند الوصول إلى المستوى ' + reward.level;
      copy.append(title, detail); card.append(icon, copy); return card;
    }));
  };
  const renderLevel = () => {
    if (!safeState()) return;
    const info = levelInfo(state.xp);
    const names = ['مبتدئ','مستكشف','متعلّم نشيط','متدرّب','متقدّم','خبير','بطل الإنجليزية'];
    const title = names[Math.min(names.length - 1, Math.floor((info.level - 1) / 7))];
    if ($('levelTitle')) $('levelTitle').textContent = 'المستوى ' + info.level + ' • ' + title;
    if ($('levelProgressText')) $('levelProgressText').textContent = info.level >= 50 ? 'وصلت إلى أعلى مستوى • ' + info.xp + ' XP' : info.into + ' / ' + (info.next - info.start) + ' XP للمستوى التالي';
    if ($('levelProgressBar')) $('levelProgressBar').style.width = info.progress + '%';
    if ($('levelIcon')) $('levelIcon').textContent = info.level >= 40 ? '🌌' : info.level >= 25 ? '👑' : info.level >= 15 ? '🛡️' : info.level >= 10 ? '🏅' : info.level >= 6 ? '🚀' : info.level >= 3 ? '📘' : '🌱';
    if ($('pathLevel')) $('pathLevel').textContent = 'المستوى ' + info.level + ' • ' + info.xp + ' XP';
    if ($('pathSummary') && typeof lessons !== 'undefined') $('pathSummary').textContent = 'أكملت ' + state.completed.length + ' من ' + lessons.length + ' درسًا. كل مستوى يتطلب XP أكثر من السابق، وتُفتح جوائز رمزية عند مستويات محددة.';
    if ($('pathProgress')) $('pathProgress').style.width = info.progress + '%';
    renderRewards();
  };
  const renderProfessionalReport = () => {
    if (!safeState()) return;
    const report = $('progressReport');
    if (report) {
      const history = Array.isArray(state.quizHistory) ? state.quizHistory : [];
      const count = history.reduce((n, q) => n + Math.max(0, Number(q.total) || 0), 0);
      const correct = history.reduce((n, q) => n + Math.max(0, Number(q.correct) || 0), 0);
      const average = history.length ? Math.round(history.reduce((n, q) => n + Math.max(0, Math.min(100, Number(q.score) || 0)), 0) / history.length) : 0;
      const data = [
        ['📝','اختبارات مسجلة',history.length],
        ['🎯','متوسط نتائج الاختبارات',history.length ? average + '%' : '—'],
        ['✅','إجابات صحيحة مسجلة',correct + ' / ' + count],
        ['📚','الدروس المكتملة',state.completed.length + (typeof lessons !== 'undefined' ? ' / ' + lessons.length : '')],
        ['⚡','نقاط الخبرة',state.xp],
        ['🧠','أخطاء تحتاج مراجعة',Object.keys(state.misses || {}).length]
      ];
      report.replaceChildren(...data.map(([emoji,label,value]) => {
        const card = document.createElement('div'); card.className = 'stat';
        const small = document.createElement('span'); small.className = 'small muted'; small.textContent = emoji + ' ' + label;
        const big = document.createElement('b'); big.textContent = String(value); card.append(small,big); return card;
      }));
    }
    if ($('reportTip')) {
      const history = Array.isArray(state.quizHistory) ? state.quizHistory : [];
      const avg = history.length ? Math.round(history.reduce((n,q)=>n+(Number(q.score)||0),0)/history.length) : 0;
      $('reportTip').textContent = !history.length ? 'نصيحة: أكمل اختبارًا لتبدأ بناء تقريرك. راجع أخطاءك بعد كل اختبار، ولا تعتمد على الدرجة وحدها.' : avg >= 85 ? 'أداء رائع! ارفع التحدي بمراجعة الأخطاء القديمة والتدرّب على القواعد الأصعب.' : 'خطوتك القادمة: راجع الأسئلة الخاطئة ثم أعد الاختبار بعد التعلّم. متوسط نتائجك المسجّلة ' + avg + '%.';
    }
  };
  const grammarLessons = [
    ['ضمائر الفاعل','I, you, he, she, it, we, they','نستخدم الضمير قبل الفعل غالبًا لتحديد من يقوم بالفعل.','I play football.','She reads a book.','مع he / she / it نضيف غالبًا s للفعل في المضارع البسيط.'],
    ['فعل be','am / is / are','نستخدم am مع I، وis مع he/she/it، وare مع you/we/they.','I am a student.','They are happy.','لا نضع am/is/are قبل فعل عادي في المضارع البسيط.'],
    ['المضارع البسيط','Subject + base verb','للعادات والحقائق. مع he/she/it نضيف s أو es غالبًا.','I study every day.','He goes to school.','كلمات مثل always وusually وevery day تدل كثيرًا على العادات.'],
    ['المضارع المستمر','am / is / are + verb-ing','لحدث يجري الآن أو حول الوقت الحالي.','I am learning English.','They are playing now.','لا تنسَ فعل be قبل الفعل المنتهي بـ ing.'],
    ['الماضي البسيط','verb-ed أو التصريف الثاني','لحدث انتهى في الماضي، مع أفعال منتظمة وغير منتظمة.','I watched a film yesterday.','She went to school.','في النفي والسؤال نستخدم did ثم الفعل الأساسي.'],
    ['المستقبل','will / be going to','will للتوقع أو القرار، وgoing to للخطة أو النية.','I will help you.','I am going to study.','بعد will نستخدم الفعل الأساسي دون to.'],
    ['أدوات السؤال','what, where, when, why, who, how','تساعدك على السؤال عن الشيء والمكان والوقت والسبب والشخص والطريقة.','Where do you live?','What is your name?','انتبه لترتيب الفعل المساعد والفاعل في السؤال.'],
    ['حروف الجر','in, on, at, under, next to','توضح الوقت أو المكان والعلاقة بين الأشياء.','I wake up at six.','The book is on the table.','احفظ التعبير كاملًا مع المثال، فالاستخدام يعتمد على السياق.'],
    ['المقارنة','-er / more … than','نستخدم صيغة المقارنة عند مقارنة شخصين أو شيئين.','Ali is taller than Omar.','English is more interesting than I thought.','الصفات الطويلة غالبًا تستخدم more، والقصيرة غالبًا تضيف er.'],
    ['الأفعال الناقصة','can, should, must','تأتي بعدها صيغة الفعل الأساسية.','I can swim.','You should practise.','لا تضف s للفعل بعد can أو should أو must.']
  ];
  const renderGrammarAcademy = () => {
    const host = $('grammarLibrary');
    if (!host || $('grammarAcademy')) return;
    const section = document.createElement('section'); section.id = 'grammarAcademy'; section.className = 'section';
    const title = document.createElement('h2'); title.textContent = '🎓 أكاديمية القواعد — تعلّم بالتدرّج';
    const intro = document.createElement('p'); intro.className = 'muted'; intro.textContent = 'افتح درسًا، اقرأ الشرح والأمثلة، ثم اختبر فهمك. ابدأ بالأساسيات قبل الانتقال إلى القواعد الأصعب.';
    const grid = document.createElement('div'); grid.className = 'grid'; grid.id = 'grammarAcademyGrid';
    section.append(title,intro,grid); host.parentElement.append(section);
    grid.replaceChildren(...grammarLessons.map((lesson,index) => {
      const card = document.createElement('article'); card.className = 'tile';
      const heading = document.createElement('h3'); heading.textContent = (index+1) + '. ' + lesson[0];
      const desc = document.createElement('p'); desc.textContent = lesson[2];
      const button = document.createElement('button'); button.type='button'; button.className='btn outline full'; button.textContent='افتح الدرس';
      const detail = document.createElement('div'); detail.className='eh-grammar-detail'; detail.hidden=true;
      const formula = document.createElement('p'); formula.innerHTML='<b>القاعدة:</b> ';
      const formulaText = document.createElement('span'); formulaText.textContent=lesson[1]; formula.append(formulaText);
      const ex1 = document.createElement('div'); ex1.className='eh-example'; ex1.textContent=lesson[3];
      const ex2 = document.createElement('div'); ex2.className='eh-example'; ex2.textContent=lesson[4];
      const tip = document.createElement('p'); tip.textContent='💡 '+lesson[5];
      const quizButton = document.createElement('button'); quizButton.type='button'; quizButton.className='btn primary'; quizButton.textContent='اختبر فهمك';
      quizButton.addEventListener('click',()=>{if(typeof page==='function')page('training');if(typeof startQuiz==='function')startQuiz('grammar');});
      detail.append(formula,ex1,ex2,tip,quizButton); button.addEventListener('click',()=>{detail.hidden=!detail.hidden;button.textContent=detail.hidden?'افتح الدرس':'إخفاء الدرس';});
      card.append(heading,desc,button,detail); return card;
    }));
  };
  const addExam = () => {
    const root = $('trainingModes');
    if (!root || $('professionalExamButton')) return;
    const card = document.createElement('button'); card.type='button'; card.id='professionalExamButton'; card.className='tile'; card.style.textAlign='right';
    card.innerHTML='<div class="emoji">⏱️</div><h3>الاختبار الاحترافي الموقّت</h3><p>٢٠ سؤالًا متنوعًا في القواعد والمفردات، بوقت محدد وسجل نتيجة.</p><span class="tag gold">١٢ دقيقة • ٢٠ سؤالًا</span>';
    card.addEventListener('click',()=>{if(typeof startQuiz==='function')startQuiz('pro');});
    root.append(card);
  };
  const addCustomization = () => {
    if ($('ehCustomization')) return;
    const exportButton = $('exportData');
    if (!exportButton || !exportButton.parentElement) return;
    const panel = document.createElement('div'); panel.id='ehCustomization'; panel.className='section';
    const title = document.createElement('h3'); title.textContent='🎨 تخصيص تجربة التعلّم';
    const note = document.createElement('p'); note.className='muted small'; note.textContent='تُحفظ هذه الخيارات على جهازك مع بقية إعدادات الموقع.';
    const grid = document.createElement('div'); grid.className='eh-settings-grid';
    const sizeWrap = document.createElement('div'); sizeWrap.className='eh-setting';
    const sizeLabel = document.createElement('label'); sizeLabel.htmlFor='ehFontScale'; sizeLabel.textContent='حجم الخط';
    const size = document.createElement('select'); size.id='ehFontScale'; size.className='field';
    [['14','صغير'],['16','متوسط'],['18','كبير']].forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;size.append(o);});
    size.value=String([14,16,18].includes(Number(state.fontScale))?Number(state.fontScale):16);
    size.addEventListener('change',()=>{state.fontScale=Number(size.value);applyPreferences();save();});
    sizeWrap.append(sizeLabel,size);
    const motionWrap=document.createElement('div');motionWrap.className='eh-setting';
    const motionLabel=document.createElement('label');motionLabel.htmlFor='ehReduceMotion';motionLabel.textContent='تقليل الحركة والمؤثرات';
    const motion=document.createElement('input');motion.type='checkbox';motion.id='ehReduceMotion';motion.checked=Boolean(state.reduceMotion);motion.style.cssText='width:22px;height:22px;accent-color:#7868e8';
    motion.addEventListener('change',()=>{state.reduceMotion=motion.checked;applyPreferences();save();});
    motionWrap.append(motionLabel,motion);grid.append(sizeWrap,motionWrap);panel.append(title,note,grid);
    exportButton.parentElement.parentElement.insertBefore(panel,exportButton.parentElement);
  };
  const applyPreferences = () => {
    if (!safeState()) return;
    const scale=[14,16,18].includes(Number(state.fontScale))?Number(state.fontScale):16;
    document.documentElement.style.fontSize=scale+'px';
    document.documentElement.classList.toggle('eh-reduce-motion',Boolean(state.reduceMotion));
    let style=$('ehMotionOverride');
    if (state.reduceMotion && !style) {style=document.createElement('style');style.id='ehMotionOverride';style.textContent='*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}';document.head.append(style);}
    if (!state.reduceMotion && style) style.remove();
    const size=$('ehFontScale');if(size)size.value=String(scale);
    const motion=$('ehReduceMotion');if(motion)motion.checked=Boolean(state.reduceMotion);
  };
  const wrap = (name, wrapper) => {
    if (typeof window[name] === 'function') window[name] = wrapper(window[name]);
  };
  const installHooks = () => {
    wrap('gain', original => function (amount) {
      ensureState();
      const before = levelInfo(state.xp).level;
      const result = original(amount);
      const after = levelInfo(state.xp).level;
      if (after > before && typeof toast === 'function') {
        const prize = [...rewards].reverse().find(item => item.level <= after && item.level > before);
        toast('🎉 ارتقيت إلى المستوى ' + after + (prize ? ' — جائزتك: ' + prize.emoji + ' ' + prize.title : ' — واصل التقدّم!'));
      }
      if (typeof renderProfile === 'function' && $('profile')?.classList.contains('active')) renderProfile();
      if (typeof renderInsights === 'function') renderInsights();
      return result;
    });
    wrap('renderProfile', original => function () { const result=original(); renderLevel(); renderProfessionalReport(); return result; });
    wrap('renderInsights', original => function () { const result=original(); renderLevel(); renderProfessionalReport(); return result; });
    wrap('renderScenarioList', original => function () { const result=original(); return result; });
    wrap('startQuiz', original => function (mode, pool) {
      if (mode !== 'pro') return original(mode,pool);
      activeExam = true; examSeconds = 12 * 60;
      original('weekly',pool);
      if (typeof quiz !== 'undefined' && quiz) quiz.mode='pro';
      const heading=$('quizHeading');if(heading)heading.textContent='⏱️ الاختبار الاحترافي';
      let clock=$('professionalExamClock');
      if(!clock){clock=document.createElement('span');clock.id='professionalExamClock';clock.className='eh-exam-clock';const counter=$('quizCounter');if(counter)counter.parentElement.insertBefore(clock,counter);else $('quizArea')?.prepend(clock);}
      const tick=()=>{if(!activeExam||!clock.isConnected)return;const m=Math.floor(examSeconds/60),sec=examSeconds%60;clock.textContent='الوقت المتبقي '+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');clock.classList.toggle('urgent',examSeconds<=60);if(examSeconds<=0){activeExam=false;if(examTimer)clearInterval(examTimer);examTimer=null;if(typeof finishQuiz==='function')finishQuiz();return;}examSeconds--;};
      if(examTimer)clearInterval(examTimer);tick();examTimer=setInterval(tick,1000);
    });
    wrap('finishQuiz', original => function () {
      const wasExam = activeExam || (typeof quiz !== 'undefined' && quiz && quiz.mode === 'pro');
      if (examTimer) clearInterval(examTimer); examTimer=null; activeExam=false;
      if (!wasExam || typeof quiz === 'undefined' || !quiz) return original();
      if (quiz.__ehFinished) return;
      quiz.__ehFinished=true;
      const pct=Math.round(100*(Number(quiz.correct)||0)/Math.max(1,quiz.items.length));
      const result=original();
      if (Array.isArray(state.quizHistory) && state.quizHistory.length) {
        const last=state.quizHistory[state.quizHistory.length-1];last.mode='pro';last.label='الاختبار الاحترافي الموقّت';
        if(pct>=80 && typeof gain==='function'){gain(30);if(typeof toast==='function')toast('🏅 نتيجة ممتازة! مكافأة الاختبار الاحترافي: +30 XP');}
        if(typeof save==='function')save();
      }
      const heading=$('quizArea')?.querySelector('h2');
      if(heading && heading.textContent.includes('الاختبار الأسبوعي'))heading.textContent='انتهى الاختبار الاحترافي!';
      const clock=$('professionalExamClock');if(clock)clock.remove();
      return result;
    });
  };
  const initialize = () => {
    ensureState(); addStyles(); installHooks(); renderGrammarAcademy(); addExam(); addCustomization(); applyPreferences(); renderLevel(); renderProfessionalReport();
    if (typeof renderProfile === 'function') renderProfile();
    if (typeof renderInsights === 'function') renderInsights();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, {once:true});
  else initialize();
})();