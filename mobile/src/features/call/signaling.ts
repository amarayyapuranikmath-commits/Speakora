import { AppState } from 'react-native'
import { api, getBaseUrl } from '../../lib/api'
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
  | { type: 'match.found' | 'call.resume'; callId: string; initiator: boolean; topic: TopicView | null; partner: PartnerView; status?: CallStatus }
  | { type: 'signal'; callId: string; kind: 'offer' | 'answer' | 'candidate'; payload: unknown }
  | { type: 'call.state'; callId: string; status: CallStatus; endReason: EndReason | null; durationSeconds: number | null; endedBy: 'you' | 'partner' | 'system' }
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

/** WebSocket link to the signalling endpoint: single-use ticket, heartbeat, automatic reconnection. Mirrors the web client. */
export class SignalingClient {
  private ws: WebSocket | null = null
  private handlers: Handlers
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private intentionallyClosed = false
  private appStateSubscription: { remove(): void } | null = null

  constructor(handlers: Handlers) {
    this.handlers = handlers
  }

  async connect(): Promise<void> {
    this.intentionallyClosed = false
    this.handlers.onStatus('connecting')
    // The phone has no "network is back" event without an extra library; coming back to the app (screen on, app reopened) is the
    // moment a stalled link matters, so that is the trigger. One subscription per instance.
    if (!this.appStateSubscription) this.appStateSubscription = AppState.addEventListener('change', this.onAppState)
    await this.open()
  }

  send(message: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== 1) {
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
    const { ticket } = await api<{ ticket: string }>('/api/ws/ticket', { method: 'POST' })
    const base = getBaseUrl()
    const url = `${base.replace(/^http/, 'ws')}/ws/signaling?ticket=${encodeURIComponent(ticket)}`
    // The server only accepts handshakes from its own origin. Browsers send that automatically; a native client must say it.
    const ws = new (WebSocket as unknown as new (u: string, p: null, o: { headers: Record<string, string> }) => WebSocket)(url, null, { headers: { Origin: base } })
    this.ws = ws

    await new Promise<void>((resolve, reject) => {
      let settled = false
      ws.onmessage = (event) => {
        let msg: ServerMessage
        try {
          msg = JSON.parse(String(event.data))
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
        clog('ws closed', { code: (e as { code?: number }).code, reason: (e as { reason?: string }).reason, intentional: this.intentionallyClosed })
        this.stopTimers()
        const code = (e as { code?: number }).code
        if (settled && !this.intentionallyClosed && (code === 4001 || code === 4003)) {
          // Another device took over this account (4001) or it was suspended/deleted (4003): reconnecting would only make two
          // devices kick each other out forever, so stop and say why.
          this.intentionallyClosed = true
          this.stopListening()
          this.handlers.onStatus('closed')
          this.handlers.onMessage({
            type: 'error',
            code: code === 4001 ? 'SESSION_REPLACED' : 'SESSION_ENDED',
            message: code === 4001 ? 'This account is open on another device or window, so this one was disconnected. Start again here to use this device.' : 'This account can no longer be used.',
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
   * The app is in the foreground again. If a retry is only waiting out its back-off, make it now: without this a phone that was
   * locked or lost signal could stay disconnected for up to MAX_BACKOFF_MS after the person is back.
   */
  private onAppState = (state: string) => {
    if (state !== 'active' || this.intentionallyClosed || !this.retryTimer) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    clog('ws reconnect now (app is active again)')
    this.open().catch(() => {
      if (!this.intentionallyClosed) this.scheduleReconnect()
    })
  }

  private stopListening() {
    this.appStateSubscription?.remove()
    this.appStateSubscription = null
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
