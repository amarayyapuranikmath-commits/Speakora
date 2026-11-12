import { ICE_REFRESH_MARGIN_MS, iceExpiryMs, iceNeedsRefresh } from '../src/features/call/iceExpiry'

const NOW = Date.parse('2026-11-10T10:00:00Z')

describe('TURN credential expiry', () => {
  it('uses the provider expiry when it is a valid timestamp', () => {
    expect(iceExpiryMs({ expiresAt: '2026-11-10T11:00:00Z', ttlSeconds: 10 }, NOW)).toBe(Date.parse('2026-11-10T11:00:00Z'))
  })

  it('falls back to the ttl, and treats an unknown expiry as already due', () => {
    expect(iceExpiryMs({ expiresAt: 'garbage', ttlSeconds: 3600 }, NOW)).toBe(NOW + 3_600_000)
    expect(iceNeedsRefresh(iceExpiryMs({}, NOW), NOW)).toBe(true)
  })

  it('refreshes when expired or expiring within 60 seconds, not before', () => {
    expect(ICE_REFRESH_MARGIN_MS).toBe(60_000)
    expect(iceNeedsRefresh(NOW - 1, NOW)).toBe(true)
    expect(iceNeedsRefresh(NOW + 59_000, NOW)).toBe(true)
    expect(iceNeedsRefresh(NOW + 60_000, NOW)).toBe(true)
    expect(iceNeedsRefresh(NOW + 61_000, NOW)).toBe(false)
  })
})
