/* English Hero optional cloud sync. Requires config.js and Supabase Auth + learning_progress table. */
(function(){
  'use strict';
  const $cloud = id => document.getElementById(id);
  let client = null;
  let user = null;
  let ready = false;
  let timer = null;
  let revision = 0;
  let syncPromise = null;
  let syncPromiseUserId = null;
  const status = (message) => { const el=$cloud('cloudStatus'); if(el) el.textContent=message; };
  const validConfig = () => {
    const c=window.ENGLISH_HERO_CLOUD_CONFIG;
    return c && /^https:\/\/[^/]+\.supabase\.co$/.test(c.supabaseUrl||'')
      && typeof c.supabaseAnonKey==='string'
      && c.supabaseAnonKey.length>20
      && !/YOUR_PROJECT|YOUR_SUPABASE|placeholder/i.test(c.supabaseUrl+c.supabaseAnonKey);
  };
  const setSignedInUI = () => {
    const signedIn = !!user;
    const authForm = $cloud('cloudAuthForm');
    const googleButton = $cloud('cloudGoogle');
    // Keep sign-in controls out of the way once a session is active.
    if(authForm) authForm.classList.toggle('hidden', signedIn);
    if(googleButton) {
      googleButton.disabled = signedIn || !client;
      const googleRow = googleButton.parentElement;
      if(googleRow) googleRow.classList.toggle('hidden', signedIn);
    }
    if($cloud('cloudUser')) {
      const metadata = user?.user_metadata || {};
      const emailName = typeof user?.email === 'string' ? user.email.split('@')[0] : '';
      const displayName = (typeof state !== 'undefined' && state.displayName) || metadata.full_name || metadata.name || metadata.user_name ||
        metadata.preferred_username || emailName || 'المستخدم';
      $cloud('cloudUser').textContent = signedIn ? '👋 أهلًا، ' + displayName + ' — تم تسجيل الدخول' : '';
      $cloud('cloudUser').setAttribute('dir', 'auto');
      $cloud('cloudUser').style.textAlign = 'start';
    }
    if($cloud('cloudSignIn')) $cloud('cloudSignIn').disabled = signedIn;
    if($cloud('cloudSignUp')) $cloud('cloudSignUp').disabled = signedIn;
    if($cloud('cloudEmail')) $cloud('cloudEmail').disabled = signedIn;
    if($cloud('cloudPassword')) $cloud('cloudPassword').disabled = signedIn;
    if($cloud('cloudSignOut')) $cloud('cloudSignOut').disabled = !signedIn;
    if($cloud('cloudSyncNow')) $cloud('cloudSyncNow').disabled = !signedIn || !ready;
    const restoreButton=$cloud('cloudRestoreBackup');
    if(restoreButton){
      let hasBackup=false;
      try { hasBackup=!!(signedIn && localStorage.getItem('english-hero-account-backup-'+user.id)); } catch {}
      restoreButton.classList.toggle('hidden',!hasBackup);
      restoreButton.disabled=!signedIn || !ready || !hasBackup;
    }
  };
  async function uploadProgress(){
    if(!client||!user||!ready) return false;
    const syncUserId=user.id;
    const current=revision;
    try {
      const {error}=await client.from('learning_progress').upsert({
        user_id:syncUserId, progress:state, updated_at:new Date().toISOString()
      },{onConflict:'user_id'});
      if(error) throw error;
      // Never associate this device's local copy with a different account.
      if(user?.id===syncUserId){
        try { localStorage.setItem('english-hero-cloud-owner',syncUserId); } catch {}
        if(current===revision) status('✅ تمت مزامنة تقدمك مع حسابك السحابي.');
      }
      return true;
    } catch(error) {
      status('تعذر رفع التقدم. سيبقى محفوظًا محليًا؛ تحقق من الاتصال وإعداد جدول learning_progress وسياسات RLS.');
      console.error('English Hero cloud save:',error?.message||error);
      return false;
    }
  }
  window.saveCloudDisplayName=async function(name){
    if(!client||!user)return;
    try{
      const {error}=await client.auth.updateUser({data:{full_name:name,display_name:name}});
      if(error){status('حُفظ الاسم على هذا الجهاز، لكن تعذّر تحديث اسم الحساب السحابي.');console.error('English Hero display name:',error.message);return;}
      setSignedInUI();
      status('✅ تم حفظ الاسم وتحديثه في حسابك.');
    }catch(error){status('حُفظ الاسم محليًا، لكن تعذّر تحديثه سحابيًا.');console.error('English Hero display name:',error?.message||error);}
  };
  window.queueCloudSave=function(){
    if(!user||!ready) return;
    revision++;
    clearTimeout(timer);
    timer=setTimeout(uploadProgress,900);
  };
  function mergeProgress(remote){
    const local=state||{};
    const r=remote&&typeof remote==='object'&&!Array.isArray(remote)?remote:{};
    const union=(a,b)=>[...new Set([...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])])];
    const object=(v)=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
    const daily={...object(r.daily),...object(local.daily)};
    for(const day of new Set([...Object.keys(object(r.daily)),...Object.keys(object(local.daily))])) daily[day]={...object(object(r.daily)[day]),...object(object(local.daily)[day])};
    state={...r,...local,
      displayName:String(local.displayName||r.displayName||user?.user_metadata?.full_name||user?.user_metadata?.display_name||'').trim().slice(0,32),
      xp:Math.max(0,Number(r.xp)||0,Number(local.xp)||0),
      best:Math.min(100,Math.max(0,Number(r.best)||0,Number(local.best)||0)),
      quizzes:Math.max(0,Number(r.quizzes)||0,Number(local.quizzes)||0),
      streak:Math.max(0,Number(r.streak)||0,Number(local.streak)||0),
      completed:union(r.completed,local.completed),
      foundationSaved:union(r.foundationSaved,local.foundationSaved),
      lessonPositions:{...object(r.lessonPositions),...object(local.lessonPositions)},
      chatHistory:(Array.isArray(local.chatHistory)&&local.chatHistory.length?local.chatHistory:(Array.isArray(r.chatHistory)?r.chatHistory:[])).slice(-60),
      saved:union(r.saved,local.saved),
      misses:{...object(r.misses),...object(local.misses)},
      review:{...object(r.review),...object(local.review)},
      daily,
      lastActive:[r.lastActive,local.lastActive].filter(v=>typeof v==='string').sort().pop()||'',
      theme:local.theme||r.theme||'dark',rate:local.rate||r.rate||0.9
    };
    try { localStorage.setItem('english-hero-academy-3',JSON.stringify(state)); } catch {}
  }
  function replaceProgress(remote){
    const r=remote&&typeof remote==='object'&&!Array.isArray(remote)?remote:{};
    const base=typeof defaults==='function'?defaults():{};
    state={...base,...r};
    state.displayName=String(state.displayName||user?.user_metadata?.full_name||user?.user_metadata?.display_name||'').trim().slice(0,32);
    state.xp=Math.max(0,Number(state.xp)||0);
    state.best=Math.min(100,Math.max(0,Number(state.best)||0));
    state.quizzes=Math.max(0,Number(state.quizzes)||0);
    state.streak=Math.max(0,Number(state.streak)||0);
    for(const key of ['completed','saved','foundationSaved','chatHistory']) if(!Array.isArray(state[key])) state[key]=[];
    for(const key of ['misses','review','daily','lessonPositions']) if(!state[key]||typeof state[key]!=='object'||Array.isArray(state[key])) state[key]={};
    state.completed=[...new Set(state.completed.filter(x=>Number.isInteger(x)&&x>=0))];
    state.saved=[...new Set(state.saved)];
    state.foundationSaved=[...new Set(state.foundationSaved.filter(x=>typeof x==='string'))];
    state.theme=state.theme==='light'?'light':'dark';
    state.rate=[0.7,0.9,1].includes(Number(state.rate))?Number(state.rate):0.9;
    try { localStorage.setItem('english-hero-academy-3',JSON.stringify(state)); } catch {}
  }
  async function syncNow(){
    if(!user||!client) return;
    const requestedUserId=user.id;
    // Serialize account changes without allowing an old account's request to block the new one.
    if(syncPromise){
      if(syncPromiseUserId===requestedUserId) return syncPromise;
      try { await syncPromise; } catch {}
      if(user && client) return syncNow();
      return;
    }
    syncPromiseUserId=requestedUserId;
    syncPromise=(async()=>{
      const syncUserId=requestedUserId;
      ready=false;setSignedInUI();status('جارٍ مزامنة تقدمك...');
      try {
        const {data,error}=await client.from('learning_progress').select('progress').eq('user_id',syncUserId).maybeSingle();
        if(error) throw error;
        // If the learner signed out or switched accounts while the request was in flight, do not merge.
        if(!user||user.id!==syncUserId) return;
        const remoteProgress=data && data.progress && typeof data.progress==='object' && !Array.isArray(data.progress)?data.progress:null;
        let localOwner='';
        try { localOwner=localStorage.getItem('english-hero-cloud-owner')||''; } catch {}
        if(localOwner && localOwner!==syncUserId){
          // Preserve the previous account's local snapshot before switching the active state.
          try { localStorage.setItem('english-hero-account-backup-'+localOwner,JSON.stringify(state)); } catch {}
          replaceProgress(remoteProgress||{});
          status(remoteProgress?'تم تحميل تقدم هذا الحساب فقط. حُفظت نسخة محلية من الحساب السابق.':'حساب جديد على هذا الجهاز؛ سيبدأ بتقدم مستقل، مع الاحتفاظ بنسخة الحساب السابق.');
        } else if(!localOwner && remoteProgress){
          // Preserve unclaimed legacy progress before loading an established cloud account.
          try { localStorage.setItem('english-hero-unclaimed-local-backup',JSON.stringify(state)); } catch {}
          replaceProgress(remoteProgress);
        } else if(!localOwner && !remoteProgress){
          // The device may have anonymous study progress. Ask before attaching it to a new account.
          const localState=state||{};
          const hasLocalProgress=(Number(localState.xp)||0)>0 ||
            (Array.isArray(localState.completed)&&localState.completed.length>0) ||
            (Array.isArray(localState.foundationSaved)&&localState.foundationSaved.length>0) ||
            (Array.isArray(localState.saved)&&localState.saved.length>0) ||
            (Number(localState.quizzes)||0)>0;
          const keepLocal=hasLocalProgress && window.confirm('وجدنا تقدمًا محفوظًا على هذا الجهاز. هل تريد دمجه مع حسابك السحابي الجديد؟ اختر «إلغاء» لبدء حساب مستقل؛ سنحتفظ بنسخة محلية من التقدم السابق.');
          if(hasLocalProgress && !keepLocal){
            try { localStorage.setItem('english-hero-unclaimed-local-backup',JSON.stringify(localState)); } catch {}
            replaceProgress(typeof defaults==='function'?defaults():{});
            status('بدأ الحساب بتقدم مستقل. احتُفظ بنسخة محلية من التقدم السابق على هذا الجهاز.');
          }
        } else if(remoteProgress){
          mergeProgress(remoteProgress);
        }
        ready=true;setSignedInUI();
        renderStats();renderCourses();renderHome();renderProfile();renderReview();
        revision++;
        const saved=await uploadProgress();
        if(saved) status('✅ تمت مزامنة التقدم. جُمعت بيانات هذا الجهاز والحساب لتقليل فقدان التقدم.');
      } catch(e) {
        ready=true;setSignedInUI();
        status('تعذرت مزامنة التقدم. بقيت بياناتك المحلية محفوظة؛ تحقق من الاتصال وإعداد جدول learning_progress وسياسات RLS.');
        console.error('English Hero cloud sync:',e?.message||e);
      }
    })();
    try { return await syncPromise; }
    finally {
      if(syncPromiseUserId===requestedUserId){syncPromise=null;syncPromiseUserId=null;}
      if(user && client && user.id!==requestedUserId) queueMicrotask(()=>syncNow());
    }
  }
  async function init(){
    if(!validConfig()){
      status('تسجيل الدخول السحابي جاهز للتهيئة، لكنه غير مفعّل بعد. يلزم إعداد مشروع Supabase ومفتاحه العام في config.js.');
      setSignedInUI();return;
    }
    try {
      if(!window.supabase?.createClient) throw new Error('لم تُحمّل مكتبة Supabase');
      client=window.supabase.createClient(window.ENGLISH_HERO_CLOUD_CONFIG.supabaseUrl,window.ENGLISH_HERO_CLOUD_CONFIG.supabaseAnonKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
      const {data,error}=await client.auth.getSession();
      if(error) throw error;
      user=data.session?.user||null;
      setSignedInUI();
      if(user) await syncNow();
      else status('أنشئ حسابًا أو سجّل الدخول لمزامنة تقدمك بين الأجهزة.');
      client.auth.onAuthStateChange((event,session)=>{
        const previousUser=user;
        user=session?.user||null;
        setSignedInUI();
        if(event==='SIGNED_IN' && user) setTimeout(()=>syncNow(),0);
        if(event==='SIGNED_OUT'){
          ready=false;
          clearTimeout(timer);
          try { if(previousUser) localStorage.setItem('english-hero-account-backup-'+previousUser.id,JSON.stringify(state)); } catch {}
          try { localStorage.removeItem('english-hero-cloud-owner'); } catch {}
          if(typeof defaults==='function') replaceProgress(defaults());
          renderStats();renderCourses();renderHome();renderProfile();renderReview();
          status('تم تسجيل الخروج. حُفظت نسخة محلية للحساب السابق، وأُعيدت الشاشة إلى تقدم مستقل.');
          user=null;
          setSignedInUI();
        }
      });
    } catch(e) {
      status('تعذر تهيئة تسجيل الدخول. تحقق من إعدادات Supabase والاتصال بالإنترنت.');
      console.error('English Hero cloud init:',e.message);
    }
  }
  const friendlyAuthError = (error, mode) => {
    const message = String(error?.message || '');
    const lower = message.toLowerCase();
    if (lower.includes('invalid login credentials')) return 'بيانات الدخول غير صحيحة، أو أن الحساب لم يُؤكَّد بعد. تأكد من البريد وكلمة المرور وأكّد البريد إذا وصلتك رسالة.';
    if (lower.includes('email not confirmed')) return 'الحساب موجود لكن البريد غير مؤكّد. افتح رسالة Supabase لتأكيد البريد ثم حاول تسجيل الدخول.';
    if (lower.includes('user already registered')) return 'هذا البريد مسجّل من قبل. استخدم «تسجيل الدخول» بدل إنشاء حساب جديد.';
    if (lower.includes('password should be at least')) return 'كلمة المرور أقصر من الحد الذي يطلبه مزوّد الخدمة.';
    if (lower.includes('email address') && lower.includes('invalid')) return 'صيغة البريد الإلكتروني غير صحيحة.';
    if (lower.includes('signup is disabled') || lower.includes('signups not allowed')) return 'إنشاء الحسابات معطّل في إعدادات Supabase Auth.';
    if (lower.includes('rate limit') || lower.includes('too many requests')) return 'محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.';
    if (lower.includes('failed to fetch') || lower.includes('network')) return 'تعذّر الاتصال بـ Supabase. تحقق من الإنترنت ومن عنوان المشروع.';
    console.error('English Hero auth error:', {mode, message, status:error?.status, code:error?.code});
    return (mode==='signup'?'تعذّر إنشاء الحساب: ':'تعذّر تسجيل الدخول: ') + (message || 'خطأ غير معروف') + ' — راجع إعدادات Authentication في Supabase.';
  };
  $cloud('cloudAuthForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!client){status('تسجيل الدخول غير مهيأ: تعذّر الاتصال بمشروع Supabase.');return;}
    const email=$cloud('cloudEmail').value.trim();
    const password=$cloud('cloudPassword').value;
    const button=$cloud('cloudSignIn');
    button.disabled=true;
    status('جارٍ التحقق من بيانات الدخول...');
    try {
      const {data,error}=await client.auth.signInWithPassword({email,password});
      if(error){status(friendlyAuthError(error,'signin'));return;}
      user=data.user||data.session?.user||null;
      setSignedInUI();
      status('تم تسجيل الدخول. جارٍ استرجاع تقدم الحساب...');
      await syncNow();
    } catch(error) {
      status(friendlyAuthError(error,'signin'));
    } finally {
      button.disabled=!!user;
    }
  });
  $cloud('cloudSignUp')?.addEventListener('click',async()=>{
    if(!client){status('إنشاء الحساب غير مهيأ: تعذّر الاتصال بمشروع Supabase.');return;}
    const email=$cloud('cloudEmail').value.trim();
    const password=$cloud('cloudPassword').value;
    if(!email||password.length<8){status('أدخل بريدًا صحيحًا وكلمة مرور من 8 أحرف على الأقل.');return;}
    const button=$cloud('cloudSignUp');
    button.disabled=true;
    status('جارٍ إنشاء الحساب...');
    try {
      const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname,data:{full_name:(($cloud('displayNameInput')?.value||'').trim().replace(/\s+/g,' ').slice(0,32)),display_name:(($cloud('displayNameInput')?.value||'').trim().replace(/\s+/g,' ').slice(0,32))}}});
      if(error){status(friendlyAuthError(error,'signup'));return;}
      if(data.session){
        user=data.user||data.session.user||null;
        setSignedInUI();
        status('تم إنشاء الحساب وتسجيل الدخول. جارٍ مزامنة التقدم...');
        await syncNow();
      } else {
        status('تم إرسال طلب إنشاء الحساب. افتح رسالة التأكيد في بريدك، ثم ارجع وسجّل الدخول. إذا لم تصل الرسالة، افحص Spam وإعدادات SMTP/تأكيد البريد في Supabase.');
      }
    } catch(error) {
      status(friendlyAuthError(error,'signup'));
    } finally {
      button.disabled=!!user;
    }
  });
  $cloud('cloudGoogle')?.addEventListener('click',async()=>{
    if(!client){status('تعذر تهيئة تسجيل الدخول.');return;}
    status('جارٍ تحويلك إلى Google لتسجيل الدخول...');
    try {
      const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}});
      if(error) status('تعذر تسجيل الدخول عبر Google. تحقق من تفعيل Google في Supabase Auth: '+error.message);
    }catch(error){status('تعذر بدء تسجيل الدخول عبر Google: '+(error?.message||error));}
  });
  $cloud('cloudSignOut')?.addEventListener('click',async()=>{
    if(!client)return;
    const button=$cloud('cloudSignOut');
    if(button) button.disabled=true;
    status('جارٍ حفظ آخر تقدم قبل تسجيل الخروج...');
    if(user && ready){
      clearTimeout(timer);
      await uploadProgress();
      try { localStorage.setItem('english-hero-account-backup-'+user.id,JSON.stringify(state)); } catch {}
    }
    const {error}=await client.auth.signOut();
    if(error){
      status('تعذر تسجيل الخروج. بقيت بياناتك محفوظة؛ حاول مرة أخرى.');
      setSignedInUI();
      return;
    }
  });
  $cloud('cloudSyncNow')?.addEventListener('click',syncNow);
  $cloud('cloudRestoreBackup')?.addEventListener('click',async()=>{
    if(!client || !user || !ready) return;
    const syncUserId=user.id;
    const backupKey='english-hero-account-backup-'+syncUserId;
    let backup;
    try {
      const raw=localStorage.getItem(backupKey);
      if(!raw) throw new Error('لا توجد نسخة احتياطية لهذا الحساب على هذا الجهاز.');
      backup=JSON.parse(raw);
      if(!backup || typeof backup!=='object' || Array.isArray(backup)) throw new Error('ملف النسخة الاحتياطية غير صالح.');
    } catch(error) {
      const message=error?.message||'تعذرت قراءة النسخة الاحتياطية.';
      const note=$cloud('cloudBackupStatus');
      if(note) note.textContent=message;
      return;
    }
    if(!window.confirm('سيتم دمج نسخة هذا الحساب المحفوظة على الجهاز مع تقدمه الحالي، مع الاحتفاظ بالتقدم الأحدث قدر الإمكان. هل تريد المتابعة؟')) return;
    const note=$cloud('cloudBackupStatus');
    if(note) note.textContent='جارٍ دمج النسخة الاحتياطية...';
    const button=$cloud('cloudRestoreBackup');
    if(button) button.disabled=true;
    try {
      backup.completed=Array.isArray(backup.completed)?backup.completed.filter(x=>Number.isInteger(x)&&x>=0):[];
      backup.foundationSaved=Array.isArray(backup.foundationSaved)?backup.foundationSaved.filter(x=>typeof x==='string'):[];
      backup.saved=Array.isArray(backup.saved)?backup.saved.filter(x=>typeof x==='string'):[];
      backup.chatHistory=Array.isArray(backup.chatHistory)?backup.chatHistory.filter(x=>x&&typeof x.text==='string'&&['me','bot'].includes(x.who)).slice(-60):[];
      for(const key of ['misses','review','daily','lessonPositions']) if(!backup[key]||typeof backup[key]!=='object'||Array.isArray(backup[key])) backup[key]={};
      mergeProgress(backup);
      if(!user || user.id!==syncUserId) throw new Error('تغيّر الحساب أثناء الاستعادة؛ لم يتم رفع النسخة.');
      renderStats();renderCourses();renderHome();renderProfile();renderReview();
      clearTimeout(timer);
      revision++;
      const saved=await uploadProgress();
      if(note) note.textContent=saved?'تم دمج النسخة الاحتياطية لهذا الحساب. أبقينا النسخة محفوظة على الجهاز للرجوع إليها لاحقًا.':'تم دمج النسخة محليًا، لكن تعذّر رفعها الآن؛ ستبقى على الجهاز ويمكنك إعادة المزامنة لاحقًا.';
    } catch(error) {
      if(note) note.textContent=error?.message||'تعذرت استعادة النسخة الاحتياطية.';
    } finally {
      setSignedInUI();
    }
  });
  // Retry pending local progress after the connection returns or the learner revisits the tab.
  // Keep the local copy until the cloud confirms a successful write.
  window.addEventListener('online',()=>{
    if(user && client) syncNow();
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible' && user && client) syncNow();
    if(document.visibilityState==='hidden' && user && ready && revision>0){
      clearTimeout(timer);
      uploadProgress();
    }
  });
  init();
})();