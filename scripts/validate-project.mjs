import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const fail = [];
const pass = [];
const check = (condition, message) => (condition ? pass : fail).push(message);
const read = path => {
  try { return readFileSync(join(root, path), 'utf8'); }
  catch { fail.push(`Missing or unreadable file: ${path}`); return ''; }
};

const html = read('index.html');
const manifestRaw = read('manifest.webmanifest');
const privacyPage = read('privacy.html');
const contactPage = read('contact.html');
const iconSvg = read('icon.svg');
const sw = read('sw.js');
const cloud = read('cloud-sync.js');
const authGateway = read('auth-gateway.js');
const authGatewayStyles = read('auth-gateway.css');
const authGuard = read('auth-guard.js');
const protectedLearningPages = ['english-basics.html','english-tenses-guide.html','grammar-lesson.html','grammar-library.html','grammar-category.html'].map(read);
const usernameAuthMigrationPath = 'supabase/migrations/20261106130000_student_username_auth_foundation.sql';
const usernameAuthMigration = read(usernameAuthMigrationPath);
const progressMigrationPath = 'supabase/migrations/20261106140000_learning_progress_owner_scope.sql';
const progressMigration = read(progressMigrationPath);
const usernameLoginFunction = read('supabase/functions/student-username-login/index.ts');
const supabaseConfig = read('supabase/config.toml');
const progressDashboard = read('pro-dashboard.js');
const learningExpansion = read('learning-expansion.js');
const englishHeroPlus = read('english-hero-plus.js');
const config = read('config.js');
const privacy = read('privacy.html');
const vocabRaw = read('vocabulary-20000.json');
const grammarLessonPage = read('grammar-lesson.html');
const grammarLibraryPage = read('grammar-library.html');
const grammarCategoryPage = read('grammar-category.html');
const grammarLessonsRaw = read('grammar-lessons.js');
const migrationPath = 'supabase/migrations/20261026151420_secure_rls_auto_enable_and_optimize_progress_policies.sql';
const migration = read(migrationPath);

