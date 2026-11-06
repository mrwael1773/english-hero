(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const gateway=byId('authGateway');
  if(!gateway)return;
  const panes={login:byId('authLoginPane'),register:byId('authRegisterPane'),onboarding:byId('authOnboardingPane')};
  const message=byId('authGatewayMessage');
  const tabs=[...gateway.querySelectorAll('[data-auth-mode]')];
  let cloud=null;
  let busy=false;
  function say(text,kind='info'){message.textContent=text;message.dataset.kind=kind;}
  function setBusy(value){busy=value;gateway.querySelectorAll('button').forEach(button=>{button.disabled=value;});}
  function showPane(name){
    Object.entries(panes).forEach(([key,pane])=>{pane.hidden=key!==name;});
    tabs.forEach(tab=>{tab.setAttribute('aria-selected',String(tab.dataset.authMode===name));});
    say('');
  }
  function safeNextPath(){
    const raw=new URLSearchParams(location.search).get('next');
    if(!raw)return null;
    try{
      const target=new URL(raw,location.origin);
      const basePath=new URL('./',location.href).pathname;
      const allowed=['english-basics.html','english-tenses-guide.html','grammar-lesson.html','grammar-library.html','grammar-category.html'];
      if(target.origin!==location.origin||!allowed.some(file=>target.pathname===basePath+file))return null;
      return target.pathname+target.search+target.hash;
    }catch{return null;}
  }
  const requestedNextPath=safeNextPath();
  // Never leave an untrusted redirect target in the address bar after validation.
  if(new URLSearchParams(location.search).has('next')){
    const cleanUrl=new URL(location.href);
    cleanUrl.searchParams.delete('next');
    history.replaceState(history.state,'',cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
  }
  function unlock(){
    gateway.hidden=true;document.body.classList.remove('auth-gateway-pending');
    if(requestedNextPath)location.replace(requestedNextPath);
  }
  function lock(){gateway.hidden=false;document.body.classList.add('auth-gateway-pending');}
  async function inspectSession(){
    const user=cloud.getUser();
    if(!user){lock();showPane('login');return;}
    // Do not expose learning screens until this account's cloud progress has loaded.
    if(!cloud.isReady?.()){
      lock();showPane('login');
      say('تم التحقق من الحساب، لكن لم تكتمل استعادة تقدمك بعد. أعد تحميل الصفحة عند استقرار الاتصال؛ أبقينا التعلم مغلقًا لحماية بياناتك.','error');
      return;
    }
    try{
      const profile=await cloud.getProfile();
      if(profile){unlock();return;}
      lock();showPane('onboarding');
      say('أهلًا بك! أكمل بيانات حسابك لتجهيز ملفك وحفظ تقدمك على هذا الحساب.');
    }catch(error){
      lock();showPane('onboarding');
      say('تعذر قراءة ملف الحساب. تحقق من الاتصال ثم أعد المحاولة.','error');
    }
  }
  async function start(){
    if(!window.EnglishHeroCloudReady){say('جارٍ تجهيز خدمة الحسابات...');return;}
    const configured=await window.EnglishHeroCloudReady;
    cloud=window.EnglishHeroCloud;
    if(!configured||!cloud?.isConfigured()){
      lock();showPane('login');
      say('خدمة الحسابات غير مهيأة حاليًا. لم نفتح محتوى التعلم لتجنب إنشاء تقدم غير مرتبط بحساب.','error');
      gateway.querySelectorAll('button').forEach(button=>button.disabled=true);
      return;
    }
    await inspectSession();
  }
  tabs.forEach(tab=>tab.addEventListener('click',()=>showPane(tab.dataset.authMode)));
  gateway.querySelectorAll('[data-auth-back]').forEach(button=>button.addEventListener('click',()=>showPane('login')));
  gateway.querySelectorAll('[data-google-auth]').forEach(button=>button.addEventListener('click',async()=>{
    if(busy)return;
    setBusy(true);say('جارٍ تحويلك إلى Google لإتمام التحقق...');
    try{await cloud.signInWithGoogle(requestedNextPath);setBusy(false);}
    catch(error){say('تعذر بدء تسجيل الدخول عبر Google. تحقق من إعدادات Google OAuth ثم حاول مجددًا.','error');setBusy(false);}
  }));
  byId('authLoginForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const username=byId('authLoginUsername').value.trim().toLowerCase();
    const password=byId('authLoginPassword').value;
    setBusy(true);say('جارٍ التحقق من بيانات الحساب...');
    try{await cloud.signInWithUsername(username,password);await inspectSession();}
    catch(error){say(error?.context?.status===429?'محاولات كثيرة. انتظر 15 دقيقة ثم حاول مجددًا.':(error?.message||'تعذر تسجيل الدخول. تحقق من البيانات وحاول مجددًا.'),'error');}
    finally{setBusy(false);}
  });
  byId('authOnboardingForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const displayName=byId('authDisplayName').value.trim().replace(/\s+/g,' ');
    const username=byId('authNewUsername').value.trim().toLowerCase();
    const password=byId('authNewPassword').value;
    const confirmation=byId('authConfirmPassword').value;
    if(!/^[a-z0-9_]{3,24}$/.test(username)){say('اسم المستخدم يجب أن يكون من 3 إلى 24 حرفًا إنجليزيًا صغيرًا أو رقمًا أو _ فقط.','error');return;}
    if(displayName.length<1||displayName.length>48){say('اكتب اسمًا من حرف واحد إلى 48 حرفًا.','error');return;}
    if(password.length<8||password.length>128){say('كلمة المرور يجب أن تكون بين 8 و128 حرفًا.','error');return;}
    if(password!==confirmation){say('تأكيد كلمة المرور غير مطابق.','error');return;}
    setBusy(true);say('جارٍ تجهيز حسابك وحفظ بيانات الملف...');
    try{
      await cloud.setPassword(password);
      await cloud.claimProfile(username,displayName);
      say('تم إعداد حسابك بنجاح. جارٍ فتح مساحة التعلم...','success');
      await inspectSession();
    }catch(error){
      const text=String(error?.message||'');
      say(text.includes('student_profiles_username_unique')||text.includes('duplicate key')?'اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.':(text.includes('verified email')?'تعذر التحقق من البريد المرتبط بحساب Google.':'تعذر حفظ بيانات الحساب. تحقق من اسم المستخدم والاتصال ثم حاول مجددًا.'),'error');
    }finally{setBusy(false);}
  });
  window.addEventListener('englishhero:authstate',()=>{if(cloud)inspectSession();});
  window.addEventListener('englishhero:authready',()=>{if(cloud)inspectSession();});
  start();
})();