import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import InCallManager from 'react-native-incall-manager'
import type { MediaStream } from 'react-native-webrtc'
import { api } from '../../lib/api'
import { liveEvents } from '../../lib/liveEvents'
import type { Quality } from '../../lib/quality'
import type { CallStatus, CallSummary, EndReason, IceConfig } from '../../lib/types'
import { clog } from './callLog'
import { iceExpiryMs, iceNeedsRefresh } from './iceExpiry'
import { endCallNotification, showCallNotification } from './foreground'
import { CallPeer, acquireMicrophone, type MicError } from './peer'
import { SignalingClient, type LinkStatus, type PartnerView, type ServerMessage, type TopicView } from './signaling'

export type Phase = 'idle' | 'starting' | 'searching' | 'connecting' | 'connected' | 'reconnecting' | 'ended'

export interface EndInfo {
  callId: string
  status: CallStatus | null
  endReason: EndReason | null
  durationSeconds: number | null
  endedBy: 'you' | 'partner' | 'system' | null
}

export interface CallState {
  phase: Phase
  callId: string | null
  partner: PartnerView | null
  topic: TopicView | null
  requestedTopic: string | null
  quality: Quality
  muted: boolean
  speakerOn: boolean
  connectedAt: number | null
  micError: MicError | null
  notice: string | null
  endInfo: EndInfo | null
  link: LinkStatus
}

/** Someone you talked to before is asking to talk again. Nothing starts until you accept. */
export interface IncomingRequest {
  requestId: string
  from: PartnerView
  expiresAt: number
}

/** The request you sent and are waiting on. `requestId` is null for the instant before the server confirms it. */
export interface OutgoingRequest {
  requestId: string | null
  partnerName: string
  expiresAt: number | null
}

export interface RequestResult {
  status: 'DECLINED' | 'EXPIRED' | 'UNAVAILABLE' | 'CANCELLED'
  /** OFFLINE, BUSY, NOT_ACCEPTING, UNAVAILABLE, LINK or null. */
  reason: string | null
  partnerName: string
}

interface RequestState {
  incoming: IncomingRequest | null
  outgoing: OutgoingRequest | null
  requestResult: RequestResult | null
}

const noRequests: RequestState = { incoming: null, outgoing: null, requestResult: null }

interface CallActions {
  /** Keeps the signalling link open while signed in, so people can reach you and you can see who is online. */
  ensureLink: () => Promise<boolean>
  /** Asks a friend (by their friend handle) for a private call. */
  requestConnect: (friendRef: string, friendName: string) => Promise<void>
  cancelRequest: () => void
  acceptRequest: () => Promise<void>
  declineRequest: () => void
  dismissRequestResult: () => void
  start: (topicSlug: string | null) => Promise<void>
  cancelSearch: () => void
  endCall: () => void
  skip: () => void
  toggleMute: () => void
  toggleSpeaker: () => void
  dismissEnded: () => void
  reset: () => void
}

const initial: CallState = {
  phase: 'idle', callId: null, partner: null, topic: null, requestedTopic: null, quality: 'unknown', muted: false, speakerOn: false,
  connectedAt: null, micError: null, notice: null, endInfo: null, link: 'closed',
}

function toIceServers(ice: IceConfig) {
  return ice.iceServers.map((s) => ({ urls: s.urls, ...(s.username ? { username: s.username } : {}), ...(s.credential ? { credential: s.credential } : {}) }))
}

const DISCONNECT_GRACE_MS = 4_000
const RECONNECT_DEADLINE_MS = 30_000
const RESTART_INTERVAL_MS = 8_000
const END_CONFIRM_TIMEOUT_MS = 4_000

const CONNECT_DEADLINE_MS = 30_000

const CallContext = createContext<(CallState & CallActions & RequestState) | null>(null)

