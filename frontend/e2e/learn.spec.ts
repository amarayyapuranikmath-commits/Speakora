import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { signUp } from './helpers'

/**
 * Real-stack Learn journey. The correct answers are read from the same curriculum files the server grades with, so a pass here
 * proves the full path: lesson, practice, server-graded test, recorded progress.
 */
test.describe.configure({ timeout: 120_000 })

interface Q { type: 'choice' | 'fill'; prompt: string; options?: string[]; answer?: number; answers?: string[] }
const curriculum = (file: string) => JSON.parse(readFileSync(join(process.cwd(), '..', 'backend', 'src', 'main', 'resources', 'curriculum', file), 'utf-8'))
const lesson = (id: string) => curriculum(`grammar-${id[1]}.json`).lessons.find((l: { id: string }) => l.id === id)

async function answer(page: Page, qs: Q[], wrongOn: number[] = []) {
  for (const [i, q] of qs.entries()) {
    const wrong = wrongOn.includes(i)
    if (q.type === 'choice') {
      const idx = wrong ? (q.answer! + 1) % q.options!.length : q.answer!
      await page.getByRole('radio', { name: q.options![idx], exact: true }).check()
    } else {
      await page.getByLabel(q.prompt, { exact: false }).fill(wrong ? 'zzz' : q.answers![0])
    }
  }
}

test('learn: choose a subject, study a lesson, practise, fail then pass the test, and see recorded progress', async ({ browser }) => {
  const page = await signUp(browser, 'Lena')
  const g = lesson('g1.01')

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Learn' }).click()
  await expect(page.getByRole('heading', { name: 'Learn' })).toBeVisible()
  await expect(page.getByText('Not started').first()).toBeVisible() // nothing is invented for a new learner
  await expect(page.getByRole('link', { name: /Recommended next/ })).toContainText('Basic sentence structure')

  await page.getByRole('link', { name: /^Grammar/ }).click()
  await page.getByRole('link', { name: /Level 1: Fundamentals/ }).click()
  await expect(page.getByRole('list', { name: 'Lessons' }).getByRole('listitem')).toHaveCount(12)
  await page.getByRole('link', { name: /Basic sentence structure/ }).click()

  // Learn tab shows every section.
  for (const h of ['Explanation', 'Correct structures', 'Positive examples', 'Negative examples', 'Question examples', 'Real-life examples', 'Common mistakes']) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible()
  }

  // Practice: feedback comes from the server.
  await page.getByRole('tab', { name: 'Practice' }).click()
  const first: Q = g.exercises[0]
  await page.getByRole('radio', { name: first.options![(first.answer! + 1) % first.options!.length], exact: true }).first().check()
  await page.getByRole('button', { name: 'Check answer 1' }).click()
  await expect(page.getByText('Not quite.')).toBeVisible()

  // Test: first attempt with two wrong answers fails (3/5 = 60%), nothing is completed.
  await page.getByRole('tab', { name: 'Test' }).click()
  await answer(page, g.assessment, [0, 1])
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByText('You scored 3 out of 5 (60%)')).toBeVisible()
  await expect(page.getByText(/Not a pass yet/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next lesson' })).toHaveCount(0)

  // Second attempt, all correct: passes and completes the lesson.
  await page.getByRole('button', { name: 'Try again' }).click()
  await answer(page, g.assessment)
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByText('You scored 5 out of 5 (100%)')).toBeVisible()
  await expect(page.getByText('Lesson completed.')).toBeVisible()
  await page.getByRole('button', { name: 'Next lesson' }).click()
  await expect(page.getByRole('heading', { name: 'Parts of speech' })).toBeVisible()

  // The level now shows the recorded result, and the learner's overview moved on.
  await page.goto('/app/learn/grammar/levels/1')
  const items = page.getByRole('list', { name: 'Lessons' }).getByRole('listitem')
  await expect(items.nth(0)).toContainText('Completed · best 100%')
  await expect(items.nth(1)).toContainText('Not started')
  await page.goto('/app/learn')
  await expect(page.getByRole('link', { name: /Recommended next/ })).toContainText('Parts of speech')
  await expect(page.getByText('1 of 60 lessons completed')).toBeVisible()
})

test('vocabulary: save a word, it joins revision, and a correct review is recorded', async ({ browser }) => {
  const page = await signUp(browser, 'Vera')
  await page.goto('/app/learn/vocabulary/levels/1')
  await page.getByRole('button', { name: /borrow/ }).click()
  await expect(page.getByText('Can I borrow your pen?')).toBeVisible()
  await page.getByRole('button', { name: 'Save borrow' }).click()
  await expect(page.getByRole('button', { name: 'Saved: borrow' })).toBeVisible()

  await page.goto('/app/learn')
  await expect(page.getByRole('link', { name: /Revision/ })).toContainText('1 item is ready to review')
  await page.getByRole('link', { name: /Revision/ }).click()
  const meaning = curriculum('vocabulary-1.json').words.find((w: { word: string }) => w.word === 'borrow').meaning
  await expect(page.getByText(`Which one means: ${meaning}?`)).toBeVisible()
  await page.getByRole('radio', { name: 'borrow', exact: true }).check()
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByText('You scored 1 out of 1 (100%)')).toBeVisible()

  // A correct review pushes the next one into the future: nothing is due any more.
  await page.goto('/app/learn')
  await expect(page.getByRole('link', { name: /Revision/ })).toHaveCount(0)
})
