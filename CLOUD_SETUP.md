# إعداد الحسابات والمزامنة ومدرب الذكاء الاصطناعي في English Hero

الموقع منشور على GitHub Pages، ويستخدم مشروع Supabase التالي للخدمات السحابية:

- Supabase Project ref: `cajevfsdhtbhtzcphbsz`
- الموقع: `https://mrwael1773.github.io/english-hero/`
- ملف إعداد الواجهة العامة: `config.js` (يحتوي على Project URL ومفتاح publishable فقط؛ لا تضع فيه أسرارًا).

## ما تم تجهيزه ونشره

- تسجيل الدخول بالبريد وكلمة المرور وتسجيل الدخول عبر Google باستخدام Supabase Auth.
- جدول `public.learning_progress` لتخزين تقدم كل متعلم، مع RLS وسياسات تحد كل مستخدم بسجله.
- مزامنة تقدم المستخدم عند تسجيل الدخول، وإعادة المحاولة عند عودة الاتصال أو الرجوع إلى التبويب.
- وظيفة Supabase Edge Function باسم `english-coach`، وهي تستقبل الرسائل الموثقة وتطلب ردًا من OpenAI على الخادم.
- واجهة محادثة تستخدم الذكاء الاصطناعي، وإملاء صوتي عند دعم المتصفح، وقراءة الرد بصوت مسموع.

## خطوة مطلوبة لتشغيل الذكاء الاصطناعي

وظيفة `english-coach` منشورة، لكنها لن تجيب حتى تضيف مفتاح OpenAI كسرّ داخل Supabase. لا ترسل المفتاح في المحادثة ولا تحفظه في GitHub أو في `config.js`.

1. افتح [أسرار Edge Functions في Supabase](https://supabase.com/dashboard/project/cajevfsdhtbhtzcphbsz/functions/secrets). إذا لم تظهر الصفحة مباشرة، افتح مشروع Supabase ثم **Edge Functions → Secrets**.
2. أضف secret باسم `OPENAI_API_KEY`، واجعل قيمته مفتاح API الخاص بك من [منصة OpenAI](https://platform.openai.com/api-keys).
3. احفظ السر. إذا لم تكن لديك صلاحية إضافة الأسرار، افتح المشروع بالحساب الذي يملك صلاحية إدارة الأسرار.

تُرسل الرسائل إلى OpenAI من الخادم فقط؛ مفتاح OpenAI لا يُرسل إلى المتصفح.

## تفعيل تسجيل الدخول عبر Google

1. في Supabase افتح [Authentication URL Configuration](https://supabase.com/dashboard/project/cajevfsdhtbhtzcphbsz/auth/url-configuration).
2. اجعل **Site URL** هو `https://mrwael1773.github.io`.
3. أضف إلى **Redirect URLs** هذا العنوان بالضبط: `https://mrwael1773.github.io/english-hero/`.
4. افتح إعدادات **Authentication → Sign In / Providers → Google** وفعّل Google.
5. إذا لم تكن بيانات Google OAuth مُعدّة بعد، أنشئ OAuth Client من Google Cloud Console، وأضف عنوان callback الذي يعرضه Supabase في صفحة مزود Google ضمن **Authorized redirect URIs**. ضع Client ID وClient Secret في إعداد مزود Google داخل Supabase فقط، ولا تضعهما في GitHub.
6. اختبر تسجيل الدخول في الموقع على الهاتف والكمبيوتر.

## اختبار حفظ التقدم

1. سجّل الدخول إلى English Hero.
2. أكمل درسًا أو اختبارًا، وتحقق من ظهور رسالة نجاح المزامنة في ملف الإنجازات.
3. افتح الموقع في متصفح آخر أو جهاز آخر وسجّل الدخول بالحساب نفسه.
4. تأكد من ظهور النقاط والدروس والاختبارات والإنجازات نفسها.
5. إذا ظهر خطأ مزامنة، راجع سياسات RLS وسجلّات Supabase. لا تحذف السجل المحلي قبل التأكد من وجود نسخة احتياطية.

## حدود الصوت

- يستخدم زر الميكروفون ميزة Web Speech API لتحويل كلام المتعلم إلى نص؛ دعم التعرف على الكلام يختلف حسب المتصفح ونظام التشغيل وقد يحتاج إذن الميكروفون.
- يستخدم زر القراءة الصوتية أصوات الجهاز/المتصفح، ولا يتطلب مفتاحًا إضافيًا.
- المحادثة الذكية تتطلب اتصال إنترنت ومفتاح OpenAI صالحًا مع رصيد/فوترة فعّالة حسب حساب OpenAI.

## الأمان

- لا تضع مفتاح OpenAI أو Supabase service-role/secret key أو Google Client Secret في أي ملف عام.
- جدول التقدم يفعّل Row Level Security ويقيّد القراءة والكتابة بهوية المستخدم.
- لا تعتبر تسجيل الدخول عبر Google أو استجابة الذكاء الاصطناعي مكتملة حتى تنجح اختبارات الدخول الفعلية في المتصفح.
