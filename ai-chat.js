/* English Hero AI conversation: secure server-side model call + browser voice tools. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form=$('chatForm'), input=$('chatInput'), chat=$('chat'), status=$('aiChatStatus');
  if(!form || !input || !chat) return;
  let recognition=null, busy=false, lastReply='';
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
      .slice(-12).map(m=>({role:m.who==='me'?'user':'assistant',content:m.text}));
    const {data,error}=await client.functions.invoke('english-coach',{body:{message:text,history}});
    if(error) {
      let detail=error.message||'تعذر الاتصال بخدمة الذكاء الاصطناعي.';
      try { const context=error.context; if(context && typeof context.json==='function'){const j=await context.json();if(j.error)detail=j.error;} } catch(_){}
      throw new Error(detail+' تأكد من نشر وظيفة english-coach وضبط OPENAI_API_KEY في Supabase.');
    }
    if(!data || typeof data.reply!=='string' || !data.reply.trim()) throw new Error('وصل رد غير صالح من خدمة الذكاء الاصطناعي.');
    return data.reply.trim();
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
      addBubble('تعذر الحصول على رد من الذكاء الاصطناعي. '+(err?.message||'تحقق من الاتصال والإعدادات.'),'bot');
      sayStatus('خدمة الذكاء الاصطناعي تحتاج إلى إعداد الخادم قبل أن تعمل.');
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
  // Replace the old scripted replies with a real AI call; keep prior chat display/history.
  sayStatus('واجهة الصوت جاهزة. خدمة الذكاء الاصطناعي تتطلب نشر وظيفة english-coach وإضافة مفتاح OpenAI الآمن في Supabase.');
})();