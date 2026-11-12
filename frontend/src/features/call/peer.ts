import { callDebugEnabled, clog, describeCandidate, summariseStats } from './callLog'
import { assessQuality, sampleFromReports, type Quality, type StatsCursor, type StatsSample } from './quality'

export interface PeerCallbacks {
  onIceCandidate: (candidate: RTCIceCandidateInit) => void
  onRemoteStream: (stream: MediaStream) => void
  onConnectionState: (state: RTCPeerConnectionState) => void
  onStats: (sample: StatsSample, quality: Quality) => void
}

/**
 * Thin wrapper over one RTCPeerConnection carrying a single audio track each way.
 * Audio travels peer-to-peer (or via TURN); the signalling socket only carries SDP and ICE candidates.
 */
export class CallPeer {
  private readonly pc: RTCPeerConnection
  private readonly sender: RTCRtpSender
  private readonly callbacks: PeerCallbacks
  private pendingCandidates: RTCIceCandidateInit[] = []
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private cursor: StatsCursor | null = null
  private closed = false
  private diagTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: RTCConfiguration, localStream: MediaStream, callbacks: PeerCallbacks) {
    this.callbacks = callbacks
    this.pc = new RTCPeerConnection(config)

    // addTrack (not addTransceiver) on purpose: when the *answerer* applies the incoming offer, the browser only reuses
    // transceivers created by addTrack. With addTransceiver it creates a second, receive-only one and answers
    // `recvonly`, so the answerer never sends its microphone (one-way audio).
    const track = localStream.getAudioTracks()[0]
    clog('peer:new', { iceServers: (config.iceServers ?? []).map((s) => s.urls), policy: config.iceTransportPolicy ?? 'all', localTrack: { enabled: track?.enabled, muted: track?.muted, readyState: track?.readyState } })
    this.sender = this.pc.addTrack(track, localStream)
    const transceiver = this.pc.getTransceivers().find((t) => t.sender === this.sender)!
    preferOpus(transceiver)

    // The receiver's track exists from the moment the transceiver is created, so hand it to the UI straight away.
    // `ontrack` stays as a fallback if the browser supplies a different stream.
    callbacks.onRemoteStream(new MediaStream([transceiver.receiver.track]))
    this.pc.ontrack = (e) => {
      clog('ontrack', { kind: e.track.kind, enabled: e.track.enabled, muted: e.track.muted, readyState: e.track.readyState, streams: e.streams.length })
      const stream = e.streams[0]
      if (stream && !stream.getTracks().includes(transceiver.receiver.track)) callbacks.onRemoteStream(stream)
    }
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        clog('ice:local-candidate', describeCandidate(e.candidate.candidate))
        callbacks.onIceCandidate(e.candidate.toJSON())
      } else {
        clog('ice:local-candidates-done')
      }
    }
    const states = () => ({ signaling: this.pc.signalingState, iceGathering: this.pc.iceGatheringState, ice: this.pc.iceConnectionState, connection: this.pc.connectionState })
    this.pc.addEventListener('signalingstatechange', () => clog('pc:signalingState', states()))
    this.pc.addEventListener('icegatheringstatechange', () => clog('pc:iceGatheringState', states()))
    this.pc.addEventListener('iceconnectionstatechange', () => clog('pc:iceConnectionState', states()))
    this.pc.addEventListener('icecandidateerror', (e) => clog('ice:candidate-error', { url: (e as RTCPeerConnectionIceErrorEvent).url, code: (e as RTCPeerConnectionIceErrorEvent).errorCode, text: (e as RTCPeerConnectionIceErrorEvent).errorText }))
    if (callDebugEnabled) this.diagTimer = setInterval(() => void this.diagnose(), 2000) // diagnostics only: a getStats() call every 2 s is not free
    this.pc.onconnectionstatechange = () => {
      clog('pc:connectionState', states())
      callbacks.onConnectionState(this.pc.connectionState)
      if (this.pc.connectionState === 'connected') this.startStats()
    }
  }

  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState
  }

  /** Swaps in fresh ICE servers (new TURN credentials). They take effect at the next ICE restart; nothing is renegotiated here. */
  setIceServers(iceServers: RTCIceServer[]): void {
    if (this.closed) return
    this.pc.setConfiguration({ ...this.pc.getConfiguration(), iceServers })
  }

  /** Switches the microphone mid-call without renegotiating. */
  async replaceMicrophone(track: MediaStreamTrack): Promise<void> {
    await this.sender.replaceTrack(track)
  }

  async createOffer(iceRestart = false): Promise<RTCSessionDescriptionInit> {
    clog('sdp:createOffer', { iceRestart })
    const offer = await this.pc.createOffer({ iceRestart })
    await this.pc.setLocalDescription(offer)
    return { type: 'offer', sdp: this.pc.localDescription?.sdp ?? offer.sdp }
  }

  async acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    clog('sdp:acceptOffer', { audioDirections: (offer.sdp?.match(/a=(sendrecv|sendonly|recvonly|inactive)/g) ?? []).join(',') })
    await this.pc.setRemoteDescription(offer)
    await this.flushCandidates()
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    return { type: 'answer', sdp: this.pc.localDescription?.sdp ?? answer.sdp }
  }

  async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (this.pc.signalingState !== 'have-local-offer') {
      clog('sdp:answer IGNORED (not in have-local-offer)', { state: this.pc.signalingState })
      return
    }
    clog('sdp:acceptAnswer', { audioDirections: (answer.sdp?.match(/a=(sendrecv|sendonly|recvonly|inactive)/g) ?? []).join(',') })
    await this.pc.setRemoteDescription(answer)
    await this.flushCandidates()
  }

  async addCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    // Candidates can arrive before the remote description; hold them until it is set.
    if (!this.pc.remoteDescription) {
      this.pendingCandidates.push(candidate)
      return
    }
    try {
      clog('ice:remote-candidate', describeCandidate(candidate.candidate))
      await this.pc.addIceCandidate(candidate)
    } catch (e) {
      clog('ice:addIceCandidate FAILED', { message: (e as Error).message })
      if (!this.closed) console.warn('Ignoring ICE candidate that could not be added', e)
    }
  }

  private async diagnose() {
    if (this.closed) return
    try {
      const report = await this.pc.getStats()
      clog('stats', summariseStats([...report.values()] as unknown as Record<string, unknown>[]))
    } catch (e) {
      clog('stats failed', { message: (e as Error).message })
    }
  }

  close() {
    clog('peer:close', { connection: this.pc.connectionState })
    this.closed = true
    if (this.diagTimer) clearInterval(this.diagTimer)
    this.diagTimer = null
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
    this.pc.onicecandidate = null
    this.pc.ontrack = null
    this.pc.onconnectionstatechange = null
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
        const { sample, cursor } = sampleFromReports(report.values() as Iterable<never>, this.cursor)
        this.cursor = cursor
        this.callbacks.onStats(sample, assessQuality(sample))
      } catch {
        // stats are best-effort
      }
    }, 2000)
  }
}

