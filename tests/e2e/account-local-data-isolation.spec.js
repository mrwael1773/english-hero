import { test, expect } from './fixtures.js';

test('student task data stays isolated when switching between accounts', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('englishHeroStudentTasksV1:e2e-student', JSON.stringify([
      { id: 'account-a-task', subject: 'English', text: 'Account A task', done: false }
    ]));
    localStorage.setItem('englishHeroStudentTasksV1:second-e2e-student', JSON.stringify([
      { id: 'account-b-task', subject: 'Science', text: 'Account B task', done: false }
    ]));
  });

  await page.goto('/index.html');
  const taskList = page.locator('#studentTaskList');

  // The fixture's initial cloud identity is e2e-student.
  await expect(taskList).toContainText('Account A task');
  await expect(taskList).not.toContainText('Account B task');

  // Simulate the same account-change event consumed by the local task store.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('englishhero:authstate', {
      detail: { user: { id: 'second-e2e-student' } }
    }));
  });
  await expect(taskList).toContainText('Account B task');
  await expect(taskList).not.toContainText('Account A task');

  // Returning to the first account restores only that account's local task list.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('englishhero:authstate', {
      detail: { user: { id: 'e2e-student' } }
    }));
  });
  await expect(taskList).toContainText('Account A task');
  await expect(taskList).not.toContainText('Account B task');
});

test('Plus progress and scenario results stay isolated when switching accounts', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ehPlusV2:e2e-student', JSON.stringify({
      known: ['improve'], missed: ['usually'], points: 45, avatar: '🦊', title: 'المجتهد'
    }));
    localStorage.setItem('ehPlusV2:second-e2e-student', JSON.stringify({
      known: ['choose'], missed: ['careful'], points: 90, avatar: '🐼', title: 'المستكشف'
    }));
    localStorage.setItem('eh-scenarios-done:e2e-student', JSON.stringify({ 0: 5 }));
    localStorage.setItem('eh-scenarios-done:second-e2e-student', JSON.stringify({ 0: 2 }));
  });

  await page.goto('/index.html');

  // The initial fixture identity is account A.
  await expect(page.locator('#ehpAvatar')).toHaveText('🦊');
  await expect(page.locator('#scenarioList .tile').first()).toContainText('5/5');

  // Switch both account-aware readers to account B.
  await page.evaluate(() => {
    window.EnglishHeroCloud.getUser = () => ({ id: 'second-e2e-student' });
    window.dispatchEvent(new CustomEvent('englishhero:authstate', {
      detail: { user: { id: 'second-e2e-student' } }
    }));
  });
  await expect(page.locator('#ehpAvatar')).toHaveText('🐼');
  await expect(page.locator('#scenarioList .tile').first()).toContainText('2/5');

  // Returning to A must restore A's Plus profile and scenario result only.
  await page.evaluate(() => {
    window.EnglishHeroCloud.getUser = () => ({ id: 'e2e-student' });
    window.dispatchEvent(new CustomEvent('englishhero:authstate', {
      detail: { user: { id: 'e2e-student' } }
    }));
  });
  await expect(page.locator('#ehpAvatar')).toHaveText('🦊');
  await expect(page.locator('#scenarioList .tile').first()).toContainText('5/5');

  const stored = await page.evaluate(() => ({
    plusA: JSON.parse(localStorage.getItem('ehPlusV2:e2e-student')),
    plusB: JSON.parse(localStorage.getItem('ehPlusV2:second-e2e-student')),
    scenariosA: JSON.parse(localStorage.getItem('eh-scenarios-done:e2e-student')),
    scenariosB: JSON.parse(localStorage.getItem('eh-scenarios-done:second-e2e-student'))
  }));
  expect(stored.plusA.avatar).toBe('🦊');
  expect(stored.plusB.avatar).toBe('🐼');
  expect(stored.plusA.points).toBe(45);
  expect(stored.plusB.points).toBe(90);
  expect(stored.scenariosA[0]).toBe(5);
  expect(stored.scenariosB[0]).toBe(2);
});
