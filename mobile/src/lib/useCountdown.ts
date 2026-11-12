import { useEffect, useState } from 'react'

/** Whole seconds left until `expiresAt` (epoch ms), ticking each second; null when there is no deadline. */
export function useCountdown(expiresAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (expiresAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  return expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - now) / 1000))
}
