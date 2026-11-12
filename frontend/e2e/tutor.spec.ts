import { expect, test } from '@playwright/test'
import { signUp } from './helpers'

/**
 * Real backend and browser with the stand-in AI provider (tools/fake-coach on :4010; backend started with GROQ_API_KEY and
 * GROQ_BASE_URL pointing at it). Proves consent gating, streaming, a conversation that lives only in the page (nothing stored, nothing
 * restored after a reload), mode switching that keeps context, and ending a session. It says nothing about the quality of a real model's answers.
 */
test.describe.configure({ timeout: 90_000 })

const stats = async () => (await fetch('http://127.0.0.1:4010/stats')).json() as Promise<{ requests: number; lastChat?: { turns: number; roles: string[]; mode: string | null; stream?: boolean } }>

test('coach: consent first, then a streamed conversation that is never stored', async ({ browser }) => {
  const page = await signUp(browser, 'Tara')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'AI Coach' }).click()
  const before = (await stats()).requests
  await expect(page.getByText(/not saved/i).first()).toBeVisible()
  await expect(page.getByLabel('Message to the coach')).toHaveCount(0)
  expect((await stats()).requests).toBe(before) // nothing leaves before consent

  await page.getByRole('button', { name: /i agree/i }).click()
  await page.getByLabel('What would you like to do?').selectOption('GRAMMAR_TUTOR')
  await page.getByLabel('Message to the coach').fill('Why do we use does?')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('Fake tutor reply to: Why do we use does?')).toBeVisible()
  expect((await stats()).lastChat?.stream).toBe(true)

  // Switching mode keeps the conversation in the page: the provider sees the earlier turns and the new mode.
  await page.getByLabel('What would you like to do?').selectOption('INTERVIEW_PRACTICE')
  await expect(page.getByText(/Switched to Interview practice/)).toBeVisible()
  await page.getByLabel('Message to the coach').fill('Ask me a question.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('Fake tutor reply to: Ask me a question.')).toBeVisible()
  const s = await stats()
  expect(s.lastChat?.roles).toEqual(['user', 'assistant', 'user'])
  expect(s.lastChat?.mode).toBe('Interview practice')

  // There is no history: after a reload the conversation is gone, and nothing is offered to restore it.
  await page.reload()
  await expect(page.getByLabel('Message to the coach')).toBeVisible()
  await expect(page.getByText('Fake tutor reply to: Ask me a question.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /history/i })).toHaveCount(0)
  await expect(page.getByText(/review my text/i)).toHaveCount(0)

  // Ending a session clears it; the next message starts a fresh conversation.
  await page.getByLabel('Message to the coach').fill('First message')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('Fake tutor reply to: First message')).toBeVisible()
  await page.getByRole('button', { name: 'End session' }).click()
  await expect(page.getByText('Fake tutor reply to: First message')).toHaveCount(0)
  await page.getByLabel('Message to the coach').fill('Second message')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('Fake tutor reply to: Second message')).toBeVisible()
  expect((await stats()).lastChat?.roles).toEqual(['user'])
})

test('tutor: a lesson links to the tutor with its topic', async ({ browser }) => {
  const page = await signUp(browser, 'Toni')
  await page.goto('/app/learn/lessons/g2.03')
  await page.getByRole('link', { name: /Ask the AI tutor about this lesson/ }).click()
  await expect(page).toHaveURL(/mode=GRAMMAR_TUTOR&topic=g2\.03/)
})
