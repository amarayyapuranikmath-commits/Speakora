/**
 * Debug builds only: pick the server address that actually answers.
 *
 * The welcome screen lets a developer save a server address, and that saved address used to win unconditionally. On a phone hotspot (or any
 * Wi-Fi that hands out a new subnet each time) the saved LAN address goes stale, and the app then reported "could not reach the server" even
 * though the USB tunnel (`adb reverse tcp:8080 tcp:8080`, reachable as http://localhost:8080) was working. Now the saved address is tried first,
 * and if it does not answer within a moment the built-in default is used instead. Release builds never call this: they always use the
 * https address baked in by `npm run set-api-url`.
 */
export const PROBE_TIMEOUT_MS = 2000

/** True when the backend's health endpoint answers (any HTTP answer from the right server counts as reachable, a refusal or a timeout does not). */
export async function isReachable(baseUrl: string, ms = PROBE_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/actuator/health`, { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The first reachable address, in priority order: the one saved on the welcome screen, then the built-in default. All are probed at the same
 * time, so the wait is at most one timeout. If none answers (the backend is down), the saved address is kept, as before, so the developer's
 * explicit choice is not silently replaced.
 */
export async function chooseServer(saved: string | null, fallback: string, probe: (url: string) => Promise<boolean> = isReachable): Promise<string> {
  const clean = (u: string) => u.replace(/\/$/, '')
  const candidates = [...new Set([saved, fallback].filter((u): u is string => !!u && u.trim() !== '').map(clean))]
  const answers = await Promise.all(candidates.map((u) => probe(u)))
  const firstReachable = candidates.find((_, i) => answers[i])
  return firstReachable ?? clean(saved || fallback)
}
