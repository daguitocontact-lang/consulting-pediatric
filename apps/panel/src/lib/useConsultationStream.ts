/**
 * The live consultation: microphone in, flow output back.
 *
 * The engine is Daguito's — the same flows the legacy product publishes. The
 * exchange is direct between the browser and Daguito (that is what the scoped
 * token minted by our API is for), and everything worth keeping is written back
 * through our own API, so the record lives in the custom's database and not in
 * a websocket that ended.
 *
 *   mic ──MicStream──▶ Daguito flow ──OutputStream──▶ here ──▶ our API
 *
 * Nothing here throws into the screen: a consultation whose engine is down is
 * still a consultation, with a room, a note the doctor can type and a
 * transcript that is simply empty. `state` says which it is.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { OutputStream } from '@daguito/sdk'
import { MicStream } from '@daguito/sdk/voice'
import { apiPatch, apiPost, type MountProps } from './api'
import { noteFromState, recommendationsFromState, transcriptFromEvent } from './flow-transform'

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
  | { kind: 'live'; flow: string; level: number }
  /** The engine is not configured in this environment (our API answered 503). */
  | { kind: 'unconfigured' }
  | { kind: 'error'; message: string }

export function useConsultationStream(props: MountProps, consultationId: string) {
  const [state, setState] = useState<StreamState>({ kind: 'idle' })
  const mic = useRef<MicStream | null>(null)
  const out = useRef<OutputStream | null>(null)
  // Fired after every write so the screen can re-read the workspace. Kept in a
  // ref: the listeners are attached once and must not hold a stale callback.
  const onChange = useRef<() => void>(() => {})

  const stop = useCallback(() => {
    // The microphone first, always: a socket that lingers is a bug, a
    // microphone that lingers is a recording nobody consented to.
    void mic.current?.stop()
    mic.current = null
    out.current?.close()
    out.current = null
    setState({ kind: 'idle' })
  }, [])

  // Stop on unmount too — leaving the screen ends the capture.
  useEffect(() => stop, [stop])

  const start = useCallback(
    async (options: { onChange?: () => void } = {}) => {
      if (mic.current || out.current) return
      onChange.current = options.onChange ?? (() => {})
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
        // failure of this consultation; anything else is worth showing.
        const status = (err as { status?: number }).status
        setState(
          status === 503
            ? { kind: 'unconfigured' }
            : { kind: 'error', message: err instanceof Error ? err.message : 'stream failed' },
        )
        return
      }

      const { api_url: apiUrl, webhook_id: webhookId, token, session_key: sessionKey } = credentials

      // Output first, so nothing the flow emits between opening the mic and
      // subscribing is missed.
      const stream = new OutputStream({ apiUrl, webhookId, token, sessionKey })
      out.current = stream

      stream.on('node.emit', ({ nodeId, kind, data }) => {
        const payload = (data ?? {}) as Record<string, unknown>

        if (kind === 'collect_data.streaming_update') {
          const full = payload.full_state as Record<string, unknown> | undefined
          if (!full) return
          if (nodeId === 'c_facts') {
            const items = recommendationsFromState(full)
            if (items.length) void persistRecommendations(items)
          } else if (nodeId === 'c_soap') {
            const body = noteFromState(full)
            if (body) void persistNote(body)
          }
          return
        }

        // The transcription nodes emit under their own kinds; the transform
        // decides what is final and worth keeping.
        if (typeof kind === 'string' && kind.includes('transcri')) {
          const segments = transcriptFromEvent(payload)
          if (segments.length) void persistTranscript(segments)
        }
      })

      stream.on('error', ({ message }) => setState({ kind: 'error', message }))

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

      try {
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
          // Audio goes out continuously.
          //
          // Voice-activity gating (`vad`) is what the legacy app uses to stop
          // paying the transcriber for silence, and it is also a gate that can
          // close over an entire consultation: a quiet room, a distant
          // microphone or a laptop with aggressive noise suppression never
          // crosses the RMS threshold, so nothing is ever sent and the panel
          // sits on "Escuchando" with an empty transcript — which is exactly
          // what happened. Streaming everything is the version that works;
          // gating it again is an optimisation to make deliberately, with the
          // level meter below to prove the threshold is right.
          onLevel: (rms) =>
            setState((current) =>
              current.kind === 'live' ? { ...current, level: rms } : current,
            ),
          onError: (err) => setState({ kind: 'error', message: err.message }),
        })
        await capture.start()
        mic.current = capture
        setState({ kind: 'live', flow: credentials.flow, level: 0 })
      } catch (err) {
        // The room still works without the microphone — most often this is the
        // browser refusing permission, which is the doctor's to grant.
        out.current?.close()
        out.current = null
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'microphone failed',
        })
      }
    },
    [consultationId, props],
  )

  return { state, start, stop }
}