export function CallProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CallState>(initial)
  const stateRef = useRef<CallState>(initial)
  const [requests, setRequests] = useState<RequestState>(noRequests)
  const requestsRef = useRef<RequestState>(noRequests)
  const accepting = useRef<string | null>(null)
  const replaced = useRef(false)
  const linking = useRef<Promise<boolean> | null>(null)
  const signaling = useRef<SignalingClient | null>(null)
  const peer = useRef<CallPeer | null>(null)
  const peerReady = useRef<Promise<void>>(Promise.resolve())
  const localStream = useRef<MediaStream | null>(null)
  const initiator = useRef(false)
  const iceExpiry = useRef(0) // epoch ms; TURN credentials live in memory only and are never persisted
  const iceRefresh = useRef<Promise<void> | null>(null)
  const skipping = useRef<string | null>(null)
  const resumeSeen = useRef(false)
  const lastLink = useRef<LinkStatus>('closed')
  const audioSession = useRef(false)
  const timers = useRef<{ connectDeadline?: ReturnType<typeof setTimeout>; disconnect?: ReturnType<typeof setTimeout>; deadline?: ReturnType<typeof setTimeout>; restart?: ReturnType<typeof setInterval>; endConfirm?: ReturnType<typeof setTimeout> }>({})

  const update = useCallback((patch: Partial<CallState>) => {
    stateRef.current = { ...stateRef.current, ...patch }
    setState(stateRef.current)
  }, [])

  const updateRequests = useCallback((patch: Partial<RequestState>) => {
    requestsRef.current = { ...requestsRef.current, ...patch }
    setRequests(requestsRef.current)
  }, [])

  const clearTimers = useCallback(() => {
    const t = timers.current
    if (t.connectDeadline) clearTimeout(t.connectDeadline)
    if (t.disconnect) clearTimeout(t.disconnect)
    if (t.deadline) clearTimeout(t.deadline)
    if (t.restart) clearInterval(t.restart)
    if (t.endConfirm) clearTimeout(t.endConfirm)
    timers.current = {}
  }, [])

  /** Audio routing and the "call in progress" notification only exist while a call (or a search) is live. */
  const startAudioSession = useCallback((partnerName: string | null) => {
    if (!audioSession.current) {
      audioSession.current = true
      clog('InCallManager.start')
      InCallManager.start({ media: 'audio' })
      InCallManager.setForceSpeakerphoneOn(stateRef.current.speakerOn)
    }
    void showCallNotification(partnerName)
  }, [])

  const stopAudioSession = useCallback(() => {
    if (audioSession.current) {
      audioSession.current = false
      clog('InCallManager.stop')
      InCallManager.stop()
    }
    void endCallNotification()
  }, [])

  const closePeer = useCallback(() => {
    peer.current?.close()
    peer.current = null
    iceExpiry.current = 0
    peerReady.current = Promise.resolve()
    clearTimers()
  }, [clearTimers])

  const releaseMicrophone = useCallback(() => {
    localStream.current?.getTracks().forEach((t) => t.stop())
    localStream.current = null
  }, [])

  const closeSignaling = useCallback(() => {
    signaling.current?.close()
    signaling.current = null
  }, [])

  const sendSignal = useCallback((kind: 'offer' | 'answer' | 'candidate', payload: unknown) => {
    const callId = stateRef.current.callId
    if (callId) signaling.current?.send({ type: 'signal', callId, kind, payload })
  }, [])

  /** Re-fetches TURN credentials when they expired or expire within a minute. Best effort: a failure is logged and the restart still goes ahead. */
  const refreshIce = useCallback(async () => {
    const p = peer.current
    if (!p || !iceNeedsRefresh(iceExpiry.current)) return
    if (!iceRefresh.current) {
      iceRefresh.current = (async () => {
        try {
          const ice = await api<IceConfig>('/api/calls/ice-servers')
          if (peer.current !== p) return // the call ended or was replaced while we waited
          p.setIceServers(toIceServers(ice))
          iceExpiry.current = iceExpiryMs(ice)
        } catch (e) {
          console.warn('Could not refresh TURN credentials', e)
        } finally {
          iceRefresh.current = null
        }
      })()
    }
    await iceRefresh.current
  }, [])

  const restartIce = useCallback(async () => {
    const p = peer.current
    if (!p || !initiator.current) return
    try {
      await refreshIce()
      sendSignal('offer', await p.createOffer(true))
    } catch (e) {
      console.warn('ICE restart failed', e)
    }
  }, [refreshIce, sendSignal])

  const enterReconnecting = useCallback(() => {
    const s = stateRef.current
    if (s.phase === 'ended' || s.phase === 'idle' || !s.callId) return
    clog('enterReconnecting', { phase: s.phase })
    if (s.phase !== 'reconnecting') {
      update({ phase: 'reconnecting', quality: 'unknown' })
      signaling.current?.send({ type: 'call.reconnecting', callId: s.callId })
    }
    if (!timers.current.restart) {
      void restartIce()
      timers.current.restart = setInterval(() => void restartIce(), RESTART_INTERVAL_MS)
    }
    if (!timers.current.deadline) {
      timers.current.deadline = setTimeout(() => {
        const cur = stateRef.current
        if (cur.phase === 'reconnecting' && cur.callId) {
          clog('reconnect deadline reached -> call.failed')
          signaling.current?.send({ type: 'call.failed', callId: cur.callId })
        }
      }, RECONNECT_DEADLINE_MS)
    }
  }, [restartIce, update])

  const onPeerState = useCallback(
    (pcState: string) => {
      clog('onPeerState', { pcState, phase: stateRef.current.phase })
      const t = timers.current
      if (pcState === 'connected') {
        if (t.connectDeadline) clearTimeout(t.connectDeadline)
        if (t.disconnect) clearTimeout(t.disconnect)
        if (t.deadline) clearTimeout(t.deadline)
        if (t.restart) clearInterval(t.restart)
        timers.current = { endConfirm: t.endConfirm }
        const cur = stateRef.current
        if (cur.callId) signaling.current?.send({ type: 'call.connected', callId: cur.callId })
        update({ phase: 'connected', connectedAt: cur.connectedAt ?? Date.now() })
      } else if (pcState === 'disconnected') {
        if (!t.disconnect) t.disconnect = setTimeout(() => { timers.current.disconnect = undefined; enterReconnecting() }, DISCONNECT_GRACE_MS)
      } else if (pcState === 'failed') {
        enterReconnecting()
      }
    },
    [enterReconnecting, update],
  )

  const beginCall = useCallback(
    async (msg: Extract<ServerMessage, { type: 'match.found' | 'call.resume' }>) => {
      const cur = stateRef.current
      clog('beginCall', { type: msg.type, initiator: msg.initiator, status: msg.status, hasLocalStream: !!localStream.current })
      if (msg.type === 'match.found') {
        accepting.current = null
        updateRequests({ incoming: null, outgoing: null, requestResult: null })
      }
      if (msg.type === 'call.resume' && peer.current && cur.callId === msg.callId) {
        if (peer.current.connectionState !== 'connected') {
          enterReconnecting()
        } else {
          // Media never broke: tell the server so it leaves RECONNECTING and the partner's screen recovers too.
          signaling.current?.send({ type: 'call.connected', callId: msg.callId })
          if (cur.phase === 'reconnecting') update({ phase: 'connected' })
        }
        return
      }
      if (!localStream.current) {
        const mic = await acquireMicrophone()
        if ('error' in mic) {
          update({ micError: mic.error, phase: 'idle', notice: 'You left the call because your microphone is unavailable.' })
          signaling.current?.send({ type: 'call.end', callId: msg.callId })
          stopAudioSession()
          return
        }
        localStream.current = mic.stream
      }
      closePeer()
      initiator.current = msg.initiator
      const resuming = msg.status === 'CONNECTED' || msg.status === 'RECONNECTING'
      update({
        phase: resuming ? 'reconnecting' : 'connecting', callId: msg.callId, partner: msg.partner, topic: msg.topic,
        quality: 'unknown', connectedAt: null, notice: null, endInfo: null, muted: false,
      })
      startAudioSession(msg.partner.displayName)
      if (!resuming) {
        // If the media never connects, fail the call instead of leaving both people stuck on "connecting".
        timers.current.connectDeadline = setTimeout(() => {
          const now = stateRef.current
          if (now.phase === 'connecting' && now.callId === msg.callId) {
            signaling.current?.send({ type: 'call.failed', callId: msg.callId })
            update({ notice: 'We could not connect the call. Please try again.' })
          }
        }, CONNECT_DEADLINE_MS)
      }
      peerReady.current = (async () => {
        const ice = await api<IceConfig>('/api/calls/ice-servers')
        iceExpiry.current = iceExpiryMs(ice)
        const servers = toIceServers(ice)
        peer.current = new CallPeer({ iceServers: servers, ...(ice.forceRelay ? { iceTransportPolicy: 'relay' as const } : {}) }, localStream.current!, {
          onIceCandidate: (c) => sendSignal('candidate', c),
          onRemoteStream: () => undefined, // the native audio module plays the remote audio; nothing to attach on Android
          onConnectionState: onPeerState,
          onStats: (_s, quality) => {
            if (stateRef.current.quality !== quality) update({ quality })
          },
        })
        if (initiator.current) sendSignal('offer', await peer.current.createOffer(resuming))
      })()
      try {
        await peerReady.current
      } catch (e) {
        clog('beginCall FAILED', { message: (e as Error).message })
        console.error('Could not start the call', e)
        signaling.current?.send({ type: 'call.failed', callId: msg.callId })
      }
    },
    [closePeer, enterReconnecting, onPeerState, sendSignal, startAudioSession, stopAudioSession, update, updateRequests],
  )

  const handleSignal = useCallback(
    async (msg: Extract<ServerMessage, { type: 'signal' }>) => {
      try {
        await peerReady.current
        const p = peer.current
        if (!p || msg.callId !== stateRef.current.callId) return
        if (msg.kind === 'offer') {
          await refreshIce() // an ICE restart: answer it with fresh TURN credentials if ours are about to expire
          sendSignal('answer', await p.acceptOffer(msg.payload as { type: string; sdp: string }))
        }
        else if (msg.kind === 'answer') await p.acceptAnswer(msg.payload as { type: string; sdp: string })
        else await p.addCandidate(msg.payload as Record<string, unknown>)
      } catch (e) {
        console.warn('Failed to process signal', e)
      }
    },
    [refreshIce, sendSignal],
  )

  const finishCall = useCallback(
    (info: EndInfo) => {
      clog('finishCall', { ...info, phase: stateRef.current.phase })
      closePeer()
      releaseMicrophone()
      stopAudioSession()
      update({ phase: 'ended', endInfo: info, quality: 'unknown' })
    },
    [closePeer, releaseMicrophone, stopAudioSession, update],
  )

  // If signalling was down and the server ended the call meanwhile, no event can reach us after we reconnect:
  // ask the server what became of it when the link returns without a `call.resume`.
  const verifyCallAfterReconnect = useCallback(() => {
    const before = stateRef.current
    if (!before.callId || !['connecting', 'connected', 'reconnecting'].includes(before.phase)) return
    resumeSeen.current = false
    setTimeout(async () => {
      const now = stateRef.current
      if (resumeSeen.current || now.callId !== before.callId || now.phase === 'ended' || now.phase === 'idle') return
      try {
        const call = await api<CallSummary>(`/api/calls/${before.callId}`)
        if (call.status === 'COMPLETED' || call.status === 'FAILED' || call.status === 'CANCELLED') {
          finishCall({ callId: call.id, status: call.status, endReason: call.endReason, durationSeconds: call.durationSeconds, endedBy: 'system' })
        }
      } catch {
        // unreachable: the next reconnect tries again
      }
    }, 2500)
  }, [finishCall])

  const onLinkChange = useCallback(
    (link: LinkStatus) => {
      update({ link })
      if (link === 'open' && lastLink.current === 'reconnecting') {
        verifyCallAfterReconnect()
        liveEvents.emit({ type: 'resync' }) // friend changes and messages may have arrived while we were away
        // The server forgets a waiting user when their socket drops, so a search must be re-entered or it silently never matches.
        const s = stateRef.current
        if (s.phase === 'searching') signaling.current?.send({ type: 'queue.join', topicSlug: s.requestedTopic })
      }
      if (link !== 'open' && (requestsRef.current.incoming || requestsRef.current.outgoing)) {
        // The server withdraws requests when the link drops; showing them would only offer buttons that no longer work.
        updateRequests({ incoming: null, outgoing: null })
        if (!stateRef.current.callId && stateRef.current.phase === 'idle') {
          localStream.current?.getTracks().forEach((t) => t.stop())
          localStream.current = null
        }
      }
      lastLink.current = link
    },
    [update, updateRequests, verifyCallAfterReconnect],
  )

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      const cur = stateRef.current
      switch (msg.type) {
        case 'match.found':
        case 'call.resume':
          if (msg.type === 'call.resume') resumeSeen.current = true
          void beginCall(msg)
          break
        case 'signal':
          void handleSignal(msg)
          break
        case 'call.state': {
          if (skipping.current === msg.callId) {
            if (msg.status === 'COMPLETED' || msg.status === 'FAILED' || msg.status === 'CANCELLED') skipping.current = null
            break
          }
          if (msg.callId !== cur.callId) break
          if (msg.status === 'COMPLETED' || msg.status === 'FAILED' || msg.status === 'CANCELLED') {
            finishCall({ callId: msg.callId, status: msg.status, endReason: msg.endReason, durationSeconds: msg.durationSeconds, endedBy: msg.endedBy })
          } else if (msg.status === 'RECONNECTING' && cur.phase === 'connected') {
            update({ phase: 'reconnecting' })
          } else if (msg.status === 'CONNECTED' && cur.phase === 'reconnecting' && peer.current?.connectionState === 'connected') {
            update({ phase: 'connected' })
          }
          break
        }
        case 'queue.timeout':
          clog('queue.timeout handled', { phase: cur.phase })
          releaseMicrophone()
          stopAudioSession()
          update({ phase: 'idle', notice: 'No partner was available right now. Please try again in a moment.' })
          break
        case 'connect.request':
          if (cur.phase === 'idle' || cur.phase === 'ended' || cur.phase === 'searching') {
            updateRequests({ incoming: { requestId: msg.requestId, from: msg.from, expiresAt: Date.parse(msg.expiresAt) } })
          }
          break
        case 'connect.ringing':
          updateRequests({ outgoing: { requestId: msg.requestId, partnerName: msg.partner.displayName, expiresAt: Date.parse(msg.expiresAt) }, requestResult: null })
          break
        case 'connect.status': {
          const out = requestsRef.current.outgoing
          if (!out || (msg.requestId && out.requestId && msg.requestId !== out.requestId)) break
          updateRequests({ outgoing: null, requestResult: { status: msg.status, reason: msg.reason, partnerName: out.partnerName } })
          if (!cur.callId && cur.phase === 'idle') {
            localStream.current?.getTracks().forEach((t) => t.stop())
            localStream.current = null
          }
          break
        }
        case 'connect.closed':
          if (requestsRef.current.incoming?.requestId === msg.requestId) updateRequests({ incoming: null })
          if (accepting.current === msg.requestId && cur.phase === 'starting' && !cur.callId) {
            accepting.current = null
            releaseMicrophone()
            stopAudioSession()
            update({ phase: 'idle', notice: 'That person is no longer available.' })
          }
          break
        case 'friends.changed':
          liveEvents.emit({ type: 'friends.changed' })
          break
        case 'message.new':
          liveEvents.emit({ type: 'message.new', friendRef: msg.friendRef })
          break
        case 'error':
          if (msg.code === 'SESSION_REPLACED') replaced.current = true
          if (cur.phase === 'searching' || cur.phase === 'starting') {
            releaseMicrophone()
            stopAudioSession()
            update({ phase: 'idle', notice: msg.message })
          } else {
            update({ notice: msg.message })
          }
          if (requestsRef.current.outgoing) {
            updateRequests({ outgoing: null })
            if (!cur.callId && cur.phase === 'idle') releaseMicrophone()
          }
          break
        default:
          break
      }
    },
    [beginCall, finishCall, handleSignal, releaseMicrophone, stopAudioSession, update, updateRequests],
  )

  const ensureLink = useCallback(async (): Promise<boolean> => {
    if (signaling.current && stateRef.current.link === 'open') return true
    if (linking.current) return linking.current
    replaced.current = false
    const attempt = (async () => {
      closeSignaling()
      signaling.current = new SignalingClient({ onMessage: handleMessage, onStatus: onLinkChange })
      try {
        await signaling.current.connect()
        return true
      } catch {
        closeSignaling()
        return false
      } finally {
        linking.current = null
      }
    })()
    linking.current = attempt
    return attempt
  }, [closeSignaling, handleMessage, onLinkChange])

  const start = useCallback(
    async (topicSlug: string | null) => {
      const phase = stateRef.current.phase
      if (phase !== 'idle' && phase !== 'ended') return
      update({ ...initial, link: stateRef.current.link, phase: 'starting', requestedTopic: topicSlug })
      updateRequests({ outgoing: null, requestResult: null })
      const mic = await acquireMicrophone()
      if ('error' in mic) {
        update({ phase: 'idle', micError: mic.error })
        return
      }
      localStream.current = mic.stream
      clog('microphone acquired', { tracks: mic.stream.getAudioTracks().map((t) => ({ enabled: t.enabled, readyState: t.readyState })) })
      if (await ensureLink()) {
        signaling.current?.send({ type: 'queue.join', topicSlug })
        startAudioSession(null)
        update({ phase: 'searching' })
      } else {
        releaseMicrophone()
        update({ phase: 'idle', notice: 'We could not connect to the server. Check your connection and try again.' })
      }
    },
    [ensureLink, releaseMicrophone, startAudioSession, update, updateRequests],
  )

  const cancelSearch = useCallback(() => {
    clog('USER cancelSearch()', { phase: stateRef.current.phase })
    signaling.current?.send({ type: 'queue.cancel' })
    releaseMicrophone()
    stopAudioSession()
    update({ phase: 'idle' })
  }, [releaseMicrophone, stopAudioSession, update])

  const requestConnect = useCallback(
    async (friendRef: string, partnerName: string) => {
      const phase = stateRef.current.phase
      if (phase !== 'idle' && phase !== 'ended') return
      if (phase === 'ended') update({ ...initial, link: stateRef.current.link, speakerOn: stateRef.current.speakerOn })
      updateRequests({ outgoing: { requestId: null, partnerName, expiresAt: null }, requestResult: null })
      const mic = await acquireMicrophone()
      if ('error' in mic) {
        update({ micError: mic.error })
        updateRequests({ outgoing: null })
        return
      }
      localStream.current = mic.stream
      if (!(await ensureLink())) {
        releaseMicrophone()
        updateRequests({ outgoing: null, requestResult: { status: 'UNAVAILABLE', reason: 'LINK', partnerName } })
        return
      }
      update({ micError: null, notice: null })
      signaling.current?.send({ type: 'connect.request', friendRef })
    },
    [ensureLink, releaseMicrophone, update, updateRequests],
  )

  const cancelRequest = useCallback(() => {
    const out = requestsRef.current.outgoing
    if (out?.requestId) signaling.current?.send({ type: 'connect.cancel', requestId: out.requestId })
    updateRequests({ outgoing: null })
    if (!stateRef.current.callId && stateRef.current.phase === 'idle') releaseMicrophone()
  }, [releaseMicrophone, updateRequests])

  const declineRequest = useCallback(() => {
    const req = requestsRef.current.incoming
    if (req) signaling.current?.send({ type: 'connect.decline', requestId: req.requestId })
    updateRequests({ incoming: null })
  }, [updateRequests])

  const acceptRequest = useCallback(async () => {
    const req = requestsRef.current.incoming
    if (!req) return
    const phase = stateRef.current.phase
    if (phase !== 'idle' && phase !== 'ended' && phase !== 'searching') return
    const mic = localStream.current ? { stream: localStream.current } : await acquireMicrophone()
    if ('error' in mic) {
      signaling.current?.send({ type: 'connect.decline', requestId: req.requestId })
      updateRequests({ incoming: null })
      update({ micError: mic.error })
      return
    }
    localStream.current = mic.stream
    accepting.current = req.requestId
    updateRequests({ incoming: null })
    update({ ...initial, link: stateRef.current.link, speakerOn: stateRef.current.speakerOn, phase: 'starting', requestedTopic: stateRef.current.requestedTopic })
    signaling.current?.send({ type: 'connect.accept', requestId: req.requestId })
  }, [update, updateRequests])

  const dismissRequestResult = useCallback(() => updateRequests({ requestResult: null }), [updateRequests])

  const endCall = useCallback(() => {
    const s = stateRef.current
    clog('USER endCall()', { phase: s.phase, callId: s.callId })
    if (!s.callId) return
    signaling.current?.send({ type: 'call.end', callId: s.callId })
    closePeer()
    releaseMicrophone()
    timers.current.endConfirm = setTimeout(() => {
      if (stateRef.current.phase !== 'ended' && stateRef.current.callId === s.callId) {
        finishCall({ callId: s.callId!, status: null, endReason: null, durationSeconds: null, endedBy: 'you' })
      }
    }, END_CONFIRM_TIMEOUT_MS)
  }, [closePeer, finishCall, releaseMicrophone])

  const skip = useCallback(() => {
    const s = stateRef.current
    clog('USER skip()', { phase: s.phase, callId: s.callId })
    if (!s.callId) return
    skipping.current = s.callId
    closePeer()
    signaling.current?.send({ type: 'call.skip', callId: s.callId, topicSlug: s.requestedTopic })
    update({ phase: 'searching', callId: null, partner: null, topic: null, connectedAt: null, quality: 'unknown' })
    void showCallNotification(null)
  }, [closePeer, update])

  const toggleMute = useCallback(() => {
    const track = localStream.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    clog('mute toggled', { enabled: track.enabled })
    update({ muted: !track.enabled })
  }, [update])

  const toggleSpeaker = useCallback(() => {
    const on = !stateRef.current.speakerOn
    InCallManager.setForceSpeakerphoneOn(on) // loudspeaker vs earpiece/headset
    clog('speaker toggled', { speakerOn: on })
    update({ speakerOn: on })
  }, [update])

  const dismissEnded = useCallback(() => update({ ...initial, link: stateRef.current.link, speakerOn: stateRef.current.speakerOn }), [update])

  const reset = useCallback(() => {
    const s = stateRef.current
    clog('reset()', { phase: s.phase, callId: s.callId })
    if (s.callId) signaling.current?.send({ type: 'call.end', callId: s.callId })
    else if (s.phase === 'searching') signaling.current?.send({ type: 'queue.cancel' })
    closePeer()
    releaseMicrophone()
    closeSignaling()
    stopAudioSession()
    updateRequests(noRequests)
    update({ ...initial })
  }, [closePeer, closeSignaling, releaseMicrophone, stopAudioSession, update, updateRequests])

  useEffect(() => () => reset(), [reset])

  const value = useMemo(
    () => ({
      ...state, ...requests, ensureLink, requestConnect, cancelRequest, acceptRequest, declineRequest, dismissRequestResult,
      start, cancelSearch, endCall, skip, toggleMute, toggleSpeaker, dismissEnded, reset,
    }),
    [state, requests, ensureLink, requestConnect, cancelRequest, acceptRequest, declineRequest, dismissRequestResult, start, cancelSearch, endCall, skip, toggleMute, toggleSpeaker, dismissEnded, reset],
  )
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}

export function useCall() {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCall must be used inside CallProvider')
  return ctx
}

/** Seconds since `since` (epoch ms), ticking once per second. */
export function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [since])
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000))
}
