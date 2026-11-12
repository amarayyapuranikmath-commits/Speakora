import { expect, test, type Page } from '@playwright/test'
import { connectedPair, openFriends, openHistory, openPartners, peakLevel, remoteAudio } from './helpers'

/**
 * Real-stack journeys for matching after a call, previous partners, friends, private messages and private calls (PostgreSQL +
 * Redis + backend + Vite, two browsers with FAKE microphones). They prove signalling, state and the audio pipeline, not
 * human-perceived quality.
 */
test.describe.configure({ timeout: 180_000 })

/** Two people talk for long enough to count as a conversation (15 s), then Alice ends the call. */
async function talkedOnce(browser: Parameters<typeof connectedPair>[0]): Promise<{ alice: Page; bob: Page }> {
  const { alice, bob } = await connectedPair(browser)
  await expect.poll(async () => (await remoteAudio(bob)).unmuted, { timeout: 15_000 }).toBeGreaterThan(0)
  await alice.waitForTimeout(17_000)
  await alice.getByRole('button', { name: 'End call' }).click()
  await expect(alice.getByRole('heading', { name: 'Call ended' })).toBeVisible()
  await expect(bob.getByRole('heading', { name: 'Call ended' })).toBeVisible()
  return { alice, bob }
}

/** Alice asks Bob to be friends from Previous partners and Bob accepts. Returns once both see each other under Friends. */
async function befriend(alice: Page, bob: Page): Promise<void> {
  await openPartners(alice)
  await alice.getByRole('button', { name: 'Add friend Bob' }).click()
  await expect(alice.getByRole('listitem').filter({ hasText: 'Bob' })).toContainText('Request sent')
  // Bob is told live, wherever he is: the Friends tab shows that something is waiting.
  await expect(bob.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Friends/ })).toContainText('1 unread', { timeout: 15_000 })
  await openFriends(bob)
  await bob.getByRole('button', { name: 'Accept Alice' }).click()
  await expect(bob.getByRole('listitem').filter({ hasText: 'Alice' })).toBeVisible()
  await openFriends(alice)
  await expect(alice.getByRole('listitem').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 15_000 })
}

test('after a call, both people can search again and are matched with each other (the only two users)', async ({ browser }) => {
  const { alice, bob } = await talkedOnce(browser)
  await alice.getByRole('button', { name: 'Find another partner' }).click()
  await bob.getByRole('button', { name: 'Find another partner' }).click()
  for (const page of [alice, bob]) {
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 40_000 })
  }
})

test('a previous partner is not a friend: there is no Connect, only Add friend, and nothing private is possible yet', async ({ browser }) => {
  const { alice, bob } = await talkedOnce(browser)
  await openPartners(alice)
  await expect(alice.getByRole('listitem').filter({ hasText: 'Bob' })).toContainText('1 conversation')
  await expect(alice.getByRole('listitem').filter({ hasText: 'Bob' })).toContainText('English B1')
  await expect(alice.getByRole('button', { name: /Connect/ })).toHaveCount(0)
  await expect(alice.getByRole('button', { name: 'Add friend Bob' })).toBeEnabled()
  await openFriends(bob)
  await expect(bob.getByText('No friends yet')).toBeVisible()
})