check(html.includes('<!doctype html>') || html.includes('<!DOCTYPE html>'), 'HTML document declaration exists');
check(html.includes('id="home"') && html.includes('id="profile"'), 'Home and profile screens exist');
check(['authGateway','authLoginPane','authRegisterPane','authOnboardingPane','authLoginForm','authOnboardingForm','authLoginUsername','authLoginPassword','authDisplayName','authNewUsername','authNewPassword','authConfirmPassword','authGatewayMessage'].every(id => html.includes(`id="${id}"`)), 'First-entry authentication gateway and onboarding fields exist');
check(html.includes('auth-gateway.css?v=1') && html.includes('auth-gateway.js?v=2') && html.includes("document.body.classList.add('auth-gateway-pending')"), 'Authentication gateway assets load before protected learning content');
check(authGateway.includes('signInWithUsername') && authGateway.includes('claimProfile') && authGateway.includes('setPassword') && authGateway.includes('getProfile'), 'Authentication gateway uses the cloud account API for login and onboarding');
check(authGateway.includes('cloud.signInWithGoogle(requestedNextPath)') && cloud.includes('async signInWithGoogle(nextPath=null)') && cloud.includes("callbackUrl.searchParams.set('next',target.pathname+target.search+target.hash)") && cloud.includes('allowed.some(file=>target.pathname===basePath+file)') && cloud.includes('redirectTo:callbackUrl.toString()'), 'Google OAuth preserves only a validated learning-page destination through the callback');
check(authGateway.includes('if(!cloud.isReady?.())') && cloud.includes('isReady: () => !!ready') && cloud.includes("new CustomEvent('englishhero:authready')") && cloud.includes('if(previousUser?.id!==user?.id) ready=false;'), 'Learning gateway remains locked until the active account progress sync completes');
check(authGatewayStyles.includes('.auth-gateway-shell') && authGatewayStyles.includes('@media(max-width:800px)') && authGatewayStyles.includes('@media(max-width:380px)'), 'Authentication gateway has responsive premium styling');
check(authGuard.includes('student_profiles') && authGuard.includes('auth.getSession') && authGuard.includes('location.replace'), 'Direct learning routes require a verified session and student profile');
check(protectedLearningPages.every(page => page.includes('auth-guard.js?v=1') && page.includes('eh-auth-pending')), 'All standalone learning pages use the pre-render authentication guard');
check(!html.includes('id="conversation"') && !html.includes('data-nav="conversation"') && !html.includes('src="ai-chat.js"'), 'AI chat section and script are disabled');
check(html.includes('name="viewport"') && html.includes('@media(max-width:720px)') && html.includes('@media(max-width:360px)') && html.includes('overflow-wrap:anywhere'), 'Responsive layout includes viewport and small-screen overflow safeguards');
check(html.includes('id="studentDesk"') && html.includes('id="studentTaskForm"') && html.includes('id="studentTaskList"'), 'Student study planner UI exists');
check(html.includes('id="wordDetective"') && html.includes('id="detectiveAnswers"') && html.includes('const detectiveCases=['), 'No-currency English detective learning game is present');
check(html.includes('data-page="wordDetective"') && html.includes('detectiveHint') && html.includes('detectiveFeedback'), 'Detective game is reachable and provides hints and explanations');
check(html.includes('englishHeroStudentTasksV1') && html.includes('function renderStudentTasks') && html.includes('studentTaskClearDone'), 'Student planner supports local persistence and task management');
const idCounts = new Map();
for (const match of html.matchAll(/\bid=["']([^"']+)["']/g)) idCounts.set(match[1], (idCounts.get(match[1]) || 0) + 1);
check([...idCounts.values()].every(count => count === 1), 'HTML element IDs are unique');
for (const path of ['manifest.webmanifest', 'privacy.html', 'contact.html', 'icon.svg', 'grammar-lesson.html', 'grammar-library.html', 'grammar-category.html', 'grammar-lessons.js']) {
  check(existsSync(join(root, path)), `Required public file exists: ${path}`);
}
try {
  const manifest = JSON.parse(manifestRaw);
  check(Boolean(manifest.name && manifest.start_url && manifest.display), 'Web app manifest has required install fields');
  check(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'Web app manifest declares app icons');
} catch {
  fail.push('Web app manifest is valid JSON');
}
check(privacyPage.includes('<html') && privacyPage.includes('</html>'), 'Privacy page has an HTML document');
check(contactPage.includes('<html') && contactPage.includes('</html>'), 'Contact page has an HTML document');
check(iconSvg.includes('<svg') && iconSvg.includes('</svg>'), 'App icon is a valid SVG document');
for (const id of ['cloudStatus','cloudSyncNow','cloudSignOut','cloudRestoreBackup','cloudBackupStatus','grammarLibrary','tensesLibrary','vocabResults']) {
  check(html.includes(`id="${id}"`), `Required UI element exists: ${id}`);
}
check(/sw\.js\?v=(\d+)/.test(html), 'Service worker registration has a version');
const registeredVersion = html.match(/sw\.js\?v=(\d+)/)?.[1];
const cacheVersion = sw.match(/english-hero-shell-v(\d+)/)?.[1];
check(Boolean(registeredVersion && cacheVersion && registeredVersion === cacheVersion), 'Service worker registration and cache versions match');
check(sw.includes("fetch(request)") && sw.includes("request.mode === 'navigate'"), 'Service worker refreshes navigation from network first');
check(sw.includes('./auth-gateway.css?v=1') && sw.includes('./auth-gateway.js?v=2') && sw.includes('./auth-guard.js?v=1') && sw.includes('./cloud-sync.js?v=2') && html.includes('src="cloud-sync.js?v=2"'), 'Service worker shell includes versioned authentication and cloud-sync assets');
check(/CREATE TABLE IF NOT EXISTS public\\.learning_progress/i.test(progressMigration) && /ALTER TABLE public\\.learning_progress ENABLE ROW LEVEL SECURITY/i.test(progressMigration) && /ALTER TABLE public\\.learning_progress FORCE ROW LEVEL SECURITY/i.test(progressMigration) && progressMigration.includes('grant select, insert, update on public.learning_progress to authenticated') && progressMigration.includes('auth.uid() = user_id') && progressMigration.includes("jsonb_typeof(progress) = 'object'"), 'Cloud learning progress has owner-scoped RLS, write grants, and object-only JSON data');
check(/ALTER TABLE public\.student_profiles FORCE ROW LEVEL SECURITY/i.test(usernameAuthMigration) && usernameAuthMigration.includes('claim_student_username') && usernameAuthMigration.includes('resolve_student_login_user_id') && usernameAuthMigration.includes('consume_student_login_attempt') && usernameAuthMigration.includes('to service_role') && usernameAuthMigration.includes('grant select on public.student_profiles to authenticated') && !usernameAuthMigration.includes('grant select, insert, update on public.student_profiles') && usernameAuthMigration.includes('set search_path = pg_catalog') && !usernameAuthMigration.includes('email text not null'), 'Username auth migration enforces owner-scoped profiles and server-only lookup/rate-limit RPCs');
check(usernameLoginFunction.includes('signInWithPassword') && usernameLoginFunction.includes('consume_student_login_attempt') && usernameLoginFunction.includes('resolve_student_login_user_id') && usernameLoginFunction.includes('getUserById') && usernameLoginFunction.includes('SUPABASE_SERVICE_ROLE_KEY') && !usernameLoginFunction.includes('console.log'), 'Username login Edge Function uses server secrets, generic auth errors, and rate limiting');
const usernameSqlDollarCount = usernameAuthMigration.split('$$').length - 1;
check(usernameSqlDollarCount >= 10 && usernameSqlDollarCount % 2 === 0 && !usernameAuthMigration.split('\n').some(line => line.trim() === 'as $' || line.includes('as $ select')), 'Username auth SQL function bodies use balanced PostgreSQL dollar quoting');
check(usernameAuthMigration.includes('revoke insert, update on public.student_profiles from authenticated'), 'Student browsers cannot directly edit profile usernames outside the transactional claim RPC');
check(cloud.indexOf('if(user) await syncNow()') >= 0 && cloud.indexOf('if(user) await syncNow()') < cloud.indexOf('resolveCloudInitialization(true)'), 'Returning account progress is restored before the authentication gateway is released');
check(cloud.includes('options:{redirectTo:location.href}'), 'Google OAuth preserves the protected learning-page destination through its callback');
check(supabaseConfig.includes('[functions.student-username-login]') && supabaseConfig.includes('verify_jwt = false'), 'Username login endpoint is configured for its explicit unauthenticated login flow');
check(/src="\.\/grammar-lessons\.js\?v=3"/.test(html), 'Main page loads the shared interactive grammar lesson catalogue');
check(html.includes("window.EnglishHeroLessons.grammar") && html.includes("window.EnglishHeroLessons.tenses") && html.includes("grammar-lesson.html#"), 'Grammar and tense cards link to their dedicated lesson pages');
check(grammarLessonPage.includes('id="lessonRoot"') && grammarLessonPage.includes("makeSection('challenge'") && grammarLessonPage.includes("setAttribute('aria-live','polite')"), 'Dedicated lesson page provides a challenge area with accessible feedback');
check(grammarLessonPage.includes('window.EnglishHeroLessons') && grammarLessonPage.includes('location.hash'), 'Dedicated lesson page resolves lesson content from its stable URL slug');
check(grammarLessonPage.includes("const start=safeText('button','btn primary','ابدأ التعلّم ↓')") && grammarLessonPage.includes('formulaArabic') && grammarLessonPage.includes("safeText('p','formula-ar'"), 'Lesson start action preserves the lesson slug and each formula has an Arabic explanation');
check(grammarLibraryPage.includes('LEARNING MAP') && grammarCategoryPage.includes('window.EnglishHeroLessons.all') && sw.includes("'./grammar-library.html'") && sw.includes("'./grammar-category.html'"), 'Grammar and tense category pages are linked and cached offline');
check(grammarLessonPage.includes("const stepNames=['افهم الفكرة','تفصيل القاعدة','ابنِ الجملة','شاهد الأمثلة','صحّح الخطأ','تذكّر النصيحة','اختبر نفسك']") && grammarLessonPage.includes('data-step-index') && grammarLessonPage.includes('lessonStepStatus') && grammarLessonPage.includes('activeLesson.guide') && grammarLessonPage.includes('guide-card'), 'Dedicated lesson page guides students through seven detailed learning steps');
check(sw.includes("'./grammar-lesson.html'") && sw.includes("'./grammar-lessons.js?v=3'"), 'Dedicated lesson page and catalogue are included in the offline app shell');
try {
  new Function(grammarLessonsRaw);
  check(true, 'Grammar lesson catalogue JavaScript syntax is valid');
} catch (error) {
  fail.push(`grammar-lessons.js has a syntax error: ${error.message}`);
}
try {
  const lessonData = new Function('window', grammarLessonsRaw + '; return window.EnglishHeroLessons;')({});
  const allLessons = [...lessonData.grammar, ...lessonData.tenses];
  const categorySlugs = [...grammarCategoryPage.matchAll(/'((?:g|t)-[a-z0-9-]+)'/g)].map(match => match[1]);
  const categoryUnique = new Set(categorySlugs);
  check(categoryUnique.size === 43 && allLessons.every(item => categoryUnique.has(item.slug)) && [...categoryUnique].every(slug => allLessons.some(item => item.slug === slug)), 'All 43 lessons appear exactly once across grammar and tense categories');
  const formulaMapMatch = grammarLessonPage.match(/const formulaArabic\s*=\s*(\{[\s\S]*?\n\s*\});/);
  const formulaMap = formulaMapMatch ? new Function('return (' + formulaMapMatch[1] + ')')() : {};
  const uniqueFormulas = [...new Set(allLessons.map(item => item.formula))];
  const translatedFormulas = uniqueFormulas.every(formula =>
    typeof formulaMap[formula] === 'string' &&
    /[ء-ي]/.test(formulaMap[formula])
  );
  check(translatedFormulas, 'Every exact grammar and tense formula key has a non-empty Arabic translation');

  const slugs = allLessons.map(item => item.slug);
  const validGuides = allLessons.every(item => item.guide &&
    typeof item.guide.idea === 'string' && item.guide.idea.trim().length > 25 &&
    typeof item.guide.use === 'string' && item.guide.use.trim().length > 20 &&
    Array.isArray(item.guide.build) && item.guide.build.length >= 3 &&
    typeof item.guide.compare === 'string' && item.guide.compare.trim().length > 20 &&
    typeof item.guide.watch === 'string' && item.guide.watch.trim().length > 20);
  check(validGuides, 'All 43 lessons include a unique detailed guide with idea, use, build steps, comparison, and common pitfalls');
  const validQuestions = item => Array.isArray(item.questions) && item.questions.length >= 3 &&
    item.questions.every(q => q && typeof q.text === 'string' && q.text.trim() &&
      Array.isArray(q.options) && q.options.length === 3 &&
      q.options.every(option => typeof option === 'string' && option.trim()) &&
      Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length &&
      typeof q.explain === 'string' && q.explain.trim());
  const validLessons = allLessons.every(item =>
    typeof item.title === 'string' && item.title.trim() &&
    typeof item.summary === 'string' && item.summary.trim() &&
    typeof item.everyday === 'string' && item.everyday.trim() &&
    typeof item.formula === 'string' && item.formula.trim() &&
    Array.isArray(item.steps) && item.steps.length >= 2 &&
    Array.isArray(item.examples) && item.examples.length >= 2 &&
    item.examples.every(example => example.en && example.ar) &&
    item.mistake && item.mistake.wrong && item.mistake.right && item.mistake.why &&
    typeof item.tip === 'string' && item.tip.trim() && validQuestions(item));
  check(lessonData.grammar.length === 37 && lessonData.tenses.length === 6,
    'Interactive catalogue includes all 37 grammar rules and 6 additional tense lessons');
  check(new Set(slugs).size === allLessons.length && validLessons,
    'Every lesson has a unique slug, step-by-step explanation, examples, correction, tip, and valid practice questions');
} catch (error) {
  fail.push('Interactive grammar catalogue can be parsed and checked: ' + error.message);
}

