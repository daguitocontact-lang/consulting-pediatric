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
 *
 * ── Why there is a screen BEFORE the room ─────────────────────────────
 *
 * Nothing starts until the parent presses "Entrar". Two reasons, and the first
 * is not a preference:
 *
 *  1. On iOS Safari — which is most of the phones this link is opened on — an
 *     `AudioContext` created outside a user gesture stays `suspended`, and
 *     nothing flows through a suspended graph. The mixer this page needs for
 *     its mute button sits between the microphone and `MicStream`, so on load
 *     the socket opened, the flow said `ready`, and not one word was ever sent.
 *     The context is now created INSIDE the click handler, synchronously,
 *     before any `await`.
 *  2. A permission dialog that appears on its own, on a page a parent has never
 *     seen, gets denied. Saying what the microphone is for first is what makes
 *     it get granted — and a denied microphone is a consultation with half a
 *     transcript.
 *
 * ── And why the microphone is a state, not a boolean ──────────────────
 *
 * It can be refused, it can drop, and the doctor may not have opened the flow
 * yet (a parent who clicks the link early). All three used to look identical:
 * a dimmed pill saying "sin micrófono", with a page reload as the only way out.
 * Now a drop retries on its own with a backoff, a refusal says how to undo it,
 * and the level meter shows real RMS, so a microphone that is connected but
 * hearing nothing looks different from one that is working — the same failure
 * the doctor's meter exists to make visible.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MicStream } from '@daguito/sdk/voice'
import { loadJitsi, meetingOptions, type MeetingCredentials } from './lib/jitsi'
import { translator, type Translator } from './lib/i18n'

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
  /** The link is bad, expired, or the visit is over. `retry` is false for the
   *  first two: there is nothing a second attempt would change. */
  | { kind: 'rejected'; message: string; retry: boolean }
  /** Loaded, waiting for the tap that starts everything. */
  | { kind: 'welcome'; session: Session }
  | { kind: 'live'; session: Session }
  /** They hung up (or the doctor closed the room). */
  | { kind: 'ended' }

type Mic =
  /** No engine for this consultation: `stream` came back null. The call works. */
  | { kind: 'unavailable' }
  | { kind: 'starting' }
  | { kind: 'live'; level: number; muted: boolean }
  /** Refused. Not retried on a timer: the dialog is gone and only the browser's
   *  own settings can bring it back. */
  | { kind: 'denied' }
  /** Dropped or never attached — retrying while `attempt` is within the table. */
  | { kind: 'failed'; retrying: boolean }

export type PatientProps = {
  apiBase: string
  consultationId: string
  token: string
  locale?: string
}

/**
 * How long to wait before re-attaching the audio socket, per attempt.
 *
 * The doctor's `scheduleAudioRestart` table, with a longer tail: the common
 * cause here is a parent who opened the link before the doctor pressed start,
 * and that wait is minutes, not seconds.
 */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000]

