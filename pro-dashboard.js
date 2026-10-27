/* English Hero professional progress layer — local-first, no AI services. */
'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const addStyle=()=>{
    if($('proDashboardStyles'))return;
    const style=document.createElement('style');style.id='proDashboardStyles';
    style.textContent=`
      .weekly-activity{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;align-items:end;padding:12px;background:var(--surface2);border:1px solid var(--stroke);border-radius:16px}
      .weekday{min-width:0;text-align:center;font-size:10px;color:var(--muted)}
      .weekday-track{height:74px;display:flex;align-items:end;justify-content:center;margin:7px 0}
      .weekday-bar{width:min(28px,70%);min-height:5px;border-radius:8px 8px 3px 3px;background:linear-gradient(180deg,var(--a),var(--mint));box-shadow:0 4px 12px #6de6c322}
      .weekday-count{font-size:10px;color:var(--ink);font-weight:800}
      .history-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:12px 2px;border-bottom:1px solid var(--stroke)}
      .history-row:last-child{border-bottom:0}.history-title{font-weight:800;overflow-wrap:anywhere}
      .history-meta{font-size:12px;color:var(--muted);margin-top:4px}.history-score{font-size:18px;font-weight:900;color:var(--mint);white-space:nowrap}
      .mistake-row{padding:13px 0;border-bottom:1px solid var(--stroke)}.mistake-row:last-child{border-bottom:0}
      .mistake-question{font-weight:800;direction:auto;overflow-wrap:anywhere}.mistake-answer{font-size:13px;line-height:1.8;margin-top:5px;overflow-wrap:anywhere}
      @media(max-width:390px){.nav{justify-content:flex-start;overflow-x:auto}.nav button{flex:0 0 60px;min-width:60px}.weekly-activity{gap:3px;padding:8px}.weekday{font-size:9px}.weekday-track{height:58px}}
    `;
    document.head.append(style);
  };
  const levelInfo=xpValue=>{const xp=Math.max(0,Math.floor(Number(xpValue)||0));let level=1;const startAt=n=>{const step=Math.max(0,Math.floor(Number(n)||1)-1);return 100*step+25*step*Math.max(0,step-1)};while(level<50&&xp>=startAt(level+1))level++;const start=startAt(level),next=level>=50?start:startAt(level+1);return {xp,level,start,next,into:xp-start,needed:Math.max(0,next-xp),progress:level>=50?100:Math.max(0,Math.min(100,(xp-start)/Math.max(1,next-start)*100))};};
  const renderDashboard=()=>{
    if(typeof state==='undefined'||typeof lessons==='undefined')return;
    const info=levelInfo(state.xp),xp=info.xp,level=info.level,inLevel=info.into,needed=info.needed;
    const names=['مبتدئ','مستكشف','متعلّم نشيط','متدرّب','متقدّم','خبير','بطل الإنجليزية'];
    const title=names[Math.min(names.length-1,Math.floor((level-1)/7))];
    const set=(id,value)=>{const el=$(id);if(el)el.textContent=String(value);};
    set('levelTitle','المستوى '+level+' • '+title);
    set('levelProgressText',level>=50?'أعلى مستوى • '+xp+' XP':inLevel+' / '+(info.next-info.start)+' XP • باقي '+needed+' XP');
    const bar=$('levelProgressBar');if(bar)bar.style.width=info.progress+'%';
    set('levelIcon',level>=35?'👑':level>=21?'💎':level>=11?'🏆':level>=6?'🚀':level>=3?'📘':'🌱');
    const answered=Math.max(0,Number(state.answerStats&&state.answerStats.answered)||0),correct=Math.max(0,Number(state.answerStats&&state.answerStats.correct)||0);
    set('statQuestions',answered);set('statAccuracy',(answered?Math.round(correct/answered*100):0)+'٪');
    set('statWordsLearned',lessons.reduce((n,l,i)=>n+(state.completed.includes(l.id)?l.words.length:0),0));
    const dayNames=['أحد','اثن','ثلا','أرب','خمي','جمع','سبت'],now=new Date(),days=[];
    for(let i=6;i>=0;i--){const d=new Date(now);d.setDate(now.getDate()-i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');const values=state.daily&&state.daily[key]||{};const count=Object.values(values).filter(Boolean).length;days.push({key,label:dayNames[d.getDay()],count,active:count>0});}
    set('statActiveDays',days.filter(d=>d.active).length+' / ٧');
    const activity=$('weeklyActivity');
    if(activity){activity.replaceChildren(...days.map(d=>{const col=document.createElement('div');col.className='weekday';const count=document.createElement('div');count.className='weekday-count';count.textContent=d.count;const track=document.createElement('div');track.className='weekday-track';const fill=document.createElement('div');fill.className='weekday-bar';fill.style.height=(d.count?Math.min(100,Math.max(14,d.count*20)):5)+'%';fill.style.opacity=d.active?'1':'.25';fill.title=d.key+' • '+d.count+' أنشطة';track.append(fill);const label=document.createElement('div');label.textContent=d.label;col.append(count,track,label);return col;}));}
    const history=$('quizHistoryList');
    if(history){history.replaceChildren();const entries=Array.isArray(state.quizHistory)?state.quizHistory:[];if(!entries.length){const p=document.createElement('p');p.className='empty';p.textContent='ستظهر نتائج اختباراتك هنا بعد إكمال اختبار.';history.append(p);}else entries.slice(-8).reverse().forEach(item=>{const row=document.createElement('div');row.className='history-row';const copy=document.createElement('div'),heading=document.createElement('div'),meta=document.createElement('div'),score=document.createElement('div');heading.className='history-title';meta.className='history-meta';score.className='history-score';heading.textContent=item.label||'اختبار إنجليزي';meta.textContent=(item.date||'')+' • '+(item.correct||0)+' من '+(item.total||0)+' إجابة صحيحة';score.textContent=(Number(item.score)||0)+'٪';copy.append(heading,meta);row.append(copy,score);history.append(row);});}
  };
  const wrap=(name,wrapper)=>{
    if(typeof window[name]==='function')window[name]=wrapper(window[name]);
  };
  wrap('renderProfile',original=>function(){original();renderDashboard();});
  wrap('renderInsights',original=>function(){
    original();
    if(typeof state==='undefined'||typeof lessons==='undefined')return;
    const info=levelInfo(state.xp),xp=info.xp,level=info.level;
    const el=$('pathLevel');if(el)el.textContent='المستوى '+level+' • '+xp+' XP';
    const summary=$('pathSummary');if(summary)summary.textContent='أكملت '+state.completed.length+' من '+lessons.length+' درسًا، وأنجزت '+state.quizzes+' اختبارًا. '+(level>=50?'وصلت إلى أعلى مستوى!':'تحتاج '+info.needed+' XP للمستوى التالي.');
    const path=$('learningPathSteps');if(!path)return;
    const stages=[
      ['🌱','الأساسيات','ابدأ بدروس التعارف والروتين',0,0,'courses'],
      ['📘','بناء المفردات','أكمل 3 دروس لتثبيت الكلمات',100,3,'courses'],
      ['🧩','تطبيق القواعد','ابدأ الاختبارات القصيرة',200,5,'training'],
      ['🎯','التدريب المكثف','أنجز 5 دروس وواصل الاختبارات',350,5,'training'],
      ['🧠','مراجعة الأخطاء','راجع الكلمات والأسئلة التي أخطأت فيها',500,8,'review'],
      ['🏆','الإتقان','أكمل 15 درسًا وارفع نتيجتك',800,15,'training']
    ];
    path.replaceChildren(...stages.map(([emoji,label,desc,requiredXP,requiredLessons,target])=>{
      const open=xp>=requiredXP&&state.completed.length>=requiredLessons;
      const card=document.createElement('button');card.type='button';card.className='tile';card.style.textAlign='right';card.disabled=!open;
      const h=document.createElement('h3');h.textContent=emoji+' '+label;
      const p=document.createElement('p');p.textContent=desc;
      const status=document.createElement('span');status.className='tag '+(open?'':'gold');status.textContent=open?'✓ متاح':'يتطلب '+requiredXP+' XP و'+requiredLessons+' دروس';
      card.append(h,p,status);if(open)card.addEventListener('click',()=>window.page&&page(target));return card;
    }));
  });
  wrap('submitAnswer',original=>function(value,correct){
    if(typeof quiz==='undefined'||!quiz||quiz.answered||!String(value==null?'':value).trim())return;
    const item=quiz.items[quiz.index],selected=String(value).trim(),answer=String(correct).trim(),ok=selected.toLocaleLowerCase()===answer.toLocaleLowerCase();
    state.answerStats=state.answerStats&&typeof state.answerStats==='object'?state.answerStats:{answered:0,correct:0};
    state.answerStats.answered=(Number(state.answerStats.answered)||0)+1;if(ok)state.answerStats.correct=(Number(state.answerStats.correct)||0)+1;
    if(!ok){state.quizMistakes=Array.isArray(state.quizMistakes)?state.quizMistakes:[];state.quizMistakes.push({date:today(),mode:quiz.mode,question:String(item&& (item.en||item.ar)||'سؤال تدريبي'),selected,correct:answer,explanation:String(item&&item.ex||'راجع الإجابة الصحيحة، ثم أعد حل السؤال لتثبيت القاعدة أو المفردة.')});state.quizMistakes=state.quizMistakes.slice(-100);}
    original(value,correct);
    if(!ok){const feedback=$('quizFeedback');if(feedback)feedback.textContent='❌ إجابتك: '+selected+' • الصحيح: '+answer+'\n💡 '+String(item&&item.ex||'احفظ الإجابة الصحيحة وحاول شرح سببها لنفسك.');}
    save();
  });
  wrap('finishQuiz',original=>function(){
    if(typeof quiz!=='undefined'&&quiz&&quiz.items&&quiz.items.length){
      const pct=Math.round(100*quiz.correct/quiz.items.length),labels={weekly:'الاختبار الأسبوعي',grammar:'اختبار القواعد',daily:'تحدي اليوم',battle:'معركة الكلمات',mistakes:'مراجعة الأخطاء',type:'تحدي الكتابة',listen:'اختبار الاستماع',lesson:'اختبار الدرس',saved:'اختبار الكلمات المحفوظة',all:'اختبار المفردات'};
      state.quizHistory=Array.isArray(state.quizHistory)?state.quizHistory:[];
      state.quizHistory.push({date:today(),mode:quiz.mode,label:labels[quiz.mode]||'اختبار إنجليزي',score:pct,correct:quiz.correct,total:quiz.items.length});state.quizHistory=state.quizHistory.slice(-30);save();
    }
    original();
  });
  wrap('renderReview',original=>function(){
    original();
    const root=$('quizMistakesList');if(!root)return;root.replaceChildren();
    const items=(Array.isArray(state.quizMistakes)?state.quizMistakes:[]).slice(-30).reverse();
    if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent='ممتاز! لا توجد أخطاء محفوظة في هذا السجل حتى الآن.';root.append(p);}
    else items.forEach(item=>{const row=document.createElement('div');row.className='mistake-row';const q=document.createElement('div');q.className='mistake-question';q.textContent=item.question;const a=document.createElement('div');a.className='mistake-answer';a.textContent='إجابتك: '+item.selected+' • الصحيح: '+item.correct;const why=document.createElement('p');why.className='muted small';why.textContent=(item.date||'')+' — '+(item.explanation||'راجع الإجابة ثم أعد التدريب.');row.append(q,a,why);root.append(row);});
    const clear=$('clearQuizMistakes');if(clear)clear.onclick=()=>{state.quizMistakes=[];save();window.renderReview&&renderReview();toast('تم مسح سجل الأخطاء');};
  });
  addStyle();
  if(typeof renderInsights==='function')renderInsights();
  if(typeof renderStats==='function')renderStats();
  if(typeof page==='function'){
    const nav=$('profile');if(nav&&nav.classList.contains('active'))renderDashboard();
  }
})();
