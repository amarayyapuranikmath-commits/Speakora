import { api } from '../../lib/api'
import { clog } from './callLog'
import type { CallStatus, EndReason, EnglishLevel } from '../../lib/types'

export interface PartnerView {
  displayName: string
  country?: string
  englishLevel?: EnglishLevel
}

export interface TopicView {
  slug: string
  name: string
  prompts: string[]
}

export type ServerMessage =
  | { type: 'connected' | 'pong' | 'queue.joined' | 'queue.cancelled' | 'queue.timeout' }
  | {
      type: 'match.found' | 'call.resume'
      callId: string
      initiator: boolean
      topic: TopicView | null
      partner: PartnerView
      status?: CallStatus
    }
  | { type: 'signal'; callId: string; kind: 'offer' | 'answer' | 'candidate'; payload: RTCSessionDescriptionInit | RTCIceCandidateInit }
  | {
      type: 'call.state'
      callId: string
      status: CallStatus
      endReason: EndReason | null
      durationSeconds: number | null
      endedBy: 'you' | 'partner' | 'system'
    }
  | { type: 'connect.ringing'; requestId: string; expiresAt: string; partner: PartnerView }
  | { type: 'connect.request'; requestId: string; expiresAt: string; from: PartnerView }
  | { type: 'connect.status'; requestId: string | null; status: 'DECLINED' | 'EXPIRED' | 'UNAVAILABLE' | 'CANCELLED'; reason: string | null }
  | { type: 'connect.closed'; requestId: string; reason: string | null }
  | { type: 'friends.changed' }
  | { type: 'message.new'; friendRef: string }
  | { type: 'error'; code: string; message: string }

export type LinkStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

interface Handlers {
  onMessage: (msg: ServerMessage) => void
  onStatus: (status: LinkStatus) => void
}

const PING_INTERVAL_MS = 15_000
const MAX_BACKOFF_MS = 8_000

/** WebSocket link to the signalling endpoint with ticket auth, heartbeat and automatic reconnection. */
/** A usable ws:// or wss:// address, or null (a missing, malformed or non-WebSocket value is ignored). */
export function socketUrl(value: string | undefined | null): URL | null {
  if (!value) return null
  try {
    const u = new URL(value)
    return u.protocol === 'wss:' || u.protocol === 'ws:' ? u : null
  } catch {
    return null
  }
}

export class SignalingClient {
  private ws: WebSocket | null = null
  private handlers: Handlers
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private intentionallyClosed = false

  constructor(handlers: Handlers) {
    this.handlers = handlers
  }

  /** Resolves once the server has acknowledged the connection. */
  async connect(): Promise<void> {
    this.intentionallyClosed = false
    this.handlers.onStatus('connecting')
    // Adding the same listener again is a no-op, so reconnecting an instance cannot stack them.
    window.addEventListener('online', this.onNetworkBack)
    document.addEventListener('visibilitychange', this.onVisible)
    await this.open()
  }

  send(message: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      clog('ws -> DROPPED (socket not open)', { type: message.type })
      return false
    }
    if (message.type !== 'ping') clog('ws ->', { type: message.type, kind: message.kind, callId: message.callId })
    this.ws.send(JSON.stringify(message))
    return true
  }

  close() {
    this.intentionallyClosed = true
    this.stopListening()
    this.stopTimers()
    this.ws?.close(1000)
    this.ws = null
    this.handlers.onStatus('closed')
  }

  private async open(): Promise<void> {
    const { ticket, wsUrl: serverWsUrl } = await api<{ ticket: string; wsUrl?: string }>('/api/ws/ticket', { method: 'POST' })
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    // The server that issued the ticket says where its own WebSocket is, so the ticket and the socket can never end up on different backends.
    // Otherwise the build-time VITE_WS_URL, otherwise this site's own address (local development).
    const wsUrl = socketUrl(serverWsUrl) ?? socketUrl(import.meta.env.VITE_WS_URL) ?? new URL(`${scheme}://${location.host}/ws/signaling`)
    wsUrl.searchParams.set('ticket', ticket)
    const ws = new WebSocket(wsUrl.toString())
    this.ws = ws

    await new Promise<void>((resolve, reject) => {
      let settled = false
      ws.onmessage = (event) => {
        let msg: ServerMessage
        try {
          msg = JSON.parse(event.data as string)
        } catch {
          return
        }
        if (msg.type !== 'pong') clog('ws <-', { type: msg.type, kind: (msg as { kind?: string }).kind, status: (msg as { status?: string }).status, endReason: (msg as { endReason?: string }).endReason, endedBy: (msg as { endedBy?: string }).endedBy, initiator: (msg as { initiator?: boolean }).initiator })
        if (msg.type === 'connected' && !settled) {
          settled = true
          this.attempts = 0
          this.startPing()
          this.handlers.onStatus('open')
          resolve()
        }
        this.handlers.onMessage(msg)
      }
      ws.onerror = () => {
        if (!settled) {
          settled = true
          reject(new Error('Could not open the connection'))
        }
      }
      ws.onclose = (e) => {
        clog('ws closed', { code: e.code, reason: e.reason, intentional: this.intentionallyClosed })
        this.stopTimers()
        if (settled && !this.intentionallyClosed && (e.code === 4001 || e.code === 4003)) {
          // Another window took over this account (4001) or the account was suspended/deleted (4003): reconnecting would only
          // make two windows kick each other out forever, so stop and say why.
          this.intentionallyClosed = true
          this.stopListening()
          this.handlers.onStatus('closed')
          this.handlers.onMessage({
            type: 'error',
            code: e.code === 4001 ? 'SESSION_REPLACED' : 'SESSION_ENDED',
            message: e.code === 4001 ? 'This account is open in another window, so this one was disconnected. Start again here to use this window.' : 'This account can no longer be used.',
          })
          return
        }
        if (!settled) {
          settled = true
          reject(new Error('Connection closed'))
        } else if (!this.intentionallyClosed) {
          this.scheduleReconnect()
        }
      }
    })
  }

  private scheduleReconnect() {
    this.handlers.onStatus('reconnecting')
    const delay = Math.min(1000 * 2 ** this.attempts, MAX_BACKOFF_MS)
    this.attempts += 1
    if (this.retryTimer) clearTimeout(this.retryTimer) // never two retries pending: a leaked timer would open a second connection
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.open().catch(() => {
        if (!this.intentionallyClosed) this.scheduleReconnect()
      })
    }, delay)
  }

  /**
   * The browser says the network is back, or the tab is visible again (a hidden tab's timers are slowed down). If a retry is only
   * waiting out its back-off, make it now: without this the link could stay down for up to MAX_BACKOFF_MS after the network returned.
   */
  private onNetworkBack = () => {
    if (this.intentionallyClosed || !this.retryTimer) return // not waiting to retry: there is nothing to hurry
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    clog('ws reconnect now (network or tab is back)')
    this.open().catch(() => {
      if (!this.intentionallyClosed) this.scheduleReconnect()
    })
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible') this.onNetworkBack()
  }

  private stopListening() {
    window.removeEventListener('online', this.onNetworkBack)
    document.removeEventListener('visibilitychange', this.onVisible)
  }

  private startPing() {
    this.stopPing()
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS)
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private stopTimers() {
    this.stopPing()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}
