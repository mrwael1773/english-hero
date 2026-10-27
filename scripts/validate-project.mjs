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
check(Boolean(registeredVersion && cacheVersion && registeredVersion === cacheVersion), 'Service worker registration and cache versions match');
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
check(html.includes('src="pro-dashboard.js"') && sw.includes("'./pro-dashboard.js'"), 'Professional progress dashboard is linked and cached offline');
check(html.includes('id="proDashboard"') && html.includes('id="weeklyActivity"') && html.includes('id="quizHistoryList"') && html.includes('id="quizMistakesList"'), 'Professional statistics, quiz history, and error review UI exist');
try { new Function(progressDashboard); check(true, 'Professional dashboard JavaScript syntax is valid'); } catch (error) { fail.push(`pro-dashboard.js has a syntax error: ${error.message}`); }
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
