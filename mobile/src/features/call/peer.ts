import { PermissionsAndroid, Platform } from 'react-native'
import { MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, mediaDevices } from 'react-native-webrtc'
import { CALL_DEBUG } from '../../config'
import { clog, describeCandidate, summariseStats } from './callLog'
import { assessQuality, sampleFromReports, type Quality, type StatsCursor, type StatsSample } from '../../lib/quality'

export interface PeerCallbacks {
  onIceCandidate: (candidate: Record<string, unknown>) => void
  onRemoteStream: (stream: MediaStream) => void
  onConnectionState: (state: string) => void
  onStats: (sample: StatsSample, quality: Quality) => void
}

/**
 * One RTCPeerConnection carrying a single audio track each way (react-native-webrtc, Opus).
 * addTrack (not addTransceiver) on purpose: the answerer only reuses transceivers created by addTrack, otherwise it
 * answers recvonly and never sends its microphone (found and fixed on the web client).
 */
export class CallPeer {
  private readonly pc: RTCPeerConnection
  private pendingCandidates: Record<string, unknown>[] = []
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private cursor: StatsCursor | null = null
  private closed = false
  private diagTimer: ReturnType<typeof setInterval> | null = null
  private readonly callbacks: PeerCallbacks
  private readonly config: { iceServers: unknown[]; iceTransportPolicy?: 'relay' | 'all' }

  constructor(config: { iceServers: unknown[]; iceTransportPolicy?: 'relay' | 'all' }, localStream: MediaStream, callbacks: PeerCallbacks) {
    this.callbacks = callbacks
    this.config = { ...config }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.pc = new RTCPeerConnection(config as any) as RTCPeerConnection
    const track = localStream.getAudioTracks()[0]
    clog('peer:new', { iceServers: config.iceServers.map((s) => (s as { urls: unknown }).urls), policy: config.iceTransportPolicy ?? 'all', localTrack: { enabled: track?.enabled, muted: (track as { muted?: boolean })?.muted, readyState: track?.readyState } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sender = (this.pc as any).addTrack(track, localStream)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transceiver = (this.pc as any).getTransceivers?.().find((t: any) => t.sender === sender)
    if (transceiver?.receiver?.track) callbacks.onRemoteStream(new MediaStream([transceiver.receiver.track]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pc = this.pc as any
    pc.addEventListener('icecandidate', (e: { candidate: { toJSON(): Record<string, unknown> } | null }) => {
      if (e.candidate) {
        const j = e.candidate.toJSON()
        clog('ice:local-candidate', describeCandidate((j as { candidate?: string }).candidate))
        callbacks.onIceCandidate(j)
      } else {
        clog('ice:local-candidates-done')
      }
    })
    pc.addEventListener('track', (e: { streams?: MediaStream[] }) => {
      const stream = e.streams?.[0]
      const rt = (e as { track?: { kind?: string; enabled?: boolean; muted?: boolean; readyState?: string } }).track
      clog('ontrack', { kind: rt?.kind, enabled: rt?.enabled, muted: rt?.muted, readyState: rt?.readyState, streams: e.streams?.length ?? 0 })
      if (stream) callbacks.onRemoteStream(stream)
    })
    const states = () => ({ signaling: pc.signalingState, iceGathering: pc.iceGatheringState, ice: pc.iceConnectionState, connection: pc.connectionState })
    pc.addEventListener('signalingstatechange', () => clog('pc:signalingState', states()))
    pc.addEventListener('icegatheringstatechange', () => clog('pc:iceGatheringState', states()))
    pc.addEventListener('iceconnectionstatechange', () => clog('pc:iceConnectionState', states()))
    pc.addEventListener('icecandidateerror', (e: unknown) => clog('ice:candidate-error', { url: (e as { url?: string }).url, code: (e as { errorCode?: number }).errorCode, text: (e as { errorText?: string }).errorText }))
    if (CALL_DEBUG) this.diagTimer = setInterval(() => void this.diagnose(), 2000) // diagnostics only: a getStats() call every 2 s is not free
    pc.addEventListener('connectionstatechange', () => {
      clog('pc:connectionState', states())
      callbacks.onConnectionState(pc.connectionState)
      if (pc.connectionState === 'connected') this.startStats()
    })
  }

  /** Swaps in fresh ICE servers (new TURN credentials). They take effect at the next ICE restart; nothing is renegotiated here. */
  setIceServers(iceServers: unknown[]): void {
    if (this.closed) return
    this.config.iceServers = iceServers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(this.pc as any).setConfiguration({ ...this.config })
  }

  get connectionState(): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.pc as any).connectionState
  }

  async createOffer(iceRestart = false) {
    clog('sdp:createOffer', { iceRestart })
    const offer = await this.pc.createOffer({ iceRestart } as never)
    await this.pc.setLocalDescription(offer)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const local = (this.pc as any).localDescription
    return { type: 'offer', sdp: local?.sdp ?? offer.sdp }
  }

  async acceptOffer(offer: { type: string; sdp: string }) {
    clog('sdp:acceptOffer', { audioDirections: (offer.sdp.match(/a=(sendrecv|sendonly|recvonly|inactive)/g) ?? []).join(',') })
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer as never))
    clog('sdp:remote-offer-set')
    await this.flushCandidates()
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const local = (this.pc as any).localDescription
    clog('sdp:answer-created', { audioDirections: ((local?.sdp ?? answer.sdp) as string).match(/a=(sendrecv|sendonly|recvonly|inactive)/g)?.join(',') })
    return { type: 'answer', sdp: local?.sdp ?? answer.sdp }
  }

