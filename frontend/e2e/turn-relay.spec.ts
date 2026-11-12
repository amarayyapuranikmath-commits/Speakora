import { expect, test } from '@playwright/test'
import { connectedPair, peakLevel, remoteAudio } from './helpers'

/**
 * Relay-only call. Requires the stack to be started with TURN_URLS / TURN_SHARED_SECRET / TURN_FORCE_RELAY=true and the
 * local TURN test server (tools/turn-test). With iceTransportPolicy "relay" the browsers can ONLY connect through TURN, so
 * a connected call with audio proves the backend's time-limited credentials are accepted by a real TURN implementation.
 */
test.skip(!process.env.E2E_RELAY, 'set E2E_RELAY=1 with the TURN test server and TURN_FORCE_RELAY=true')

test('the issued credentials let a browser gather a relay candidate (and say why not if it fails)', async ({ page, request }) => {
  const email = `turn.${Date.now()}@example.com`
  const reg = await request.post('/api/auth/register', { data: { email, password: 'Passw0rdOK', displayName: 'Turn', dateOfBirth: '1990-05-01' } })
  expect(reg.ok()).toBeTruthy()
  const { accessToken } = await reg.json()
  const ice = await (await request.get('/api/calls/ice-servers', { headers: { Authorization: `Bearer ${accessToken}` } })).json()
  expect(ice.turnConfigured).toBe(true)
  expect(ice.forceRelay).toBe(true)
  const turn = ice.iceServers.find((s: { username: string | null }) => s.username)
  expect(turn.username).toMatch(/^\d+:[0-9a-f-]{36}$/) // expiry:userId, like coach's use-auth-secret scheme
  expect(Number(turn.username.split(':')[0])).toBeGreaterThan(Date.now() / 1000)

  await page.goto('/')
  const result = await page.evaluate(async (servers) => {
    const errors: string[] = []
    const types: string[] = []
    const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: 'relay' })
    pc.createDataChannel('probe')
    pc.onicecandidateerror = (e) => errors.push(`${(e as RTCPeerConnectionIceErrorEvent).errorCode} ${(e as RTCPeerConnectionIceErrorEvent).errorText} @ ${(e as RTCPeerConnectionIceErrorEvent).url}`)
    pc.onicecandidate = (e) => e.candidate && types.push(e.candidate.type ?? 'unknown')
    await pc.setLocalDescription(await pc.createOffer())
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 8000)
      pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && (clearTimeout(t), resolve())
    })
    pc.close()
    return { errors, types }
  }, ice.iceServers)
  console.log('relay gathering result', JSON.stringify(result))
  expect(result.errors, 'ICE errors while allocating on the TURN server').toEqual([])
  expect(result.types).toContain('relay')
})

test('audio flows through the TURN relay using time-limited credentials', async ({ browser }) => {
  const before = await (await fetch('http://127.0.0.1:3479/stats')).json()
  const { alice, bob } = await connectedPair(browser)

  for (const [name, page] of [['alice', alice], ['bob', bob]] as const) {
    await expect.poll(async () => (await remoteAudio(page)).unmuted, { message: `${name} receives RTP via relay`, timeout: 15_000 }).toBeGreaterThan(0)
    await expect.poll(async () => (await remoteAudio(page)).playedSeconds, { timeout: 15_000 }).toBeGreaterThan(0.5)
  }
  expect(await peakLevel(bob, 4000), 'Bob hears Alice through the relay').toBeGreaterThan(0.01)
  expect(await peakLevel(alice, 4000), 'Alice hears Bob through the relay').toBeGreaterThan(0.01)

  // The server confirms that clients really authenticated and allocated relay addresses.
  const after = await (await fetch('http://127.0.0.1:3479/stats')).json()
  console.log('TURN stats before/after', JSON.stringify(before), JSON.stringify(after))
  expect(after.allocations).toBeGreaterThan(before.allocations)
})
