import { expect, test, type Page } from '@playwright/test'
import { connectedPair, peakLevel, remoteAudio } from './helpers'

/**
 * Relay-only call through the REAL Turnix service. Run with the backend started with TURNIX_API_TOKEN set and
 * TURN_FORCE_RELAY=true, and E2E_TURNIX_RELAY=1. With iceTransportPolicy "relay" the browsers can only connect through TURN, and
 * the selected candidate pair is read from getStats() to prove it. Nothing here prints credentials.
 */
test.skip(!process.env.E2E_TURNIX_RELAY, 'set E2E_TURNIX_RELAY=1 with TURNIX_API_TOKEN configured and TURN_FORCE_RELAY=true')

const HOOK = `
  (() => {
    const Orig = window.RTCPeerConnection
    window.__pcs = []
    function Hooked(...args) { const pc = new Orig(...args); window.__pcs.push(pc); return pc }
    Hooked.prototype = Orig.prototype
    Object.setPrototypeOf(Hooked, Orig)
    window.RTCPeerConnection = Hooked
  })()
`

interface PairStats {
  pairState: string
  localType: string
  remoteType: string
  localProtocol: string | null
  relayProtocol: string | null
  bytesSent: number
  bytesReceived: number
}

const pairStats = (page: Page): Promise<PairStats> =>
  page.evaluate(async () => {
    const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs
    const pc = pcs[pcs.length - 1]
    const report = await pc.getStats()
    const byId = new Map<string, Record<string, unknown>>()
    report.forEach((s) => byId.set(s.id, s as Record<string, unknown>))
    const all = [...byId.values()]
    const transport = all.find((s) => s.type === 'transport' && s.selectedCandidatePairId)
    const pair = byId.get(transport?.selectedCandidatePairId as string) ?? all.find((s) => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded')
    const local = byId.get(pair?.localCandidateId as string)
    const remote = byId.get(pair?.remoteCandidateId as string)
    const out = all.find((s) => s.type === 'outbound-rtp' && s.kind === 'audio')
    const inn = all.find((s) => s.type === 'inbound-rtp' && s.kind === 'audio')
    return {
      pairState: String(pair?.state),
      localType: String(local?.candidateType),
      remoteType: String(remote?.candidateType),
      localProtocol: (local?.protocol as string) ?? null,
      relayProtocol: (local?.relayProtocol as string) ?? null,
      bytesSent: Number(out?.bytesSent ?? 0),
      bytesReceived: Number(inn?.bytesReceived ?? 0),
    }
  })

test('a call through real Turnix uses a relay candidate pair and audio flows both ways', async ({ browser }) => {
  // The shared helpers create their own browser contexts; make each of them record its RTCPeerConnections.
  const original = browser.newContext.bind(browser)
  ;(browser as { newContext: typeof browser.newContext }).newContext = async (options) => {
    const context = await original(options)
    await context.addInitScript(HOOK)
    return context
  }

  const { alice, bob } = await connectedPair(browser)

  for (const [name, page] of [['alice', alice], ['bob', bob]] as const) {
    await expect.poll(async () => (await remoteAudio(page)).unmuted, { message: `${name} receives RTP`, timeout: 20_000 }).toBeGreaterThan(0)
  }
  expect(await peakLevel(bob, 4000), 'Bob hears Alice').toBeGreaterThan(0.01)
  expect(await peakLevel(alice, 4000), 'Alice hears Bob').toBeGreaterThan(0.01)

  const first: Record<string, PairStats> = { alice: await pairStats(alice), bob: await pairStats(bob) }
  console.log('selected pair', JSON.stringify({ alice: { ...first.alice, bytesSent: undefined, bytesReceived: undefined }, bob: { ...first.bob, bytesSent: undefined, bytesReceived: undefined } }))
  for (const [name, s] of Object.entries(first)) {
    expect(s.pairState, `${name} pair state`).toBe('succeeded')
    expect(s.localType, `${name} selected LOCAL candidate type`).toBe('relay')
    expect(s.remoteType, `${name} selected REMOTE candidate type`).toBe('relay')
  }

  await alice.waitForTimeout(3000)
  const second: Record<string, PairStats> = { alice: await pairStats(alice), bob: await pairStats(bob) }
  for (const name of ['alice', 'bob']) {
    expect(second[name].bytesSent, `${name} keeps SENDING audio over the relay`).toBeGreaterThan(first[name].bytesSent)
    expect(second[name].bytesReceived, `${name} keeps RECEIVING audio over the relay`).toBeGreaterThan(first[name].bytesReceived)
  }
  console.log('audio bytes over relay', JSON.stringify({
    aliceSentDelta: second.alice.bytesSent - first.alice.bytesSent, aliceReceivedDelta: second.alice.bytesReceived - first.alice.bytesReceived,
    bobSentDelta: second.bob.bytesSent - first.bob.bytesSent, bobReceivedDelta: second.bob.bytesReceived - first.bob.bytesReceived,
    relayProtocol: first.alice.relayProtocol,
  }))
})