  async acceptAnswer(answer: { type: string; sdp: string }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((this.pc as any).signalingState !== 'have-local-offer') {
      clog('sdp:answer IGNORED (not in have-local-offer)', { state: (this.pc as any).signalingState })
      return
    }
    clog('sdp:acceptAnswer', { audioDirections: (answer.sdp.match(/a=(sendrecv|sendonly|recvonly|inactive)/g) ?? []).join(',') })
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer as never))
    await this.flushCandidates()
  }

  async addCandidate(candidate: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(this.pc as any).remoteDescription) {
      clog('ice:remote-candidate queued (no remote description yet)')
      this.pendingCandidates.push(candidate)
      return
    }
    try {
      clog('ice:remote-candidate', describeCandidate((candidate as { candidate?: string }).candidate))
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate as never))
    } catch (e) {
      clog('ice:addIceCandidate FAILED', { message: (e as Error).message })
      if (!this.closed) console.warn('Ignoring ICE candidate that could not be added', e)
    }
  }

  /** Why the connection is (not) working: candidate pairs, bytes in each direction, audio levels. */
  private async diagnose() {
    if (this.closed) return
    try {
      const report = await this.pc.getStats()
      const items: unknown[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(report as any).forEach((v: unknown) => items.push(v))
      clog('stats', summariseStats(items as never))
    } catch (e) {
      clog('stats failed', { message: (e as Error).message })
    }
  }

  close() {
    clog('peer:close', { connection: (this.pc as any).connectionState })
    this.closed = true
    if (this.diagTimer) clearInterval(this.diagTimer)
    this.diagTimer = null
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
    this.pc.close()
  }

  private async flushCandidates() {
    const queued = this.pendingCandidates
    this.pendingCandidates = []
    for (const c of queued) await this.addCandidate(c)
  }

  private startStats() {
    if (this.statsTimer) return
    this.statsTimer = setInterval(async () => {
      if (this.closed) return
      try {
        const report = await this.pc.getStats()
        const items: unknown[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(report as any).forEach((v: unknown) => items.push(v))
        const { sample, cursor } = sampleFromReports(items as never, this.cursor)
        this.cursor = cursor
        this.callbacks.onStats(sample, assessQuality(sample))
      } catch {
        // stats are best-effort
      }
    }, 2000)
  }
}

export type MicError = 'denied' | 'blocked' | 'not-found' | 'other'

/** Asks for the Android microphone permission, then opens the microphone with echo cancellation, noise suppression and AGC. */
export async function acquireMicrophone(): Promise<{ stream: MediaStream } | { error: MicError }> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: 'Microphone access',
      message: 'Voice calls need your microphone so your partner can hear you.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    })
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return { error: 'blocked' }
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return { error: 'denied' }
  }
  try {
    const stream = await mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } as never,
      video: false,
    })
    return { stream: stream as MediaStream }
  } catch (e) {
    const name = (e as { name?: string }).name
    if (name === 'NotAllowedError') return { error: 'denied' }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return { error: 'not-found' }
    return { error: 'other' }
  }
}
