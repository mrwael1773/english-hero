import { test, expect } from './helpers/authenticated-test.js';

async function openCourses(page) {
  await page.goto('/');
  await page.locator('.launch-card[data-page="courses"]').click();
  await expect(page.locator('#courses')).toHaveClass(/active/);
}

test('a reviewed lesson word remains saved after a page reload', async ({ page }) => {
  await openCourses(page);
  const firstLesson = page.locator('#courseGrid button').first();
  await expect(firstLesson).toBeVisible();
  await firstLesson.click();

  const word = (await page.locator('#wordEnglish').textContent())?.trim();
  expect(word).toBeTruthy();

  const bookmark = page.locator('#bookmarkWord');
  await expect(bookmark).toHaveText('☆ أضف للمراجعة');
  await bookmark.click();
  await expect(bookmark).toHaveText('★ في المراجعة');

  await page.reload();
  await openCourses(page);
  await page.locator('#courseGrid button').first().click();

  await expect(page.locator('#wordEnglish')).toHaveText(word);
  await expect(page.locator('#bookmarkWord')).toHaveText('★ في المراجعة');
});

test('one press on the lesson audio button requests speech once', async ({ page }) => {
  await page.addInitScript(() => {
    window.__ehSpoken = [];
    class MockUtterance {
      constructor(text) { this.text = text; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockUtterance
    });
    const mockSpeech = {
      speaking: false,
      pending: false,
      getVoices: () => [{ lang: 'en-US', name: 'English Test Voice', localService: true, default: true }],
      cancel: () => {},
      resume: () => {},
      speak: utterance => window.__ehSpoken.push(utterance.text)
    };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: mockSpeech
    });
  });

  await openCourses(page);
  await page.locator('#courseGrid button').first().click();
  const word = (await page.locator('#wordEnglish').textContent())?.trim();
  await page.locator('#sayWord').click();

  await expect.poll(() => page.evaluate(() => window.__ehSpoken.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__ehSpoken[0])).toBe(word);
});

test('vocabulary search can find and open a word from the library', async ({ page }) => {
  await openCourses(page);
  const search = page.locator('#vocabSearch');
  await expect(search).toBeVisible();
  await expect(page.locator('#vocabResults .vocab-focus-stage')).toBeVisible();

  await search.fill('school');
  const result = page.locator('#vocabResults .vocab-search-result').filter({ hasText: 'school' }).first();
  await expect(result).toBeVisible();
  await result.click();

  await expect(page.locator('#vocabResults .vocab-focus-word')).toHaveText('school');
});
