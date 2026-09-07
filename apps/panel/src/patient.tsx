/**
 * The patient's page of a video consultation.
 *
 * A parent opens a link on a phone. What they get is the room, and — the point
 * of this file — their microphone streaming to `<session>:patient`, which is
 * where `realtime-consultation`'s second transcribe node listens. Without it
 * that node starves for its whole timeout and the merge withholds the DOCTOR's
 * transcript too, so this page is not a nicety for the patient: it is what makes
 * a video consultation transcribe at all.
 *
 * The legacy app's `ConsultationConnectionPage`, minus everything that assumed a
 * logged-in user: no navigation, no consultation record, no recommendations —
 * the credential is `produce`-only and could not read them anyway.
 *
 * It ships inside `panel.js` and is mounted by `patient.html`, which sits next
 * to it in the same bucket. Same origin, so importing the module needs no CORS,
 * and the bundle is one file for both audiences.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MicStream } from '@daguito/sdk/voice'
import { loadJitsi, meetingOptions, type MeetingCredentials } from './lib/jitsi'
import { translator } from './lib/i18n'

type Session = {
  consultation: { id: string; patient_name: string | null; status: string }
  meeting: MeetingCredentials
  stream: {
    api_url: string
    webhook_id: string
    token: string
    session_key: string
  } | null
}

type Phase =
  | { kind: 'loading' }
  /** The link is bad, expired, or the visit is over. Nothing to retry. */
  | { kind: 'rejected'; message: string }
  | { kind: 'ready' }

export type PatientProps = {
  apiBase: string
  consultationId: string
  token: string
  locale?: string
}

export function PatientScreen({ apiBase, consultationId, token, locale }: PatientProps) {
  const { t } = translator(locale)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [micOn, setMicOn] = useState(false)
  const [muted, setMuted] = useState(false)

  const container = useRef<HTMLDivElement | null>(null)
  const mic = useRef<MicStream | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const micGain = useRef<GainNode | null>(null)
  const rawStream = useRef<MediaStream | null>(null)

  const teardown = useCallback(() => {
    void mic.current?.stop()
    mic.current = null
    rawStream.current?.getTracks().forEach((track) => track.stop())
    rawStream.current = null
    micGain.current = null
    void audioCtx.current?.close().catch(() => {})
    audioCtx.current = null
    setMicOn(false)
  }, [])

  useEffect(() => teardown, [teardown])

  useEffect(() => {
    let disposed = false
    let jitsi: { dispose: () => void } | null = null

    void (async () => {
      let session: Session
      try {
        const res = await fetch(
          `${apiBase}/public/consultations/${encodeURIComponent(consultationId)}` +
            `/patient/session?t=${encodeURIComponent(token)}`,
        )
        if (!res.ok) {
          setPhase({
            kind: 'rejected',
            message: res.status === 410 ? t('patient.finished') : t('patient.invalid'),
          })
          return
        }
        session = (await res.json()) as Session
      } catch {
        setPhase({ kind: 'rejected', message: t('patient.offline') })
        return
      }
      if (disposed) return
      setPhase({ kind: 'ready' })

      // ── The room ────────────────────────────────────────────────────
      try {
        const JitsiMeetExternalAPI = await loadJitsi(session.meeting.domain)
        if (disposed || !container.current) return
        jitsi = new JitsiMeetExternalAPI(session.meeting.domain, {
          ...meetingOptions({
            credentials: session.meeting,
            displayName: session.consultation.patient_name ?? 'Paciente',
            lang: locale?.startsWith('en') ? 'en' : 'es',
          }),
          parentNode: container.current,
          width: '100%',
          height: '100%',
        })
      } catch {
        // A room that fails to load must not take the microphone with it: the
        // transcript is the thing the doctor cannot reconstruct afterwards.
      }

      // ── The microphone → `<session>:patient` ────────────────────────
      if (!session.stream) return
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        if (disposed) {
          media.getTracks().forEach((track) => track.stop())
          return
        }
        rawStream.current = media

        // The same mixer as the doctor's side: the mute button is a GainNode,
        // because `track.enabled` does not travel through a Web Audio graph.
        const context = new AudioContext()
        audioCtx.current = context
        if (context.state === 'suspended') await context.resume().catch(() => {})
        const destination = context.createMediaStreamDestination()
        const gain = context.createGain()
        micGain.current = gain
        context.createMediaStreamSource(media).connect(gain)
        gain.connect(destination)

        const capture = new MicStream({
          apiUrl: session.stream.api_url,
          token: session.stream.token,
          // The patient's OWN sub-channel. `s_stt_patient` declares
          // `audio_session_suffix: "patient"`; the bare session key is read by
          // nobody and fails silently — the socket opens and no word arrives.
          sessionId: `${session.stream.session_key}:patient`,
          mediaStream: destination.stream,
          vad: { enabled: true },
          onError: () => {},
        })
        await capture.start()
        if (disposed) {
          void capture.stop()
          return
        }
        mic.current = capture
        setMicOn(true)
      } catch {
        // Almost always a refused microphone permission. The call still works;
        // the page says the transcript will not have their side.
        setMicOn(false)
      }
    })()

    return () => {
      disposed = true
      jitsi?.dispose()
      teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, consultationId, token])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    if (micGain.current) micGain.current.gain.value = next ? 0 : 1
    void mic.current?.setMuted(next)
  }

  if (phase.kind === 'rejected') {
    return (
      <div style={styles.center}>
        <p style={styles.message}>{phase.message}</p>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.bar}>
        <span style={styles.brand}>{t('patient.title')}</span>
        <span style={{ ...styles.pill, opacity: micOn ? 1 : 0.6 }}>
          {micOn
            ? muted
              ? t('patient.mic.muted')
              : t('patient.mic.on')
            : t('patient.mic.off')}
        </span>
        {micOn ? (
          <button type="button" style={styles.button} onClick={toggleMute}>
            {muted ? t('workspace.unmute') : t('workspace.mute')}
          </button>
        ) : null}
      </div>
      <div ref={container} style={styles.room}>
        {phase.kind === 'loading' ? <p style={styles.message}>{t('meeting.connecting')}</p> : null}
      </div>
    </div>
  )
}

/**
 * Plain inline styles, not Tamagui.
 *
 * This page is opened by a parent on a phone with one job, and it must render
 * before a provider tree, a theme and a font have loaded. It is also the one
 * surface here that is not inside Daguito's chrome, so it inherits no design
 * from the host to match.
 */
const styles: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0b0d10' },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    color: '#e8eaed',
    font: '14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  },
  brand: { fontWeight: 700 },
  pill: {
    marginLeft: 'auto',
    padding: '3px 10px',
    borderRadius: 999,
    background: '#1b1f24',
    fontSize: 12,
  },
  button: {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #2a2f36',
    background: '#1b1f24',
    color: '#e8eaed',
    font: '13px system-ui, sans-serif',
    cursor: 'pointer',
  },
  room: { flex: 1, minHeight: 0, position: 'relative' },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100dvh',
    background: '#0b0d10',
    padding: 24,
  },
  message: {
    color: '#e8eaed',
    font: '15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    textAlign: 'center',
    margin: 0,
  },
}