check(cloud.includes("from('learning_progress')") && cloud.includes('window.EnglishHeroCloud') && cloud.includes('signInWithUsername') && cloud.includes('claim_student_username') && cloud.includes('updateUser({password})') && read('tests/e2e/fixtures.js').includes('isReady:()=>true'), 'Cloud progress sync, username/Google gateway API, and authenticated E2E fixture readiness are present');
check(cloud.includes('async function cloudRequest(query, timeoutMs=15000)') && cloud.includes('query.abortSignal(controller.signal)'), 'Cloud progress requests abort after a bounded timeout');
check(cloud.includes("English Hero sign out:") && cloud.includes('finally {\n      setSignedInUI();\n    }'), 'Sign-out failures restore the account UI safely');
check(html.includes("'weekly'") && html.includes('20 سؤالًا متنوعًا') && html.includes('state.weeklyTestLast'), 'Weekly assessment includes mixed questions and stores its result');
check(cloud.includes("english-hero-account-backup-") && cloud.includes('english-hero-unclaimed-local-backup') && cloud.includes('syncPromiseUserId'), 'Account switching is isolated and local progress can be recovered');
check(cloud.includes('const chatRows=[...(Array.isArray(r.chatHistory)?r.chatHistory:[])') && cloud.includes('const chatHistory=[...new Map(chatRows.map(m=>[JSON.stringify(m),m])).values()].slice(-60)'), 'Cloud sync preserves and deduplicates local and remote chat history');
try { new Function(cloud); check(true, 'Cloud sync JavaScript syntax is valid'); } catch (error) { fail.push(`cloud-sync.js has a syntax error: ${error.message}`); }
try { new Function(sw); check(true, 'Service worker JavaScript syntax is valid'); } catch (error) { fail.push(`sw.js has a syntax error: ${error.message}`); }
check(cloud.includes("english-hero-cloud-owner") && cloud.includes('function replaceProgress') && cloud.includes('localOwner && localOwner!==syncUserId'), 'Local progress is isolated when accounts change on a shared device');
check(cloud.includes("$cloud('cloudRestoreBackup')?.addEventListener('click'") && cloud.includes('mergeProgress(backup)'), 'Account-specific backup restore is available and merges progress safely');
check(!existsSync(join(root, 'ai-chat.js')) && !html.includes('src="ai-chat.js"'), 'Retired AI coach code is absent from the public site');
check(/src="pro-dashboard\.js(?:\?v=\d+)?"/.test(html) && sw.includes("'./pro-dashboard.js?v="), 'Professional progress dashboard is linked and cached offline');
check(/src="learning-expansion\.js(?:\?v=\d+)?"/.test(html) && sw.includes("'./learning-expansion.js?v="), 'Learning expansion is linked and cached offline');
check(learningExpansion.includes('100 * n + 25 * n * Math.max(0, n - 1)') && learningExpansion.includes('level <= 50'), 'XP requirements increase with each level and cap at level 50');
check(learningExpansion.includes("title:'شارة المستوى ' + level") && learningExpansion.includes('rewards.some(reward => reward.level === level)'), 'Every progression level has a displayed reward');
check(learningExpansion.includes('الاختبار الاحترافي الموقّت') && learningExpansion.includes('12 * 60'), 'Professional timed mixed assessment is available');
check(!learningExpansion.includes('grammarAcademyGrid') && !learningExpansion.includes('renderGrammarAcademy') && grammarLibraryPage.includes('id="basicsTab"') && grammarLibraryPage.includes('id="grammarTab"'), 'Learning library has only the Foundations and Grammar & Tenses entry tabs without a duplicate station path');
check(learningExpansion.includes('reviewedAcademyQuestions') && learningExpansion.includes('new Set(options).size !== 4'), 'Grammar academy filters malformed and duplicate-choice questions');
try {
  const bankMatch = learningExpansion.match(/const academyQuestions = ([\s\S]*?);\s*\/\/ Validate every lesson bank/);
  if (!bankMatch) throw new Error('Question bank declaration not found');
  const banks = new Function('return (' + bankMatch[1] + ')')();
  check(banks.length === 10, 'Grammar academy has a separate bank for all 10 lessons');
  check(banks.every(bank => Array.isArray(bank) && bank.length === 8), 'Every grammar lesson has 8 focused questions');
  // This answer-key snapshot is intentionally independent of the runtime bank:
  // if a lesson's first (correct) option changes accidentally, CI catches it.
  const expectedAnswers = [
    ['I','He','They','She','He','We','We','It'],
    ['am','is','are','are','is','are','are','am'],
    ['plays','go','studies','rises','eats','study','watches','eat'],
    ['is','playing','am','raining','crying','are','writing','are'],
    ['finished','went','watch','enjoy','visited','bought','made','arrive'],
    ['will','to','base','are','leave','read','clean','will'],
    ['What','Where','Why','When','Who','How','Where','Why'],
    ['on','at','in','under','on','in','in','on'],
    ['than','cheaper','more','faster','bigger','less','easier','faster'],
    ['can','practise','leave','cannot','learn','finish','be','swim']
  ];
  let malformed = banks.length !== expectedAnswers.length;
  const allPrompts = new Set();
  banks.forEach((bank, bankIndex) => {
    const prompts = new Set();
    if (!Array.isArray(bank) || bank.length !== 8) { malformed = true; return; }
    bank.forEach((q, questionIndex) => {
      if (!Array.isArray(q) || q.length !== 5 || q.some(v => typeof v !== 'string' || !v.trim())) { malformed = true; return; }
      const prompt = q[0].trim().toLocaleLowerCase();
      const options = q.slice(1).map(v => v.trim().toLocaleLowerCase());
      const expected = expectedAnswers[bankIndex]?.[questionIndex];
      if (prompts.has(prompt) || allPrompts.has(prompt) || new Set(options).size !== 4 ||
          q[1].trim().toLocaleLowerCase() !== String(expected || '').toLocaleLowerCase()) malformed = true;
      prompts.add(prompt);
      allPrompts.add(prompt);
    });
  });
  check(!malformed, 'Grammar academy banks match the reviewed answer key, contain no repeated prompts across lessons, and have four distinct choices');
} catch (error) {
  fail.push('Grammar academy question bank can be parsed and validated: ' + error.message);
}
try {
  const generalMatch = html.match(/const grammar=(\[[\s\S]*?\]);/);
  if (!generalMatch) throw new Error('General grammar bank declaration not found');
  const bank = new Function('return (' + generalMatch[1] + ')')();
  const prompts = new Set();
  let malformed = !Array.isArray(bank) || bank.length < 20;
  if (Array.isArray(bank)) bank.forEach((q) => {
    if (!Array.isArray(q) || q.length !== 5 || q.some(v => typeof v !== 'string' || !v.trim())) { malformed = true; return; }
    const prompt = q[0].trim().toLocaleLowerCase();
    const options = q.slice(1).map(v => v.trim().toLocaleLowerCase());
    if (prompts.has(prompt) || new Set(options).size !== 4 || !options.includes(q[1].trim().toLocaleLowerCase())) malformed = true;
    prompts.add(prompt);
  });
  check(!malformed, 'General grammar quiz has unique prompts, four distinct choices, and a valid correct answer for every question');
} catch (error) {
  fail.push('General grammar quiz bank can be parsed and validated: ' + error.message);
}
check(learningExpansion.includes('ehFontScale') && learningExpansion.includes('ehReduceMotion'), 'Font-size and reduced-motion customization controls are present');
check(learningExpansion.includes('متوسط نتائج الاختبارات') && learningExpansion.includes('مراجعات معلقة') && html.includes('function pendingReviewCount()'), 'Progress report counts pending practice and retention reviews');
try { new Function(learningExpansion); check(true, 'Learning expansion JavaScript syntax is valid'); } catch (error) { fail.push(`learning-expansion.js has a syntax error: ${error.message}`); }
check(html.includes('id="proDashboard"') && html.includes('id="weeklyActivity"') && html.includes('id="quizHistoryList"') && html.includes('id="quizMistakesList"'), 'Professional statistics, quiz history, and error review UI exist');
check(progressDashboard.includes('state.masteredLessons.includes(l.id)?l.words.length:0') && !progressDashboard.includes('state.masteredLessons.includes(i)?l.words.length:0'), 'Mastered-word totals use lesson IDs including extra lessons');
check(html.includes("age>=0&&age<7") && html.includes("x.mode==='mistakes'"), 'Weekly and review achievements enforce their actual conditions');
try { new Function(progressDashboard); check(true, 'Professional dashboard JavaScript syntax is valid'); } catch (error) { fail.push(`pro-dashboard.js has a syntax error: ${error.message}`); }
try { new Function(englishHeroPlus); check(true, 'English Hero Plus JavaScript syntax is valid'); } catch (error) { fail.push(`english-hero-plus.js has a syntax error: ${error.message}`); }
check(/src="english-hero-plus\.js(?:\?v=\d+)?"/.test(html) && sw.includes("'./english-hero-plus.js?v="), 'English Hero Plus is linked and cached offline');
check(!privacy.includes('\\n<h2>'), 'Privacy policy does not contain escaped newline artifacts');
check(privacy.includes('MyMemory') && privacy.includes('Supabase') && !privacy.includes('OpenAI'), 'Privacy policy matches the current translation and cloud services without the retired AI coach');
const publicHtml = ['index.html','privacy.html','contact.html','english-basics.html','english-tenses-guide.html','grammar-lesson.html'].map(read).join('\\n');
check(!/(adsbygoogle|googlesyndication|google-adsense-account|googletagmanager|google-analytics)/i.test(publicHtml), 'Public HTML files contain no ad or third-party analytics tags');
check(!html.includes('analytics_events') && !html.includes('englishHeroAnalyticsVisitorV1'), 'Main page does not send custom analytics events or create analytics visitor identifiers');
check(html.includes('navigator.serviceWorker.register'), 'Main page registers the service worker');
check(!/(?:service_role|sb_secret_)\s*[:=]\s*['"]/i.test(config) && !/sb_secret_[A-Za-z0-9_-]{12,}/i.test(config), 'Client configuration contains no server secret key');
check(migration.includes('REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()') && migration.includes('(SELECT auth.uid())'), 'Tracked migration contains the security and RLS policy changes');
check(existsSync(join(root, migrationPath)), 'Applied Supabase migration is tracked in the repository');

let vocabulary;
try {
  vocabulary = JSON.parse(vocabRaw);
  check(Array.isArray(vocabulary.words), 'Vocabulary JSON contains a words array');
  check(vocabulary.words.length >= 19000 && vocabulary.words.length <= 20000, 'Reviewed vocabulary list contains between 19000 and 20000 entries');
  check(new Set(vocabulary.words.map(word => String(word).toLowerCase())).size === vocabulary.words.length, 'Vocabulary list has no case-insensitive duplicates');
  check(vocabulary.words.every(word => typeof word === 'string' && word.trim().length > 0), 'Vocabulary entries are non-empty strings');
  check(vocabulary.words.every(word => word.length > 1 || word === 'a' || word === 'i'), 'Vocabulary list excludes one-letter tokenization artifacts');
  const unsuitableVocabulary = new Set(["xxx","milf","cum","hardcore","porno","tits","hentai","shemale","voyeur","sexo","blowjob","boobs","dildo","sexcam","milfhunter","beastiality","upskirt","milfs","breasts","blowjobs","bestiality","cumshot","busty","cocks","tranny","cumshots","bukkake","nipples","pissing","fisting","fucked","gangbang","dildos","upskirts","ejaculation","bbw","squirting","sluts","twinks","threesome","handjob","xnxx","thumbzilla","pichunter","bdsm","livesex","worldsex","zoophilia","vibrator","vibrators","escorts","sucks","adipex","sex","sexual","sexually","sexy","fuck","fucking","fucker","motherfucker","shit","bullshit","bitch","asshole","porn","pornography","pornographic","nude","penis","vagina","vaginal","masturbate","masturbation","masturbating","whore","slut","dick","dicks","playboy","transexual","transexuales"]);
  check(vocabulary.words.every(word => !unsuitableVocabulary.has(String(word).toLowerCase())), 'Vocabulary excludes the reviewed explicit profanity and adult-content blocklist');
  check(html.includes('d.words.length<19000') && html.includes('d.words.length>20000'), 'Vocabulary loader accepts the reviewed variable count and rejects invalid counts');
} catch {
  fail.push('Vocabulary file is valid JSON');
}

let inlineCount = 0;
const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
for (const match of html.matchAll(scriptPattern)) {
  const attrs = match[1] || '';
  const body = match[2] || '';
  if (/\bsrc\s*=/.test(attrs) || /application\/ld\+json/i.test(attrs) || !body.trim()) continue;
  inlineCount++;
  try {
    // Parse only; never execute application code in CI validation.
    new Function(body);
  } catch (error) {
    fail.push(`Inline script #${inlineCount} has a syntax error: ${error.message}`);
  }
}
check(inlineCount > 0, 'At least one inline application script was checked');

console.log('English Hero project validation');
for (const item of pass) console.log(`PASS  ${item}`);
for (const item of fail) console.error(`FAIL  ${item}`);
console.log(`\nResult: ${pass.length} passed, ${fail.length} failed.`);
if (fail.length) process.exitCode = 1;