test('friend request, live private messages, and a private call that the friend must accept', async ({ browser }) => {
  const { alice, bob } = await talkedOnce(browser)
  await befriend(alice, bob)

  // Messages: Alice writes, Bob sees it arrive without reloading and with an unread count; Bob replies.
  await alice.getByRole('link', { name: 'Message Bob' }).click()
  await alice.getByLabel('Message to Bob').fill('Hello Bob, are you free?')
  await alice.getByRole('button', { name: 'Send message' }).click()
  await expect(alice.getByRole('log').getByText('Hello Bob, are you free?')).toBeVisible()
  await expect(bob.getByText('unread from Alice')).toBeVisible({ timeout: 15_000 })
  await bob.getByRole('link', { name: /Message Alice/ }).click()
  await expect(bob.getByRole('log').getByText('Hello Bob, are you free?')).toBeVisible()
  await bob.getByLabel('Message to Alice').fill('Yes! Call me.')
  await bob.keyboard.press('Enter')
  await expect(alice.getByRole('log').getByText('Yes! Call me.')).toBeVisible({ timeout: 15_000 })

  // Private call: Alice asks, Bob is interrupted wherever he is, nothing starts until he accepts.
  await alice.getByRole('button', { name: 'Call Bob' }).click()
  await expect(alice.getByText('Asking Bob to talk…')).toBeVisible()
  const prompt = bob.getByRole('dialog', { name: 'A friend wants to talk' })
  await expect(prompt).toContainText('Alice')
  await alice.waitForTimeout(1500)
  await expect(alice.getByText('Asking Bob to talk…')).toBeVisible()
  await prompt.getByRole('button', { name: /Accept and talk/ }).click()
  for (const page of [alice, bob]) {
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 })
  }
  await expect.poll(async () => (await remoteAudio(alice)).unmuted, { timeout: 15_000 }).toBeGreaterThan(0)
  await expect.poll(async () => (await remoteAudio(bob)).unmuted, { timeout: 15_000 }).toBeGreaterThan(0)
  expect(await peakLevel(bob, 4000), 'Bob hears Alice').toBeGreaterThan(0.01)
  expect(await peakLevel(alice, 4000), 'Alice hears Bob').toBeGreaterThan(0.01)
})

test('a declined friend request does not affect random matching, and the asker cannot ask again straight away', async ({ browser }) => {
  const { alice, bob } = await talkedOnce(browser)
  await openPartners(alice)
  await alice.getByRole('button', { name: 'Add friend Bob' }).click()
  await openFriends(bob)
  await bob.getByRole('button', { name: 'Decline Alice' }).click()
  await expect(bob.getByText('No friends yet')).toBeVisible()

  // Alice may not ask again straight away, but nobody is blocked: they are still matched with each other at random.
  await expect(alice.getByRole('button', { name: 'Add friend Bob' })).toBeVisible({ timeout: 15_000 })
  await alice.getByRole('button', { name: 'Add friend Bob' }).click()
  await expect(alice.getByRole('alert')).toContainText('cannot send this person a request right now')
  await alice.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Talk' }).click()
  await bob.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Talk' }).click()
  for (const page of [alice, bob]) await page.getByRole('button', { name: 'Find another partner' }).click()
  for (const page of [alice, bob]) {
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 40_000 })
  }
})

test('the private-call prompt appears on whatever page the friend is on, and Escape declines it', async ({ browser }) => {
  const { alice, bob } = await talkedOnce(browser)
  await befriend(alice, bob)
  await openHistory(bob) // Bob is somewhere else entirely
  await expect(alice.getByRole('button', { name: 'Call Bob' })).toBeEnabled({ timeout: 20_000 })
  await alice.getByRole('button', { name: 'Call Bob' }).click()
  await expect(bob.getByRole('dialog', { name: 'A friend wants to talk' })).toBeVisible()
  await bob.keyboard.press('Escape')
  await expect(alice.getByText("Bob can't talk right now.")).toBeVisible()
})

test('blocking a friend removes them for both people at once, live, and ends all contact', async ({ browser }) => {
  const { alice, bob } = await talkedOnce(browser)
  await befriend(alice, bob)
  await alice.getByRole('link', { name: 'Message Bob' }).click()
  await alice.getByLabel('Message to Bob').fill('before the block')
  await alice.getByRole('button', { name: 'Send message' }).click()
  await expect(alice.getByRole('log').getByText('before the block')).toBeVisible()

  await openFriends(bob)
  const aliceRow = bob.getByRole('listitem').filter({ hasText: 'Alice' })
  await aliceRow.getByRole('button', { name: 'More options for Alice' }).click()
  await aliceRow.getByRole('button', { name: /Block Alice/ }).click()
  await expect(bob.getByText('No friends yet')).toBeVisible({ timeout: 15_000 })

  // Alice's open conversation closes down by itself, and she cannot reach Bob any more.
  await expect(alice.getByText('Conversation not available')).toBeVisible({ timeout: 20_000 })
  await openPartners(alice)
  await expect(alice.getByText('No previous partners yet')).toBeVisible({ timeout: 15_000 })
  await openFriends(alice)
  await expect(alice.getByText('No friends yet')).toBeVisible()
})
