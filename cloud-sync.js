/* English Hero optional cloud sync. Requires config.js and Supabase Auth + learning_progress table. */
(function(){
  'use strict';
  const $cloud = id => document.getElementById(id);
  let client = null;
  let user = null;
  let ready = false;
  let timer = null;
  let revision = 0;
  const status = (message) => { const el=$cloud('cloudStatus'); if(el) el.textContent=message; };
  const validConfig = () => {
    const c=window.ENGLISH_HERO_CLOUD_CONFIG;
    return c && /^https:\/\/[^/]+\.supabase\.co$/.test(c.supabaseUrl||'')
      && typeof c.supabaseAnonKey==='string'
      && c.supabaseAnonKey.length>20
      && !/YOUR_PROJECT|YOUR_SUPABASE|placeholder/i.test(c.supabaseUrl+c.supabaseAnonKey);
  };
  const setSignedInUI = () => {
    if($cloud('cloudUser')) $cloud('cloudUser').textContent=user ? user.email : '';
    if($cloud('cloudSignIn')) $cloud('cloudSignIn').disabled=!!user;
    if($cloud('cloudSignUp')) $cloud('cloudSignUp').disabled=!!user;
    if($cloud('cloudEmail')) $cloud('cloudEmail').disabled=!!user;
    if($cloud('cloudPassword')) $cloud('cloudPassword').disabled=!!user;
    if($cloud('cloudSignOut')) $cloud('cloudSignOut').disabled=!user;
    if($cloud('cloudSyncNow')) $cloud('cloudSyncNow').disabled=!user||!ready;
  };
  async function uploadProgress(){
    if(!client||!user||!ready) return;
    const current=revision;
    const {error}=await client.from('learning_progress').upsert({
      user_id:user.id, progress:state, updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
    if(error){status('تعذر رفع التقدم. سيبقى محفوظًا محليًا؛ تحقق من إعداد قاعدة البيانات والاتصال.');console.error('English Hero cloud save:',error.message);return;}
    if(current===revision) status('✅ تمت مزامنة تقدمك مع حسابك السحابي.');
  }
  window.queueCloudSave=function(){
    if(!user||!ready) return;
    revision++;
    clearTimeout(timer);
    timer=setTimeout(uploadProgress,900);
  };
  async function syncNow(){
    if(!user||!client) return;
    ready=false;setSignedInUI();status('جارٍ مزامنة تقدمك...');
    const {data,error}=await client.from('learning_progress').select('progress').eq('user_id',user.id).maybeSingle();
    if(error){status('تعذر قراءة التقدم السحابي. تحقق من SQL وسياسات RLS.');console.error('English Hero cloud load:',error.message);ready=true;setSignedInUI();return;}
    if(data && data.progress && typeof data.progress==='object' && !Array.isArray(data.progress)){
      try {
        localStorage.setItem('english-hero-academy-3',JSON.stringify(data.progress));
        status('تم استرجاع تقدم الحساب. جارٍ تحديث الصفحة...');
        location.reload();
        return;
      } catch(e) {
        status('تعذر استرجاع التقدم على هذا الجهاز؛ تحقق من مساحة التخزين.');
        ready=true;setSignedInUI();return;
      }
    }
    ready=true;setSignedInUI();
    await uploadProgress();
    status('تم حفظ تقدم هذا الجهاز في حسابك.');
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
        user=session?.user||null;
        setSignedInUI();
        if(event==='SIGNED_IN' && user) setTimeout(()=>syncNow(),0);
        if(event==='SIGNED_OUT'){ready=false;status('تم تسجيل الخروج. التقدم المحلي على هذا الجهاز لم يُحذف.');}
      });
    } catch(e) {
      status('تعذر تهيئة تسجيل الدخول. تحقق من إعدادات Supabase والاتصال بالإنترنت.');
      console.error('English Hero cloud init:',e.message);
    }
  }
  $cloud('cloudAuthForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!client){status('المزامنة غير مهيأة بعد. اضبط config.js أولًا.');return;}
    const email=$cloud('cloudEmail').value.trim();
    const password=$cloud('cloudPassword').value;
    $cloud('cloudSignIn').disabled=true;
    const {error}=await client.auth.signInWithPassword({email,password});
    $cloud('cloudSignIn').disabled=false;
    if(error) status('تعذر تسجيل الدخول. تأكد من البريد وكلمة المرور وإعدادات المصادقة.');
    else status('تم قبول تسجيل الدخول. جارٍ استرجاع تقدم الحساب...');
  });
  $cloud('cloudSignUp')?.addEventListener('click',async()=>{
    if(!client){status('المزامنة غير مهيأة بعد. اضبط config.js أولًا.');return;}
    const email=$cloud('cloudEmail').value.trim();
    const password=$cloud('cloudPassword').value;
    if(!email||password.length<8){status('أدخل بريدًا صحيحًا وكلمة مرور من 8 أحرف على الأقل.');return;}
    $cloud('cloudSignUp').disabled=true;
    const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});
    $cloud('cloudSignUp').disabled=false;
    if(error){status('تعذر إنشاء الحساب. تحقق من البريد أو جرّب لاحقًا.');return;}
    status(data.session?'تم إنشاء الحساب. جارٍ بدء المزامنة...':'تم إرسال رسالة تأكيد إذا كان تأكيد البريد مفعّلًا. افتح بريدك ثم سجّل الدخول.');
  });
  $cloud('cloudSignOut')?.addEventListener('click',async()=>{
    if(!client)return;
    const {error}=await client.auth.signOut();
    if(error) status('تعذر تسجيل الخروج. حاول مرة أخرى.');
  });
  $cloud('cloudSyncNow')?.addEventListener('click',syncNow);
  init();
})();