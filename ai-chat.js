/* English Hero AI conversation: secure server-side model call + browser voice tools. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form=$('chatForm'), input=$('chatInput'), chat=$('chat'), status=$('aiChatStatus');
  if(!form || !input || !chat) return;
  let recognition=null, busy=false, lastReply='';
  const initialHistory=(()=>{try{return typeof state!=='undefined'&&Array.isArray(state.chatHistory)?state.chatHistory:[]}catch(_){return []}})();
  lastReply=[...initialHistory].reverse().find(m=>m&&m.who==='bot'&&typeof m.text==='string')?.text||'';
  const sayStatus = text => { if(status) status.textContent=text; };
  function addBubble(text, who, record=true) {
    const el=document.createElement('div'); el.className='bubble '+who; el.textContent=text;
    chat.append(el); chat.scrollTop=chat.scrollHeight;
    if(record) {
      try {
        if(typeof state!=='undefined' && Array.isArray(state.chatHistory)) {
          state.chatHistory.push({who,text}); state.chatHistory=state.chatHistory.slice(-60);
          if(typeof save==='function') save();
        }
      } catch(e) { console.warn('Could not save conversation locally',e); }
    }
    return el;
  }
  initialHistory.forEach(m=>{if(m&&typeof m.text==='string'&&['me','bot'].includes(m.who))addBubble(m.text,m.who,false)});
  if(!initialHistory.length)addBubble('Hello! 👋 Let’s practice English together. What would you like to talk about?','bot',false);
  async function refreshAuthHint(){
    const hint=$('aiCoachSignInHint');
    const cfg=window.ENGLISH_HERO_CLOUD_CONFIG;
    if(!hint)return;
    if(!cfg||!window.supabase?.createClient){hint.classList.remove('hidden');hint.textContent='إعداد الاتصال غير مكتمل. لا يمكن تشغيل مدرّب الذكاء الاصطناعي حاليًا.';return;}
    try{
      const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      const {data}=await client.auth.getSession();
      hint.classList.toggle('hidden',!!data?.session);
      hint.textContent='تحتاج إلى تسجيل الدخول من «حسابي» لاستخدام مدرّب الذكاء الاصطناعي.';
      client.auth.onAuthStateChange((_event,session)=>hint.classList.toggle('hidden',!!session));
    }catch(_){hint.classList.remove('hidden');}
  }
  refreshAuthHint();
  function voiceSpeak(text) {
    if(!('speechSynthesis' in window)) { sayStatus('ميزة القراءة الصوتية غير مدعومة في هذا المتصفح.'); return; }
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(text);
    utterance.lang='en-US'; utterance.rate=0.88;
    window.speechSynthesis.speak(utterance);
  }
  async function askAI(text) {
    const cfg=window.ENGLISH_HERO_CLOUD_CONFIG;
    if(!cfg || !window.supabase?.createClient) throw new Error('إعداد الاتصال غير مكتمل. تحقق من تحميل config.js ومكتبة Supabase.');
    const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    const {data:{session}}=await client.auth.getSession();
    if(!session) throw new Error('سجّل الدخول أولًا حتى تتمكن من استخدام مدرب الذكاء الاصطناعي.');
    const history=(Array.isArray(state.chatHistory)?state.chatHistory:[])
      .slice(-13,-1).map(m=>({role:m.who==='me'?'user':'assistant',content:m.text}));
    // Abort slow requests so the learner never waits indefinitely for the AI service.
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),16000);
    let result;
    try {
      result=await client.functions.invoke('english-coach',{body:{message:text,history},signal:controller.signal});
    } catch(requestError) {
      if(controller.signal.aborted) throw new Error('انتهت مهلة الرد بعد 16 ثانية. تحقق من الاتصال وحاول مرة أخرى.');
      throw requestError;
    } finally {
      clearTimeout(timeout);
    }
    const {data,error}=result;
    if(error) {
      if(controller.signal.aborted || /abort|timeout/i.test(String(error.message||''))) {
        throw new Error('انتهت مهلة الرد. تحقق من الاتصال وحاول مرة أخرى.');
      }
      let detail=error.message||'تعذر الاتصال بخدمة الذكاء الاصطناعي.';
      try { const context=error.context; if(context && typeof context.json==='function'){const j=await context.json();if(j.error)detail=j.error;} } catch(_){}
      throw new Error(detail+' تأكد من نشر وظيفة english-coach وضبط OPENAI_API_KEY في Supabase.');
    }
    if(!data || typeof data.reply!=='string' || !data.reply.trim()) throw new Error('وصل رد غير صالح من خدمة الذكاء الاصطناعي.');
    return data.reply.trim();
  }
  function offlineCoach(text){
    const fixes=[
      [/\bi\s+like\s+play(?:ing)?\b/i,{sentence:'I like playing football.',reason:'بعد like نستخدم الفعل مع -ing أو to + المصدر.'}],
      [/\bi\s+(?:am|’m|'m)\s+wake\s+up\b/i,{sentence:'I wake up at 5:30.',reason:'للعادات نستخدم المضارع البسيط، ولا نضع am قبل wake up.'}],
      [/\bi\s+go\s+to\s+school\s+in\s+(\d{1,2}(?::\d{2})?)/i,{sentence:'I go to school at $1.',reason:'نستخدم at مع الساعة.'}],
      [/\bi\s+drink\s+a\s+water\b/i,{sentence:'I drink water.',reason:'كلمة water غير معدودة في هذا الاستخدام، لذلك لا نضع a قبلها.'}],
      [/\bnodlls\b/i,{sentence:'noodles',reason:'هذه هي التهجئة الصحيحة لكلمة نودلز.'}],
      [/\bbule\b/i,{sentence:'blue',reason:'هذه هي التهجئة الصحيحة للون الأزرق.'}],
      [/\bi\s+(?:am|’m|'m)\s+understand\b/i,{sentence:'I understand.',reason:'لا نضع am قبل الفعل understand في المضارع البسيط.'}],
      [/\bi\s+from\s+yemen\b/i,{sentence:'I am from Yemen.',reason:'نحتاج إلى am في جملة I am from… واسم الدولة يبدأ بحرف كبير.'}],
      [/\bdidn['’]t\s+went\b/i,{sentence:"didn't go",reason:'بعد did أو didn’t نستخدم الفعل في المصدر.'}],
      [/\bpeople\s+is\b/i,{sentence:'People are…',reason:'كلمة people جمع، لذلك نستخدم are.'}]
    ];
    for(const [pattern,fix] of fixes){
      if(pattern.test(text))return '✍️ التصحيح المقترح: '+text.replace(pattern,fix.sentence)+'\n📘 السبب: '+fix.reason+'\n\nجرّب كتابة جملة جديدة باستخدام التصحيح.';
    }
    const prompts=[
      'What do you usually do after school?',
      'What is your favorite food, and why?',
      'Tell me about your daily routine.',
      'What did you do yesterday?',
      'What sport do you like playing?'
    ];
    if(/[\u0600-\u06FF]/.test(text))return 'الوضع الاحتياطي يعمل دون الذكاء الاصطناعي. يمكنك كتابة ما تريد قوله بالعربية، ثم حاول تكوين جملة إنجليزية بسيطة.\nمثال: أحب كرة القدم = I like football.\n\nجرّب: '+prompts[initialHistory.length%prompts.length];
    return 'وصلت رسالتك. أستطيع الآن فحص بعض الأخطاء الشائعة دون اتصال بخدمة الذكاء الاصطناعي. إذا لم يظهر تصحيح محدد، فذلك لا يعني أن الجملة صحيحة بالكامل.\n\nجرّب الإجابة عن هذا السؤال: '+prompts[initialHistory.length%prompts.length];
  }
  form.onsubmit=async e=>{
    e.preventDefault(); const text=input.value.trim(); if(!text||busy)return;
    busy=true; const send=form.querySelector('button[type="submit"]'); if(send)send.disabled=true;
    input.value=''; addBubble(text,'me'); const waiting=addBubble('Thinking…','bot',false);
    sayStatus('جارٍ إرسال رسالتك إلى مدرب الذكاء الاصطناعي…');
    try {
      const reply=await askAI(text); waiting.remove(); addBubble(reply,'bot'); lastReply=reply;
      sayStatus('يمكنك متابعة المحادثة بالكتابة أو بالميكروفون.');
      if($('chatSpeak')?.dataset.autoread==='true') voiceSpeak(reply);
      if(typeof daily==='function') daily('chat');
    } catch(err) {
      waiting.remove();
      const message=err?.message||'تحقق من الاتصال والإعدادات.';
      const timedOut=message.includes('انتهت مهلة الرد') || message.includes('مهلة رد الذكاء الاصطناعي') || /response took too long|timed out|timeout/i.test(message);
      if(message.includes('رصيد OpenAI API') || timedOut){
        const reason=timedOut
          ? '⚠️ تأخر رد الذكاء الاصطناعي وانتهت مهلة الاتصال. هذا تدريب احتياطي محلي وليس ردًا من الذكاء الاصطناعي. جرّب مرة أخرى لاحقًا.\n\n'
          : '⚠️ الرد الذكي غير متاح حاليًا بسبب رصيد الخدمة. هذا تدريب احتياطي محلي وليس ردًا من الذكاء الاصطناعي.\n\n';
        const fallback=reason+offlineCoach(text);
        addBubble(fallback,'bot');lastReply=fallback;
        sayStatus(timedOut
          ? 'انتهت مهلة الرد؛ انتقلنا إلى تدريب احتياطي محلي حتى لا تتوقف الممارسة.'
          : 'خدمة الذكاء الاصطناعي متوقفة مؤقتًا؛ يستمر التدريب الاحتياطي المحلي وبقية الموقع تعمل طبيعيًا.');
        if(typeof daily==='function')daily('chat');
      }else{
        addBubble('تعذر الحصول على رد من الذكاء الاصطناعي. '+message,'bot',false);
        if(message.includes('سجّل الدخول')) sayStatus('سجّل الدخول من قسم ملف الإنجازات ثم ارجع للمحادثة.');
        else if(message.includes('OPENAI_API_KEY')) sayStatus('الخادم منشور؛ يلزم إضافة OPENAI_API_KEY إلى أسرار Supabase لتفعيل الردود.');
        else if(message.includes('نشر وظيفة')) sayStatus('تحقق من نشر وظيفة english-coach في Supabase.');
        else if(message.includes('حد الطلبات مؤقتًا')) sayStatus('وصلت الخدمة إلى حد الطلبات مؤقتًا. انتظر قليلًا ثم أعد المحاولة.');
        else sayStatus('تعذر الاتصال بالمدرب. تحقق من الإنترنت ثم أعد المحاولة.');
      }
    } finally { busy=false; if(send)send.disabled=false; input.focus(); }
  };
  $('chatMic')?.addEventListener('click',()=>{
    const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SpeechRecognition){sayStatus('التعرّف على الكلام غير مدعوم هنا. جرّب Safari أو Chrome بإذن الميكروفون، أو اكتب رسالتك.');return;}
    if(recognition){recognition.stop();recognition=null;return;}
    recognition=new SpeechRecognition(); recognition.lang='en-US'; recognition.interimResults=false; recognition.maxAlternatives=1;
    recognition.onstart=()=>sayStatus('تحدث الآن بالإنجليزية…');
    recognition.onresult=event=>{input.value=event.results[0][0].transcript;form.requestSubmit();};
    recognition.onerror=event=>sayStatus('تعذر استخدام الميكروفون ('+event.error+'). تحقق من إذن الميكروفون.');
    recognition.onend=()=>{recognition=null;if(status && status.textContent==='تحدث الآن بالإنجليزية…')sayStatus('انتهى الاستماع.');};
    try{recognition.start();}catch(e){recognition=null;sayStatus('تعذر بدء الميكروفون. حاول مرة أخرى.');}
  });
  $('chatSpeak')?.addEventListener('click',()=>{if(lastReply)voiceSpeak(lastReply);else sayStatus('لا يوجد رد جديد لقراءته بعد.');});
  $('chatReset')?.addEventListener('click',()=>{
    if(busy){sayStatus('انتظر حتى ينتهي الرد الحالي قبل بدء محادثة جديدة.');return;}
    lastReply='';
    if(recognition){recognition.stop();recognition=null;}
    if('speechSynthesis' in window)window.speechSynthesis.cancel();
    try{if(typeof state!=='undefined'){state.chatHistory=[];if(typeof save==='function')save();}}catch(_){}
    chat.replaceChildren();
    addBubble('Hello! 👋 Let’s practice English together. What would you like to talk about?','bot',false);
    sayStatus('بدأت محادثة جديدة. اكتب جملة بالإنجليزية للبدء.');
  });
  // Replace the old scripted replies with a real AI call; keep prior chat display/history.
  sayStatus('واجهة الصوت جاهزة. خدمة الذكاء الاصطناعي تتطلب نشر وظيفة english-coach وإضافة مفتاح OpenAI الآمن في Supabase.');
})();