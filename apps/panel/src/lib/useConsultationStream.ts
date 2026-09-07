/**
 * The live consultation: microphone in, flow output back.
 *
 * The engine is Daguito's — the same flows the legacy product publishes, driven
 * the same way its `MedicalConsultation.tsx` drives them. The exchange is direct
 * between the browser and Daguito (that is what the scoped token minted by our
 * API is for), and everything worth keeping is written back through our own API,
 * so the record lives in the custom's database and not in a websocket that
 * ended.
 *
 *   mic ──▶ mixer ──MicStream──▶ Daguito flow ──OutputStream──▶ here ──▶ our API
 *
 * The mixer in the middle is not decoration. It is what lets the mute button
 * work (a GainNode at 0 — `track.enabled` does not travel through a Web Audio
 * graph) and it is the seam the legacy app injects test audio at.
 *
 * Nothing here throws into the screen: a consultation whose engine is down is
 * still a consultation, with a room, a note the doctor can type and a transcript
 * that is simply empty. `state` says which it is.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { OutputStream } from '@daguito/sdk'
import { MicStream } from '@daguito/sdk/voice'
import { apiPatch, apiPost, type MountProps } from './api'
import {
  noteFromState,
  recommendationsFromState,
  resolveSpeaker,
  transcriptFromEvent,
  type FlowMode,
} from './flow-transform'

export type StreamCredentials = {
  api_url: string
  webhook_id: string
  token: string
  session_key: string
  expires_at: number | null
  flow: string
}

export type StreamState =
  /** No attempt yet, or stopped. */
  | { kind: 'idle' }
  | { kind: 'connecting' }
  /** `level` is the microphone's RMS (0..1): the panel shows it so a dead mic
   *  is visible before the consultation is over. */
  | { kind: 'live'; flow: string; level: number; muted: boolean }
  /** The engine is not configured in this environment (our API answered 503). */
  | { kind: 'unconfigured' }
  /** This consultation is transcribed from an upload, not from a microphone. */
  | { kind: 'upload' }
  | { kind: 'error'; message: string }

/** What the flow is saying right now, before it has finished the sentence. */
export type PartialLine = { speaker: string | null; text: string }

/**
 * What Daguito charged, accumulated in the browser because that is where the
 * `cost` events land — they are emitted to whoever is consuming the flow, and
 * that is this tab. Flushed to our API when the consultation stops, which is
 * how the legacy app's live total stopped evaporating on close.
 */
type CostAccumulator = {
  streaming: number
  streamingCount: number
  facts: number
  factsCount: number
  template: number
  templateCount: number
}

const emptyCosts = (): CostAccumulator => ({
  streaming: 0,
  streamingCount: 0,
  facts: 0,
  factsCount: 0,
  template: 0,
  templateCount: 0,
})

/** Backoff for the self-healing restart: 2s, 4s, 8s, then give up. */
const RESTART_DELAYS_MS = [2000, 4000, 8000]