/** Puts Opus first in the codec list; browsers already default to it, this just makes the intent explicit. */
function preferOpus(transceiver: RTCRtpTransceiver) {
  try {
    const codecs = RTCRtpReceiver.getCapabilities?.('audio')?.codecs
    if (!codecs || !transceiver.setCodecPreferences) return
    const opus = codecs.filter((c) => c.mimeType.toLowerCase() === 'audio/opus')
    if (opus.length === 0) return
    transceiver.setCodecPreferences([...opus, ...codecs.filter((c) => c.mimeType.toLowerCase() !== 'audio/opus')])
  } catch {
    // keep browser defaults
  }
}

export type MicError = 'denied' | 'not-found' | 'insecure' | 'other'

export async function acquireMicrophone(deviceId?: string): Promise<{ stream: MediaStream } | { error: MicError }> {
  if (!navigator.mediaDevices?.getUserMedia) return { error: 'insecure' }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
      video: false,
    })
    return { stream }
  } catch (e) {
    const name = (e as DOMException).name
    if (name === 'NotAllowedError' || name === 'SecurityError') return { error: 'denied' }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return { error: 'not-found' }
    return { error: 'other' }
  }
}

export async function listMicrophones(): Promise<{ id: string; label: string }[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'audioinput' && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
  } catch {
    return []
  }
}
