/**
 * TURN credentials are short-lived and held in memory only (never localStorage / AsyncStorage). Before an ICE restart, or before
 * answering one, they are re-fetched when they have expired or will within a minute.
 */
export const ICE_REFRESH_MARGIN_MS = 60_000

/** When the credentials stop being accepted, in epoch ms. Unknown expiry counts as already due, so it is refreshed rather than trusted. */
export function iceExpiryMs(ice: { expiresAt?: string | null; ttlSeconds?: number }, now: number = Date.now()): number {
  const parsed = ice.expiresAt ? Date.parse(ice.expiresAt) : NaN
  if (Number.isFinite(parsed)) return parsed
  return now + (ice.ttlSeconds ?? 0) * 1000
}

export function iceNeedsRefresh(expiresAtMs: number, now: number = Date.now(), marginMs: number = ICE_REFRESH_MARGIN_MS): boolean {
  return expiresAtMs - now <= marginMs
}
