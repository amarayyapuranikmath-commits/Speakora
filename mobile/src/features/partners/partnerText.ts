import type { RequestResult } from '../call/CallContext'

/** A plain-language sentence for what happened to a private-call request the user sent. Null when there is nothing to say. */
export function resultMessage(r: RequestResult): string | null {
  const name = r.partnerName || 'That person'
  if (r.status === 'CANCELLED') return null
  if (r.status === 'DECLINED') return `${name} can't talk right now.`
  if (r.status === 'EXPIRED') return `${name} didn't answer. They may be away from their phone.`
  switch (r.reason) {
    case 'OFFLINE':
      return `${name} is offline.`
    case 'BUSY':
      return `${name} is in another call or already answering someone.`
    case 'NOT_ACCEPTING':
      return `${name} isn't accepting calls right now.`
    case 'LINK':
      return 'We could not reach the server. Check your connection and try again.'
    default:
      return `${name} is no longer available.`
  }
}
