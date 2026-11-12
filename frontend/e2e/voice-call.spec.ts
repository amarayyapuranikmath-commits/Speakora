import { expect, test } from '@playwright/test'
import { connectedPair, openHistory, peakLevel, remoteAudio } from './helpers'

/**
 * Real-stack journeys (PostgreSQL + Redis + backend + Vite). Two independent browser sessions use a FAKE microphone,
 * so this proves the signalling, WebRTC negotiation and audio pipeline, not human-perceived voice quality.
 */

test('two users match, talk over WebRTC, mute, end, give feedback and see history', async ({ browser }) => {
  const { alice, bob } = await connectedPair(browser)
  await expect(alice.getByRole('heading', { name: 'Bob' })).toBeVisible()
  await expect(bob.getByRole('heading', { name: 'Alice' })).toBeVisible()

  // Each side must be RECEIVING a live remote track and actually playing it.
  for (const [name, page] of [['alice', alice], ['bob', bob]] as const) {
    await expect.poll(async () => (await remoteAudio(page)).live, { message: `${name} remote audio track`, timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(async () => (await remoteAudio(page)).unmuted, { message: `${name} receives RTP`, timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(async () => (await remoteAudio(page)).playedSeconds, { message: `${name} audio is playing`, timeout: 10_000 }).toBeGreaterThan(0.5)
  }

  await alice.getByRole('button', { name: 'Mute' }).click()
  await expect(alice.getByRole('button', { name: 'Unmute' })).toHaveAttribute('aria-pressed', 'true')
  await alice.getByRole('button', { name: 'Unmute' }).click()
  await expect(alice.getByRole('button', { name: 'Mute' })).toBeVisible()

  await alice.waitForTimeout(3000)
  await alice.getByRole('button', { name: 'End call' }).click()
  await expect(alice.getByRole('heading', { name: 'Call ended' })).toBeVisible()
  await expect(bob.getByRole('heading', { name: 'Call ended' })).toBeVisible()

  await alice.getByRole('radio', { name: '5 out of 5' }).click()
  await alice.getByRole('button', { name: 'Yes' }).click()
  await alice.getByRole('button', { name: 'Submit feedback' }).click()
  await expect(alice.getByText(/feedback has been saved/i)).toBeVisible()

  await alice.getByRole('link', { name: /back to dashboard/i }).click()
  await openHistory(alice)
  const row = alice.getByRole('listitem').filter({ hasText: 'Bob' })
  await expect(row).toContainText('Completed')
  await expect(row).toContainText('Feedback sent')
})

test('muting really silences what the partner hears, and unmuting restores it', async ({ browser }) => {
  const { alice, bob } = await connectedPair(browser)
  await expect.poll(async () => (await remoteAudio(bob)).unmuted, { timeout: 10_000 }).toBeGreaterThan(0)

  // The fake microphone emits a periodic beep, so a few seconds always contain signal when the sender is live.
  const open = await peakLevel(bob, 4000)
  expect(open, 'Bob should hear Alice before she mutes').toBeGreaterThan(0.01)

  await alice.getByRole('button', { name: 'Mute' }).click()
  await bob.waitForTimeout(1500) // let packets already in flight and the jitter buffer drain
  const muted = await peakLevel(bob, 4000)
  expect(muted, 'Bob should hear (almost) nothing while Alice is muted').toBeLessThan(0.002)

  await alice.getByRole('button', { name: 'Unmute' }).click()
  await bob.waitForTimeout(1000)
  const back = await peakLevel(bob, 4000)
  expect(back, 'Bob should hear Alice again after she unmutes').toBeGreaterThan(0.01)
  console.log('peak levels (open / muted / unmuted):', open.toFixed(3), muted.toFixed(4), back.toFixed(3))
})

test('a signed-out visitor is sent to log in', async ({ page }) => {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/login/)
})

test('landing page loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Speak English with real people.')
})
