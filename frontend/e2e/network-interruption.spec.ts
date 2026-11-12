import { expect, test, type Page } from '@playwright/test'
import { peakLevel, remoteAudio, signUp } from './helpers'

/**
 * Severs and restores the REAL signalling WebSocket of one participant mid-call (the browser's own network stack is not
 * touched, so media keeps its loopback path: this tests signalling loss, reconnection, call-state recovery and the server's
 * 20-second grace period, not packet loss or ICE restart on a changed network, which need real devices/networks).
 */

interface Link { drop(): void; restore(): void }

async function controllableSignalling(page: Page): Promise<Link> {
  const state: { blocked: boolean; live: { ws: { close(): void }; server: { close(): void } } | null } = { blocked: false, live: null }
  await page.routeWebSocket(/\/ws\/signaling/, (ws) => {
    if (state.blocked) {
      ws.close() // the "network" is down: refuse new connections
      return
    }
    state.live = { ws, server: ws.connectToServer() } // pass-through until we decide to cut it
  })
  return {
    drop() {
      state.blocked = true
      state.live?.server.close()
      state.live?.ws.close()
    },
    restore() { state.blocked = false },
  }
}

async function startPair(browser: Parameters<typeof signUp>[0]) {
  const [alice, bob] = [await signUp(browser, 'Alice'), await signUp(browser, 'Bob')]
  const aliceLink = await controllableSignalling(alice)
  for (const page of [alice, bob]) {
    await page.getByRole('link', { name: /start speaking/i }).click()
    await page.getByRole('button', { name: /start looking/i }).click()
  }
  for (const page of [alice, bob]) await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await remoteAudio(bob)).unmuted, { timeout: 10_000 }).toBeGreaterThan(0)
  return { alice, bob, aliceLink }
}

test.describe('network interruption', () => {
  test.setTimeout(150_000)

  test('a short signalling outage: both sides show reconnecting, the call recovers by itself and audio keeps flowing', async ({ browser }) => {
    const { alice, bob, aliceLink } = await startPair(browser)

    aliceLink.drop()
    await expect(alice.getByText(/reconnecting to the server/i)).toBeVisible({ timeout: 10_000 })
    await expect(bob.getByText(/connection lost\. reconnecting/i)).toBeVisible({ timeout: 10_000 }) // server told Bob

    await bob.waitForTimeout(4000) // well inside the 20 s grace period
    aliceLink.restore()

    await expect(bob.getByText('Connected', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(alice.getByText('Connected', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(alice.getByText(/reconnecting to the server/i)).toHaveCount(0)
    expect(await peakLevel(bob, 4000), 'Bob still hears Alice after the outage').toBeGreaterThan(0.01)

    // the call is fully usable afterwards: it ends normally for both
    await alice.getByRole('button', { name: 'End call' }).click()
    await expect(alice.getByRole('heading', { name: 'Call ended' })).toBeVisible()
    await expect(bob.getByRole('heading', { name: 'Call ended' })).toBeVisible()
  })

  test('an outage longer than the grace period ends the call for both, and the returning user is told', async ({ browser }) => {
    const { alice, bob, aliceLink } = await startPair(browser)

    aliceLink.drop()
    await expect(bob.getByText(/connection lost\. reconnecting/i)).toBeVisible({ timeout: 10_000 })

    // After ~20 s the server gives up on Alice and ends the call; Bob is told it was a disconnect.
    await expect(bob.getByRole('heading', { name: 'Call ended' })).toBeVisible({ timeout: 40_000 })
    await expect(bob.getByText(/lost their connection/i)).toBeVisible()

    // Alice comes back online. Her client must not sit on a dead call: it asks the server and shows it ended.
    aliceLink.restore()
    await expect(alice.getByRole('heading', { name: 'Call ended' })).toBeVisible({ timeout: 40_000 })
    await expect(alice.getByRole('button', { name: 'Find another partner' })).toBeVisible()
  })

  test('closing the tab mid-call ends it for the partner after the grace period', async ({ browser }) => {
    const { alice, bob } = await startPair(browser)
    await alice.context().close() // browser/tab gone: no goodbye message at all
    await expect(bob.getByText(/connection lost\. reconnecting/i)).toBeVisible({ timeout: 10_000 })
    await expect(bob.getByRole('heading', { name: 'Call ended' })).toBeVisible({ timeout: 40_000 })
    await expect(bob.getByRole('button', { name: 'Find another partner' })).toBeVisible()
  })
})