export function useConsultationStream(props: MountProps, consultationId: string) {
  const [state, setState] = useState<StreamState>({ kind: 'idle' })
  /** Live partials, keyed by speaker — replaced as the sentence is rewritten. */
  const [partials, setPartials] = useState<PartialLine[]>([])

  const mic = useRef<MicStream | null>(null)
  const out = useRef<OutputStream | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const micGain = useRef<GainNode | null>(null)
  const rawStream = useRef<MediaStream | null>(null)
  const costs = useRef<CostAccumulator>(emptyCosts())
  const muted = useRef(false)
  // Fired after every write so the screen can re-read the workspace. Kept in a
  // ref: the listeners are attached once and must not hold a stale callback.
  const onChange = useRef<() => void>(() => {})
  // The self-healing loop, and the guard that stops it after a deliberate stop.
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartAttempt = useRef(0)
  const startRef = useRef<((options?: StartOptions) => Promise<void>) | null>(null)
  const stopped = useRef(false)

  /** Tear the audio graph down. Separated because the restart path reuses it. */
  const teardown = useCallback(() => {
    // The microphone first, always: a socket that lingers is a bug, a
    // microphone that lingers is a recording nobody consented to.
    void mic.current?.stop()
    mic.current = null
    out.current?.close()
    out.current = null
    // The raw tracks too — stopping the MicStream does not release the device
    // when the stream it was handed came from our own mixer.
    rawStream.current?.getTracks().forEach((track) => track.stop())
    rawStream.current = null
    micGain.current = null
    void audioCtx.current?.close().catch(() => {})
    audioCtx.current = null
    setPartials([])
  }, [])

  /** Send the accumulated charges to our API and reset. Best-effort. */
  const flushCosts = useCallback(async () => {
    const c = costs.current
    if (!c.streaming && !c.facts && !c.template) return
    costs.current = emptyCosts()
    try {
      await apiPost(props, `/api/consultations/${consultationId}/costs`, {
        streaming_usd: c.streaming,
        streaming_count: c.streamingCount,
        facts_usd: c.facts,
        facts_count: c.factsCount,
        template_usd: c.template,
        template_count: c.templateCount,
      })
    } catch {
      // A lost cost line is an accounting gap, not a clinical one. It must
      // never be the reason a consultation fails to stop.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, props])

  const stop = useCallback(() => {
    stopped.current = true
    if (restartTimer.current) {
      clearTimeout(restartTimer.current)
      restartTimer.current = null
    }
    restartAttempt.current = 0
    teardown()
    void flushCosts()
    setState({ kind: 'idle' })
  }, [teardown, flushCosts])

  // Stop on unmount too — leaving the screen ends the capture.
  useEffect(() => stop, [stop])

  /**
   * Mute without dropping the session.
   *
   * Two things at once, and both are needed: the GainNode silences what reaches
   * the mixer (the only thing that works through a Web Audio graph), and
   * `MicStream.setMuted` pauses the transport, which ends the STT segment
   * server-side so a muted stretch is not billed as speech.
   */
  const setMuted = useCallback((next: boolean) => {
    muted.current = next
    if (micGain.current) micGain.current.gain.value = next ? 0 : 1
    void mic.current?.setMuted(next)
    setState((current) => (current.kind === 'live' ? { ...current, muted: next } : current))
  }, [])

  type StartOptions = { onChange?: () => void; mode?: FlowMode | null }

  const start = useCallback(
    async (options: StartOptions = {}) => {
      if (mic.current || out.current) return
      stopped.current = false
      onChange.current = options.onChange ?? onChange.current

      // NEVER guess the mode.
      //
      // The mode picks the flow, and the flows are not interchangeable: routing
      // an in-person consultation through the two-channel video flow leaves its
      // `:patient` transcribe node idle, and the merge withholds the doctor's
      // transcript for the whole 30 s node timeout. The legacy app hit exactly
      // that by defaulting to "video" while `getConsultation()` was still in
      // flight. If the caller has not loaded the consultation yet, this attempt
      // is abandoned — the doctor presses record again a moment later.
      const mode = options.mode
      if (mode !== 'video' && mode !== 'in_person' && mode !== 'transcription') {
        setState({
          kind: 'error',
          message: 'consultation not loaded yet',
        })
        return
      }
      if (mode === 'transcription') {
        // Its flow reads a file, not a socket. Saying so is the whole point:
        // the panel shows the upload instead of a microphone that would record
        // into nothing.
        setState({ kind: 'upload' })
        return
      }

      setState({ kind: 'connecting' })

      let credentials: StreamCredentials
      try {
        const body = await apiPost<{ stream: StreamCredentials }>(
          props,
          `/api/consultations/${consultationId}/stream/token`,
        )
        credentials = body.stream
      } catch (err) {
        // 503 is "no engine here", which is a state of the world and not a
        // failure of this consultation; 409 is "this mode is an upload".
        const status = (err as { status?: number }).status
        if (status === 503) setState({ kind: 'unconfigured' })
        else if (status === 409) setState({ kind: 'upload' })
        else {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'stream failed',
          })
          scheduleRestart('token request failed')
        }
        return
      }

      const { api_url: apiUrl, webhook_id: webhookId, token, session_key: sessionKey } = credentials

      // ── Events OUT ─────────────────────────────────────────────────────
      // Subscribed first, so nothing the flow emits between opening the mic and
      // subscribing is missed.
      const stream = new OutputStream({ apiUrl, webhookId, token, sessionKey })
      out.current = stream

      const persistTranscript = async (
        segments: { speaker: string | null; text: string; at_seconds: number }[],
      ) => {
        try {
          await apiPost(props, `/api/consultations/${consultationId}/transcript`, { segments })
          onChange.current()
        } catch {
          // A dropped segment must not tear down the capture: the doctor is in
          // the middle of a consultation and the next one will land.
        }
      }

      const persistRecommendations = async (
        items: { category: string; value: string; priority: number }[],
      ) => {
        try {
          await apiPost(props, `/api/consultations/${consultationId}/recommendations`, { items })
          onChange.current()
        } catch {
          /* see above */
        }
      }

      const persistNote = async (body: string) => {
        try {
          // `engine`: the API refuses to overwrite a note the doctor has
          // edited, so a flow that keeps re-rendering cannot wipe their words.
          await apiPatch(props, `/api/consultations/${consultationId}/note`, {
            body,
            source: 'engine',
          })
          onChange.current()
        } catch {
          /* see above */
        }
      }

      /**
       * The sentence being spoken right now.
       *
       * Shown, never stored: a partial is rewritten as the speaker keeps
       * talking, and persisting it would leave half-sentences in the clinical
       * record. Without this the transcript panel sat blank for whole sentences
       * at a time and the doctor could not tell a working microphone from a
       * dead one — which is what the level meter was added to compensate for.
       */
      stream.on('node.token', ({ text }) => {
        const partial = text.trim()
        if (!partial) return
        setPartials((current) => {
          const index = current.findIndex((line) => line.speaker === null)
          if (index === -1) return [...current, { speaker: null, text: partial }]
          return current.map((line, i) => (i === index ? { ...line, text: partial } : line))
        })
      })

      stream.on('node.emit', ({ nodeId, kind, data }) => {
        const payload = (data ?? {}) as Record<string, unknown>

        if (kind === 'transcript.final') {
          const segments = transcriptFromEvent(payload, mode)
          if (!segments.length) return
          // The partial this final replaces, by the speaker it settled on.
          const speaker = resolveSpeaker(payload, mode)
          setPartials((current) =>
            current.filter((line) => line.speaker !== speaker && line.speaker !== null),
          )
          void persistTranscript(segments)
          return
        }

        if (kind === 'collect_data.streaming_update') {
          const full = payload.full_state as Record<string, unknown> | undefined
          if (!full) return
          if (nodeId === 'c_facts') {
            const items = recommendationsFromState(full)
            if (items.length) void persistRecommendations(items)
          } else {
            // ANY other collect_data node is the note, not just `c_soap`: the
            // three flows name it the same today, and the legacy dispatches on
            // "not c_facts" so a flow that renames it still fills the note.
            const body = noteFromState(full)
            if (body) void persistNote(body)
          }
          return
        }

        if (kind === 'cost') {
          // Daguito bills per step and emits one of these per charge. Nothing
          // else ever sees them: they are pushed to whoever is consuming the
          // flow, which is this tab.
          const usd = typeof payload.cost_usd === 'number' ? payload.cost_usd : 0
          if (!usd) return
          const step = String(payload.step_type ?? '').toLowerCase()
          const c = costs.current
          if (step.startsWith('stt') || step.includes('transcribe')) {
            c.streaming += usd
            c.streamingCount += 1
          } else if (nodeId === 'c_facts') {
            c.facts += usd
            c.factsCount += 1
          } else {
            c.template += usd
            c.templateCount += 1
          }
          return
        }

        // Some flows emit finals under their own kind rather than
        // `transcript.final`; the transform decides what is worth keeping.
        if (typeof kind === 'string' && kind.includes('transcri')) {
          const segments = transcriptFromEvent(payload, mode)
          if (segments.length) void persistTranscript(segments)
        }
      })

      stream.on('error', ({ message }) => setState({ kind: 'error', message }))

      // ── Audio IN ───────────────────────────────────────────────────────
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: {
            // The legacy app's constraints, and they matter to the transcript:
            // a consultation is two people in a room with a laptop, and without
            // these the model transcribes the room.
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        rawStream.current = media

        // The mixer. A fresh AudioContext can start suspended under the
        // autoplay policy, and while it is suspended NOTHING flows through it —
        // the microphone included.
        const context = new AudioContext()
        audioCtx.current = context
        if (context.state === 'suspended') await context.resume().catch(() => {})

        const destination = context.createMediaStreamDestination()
        const source = context.createMediaStreamSource(media)
        const gain = context.createGain()
        gain.gain.value = muted.current ? 0 : 1
        micGain.current = gain
        source.connect(gain)
        gain.connect(destination)

        const capture = new MicStream({
          apiUrl,
          token,
          // The STT node reads the DOCTOR sub-channel: the flow graph declares
          // `audio_session_suffix: "doctor"`, so it listens on
          // `<session>:doctor` and never on the base session. Sending to the
          // bare key is silent in the worst way — the socket opens, the level
          // meter moves, the flow says `ready`, and no transcript ever arrives
          // because nobody is listening on that channel. Measured: 30 s of real
          // speech, zero events.
          sessionId: `${sessionKey}:doctor`,
          // The mixed stream, not the raw device: the mute gain is in it.
          mediaStream: destination.stream,
          // Voice activity detection, as the legacy runs it. It is not (only) a
          // saving: in silence the STT segment pauses, which is what lets the
          // run reach its silence deadline and CLOSE instead of hanging on
          // "running" until the timeout. It was turned off here after a quiet
          // room never crossed the threshold and nothing was ever sent — the
          // level meter below is what makes that visible now, so the gate can
          // stay on with the failure diagnosable.
          vad: { enabled: true },
          onLevel: (rms) =>
            setState((current) =>
              current.kind === 'live' ? { ...current, level: rms } : current,
            ),
          onError: (err) => setState({ kind: 'error', message: err.message }),
        })
        await capture.start()
        void capture.setMuted(muted.current)
        mic.current = capture
        restartAttempt.current = 0
        setState({ kind: 'live', flow: credentials.flow, level: 0, muted: muted.current })
      } catch (err) {
        teardown()
        const name = err instanceof DOMException ? err.name : ''
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'microphone failed',
        })
        // A refused microphone is the doctor's to grant and retrying loops on a
        // dialog they already dismissed. Everything else is usually the API
        // mid-restart, which heals.
        if (name !== 'NotAllowedError' && name !== 'SecurityError') {
          scheduleRestart('audio setup failed')
        }
      }

      /**
       * Rebuild the session after a failure that is likely transient.
       *
       * The legacy app's `scheduleAudioRestart`: a consultation that goes silent
       * because a deploy rolled the API is a consultation the doctor keeps
       * talking through, and nothing tells them it stopped. Bounded and
       * cancelled by a deliberate stop.
       */
      function scheduleRestart(reason: string) {
        if (stopped.current) return
        const delay = RESTART_DELAYS_MS[restartAttempt.current]
        if (delay === undefined) return
        restartAttempt.current += 1
        console.warn(`[stream] ${reason} — retrying in ${delay}ms`)
        restartTimer.current = setTimeout(() => {
          restartTimer.current = null
          teardown()
          void startRef.current?.({ mode })
        }, delay)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consultationId, props, teardown],
  )

  startRef.current = start

  return { state, partials, start, stop, setMuted }
}
