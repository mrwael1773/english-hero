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
      const {data,error}=await client.auth.getSession();
      const session=data?.session;
      if(error||!session?.user?.id){redirectToGateway();return;}
      const {data:profile,error:profileError}=await client.from('student_profiles')
        .select('user_id').eq('user_id',session.user.id).maybeSingle();
      if(profileError||!profile){redirectToGateway();return;}
      document.documentElement.classList.remove('eh-auth-pending');
    }catch{
      redirectToGateway();
    }
  })();
})();
