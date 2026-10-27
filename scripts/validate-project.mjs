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
const progressDashboard = read('pro-dashboard.js');
const learningExpansion = read('learning-expansion.js');
const englishHeroPlus = read('english-hero-plus.js');
const config = read('config.js');
const privacy = read('privacy.html');
const vocabRaw = read('vocabulary-6000.json');
const migrationPath = 'supabase/migrations/20261026151420_secure_rls_auto_enable_and_optimize_progress_policies.sql';
const migration = read(migrationPath);

check(html.includes('<!doctype html>') || html.includes('<!DOCTYPE html>'), 'HTML document declaration exists');
check(html.includes('id="home"') && html.includes('id="profile"'), 'Home and profile screens exist');
check(!html.includes('id="conversation"') && !html.includes('data-nav="conversation"') && !html.includes('src="ai-chat.js"'), 'AI chat section and script are disabled');
check(html.includes('name="viewport"') && html.includes('@media(max-width:720px)') && html.includes('@media(max-width:360px)') && html.includes('overflow-wrap:anywhere'), 'Responsive layout includes viewport and small-screen overflow safeguards');
check(html.includes('id="studentDesk"') && html.includes('id="studentTaskForm"') && html.includes('id="studentTaskList"'), 'Student study planner UI exists');
check(html.includes('id="wordDetective"') && html.includes('id="detectiveAnswers"') && html.includes('const detectiveCases=['), 'No-currency English detective learning game is present');
check(html.includes('data-page="wordDetective"') && html.includes('detectiveHint') && html.includes('detectiveFeedback'), 'Detective game is reachable and provides hints and explanations');
check(html.includes('englishHeroStudentTasksV1') && html.includes('function renderStudentTasks') && html.includes('studentTaskClearDone'), 'Student planner supports local persistence and task management');
const idCounts = new Map();
for (const match of html.matchAll(/\bid=["']([^"']+)["']/g)) idCounts.set(match[1], (idCounts.get(match[1]) || 0) + 1);
check([...idCounts.values()].every(count => count === 1), 'HTML element IDs are unique');
for (const path of ['manifest.webmanifest', 'privacy.html', 'contact.html', 'icon.svg']) {
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
for (const id of ['cloudAuthForm','cloudStatus','cloudSignIn','cloudSignUp','cloudGoogle','cloudSyncNow','cloudSignOut','cloudRestoreBackup','cloudBackupStatus','grammarLibrary','tensesLibrary','vocabResults']) {
  check(html.includes(`id="${id}"`), `Required UI element exists: ${id}`);
}
check(/sw\.js\?v=(\d+)/.test(html), 'Service worker registration has a version');
const registeredVersion = html.match(/sw\.js\?v=(\d+)/)?.[1];
const cacheVersion = sw.match(/english-hero-shell-v(\d+)/)?.[1];
check(Boolean(registeredVersion && cacheVersion), 'Service worker registration and cache use explicit versions');
check(sw.includes("fetch(request)") && sw.includes("request.mode === 'navigate'"), 'Service worker refreshes navigation from network first');
check(cloud.includes("from('learning_progress')") && cloud.includes('signInWithPassword') && cloud.includes('signUp'), 'Cloud progress and email auth flows are present');
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
check(learningExpansion.includes('grammarAcademyGrid') && learningExpansion.includes('grammarLessons'), 'Progressive grammar academy lessons are present');
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
  const generalMatch = html.match(/const grammar=(\\[[\\s\\S]*?\\]);/);
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
check(learningExpansion.includes('متوسط نتائج الاختبارات') && learningExpansion.includes('أخطاء تحتاج مراجعة'), 'Progress report includes quiz averages and review needs');
try { new Function(learningExpansion); check(true, 'Learning expansion JavaScript syntax is valid'); } catch (error) { fail.push(`learning-expansion.js has a syntax error: ${error.message}`); }
check(html.includes('id="proDashboard"') && html.includes('id="weeklyActivity"') && html.includes('id="quizHistoryList"') && html.includes('id="quizMistakesList"'), 'Professional statistics, quiz history, and error review UI exist');
check(progressDashboard.includes('state.completed.includes(l.id)?l.words.length:0') && !progressDashboard.includes('state.completed.includes(i)?l.words.length:0'), 'Learned-word totals use lesson IDs including extra lessons');
check(html.includes("age>=0&&age<7") && html.includes("x.mode==='mistakes'"), 'Weekly and review achievements enforce their actual conditions');
try { new Function(progressDashboard); check(true, 'Professional dashboard JavaScript syntax is valid'); } catch (error) { fail.push(`pro-dashboard.js has a syntax error: ${error.message}`); }
try { new Function(englishHeroPlus); check(true, 'English Hero Plus JavaScript syntax is valid'); } catch (error) { fail.push(`english-hero-plus.js has a syntax error: ${error.message}`); }
check(/src="english-hero-plus\.js(?:\?v=\d+)?"/.test(html) && sw.includes("'./english-hero-plus.js?v="), 'English Hero Plus is linked and cached offline');
check(!privacy.includes('\\n<h2>'), 'Privacy policy does not contain escaped newline artifacts');
check(privacy.includes('MyMemory') && privacy.includes('Supabase') && !privacy.includes('OpenAI'), 'Privacy policy matches the current translation and cloud services without the retired AI coach');
check(!/(?:service_role|sb_secret_)\s*[:=]\s*['"]/i.test(config) && !/sb_secret_[A-Za-z0-9_-]{12,}/i.test(config), 'Client configuration contains no server secret key');
check(migration.includes('REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()') && migration.includes('(SELECT auth.uid())'), 'Tracked migration contains the security and RLS policy changes');
check(existsSync(join(root, migrationPath)), 'Applied Supabase migration is tracked in the repository');

let vocabulary;
try {
  vocabulary = JSON.parse(vocabRaw);
  check(Array.isArray(vocabulary.words), 'Vocabulary JSON contains a words array');
  check(vocabulary.words.length === 6000, 'Vocabulary list contains exactly 6000 entries');
  check(new Set(vocabulary.words).size === vocabulary.words.length, 'Vocabulary list has no duplicate entries');
  check(vocabulary.words.every(word => typeof word === 'string' && word.trim().length > 0), 'Vocabulary entries are non-empty strings');
  check(vocabulary.words.every(word => word.length > 1 || word === 'a' || word === 'i'), 'Vocabulary list excludes one-letter tokenization artifacts');
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
