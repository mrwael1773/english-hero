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