export function PatientScreen({ apiBase, consultationId, token, locale }: PatientProps) {
  const { t } = translator(locale)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [mic, setMic] = useState<Mic>({ kind: 'starting' })

  const container = useRef<HTMLDivElement | null>(null)
  const stream = useRef<MicStream | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const micGain = useRef<GainNode | null>(null)
  const mixed = useRef<MediaStream | null>(null)
  const rawStream = useRef<MediaStream | null>(null)
  const muted = useRef(false)
  const attempt = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)
  const room = useRef<{ executeCommand: (command: string, ...args: unknown[]) => void } | null>(
    null,
  )
  /** What Jitsi last said ITS microphone is, so the two are only ever nudged
   *  when they actually disagree — no toggle can bounce between them. */
  const roomMuted = useRef(false)
  /** The last level pushed to React, so a 50 Hz callback is not a 50 Hz render. */
  const lastLevelAt = useRef(0)
  const leaving = useRef(false)
  /** The microphone state, readable from an event handler without re-binding
   *  the listener on every level frame. */
  const micRef = useRef<Mic>(mic)
  micRef.current = mic
  /** False once the page is torn down: an attach that was in flight must not
   *  leave a live socket behind it. */
  const alive = useRef(true)

  // ── Teardown ────────────────────────────────────────────────────────

  const stopRetry = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    retryTimer.current = null
  }, [])

  const teardown = useCallback(() => {
    stopRetry()
    alive.current = false
    void stream.current?.stop()
    stream.current = null
    rawStream.current?.getTracks().forEach((track) => track.stop())
    rawStream.current = null
    mixed.current = null
    micGain.current = null
    void audioCtx.current?.close().catch(() => {})
    audioCtx.current = null
    void wakeLock.current?.release().catch(() => {})
    wakeLock.current = null
  }, [stopRetry])

  useEffect(() => teardown, [teardown])

  // ── The session ─────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' })
    try {
      const res = await fetch(
        `${apiBase}/public/consultations/${encodeURIComponent(consultationId)}` +
          `/patient/session?t=${encodeURIComponent(token)}`,
      )
      if (!res.ok) {
        setPhase({
          kind: 'rejected',
          message: res.status === 410 ? t('patient.finished') : t('patient.invalid'),
          retry: false,
        })
        return
      }
      setPhase({ kind: 'welcome', session: (await res.json()) as Session })
    } catch {
      // A phone that walked out of range. This one IS worth retrying, and a
      // parent should not have to know that reloading is how you do it.
      setPhase({ kind: 'rejected', message: t('patient.offline'), retry: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, consultationId, token])

  useEffect(() => {
    void load()
  }, [load])

  // ── The microphone ──────────────────────────────────────────────────

  /**
   * Attach (or re-attach) the audio socket on top of the mixer that is already
   * running.
   *
   * Split from the permission step on purpose: this is the part that fails for
   * reasons that heal — the doctor has not started the flow, the API rolled
   * mid-visit — and it must be retryable without asking the parent for their
   * microphone a second time.
   */
  const attach = useCallback(
    async (session: Session) => {
      const credentials = session.stream
      const media = mixed.current
      if (!credentials || !media) return

      stopRetry()
      void stream.current?.stop()
      stream.current = null

      try {
        const capture = new MicStream({
          apiUrl: credentials.api_url,
          token: credentials.token,
          // The patient's OWN sub-channel. `s_stt_patient` declares
          // `audio_session_suffix: "patient"`; the bare session key is read by
          // nobody and fails silently — the socket opens and no word arrives.
          sessionId: `${credentials.session_key}:patient`,
          // The mixed stream, not the raw device: the mute gain is in it.
          mediaStream: media,
          vad: { enabled: true },
          onLevel: (rms: number) => {
            // ~12 frames a second is plenty for five bars and keeps a phone
            // from re-rendering the room's neighbour on every audio buffer.
            const now = Date.now()
            if (now - lastLevelAt.current < 80) return
            lastLevelAt.current = now
            setMic((current) => (current.kind === 'live' ? { ...current, level: rms } : current))
          },
          onError: () => scheduleRetry(session),
        })
        await capture.start()
        if (!alive.current) {
          void capture.stop()
          return
        }
        void capture.setMuted(muted.current)
        stream.current = capture
        attempt.current = 0
        setMic({ kind: 'live', level: 0, muted: muted.current })
      } catch {
        scheduleRetry(session)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopRetry],
  )

  /**
   * Try again later, up the table, and say so meanwhile.
   *
   * The parent is told the microphone is reconnecting rather than that it
   * failed: for the most common cause — the doctor has not started yet — it
   * will, and a "no funcionó" they can act on is worse than a wait they cannot.
   */
  const scheduleRetry = useCallback(
    (session: Session) => {
      stopRetry()
      const delay = RETRY_DELAYS_MS[attempt.current]
      setMic({ kind: 'failed', retrying: delay !== undefined })
      if (delay === undefined) return
      attempt.current += 1
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null
        void attach(session)
      }, delay)
    },
    [attach, stopRetry],
  )

  /**
   * Ask for the microphone and build the mixer.
   *
   * `context` is handed in from the click handler, where it was created inside
   * the gesture — see the note at the top of the file.
   */
  const openMicrophone = useCallback(
    async (session: Session, context: AudioContext) => {
      if (!session.stream) {
        setMic({ kind: 'unavailable' })
        return
      }
      setMic({ kind: 'starting' })
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        rawStream.current = media

        // The same mixer as the doctor's side: the mute button is a GainNode,
        // because `track.enabled` does not travel through a Web Audio graph.
        const destination = context.createMediaStreamDestination()
        const gain = context.createGain()
        gain.gain.value = muted.current ? 0 : 1
        micGain.current = gain
        context.createMediaStreamSource(media).connect(gain)
        gain.connect(destination)
        mixed.current = destination.stream

        await attach(session)
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ''
        // A refusal is the parent's to undo in the browser's own settings;
        // anything else (a device in use by another app, a phone that lost the
        // input) is worth trying again.
        if (name === 'NotAllowedError' || name === 'SecurityError') setMic({ kind: 'denied' })
        else scheduleRetry(session)
      }
    },
    [attach, scheduleRetry],
  )

  // ── Entering ────────────────────────────────────────────────────────

  const join = (session: Session) => {
    alive.current = true
    // SYNCHRONOUS, and before any await: on iOS an AudioContext built outside
    // the gesture never leaves `suspended`, and the whole mixer is silent.
    const context = new AudioContext()
    audioCtx.current = context
    void context.resume().catch(() => {})

    setPhase({ kind: 'live', session })
    void openMicrophone(session, context)
    void requestWakeLock()
  }

  /**
   * Keep the screen on for the visit.
   *
   * A phone that locks mid-consultation suspends the AudioContext with it: the
   * parent puts it down for a minute and the patient channel goes quiet without
   * anything on screen changing. Best effort — the API does not exist on every
   * browser, and where it does the promise can reject outright.
   */
  const requestWakeLock = async () => {
    try {
      const api = (
        navigator as Navigator & {
          wakeLock?: { request: (kind: 'screen') => Promise<{ release: () => Promise<void> }> }
        }
      ).wakeLock
      if (!api) return
      wakeLock.current = await api.request('screen')
    } catch {
      /* not supported, or refused in the background: not worth telling anyone */
    }
  }

  // ── The room ────────────────────────────────────────────────────────

  const [roomReady, setRoomReady] = useState(false)
  const [roomFailed, setRoomFailed] = useState(false)
  /** Bumped by the retry button to re-run the effect below. */
  const [roomAttempt, setRoomAttempt] = useState(0)
  const session = phase.kind === 'live' ? phase.session : null

  useEffect(() => {
    if (!session) return
    let disposed = false
    let api: { dispose: () => void } | null = null

    setRoomReady(false)
    setRoomFailed(false)

    void (async () => {
      try {
        const JitsiMeetExternalAPI = await loadJitsi(session.meeting.domain)
        if (disposed || !container.current) return
        const instance = new JitsiMeetExternalAPI(session.meeting.domain, {
          ...meetingOptions({
            credentials: session.meeting,
            displayName: session.consultation.patient_name ?? t('patient.you'),
            lang: locale?.startsWith('en') ? 'en' : 'es',
          }),
          parentNode: container.current,
          width: '100%',
          height: '100%',
        })
        api = instance
        room.current = instance
        setRoomReady(true)

        // The room's own toolbar is the mute most parents will reach for.
        instance.addListener('audioMuteStatusChanged', (payload?: unknown) => {
          const next = Boolean((payload as { muted?: boolean } | undefined)?.muted)
          roomMuted.current = next
          if (muted.current !== next) applyMute(next)
        })

        // Hanging up used to leave the parent looking at an empty black box
        // with a live microphone still in it. Now it ends the page.
        const leave = () => {
          if (leaving.current) return
          leaving.current = true
          teardown()
          setPhase({ kind: 'ended' })
        }
        instance.addListener('videoConferenceLeft', leave)
        instance.addListener('readyToClose', leave)
      } catch {
        // A room that fails to load must not take the microphone with it: the
        // transcript is the thing the doctor cannot reconstruct afterwards. It
        // must also not leave a black rectangle: the usual causes (the Jitsi
        // domain blocked on the parent's network, a tunnel that was down) look
        // exactly like a frozen page.
        if (!disposed) {
          setRoomReady(true)
          setRoomFailed(true)
        }
      }
    })()

    return () => {
      disposed = true
      room.current = null
      api?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, roomAttempt])

  /**
   * Coming back from the lock screen or another app.
   *
   * Both suspend the AudioContext on mobile, and a suspended graph feeds
   * `MicStream` silence — with every indicator on this page still saying the
   * microphone is live. So the context is resumed, and a socket that died while
   * the tab was hidden is re-attached at once rather than on its next backoff.
   */
  useEffect(() => {
    if (!session) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void audioCtx.current?.resume().catch(() => {})
      if (!wakeLock.current) void requestWakeLock()
      // Read through the ref, not a state updater: an updater that starts a
      // socket is a side effect React is free to run twice.
      const current = micRef.current
      if (current.kind === 'failed' && current.retrying) {
        attempt.current = 0
        void attach(session)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, attach])

  /**
   * Mute BOTH sides, from wherever the parent pressed it.
   *
   * Jitsi's own toolbar mute silences the room and nothing else: the microphone
   * kept feeding `<session>:patient`, so a parent who muted "to cough" or to
   * deal with a second child was still being transcribed. They are one control
   * now — this page's button drives Jitsi too, and Jitsi's drives this.
   */
  const applyMute = useCallback((next: boolean) => {
    muted.current = next
    if (micGain.current) micGain.current.gain.value = next ? 0 : 1
    void stream.current?.setMuted(next)
    setMic((current) => (current.kind === 'live' ? { ...current, muted: next } : current))
  }, [])

  const toggleMute = () => {
    const next = !muted.current
    applyMute(next)
    // Only when they disagree: `toggleAudio` flips whatever Jitsi has, so
    // sending it blindly is how the two ends up inverted.
    if (roomMuted.current !== next) room.current?.executeCommand('toggleAudio')
  }

  const retryMic = () => {
    if (!session) return
    attempt.current = 0
    const context = audioCtx.current
    // A denied microphone has no mixer behind it: start from the permission.
    if (!mixed.current && context) void openMicrophone(session, context)
    else void attach(session)
  }

  // ── Screens ─────────────────────────────────────────────────────────

  if (phase.kind === 'loading') {
    return (
      <Centered>
        <Spinner />
        <p style={styles.message}>{t('patient.loading')}</p>
      </Centered>
    )
  }

  // The two endings share the welcome's card: a line of text alone in a black
  // page reads like something crashed, and this is the last thing the parent
  // sees of the practice.
  if (phase.kind === 'rejected') {
    return (
      <Centered>
        <div style={styles.card}>
          <p style={styles.eyebrow}>{t('patient.title')}</p>
          <p style={styles.cardMessage}>{phase.message}</p>
          {phase.retry ? (
            <button type="button" style={styles.primary} onClick={() => void load()}>
              {t('patient.retry')}
            </button>
          ) : null}
        </div>
      </Centered>
    )
  }

  if (phase.kind === 'ended') {
    return (
      <Centered>
        <div style={styles.card}>
          <p style={styles.eyebrow}>{t('patient.title')}</p>
          <p style={{ ...styles.title, textAlign: 'left' }}>{t('patient.ended.title')}</p>
          <p style={styles.cardMessage}>{t('patient.ended.body')}</p>
        </div>
      </Centered>
    )
  }

  if (phase.kind === 'welcome') {
    const name = phase.session.consultation.patient_name
    return (
      <Centered>
        <div style={styles.card}>
          <p style={styles.eyebrow}>{t('patient.title')}</p>
          <p style={{ ...styles.title, textAlign: 'left' }}>
            {name ? t('patient.join.for', { name }) : t('patient.join.generic')}
          </p>
          <ul style={styles.points}>
            <li style={styles.point}>{t('patient.join.point.room')}</li>
            <li style={styles.point}>
              {phase.session.stream
                ? t('patient.join.point.mic')
                : t('patient.join.point.noEngine')}
            </li>
            <li style={styles.point}>{t('patient.join.point.mute')}</li>
          </ul>
          <button type="button" style={styles.primary} onClick={() => join(phase.session)}>
            {t('patient.join.cta')}
          </button>
          <p style={styles.footnote}>{t('patient.join.permission')}</p>
        </div>
      </Centered>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.bar}>
        <span style={styles.brand}>{t('patient.title')}</span>
        <MicChip mic={mic} t={t} />
        {mic.kind === 'live' ? (
          <button
            type="button"
            style={{ ...styles.button, ...(mic.muted ? styles.buttonAlert : null) }}
            onClick={toggleMute}
            aria-pressed={mic.muted}
          >
            {mic.muted ? t('workspace.unmute') : t('workspace.mute')}
          </button>
        ) : null}
      </div>

      {/* The one line that tells a parent what to do about it, and only when
          there is something to do. */}
      {mic.kind === 'denied' || (mic.kind === 'failed' && !mic.retrying) ? (
        <div style={styles.notice} role="status">
          <span style={styles.noticeText}>
            {mic.kind === 'denied' ? t('patient.mic.deniedHint') : t('patient.mic.failedHint')}
          </span>
          <button type="button" style={styles.buttonSmall} onClick={retryMic}>
            {t('patient.retry')}
          </button>
        </div>
      ) : null}

      <div ref={container} style={styles.room}>
        {!roomReady ? (
          <div style={styles.overlay}>
            <Spinner />
            <p style={styles.message}>{t('meeting.connecting')}</p>
          </div>
        ) : null}
        {roomFailed ? (
          <div style={styles.overlay}>
            <p style={styles.message}>{t('patient.room.failed')}</p>
            <button
              type="button"
              style={styles.buttonSmall}
              onClick={() => setRoomAttempt((n) => n + 1)}
            >
              {t('patient.retry')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The microphone, as a chip with a level meter in it.
 *
 * The bars are real RMS, not decoration: "activo" with five flat bars is a
 * microphone that is connected and hearing nothing — a muted headset, a phone
 * whose input another app has taken — and that is the failure that otherwise
 * only shows up as an empty transcript after the visit.
 */
function MicChip({ mic, t }: { mic: Mic; t: Translator['t'] }) {
  const live = mic.kind === 'live' && !mic.muted
  const label =
    mic.kind === 'live'
      ? mic.muted
        ? t('patient.mic.muted')
        : t('patient.mic.on')
      : mic.kind === 'starting'
        ? t('patient.mic.starting')
        : mic.kind === 'failed' && mic.retrying
          ? t('patient.mic.reconnecting')
          : mic.kind === 'unavailable'
            ? t('patient.mic.off')
            : t('patient.mic.blocked')

  return (
    <span
      style={{ ...styles.pill, ...(live ? styles.pillLive : null) }}
      role="status"
      aria-live="polite"
    >
      {mic.kind === 'live' ? <Meter level={mic.muted ? 0 : mic.level} active={live} /> : null}
      {label}
    </span>
  )
}

/** Five bars, tallest in the middle — the same shape as the doctor's meter. */
const WEIGHTS = [0.5, 0.8, 1, 0.8, 0.5]

function Meter({ level, active }: { level: number; active: boolean }) {
  return (
    <span style={styles.meter} aria-hidden="true">
      {WEIGHTS.map((weight, index) => (
        <span
          key={index}
          style={{
            ...styles.meterBar,
            height: 3 + Math.min(1, level * 2.2) * weight * 11,
            background: active ? '#4ade80' : '#4b5563',
          }}
        />
      ))}
    </span>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={styles.center}>
      <div style={styles.stack}>{children}</div>
    </div>
  )
}

/** A ring, drawn with the keyframes `patient.html` ships. */
function Spinner() {
  return <span style={styles.spinner} aria-hidden="true" />
}

/**
 * Plain inline styles, not Tamagui.
 *
 * This page is opened by a parent on a phone with one job, and it must render
 * before a provider tree, a theme and a font have loaded. It is also the one
 * surface here that is not inside Daguito's chrome, so it inherits no design
 * from the host to match. Dark, because the room it frames is.
 */
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const INK = '#e8eaed'
const DIM = '#9aa4b2'
const LINE = '#2a2f36'
const SURFACE = '#161a1f'

const styles: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0b0d10' },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    padding: '10px 14px',
    paddingTop: 'max(10px, env(safe-area-inset-top))',
    color: INK,
    font: `14px/1.4 ${FONT}`,
    borderBottom: `1px solid ${LINE}`,
  },
  brand: { fontWeight: 700, whiteSpace: 'nowrap' },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
    padding: '5px 12px',
    borderRadius: 999,
    border: `1px solid ${LINE}`,
    background: SURFACE,
    color: DIM,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  pillLive: { color: INK, borderColor: '#2f6b46' },
  meter: { display: 'inline-flex', alignItems: 'center', gap: 2, height: 14 },
  meterBar: { width: 3, borderRadius: 2, transition: 'height 90ms linear, background 200ms' },
  button: {
    // 44 px is the tap target a thumb hits on the first try; the old 28 px one
    // was next to a video call the parent is trying to watch.
    minHeight: 44,
    padding: '0 16px',
    borderRadius: 10,
    border: `1px solid ${LINE}`,
    background: SURFACE,
    color: INK,
    font: `14px ${FONT}`,
    cursor: 'pointer',
  },
  buttonAlert: { borderColor: '#7f3b3b', background: '#2a1a1a', color: '#ffb4b4' },
  buttonSmall: {
    minHeight: 36,
    padding: '0 12px',
    borderRadius: 8,
    border: `1px solid ${LINE}`,
    background: 'transparent',
    color: INK,
    font: `13px ${FONT}`,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  primary: {
    minHeight: 50,
    width: '100%',
    padding: '0 20px',
    borderRadius: 12,
    border: 'none',
    background: '#2f6b46',
    color: '#f2fff7',
    font: `600 16px ${FONT}`,
    cursor: 'pointer',
  },
  notice: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    padding: '10px 14px',
    background: '#2a1a1a',
    borderBottom: `1px solid #7f3b3b`,
  },
  noticeText: { flex: 1, color: '#ffd9d9', font: `13px/1.4 ${FONT}`, minWidth: 180 },
  room: { flex: 1, minHeight: 0, position: 'relative', background: '#000' },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100dvh',
    background: '#0b0d10',
    padding: 24,
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    width: '100%',
    maxWidth: 420,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    width: '100%',
    padding: 24,
    borderRadius: 16,
    border: `1px solid ${LINE}`,
    background: SURFACE,
    boxSizing: 'border-box',
  },
  eyebrow: {
    margin: 0,
    color: DIM,
    font: `600 12px ${FONT}`,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: { margin: 0, color: INK, font: `700 20px/1.3 ${FONT}`, textAlign: 'center' },
  points: { display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 },
  point: {
    listStyle: 'none',
    color: DIM,
    font: `14px/1.45 ${FONT}`,
    paddingLeft: 16,
    borderLeft: `2px solid ${LINE}`,
  },
  footnote: { margin: 0, color: DIM, font: `12px/1.4 ${FONT}`, textAlign: 'center' },
  message: { color: INK, font: `15px/1.5 ${FONT}`, textAlign: 'center', margin: 0 },
  // Inside the card the copy is ragged-right, like everything else in it.
  cardMessage: { color: INK, font: `15px/1.5 ${FONT}`, margin: 0 },
  spinner: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    border: `2px solid ${LINE}`,
    borderTopColor: INK,
    animation: 'patient-spin 800ms linear infinite',
    display: 'inline-block',
  },
}
