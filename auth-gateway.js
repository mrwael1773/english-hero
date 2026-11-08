(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const gateway=byId('authGateway');
  if(!gateway)return;
  const panes={login:byId('authLoginPane'),register:byId('authRegisterPane'),recoveryRequest:byId('authRecoveryRequestPane'),recoveryComplete:byId('authRecoveryCompletePane'),onboarding:byId('authOnboardingPane')};
  const message=byId('authGatewayMessage');
  const tabs=[...gateway.querySelectorAll('[data-auth-mode]')];
  let cloud=null;
  let busy=false;
  let sessionCheckId=0;
  const googleAuthIntentKey='englishHeroGoogleAuthIntent';
  function readGoogleAuthIntent(){try{return sessionStorage.getItem(googleAuthIntentKey)||'';}catch{return '';}}
  function clearGoogleAuthIntent(){try{sessionStorage.removeItem(googleAuthIntentKey);}catch{}}
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
  function showRecoveryComplete(){sessionCheckId++;lock();showPane('recoveryComplete');say('أدخل كلمة مرور جديدة لحسابك.');}
  async function inspectSession({allowOnboarding=false}={}){
    const checkId=++sessionCheckId;
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
      // A newer auth event (especially SIGNED_OUT or account switching) invalidates
      // this request. Never unlock based on a profile response for a stale session.
      if(checkId!==sessionCheckId || cloud.getUser()?.id!==user.id)return;
      if(profile && readGoogleAuthIntent()==='register'){
        sessionCheckId++;
        try{
          await cloud.signOut();
          clearGoogleAuthIntent();
          lock();showPane('login');
          say('هذا الحساب مسجل بالفعل في بطل الإنجليزي. استخدم «تسجيل الدخول» بدلًا من إنشاء حساب جديد.','error');
        }catch(error){
          lock();showPane('login');
          say('هذا الحساب مسجل بالفعل، وتعذر إنهاء جلسة Google تلقائيًا. أعد المحاولة من قسم تسجيل الدخول.','error');
        }
        return;
      }
      if(profile){clearGoogleAuthIntent();unlock();return;}
      if(readGoogleAuthIntent()==='login'){
        // OAuth may return a newly provisioned Auth identity. A login attempt must
        // never turn that identity into a student profile or open onboarding.
        sessionCheckId++;
        try{
          await cloud.signOut();
          clearGoogleAuthIntent();
          lock();showPane('login');
          say('هذا الحساب غير مسجل في بطل الإنجليزي. انتقل إلى «إنشاء حساب» إذا كنت تريد التسجيل.','error');
        }catch(error){
          lock();showPane('login');
          say('هذا الحساب غير مسجل، وتعذر إنهاء جلسة Google تلقائيًا. أعد المحاولة بعد التحقق من الاتصال.','error');
        }
        return;
      }
      if(readGoogleAuthIntent()!=='register'&&!allowOnboarding){
        lock();showPane('login');
        say('هذا الحساب لا يملك ملف طالب مسجلًا. استخدم «إنشاء حساب» للتسجيل، أو استعادة كلمة المرور إذا كان حسابك قديمًا.','error');
        return;
      }
      lock();showPane('onboarding');
      say('أهلًا بك! أكمل بيانات حسابك لتجهيز ملفك وحفظ تقدمك على هذا الحساب.');
    }catch(error){
      if(checkId!==sessionCheckId || cloud.getUser()?.id!==user.id)return;
      // A profile-read failure is not proof that this is a new account.
      // Fail closed: never show onboarding or allow a profile claim on a transient read error.
      lock();showPane('login');
      say('تعذر التحقق من ملف الحساب. لم نعرض نموذج إنشاء الحساب حتى لا نغيّر بيانات حساب قائم. تحقق من الاتصال ثم أعد المحاولة.','error');
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
    let recoveryPending=window.EnglishHeroPasswordRecovery===true;
    try { recoveryPending=recoveryPending || sessionStorage.getItem('englishHeroPasswordRecovery')==='1'; } catch {}
    if(recoveryPending){showRecoveryComplete();return;}
    await inspectSession();
  }
  tabs.forEach(tab=>tab.addEventListener('click',()=>showPane(tab.dataset.authMode)));
  gateway.querySelectorAll('[data-auth-back]').forEach(button=>button.addEventListener('click',()=>showPane('login')));
  byId('authForgotPassword').addEventListener('click',()=>showPane('recoveryRequest'));
  byId('authRecoveryRequestForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const email=byId('authRecoveryEmail').value.trim();
    if(!email||email.length>254){say('اكتب بريدًا إلكترونيًا صحيحًا.','error');return;}
    setBusy(true);say('جارٍ إرسال طلب الاستعادة...');
    try{
      await cloud.sendPasswordRecovery(email);
      say('إذا كان البريد مرتبطًا بحساب، فستصلك رسالة تحتوي رابط الاستعادة. تحقق من صندوق الوارد والرسائل غير المرغوب فيها.','success');
    }catch(error){say('تعذر إرسال طلب الاستعادة حاليًا. تحقق من الاتصال وحاول مجددًا.','error');}
    finally{setBusy(false);}
  });
  byId('authRecoveryCompleteForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const password=byId('authRecoveryNewPassword').value;
    const confirmation=byId('authRecoveryConfirmPassword').value;
    if(password.length<8||password.length>128){say('كلمة المرور يجب أن تكون بين 8 و128 حرفًا.','error');return;}
    if(password!==confirmation){say('تأكيد كلمة المرور غير مطابق.','error');return;}
    setBusy(true);say('جارٍ تحديث كلمة المرور...');
    try{
      await cloud.updateRecoveredPassword(password);
      window.EnglishHeroPasswordRecovery=false;
      try { sessionStorage.removeItem('englishHeroPasswordRecovery'); } catch {}
      say('تم تحديث كلمة المرور. جارٍ استعادة تقدمك وفتح حسابك...','success');
      await inspectSession({allowOnboarding:true});
    }catch(error){say('تعذر تحديث كلمة المرور. قد يكون رابط الاستعادة منتهي الصلاحية أو مستخدمًا؛ اطلب رابطًا جديدًا.','error');}
    finally{setBusy(false);}
  });
  gateway.querySelectorAll('[data-google-auth]').forEach(button=>button.addEventListener('click',async()=>{
    if(busy)return;
    const intent=button.closest('#authRegisterPane')?'register':'login';
    try{sessionStorage.setItem(googleAuthIntentKey,intent);}catch{}
    setBusy(true);say('جارٍ تحويلك إلى Google لإتمام التحقق...');
    try{await cloud.signInWithGoogle(requestedNextPath);setBusy(false);}
    catch(error){clearGoogleAuthIntent();say('تعذر بدء تسجيل الدخول عبر Google. تحقق من إعدادات Google OAuth ثم حاول مجددًا.','error');setBusy(false);}
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
  window.addEventListener('englishhero:authstate',event=>{
    if(!cloud)return;
    if(event.detail?.event==='PASSWORD_RECOVERY'){showRecoveryComplete();return;}
    if(cloud.getUser()?.id && panes.recoveryComplete && !panes.recoveryComplete.hidden)return;
    inspectSession();
  });
  window.addEventListener('englishhero:authready',()=>{if(cloud)inspectSession();});
  start();
})();