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
const aiChat = read('ai-chat.js');
const config = read('config.js');
const privacy = read('privacy.html');
const coach = read('supabase/functions/english-coach/index.ts');
const vocabRaw = read('vocabulary-6000.json');
const migrationPath = 'supabase/migrations/20261026151420_secure_rls_auto_enable_and_optimize_progress_policies.sql';
const migration = read(migrationPath);

check(html.includes('<!doctype html>') || html.includes('<!DOCTYPE html>'), 'HTML document declaration exists');
check(html.includes('id="home"') && html.includes('id="profile"'), 'Home and profile screens exist');
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
for (const id of ['cloudAuthForm','cloudStatus','cloudSignIn','cloudSignUp','cloudGoogle','cloudSyncNow','cloudSignOut','cloudRestoreBackup','cloudBackupStatus','grammarLibrary','tensesLibrary','vocabResults','conversation','chat','chatForm','chatInput','chatMic','chatSpeak','chatReset','aiChatStatus']) {
  check(html.includes(`id="${id}"`), `Required UI element exists: ${id}`);
}
check(/sw\.js\?v=(\d+)/.test(html), 'Service worker registration has a version');
const registeredVersion = html.match(/sw\.js\?v=(\d+)/)?.[1];
const cacheVersion = sw.match(/english-hero-shell-v(\d+)/)?.[1];
check(Boolean(registeredVersion && cacheVersion && registeredVersion === cacheVersion), 'Service worker registration and cache versions match');
check(sw.includes("fetch(request)") && sw.includes("request.mode === 'navigate'"), 'Service worker refreshes navigation from network first');
check(cloud.includes("from('learning_progress')") && cloud.includes('signInWithPassword') && cloud.includes('signUp'), 'Cloud progress and email auth flows are present');
check(cloud.includes('async function cloudRequest(query, timeoutMs=15000)') && cloud.includes('query.abortSignal(controller.signal)'), 'Cloud progress requests abort after a bounded timeout');
check(cloud.includes("English Hero sign out:") && cloud.includes('finally {\n      setSignedInUI();\n    }'), 'Sign-out failures restore the account UI safely');
check(html.includes('data-nav="conversation"') && html.includes('id="conversation"') && html.includes('id="chatForm"'), 'AI conversation screen is connected to navigation and has its form');
check(html.includes("'weekly'") && html.includes('20 سؤالًا متنوعًا') && html.includes('state.weeklyTestLast'), 'Weekly assessment includes mixed questions and stores its result');
check(aiChat.includes('client.functions.invoke(\'english-coach\'') && aiChat.includes('refreshAuthHint') && aiChat.includes('chat.replaceChildren()'), 'AI conversation calls the server function and handles login/reset');
check(aiChat.includes('setTimeout(()=>controller.abort(),18000)') && aiChat.includes('انتهت مهلة الرد بعد 18 ثانية') && coach.includes('setTimeout(() => aiController.abort(), 15000)'), 'AI chat and server timeouts are aligned with a clear timeout message');
check(aiChat.includes('function offlineCoach') && aiChat.includes('هذا تدريب احتياطي محلي'), 'AI chat keeps a transparent local practice fallback when API credits are exhausted');
check(aiChat.includes('const timedOut=') && aiChat.includes('انتهت مهلة الرد؛ انتقلنا إلى تدريب احتياطي محلي'), 'AI chat falls back to local practice after a request timeout');
check(cloud.includes("english-hero-account-backup-") && cloud.includes('english-hero-unclaimed-local-backup') && cloud.includes('syncPromiseUserId'), 'Account switching is isolated and local progress can be recovered');
check(cloud.includes('const chatRows=[...(Array.isArray(r.chatHistory)?r.chatHistory:[])') && cloud.includes('const chatHistory=[...new Map(chatRows.map(m=>[JSON.stringify(m),m])).values()].slice(-60)'), 'Cloud sync preserves and deduplicates local and remote chat history');
try { new Function(cloud); check(true, 'Cloud sync JavaScript syntax is valid'); } catch (error) { fail.push(`cloud-sync.js has a syntax error: ${error.message}`); }
try { new Function(aiChat); check(true, 'AI chat JavaScript syntax is valid'); } catch (error) { fail.push(`ai-chat.js has a syntax error: ${error.message}`); }
try { new Function(sw); check(true, 'Service worker JavaScript syntax is valid'); } catch (error) { fail.push(`sw.js has a syntax error: ${error.message}`); }
check(cloud.includes("english-hero-cloud-owner") && cloud.includes('function replaceProgress') && cloud.includes('localOwner && localOwner!==syncUserId'), 'Local progress is isolated when accounts change on a shared device');
check(cloud.includes("$cloud('cloudRestoreBackup')?.addEventListener('click'") && cloud.includes('mergeProgress(backup)'), 'Account-specific backup restore is available and merges progress safely');
check(coach.includes('supabase.auth.getUser(accessToken)') && coach.includes('Deno.env.get("OPENAI_API_KEY")') && coach.includes('https://api.openai.com/v1/responses'), 'AI coach authenticates users and calls OpenAI from the server');
check(coach.includes('insufficient_quota') && coach.includes('رصيد OpenAI API') && coach.includes('aiController.signal.aborted'), 'AI coach handles exhausted API credits and server-side timeouts');
check(coach.includes('maxRequestsPerWindow = 8') && coach.includes('requestWindows.get(user.id)'), 'AI coach includes a per-user request guard');
check(!coach.includes('sk-proj-') && !coach.includes('sb_secret_'), 'AI coach source contains no hard-coded API secrets');
check(!privacy.includes('\\n<h2>'), 'Privacy policy does not contain escaped newline artifacts');
check(privacy.includes('MyMemory') && privacy.includes('OpenAI') && privacy.includes('Supabase'), 'Privacy policy discloses AI, cloud sync, and translation providers');
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
