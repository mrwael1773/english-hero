/* English Hero — measurable learning pilot (teacher-reviewable, local-first, no AI). */
'use strict';
(function () {
  const KEY = 'englishHeroMeasuredPilotV1';
  const $ = (id) => document.getElementById(id);
  const words = [
    { en: 'Hello', ar: 'مرحبًا', ex: 'Hello, my name is Ali.', audio: 'Hello' },
    { en: 'Name', ar: 'اسم', ex: 'My name is Sara.', audio: 'Name' },
    { en: 'Friend', ar: 'صديق', ex: 'Omar is my friend.', audio: 'Friend' },
    { en: 'Meet', ar: 'يقابل', ex: 'Nice to meet you.', audio: 'Meet' },
    { en: 'Fine', ar: 'بخير', ex: 'I am fine, thank you.', audio: 'Fine' },
    { en: 'Goodbye', ar: 'مع السلامة', ex: 'Goodbye! See you tomorrow.', audio: 'Goodbye' }
  ];
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (date, days) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
  const blank = () => ({ startedAt: null, trainingDone: false, masteredAt: null, attempts: [], mistakes: [], reviews: [], sessions: [], consent: false });
  let data;
  try { data = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) { data = blank(); }
  if (!Array.isArray(data.attempts)) data.attempts = [];
  if (!Array.isArray(data.mistakes)) data.mistakes = [];
  if (!Array.isArray(data.reviews)) data.reviews = [];
  if (!Array.isArray(data.sessions)) data.sessions = [];
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { status('تعذر الحفظ على هذا الجهاز.'); } };
  const status = (message) => { const el = $('pilotStatus'); if (el) el.textContent = message; };
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const button = (label, action, cls = 'btn ghost') => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', action); return b; };
  const speak = (text) => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { status('ميزة النطق غير متاحة في هذا المتصفح.'); return; }
    try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.9; window.speechSynthesis.speak(u); }
    catch (_) { status('تعذر تشغيل الصوت؛ حاول مرة أخرى.'); }
  };
  const dueReviews = () => data.mistakes.filter(m => m.nextReview && m.nextReview <= today());
  const mastered = () => Boolean(data.masteredAt);
  const stateLabel = () => mastered() ? 'أتقن الدرس' : data.trainingDone ? 'أكمل التدريب' : data.startedAt ? 'بدأ الدرس' : 'لم يبدأ';
  const style = () => {
    if ($('measuredPilotStyles')) return;
    const s = el('style'); s.id = 'measuredPilotStyles';
    s.textContent = `
      #measuredPilot{margin-top:24px;border:1px solid var(--stroke);border-radius:22px;padding:20px;background:linear-gradient(145deg,var(--surface),var(--surface2))}
      #measuredPilot .pilot-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:14px 0}
      #measuredPilot .pilot-stat{padding:12px;border:1px solid var(--stroke);border-radius:13px;background:var(--surface2)}
      #measuredPilot .pilot-stat b{display:block;font-size:19px;margin-top:5px}
      #measuredPilot .pilot-word{padding:14px;border:1px solid var(--stroke);border-radius:14px;background:var(--surface2);margin:9px 0}
      #measuredPilot .pilot-word strong{font-size:21px;direction:ltr;display:block;text-align:left}
      #measuredPilot .pilot-word p{margin:7px 0;line-height:1.7}
      #measuredPilot .pilot-question{padding:15px;border:1px solid var(--stroke);border-radius:15px;margin:12px 0;background:var(--surface2)}
      #measuredPilot .pilot-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
      #measuredPilot .pilot-options button{min-height:46px;white-space:normal}
      #measuredPilot .pilot-input{width:100%;padding:12px;border:1px solid var(--stroke);border-radius:11px;background:var(--surface);color:var(--ink);margin-top:9px}
      #measuredPilot .pilot-pill{display:inline-block;border-radius:20px;padding:6px 10px;background:var(--surface2);font-size:12px;margin:3px}
      #measuredPilot .pilot-warning{padding:12px;border:1px solid var(--orange);border-radius:12px;line-height:1.7;margin:12px 0}
      @media(max-width:520px){#measuredPilot .pilot-grid{grid-template-columns:1fr}#measuredPilot .pilot-options{grid-template-columns:1fr}}
    `;
    document.head.append(s);
  };
  const render = () => {
    const host = $('courses');
    if (!host) return;
    style();
    let root = $('measuredPilot');
    if (!root) { root = el('section'); root.id = 'measuredPilot'; host.append(root); }
    root.replaceChildren();
    root.append(el('div','eyebrow','MEASURABLE LEARNING • PILOT 01'));
    root.append(el('h2', '', '🎯 مسار البداية: التعارف والتحيات'));
    root.append(el('p','muted','هدفك: تتعرّف على ست كلمات وتستخدمها في جمل بسيطة. مدة مقترحة: ١٠ دقائق، أربعة أيام أسبوعيًا.'));
    const warning = el('div','pilot-warning','نسخة تجريبية للمراجعة مع معلم الإنجليزية. الكلمات والأسئلة والدرجة المقترحة (٨٠٪) ليست اعتمادًا تربويًا نهائيًا حتى يراجعها المعلم.');
    root.append(warning);
    const stats = el('div','pilot-grid');
    [['حالة الدرس',stateLabel()],['محاولات الاختبار',data.attempts.length],['مراجعات مستحقة',dueReviews().length]].forEach(([a,b])=>{const c=el('div','pilot-stat');c.append(el('small','muted',a),el('b','',String(b)));stats.append(c);});
    root.append(stats);
    const actions = el('div','row');
    actions.append(button('ابدأ الدرس',()=>{if(!data.startedAt)data.startedAt=today();data.sessions.push({date:today(),minutes:10});persist();render();status('بدأت رحلتك. اقرأ الكلمات واستمع إليها.');},'btn primary'));
    actions.append(button('اختبر تعلّمي',startAssessment,'btn mint'));
    actions.append(button('راجع أخطائي المستحقة',reviewDue,'btn outline'));
    root.append(actions);
    const list = el('div');
    words.forEach((w,i)=>{const card=el('article','pilot-word');card.append(el('strong','',w.en),el('p','',w.ar),el('p','muted',w.ex));card.append(button('🔊 استمع',()=>speak(w.audio)));list.append(card);});
    root.append(list);
    const footer=el('div','row');
    footer.append(button('تصدير تقرير التجربة (دون اسم)',exportReport,'btn outline'));
    footer.append(button('إعادة ضبط المسار التجريبي',reset,'btn ghost'));
    root.append(footer);
    root.append(el('p','muted small','الحفظ محلي على هذا الجهاز. لا تُجمع أسماء الطلاب أو بريدهم ضمن تقرير التجربة.'));
    root.append(el('p','small','', ''));
    const st=el('p','small');st.id='pilotStatus';st.setAttribute('role','status');root.append(st);
  };
  const startAssessment = () => {
    if (!data.startedAt) data.startedAt=today();
    const questions = [
      {type:'listen', prompt:'استمع ثم اختر الكلمة التي سمعتها.', answer:'Hello', options:['Hello','Friend','Goodbye'], audio:'Hello'},
      {type:'meaning', prompt:'ما معنى كلمة Friend؟', answer:'صديق', options:['اسم','صديق','بخير']},
      {type:'listen', prompt:'استمع ثم اختر الكلمة التي سمعتها.', answer:'Goodbye', options:['Meet','Goodbye','Name'], audio:'Goodbye'},
      {type:'meaning', prompt:'ما معنى كلمة Fine؟', answer:'بخير', options:['بخير','يقابل','مع السلامة']},
      {type:'write', prompt:'اكتب جملة إنجليزية صحيحة تستخدم كلمة Name.', answer:'name', hint:'مثال للتوجيه بعد المحاولة: My name is Ali.'}
    ];
    let index=0, score=0, answers=[];
    const host=$('measuredPilot'); const panel=el('div');panel.id='pilotAssessment';panel.className='panel';panel.style.marginTop='16px';host.append(panel);
    const draw=()=>{
      panel.replaceChildren(el('h3','','اختبار قياس التعلّم • '+(index+1)+' من '+questions.length));
      const q=questions[index];panel.append(el('p','',q.prompt));
      if(q.audio)panel.append(button('🔊 شغّل الصوت',()=>speak(q.audio)));
      if(q.type==='write'){
        const input=el('input','pilot-input');input.type='text';input.placeholder='اكتب جملتك هنا';input.autocomplete='off';panel.append(input);
        panel.append(button('تحقق من الإجابة',()=>{const value=input.value.trim();const ok=/\bname\b/i.test(value)&&value.split(/\s+/).length>=3;record(ok,value);}));
      }else{
        const opts=el('div','pilot-options');q.options.forEach(option=>opts.append(button(option,()=>record(option===q.answer,option),'btn outline')));panel.append(opts);
      }
    };
    const record=(ok,value)=>{if(ok)score++;answers.push({type:questions[index].type,correct:ok});if(!ok)data.mistakes.push({word:questions[index].type==='write'?'Name':questions[index].answer,selected:value,expected:questions[index].answer,nextReview:addDays(today(),3)});index++;if(index<questions.length)draw();else{
      const pct=Math.round(score/questions.length*100);data.attempts.push({date:today(),score:pct,correct:score,total:questions.length,answers});data.trainingDone=true;
      if(pct>=80){data.masteredAt=today();data.reviews.push({date:today(),kind:'initial',score:pct});status('أحسنت! اجتزت حد الإتقان التجريبي. ستظل هناك مراجعة لاحقة للتحقق من ثبات التعلم.');}
      else {data.masteredAt=null;status('أكملت التدريب، لكن لم تصل إلى حد الإتقان المقترح. راجع أخطاءك ثم أعد الاختبار.');}
      persist();panel.replaceChildren(el('h3','','نتيجة الاختبار: '+pct+'٪'),el('p','',score+' من '+questions.length+' إجابات صحيحة.'),el('p','muted','الحد التجريبي للإتقان: ٨٠٪. الدرجة وحدها لا تثبت الاحتفاظ طويل المدى.'),button('إعادة الاختبار',startAssessment,'btn primary'));render();
    }};
    draw();
  };
  const reviewDue = () => {
    const due=dueReviews();const host=$('measuredPilot');let panel=$('pilotReview');if(!panel){panel=el('div');panel.id='pilotReview';panel.className='panel';host.append(panel);}panel.replaceChildren(el('h3','','مراجعة متباعدة'));
    if(!due.length){panel.append(el('p','muted','لا توجد مراجعات مستحقة الآن. ستظهر الكلمات التي أخطأت فيها بعد ثلاثة أيام.'));return;}
    due.forEach(item=>{const row=el('div','pilot-word');row.append(el('strong','',item.word),el('p','muted','تدرّب على تذكّر الكلمة قبل إظهار الإجابة.'));row.append(button('أظهر المعنى',()=>{const found=words.find(w=>w.en===item.word);row.append(el('p','',found?found.ar:item.expected));item.nextReview=addDays(today(),4);data.reviews.push({date:today(),kind:'spaced',word:item.word});persist();},'btn outline'));panel.append(row);});
  };
  const exportReport = () => {
    const report={project:'English Hero — pilot 01',exportedAt:new Date().toISOString(),anonymous:true,studentNamesCollected:false,startedAt:data.startedAt,trainingDone:data.trainingDone,masteredAt:data.masteredAt,attempts:data.attempts,reviews:data.reviews,sessionDays:[...new Set(data.sessions.map(s=>s.date))],sessionCount:data.sessions.length,teacherReviewRequired:true};
    const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download='english-hero-pilot-report.json';a.click();URL.revokeObjectURL(url);status('تم تجهيز تقرير مجهول دون اسم أو بريد.');
  };
  const reset=()=>{if(!window.confirm('هل تريد مسح تقدم المسار التجريبي فقط؟'))return;data=blank();persist();render();};
  // Legacy course lessons only count as complete after their assessment reaches 80%.
  if (typeof window.finishQuiz === 'function' && !window.finishQuiz.__ehMasteryGate) {
    const originalFinish = window.finishQuiz;
    const gatedFinish = function () {
      const pending = Number.isInteger(window.__ehPendingLesson) ? window.__ehPendingLesson : null;
      const total = typeof quiz !== 'undefined' && quiz && Array.isArray(quiz.items) ? quiz.items.length : 0;
      const correct = typeof quiz !== 'undefined' && quiz ? Number(quiz.correct) || 0 : 0;
      const passed = total > 0 && Math.round(correct / total * 100) >= 80;
      originalFinish();
      if (pending === null || !Array.isArray(state.completed)) return;
      const retry = $('again');
      if (passed) {
        if (!state.completed.includes(pending)) { state.completed.push(pending); if (typeof gain === 'function') gain(40); if (typeof daily === 'function') daily('lesson'); }
        if (typeof renderCourses === 'function') renderCourses();
        if (typeof toast === 'function') toast('🎉 اجتزت اختبار الدرس بنسبة ٨٠٪ أو أكثر! +40 XP');
        delete window.__ehPendingLesson;
      } else {
        if (retry) retry.onclick = () => { if (typeof restoreQuiz === 'function') restoreQuiz(); if (typeof startQuiz === 'function') startQuiz('lesson', lessons[pending].words); };
        if (typeof toast === 'function') toast('أكملت التدريب، لكن يلزم ٨٠٪ لاجتياز الدرس. أعد المحاولة.');
      }
      if (typeof save === 'function') save();
    };
    gatedFinish.__ehMasteryGate = true;
    window.finishQuiz = gatedFinish;
  }
  window.addEventListener('DOMContentLoaded',render);
  if(document.readyState!=='loading')render();
})();