(function(){
  'use strict';
  const redirectToGateway=()=>{
    const next=location.pathname+location.search+location.hash;
    const target=new URL('./index.html',location.href);
    target.searchParams.set('next',next);
    location.replace(target.href);
  };
  (async()=>{
    try{
      const config=window.ENGLISH_HERO_CLOUD_CONFIG;
      if(!window.supabase?.createClient||!config?.supabaseUrl||!config?.supabaseAnonKey){
        redirectToGateway();return;
      }
      const client=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
      let verificationId=0;
      const lock=()=>document.documentElement.classList.add('eh-auth-pending');
      const verifyCurrentSession=async expectedUserId=>{
        const run=++verificationId;
        lock();
        try{
          const {data,error}=await client.auth.getSession();
          const userId=data?.session?.user?.id;
          if(run!==verificationId)return;
          if(error||!userId||(expectedUserId&&userId!==expectedUserId)){
            redirectToGateway();return;
          }
          const {data:profile,error:profileError}=await client.from('student_profiles')
            .select('user_id').eq('user_id',userId).maybeSingle();
          if(run!==verificationId)return;
          const {data:latest,error:latestError}=await client.auth.getSession();
          if(run!==verificationId)return;
          if(latestError||latest?.session?.user?.id!==userId||profileError||!profile){
            redirectToGateway();return;
          }
          document.documentElement.classList.remove('eh-auth-pending');
        }catch{
          if(run===verificationId)redirectToGateway();
        }
      };
      // Re-lock protected content and re-check ownership whenever the auth identity changes.
      client.auth.onAuthStateChange((event,session)=>{
        if(event==='SIGNED_OUT'||event==='USER_DELETED'){
          verificationId++;
          redirectToGateway();return;
        }
        if(['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED','PASSWORD_RECOVERY'].includes(event)){
          lock();
          const expectedUserId=session?.user?.id;
          if(!expectedUserId){verificationId++;redirectToGateway();return;}
          // Defer Supabase calls until outside its auth-state callback.
          setTimeout(()=>verifyCurrentSession(expectedUserId),0);
        }
      });
      await verifyCurrentSession();
    }catch{
      redirectToGateway();
    }
  })();
})();
