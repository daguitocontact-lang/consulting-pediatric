/**
 * One Jitsi room, mounted into a node React does not touch.
 *
 * Shared by the listing's modal and the consultation screen's Meeting panel, so
 * the mounting rules live in one place:
 *
 *   - Jitsi renders into a DOM node it OWNS. React must never reconcile that
 *     node's children, so the container is an empty <div> with a ref.
 *   - The api object has to be disposed on unmount. Skipping it leaves the
 *     iframe running: the microphone stays live and the doctor stays "in the
 *     room" for everyone else after the panel is gone.
 *   - The dialog may close while the script is still loading, and a room that
 *     starts after that is a microphone nobody can see.
 */
import { useEffect, useRef, useState } from 'react'
import { Text, YStack } from 'tamagui'
import { apiGet, apiPost, errorMessage, type MountProps } from '../lib/api'
import type { translator } from '../lib/i18n'
import { loadJitsi, meetingOptions, type MeetingCredentials } from '../lib/jitsi'
import { ErrorNote } from './PageShell'
import { Spinner } from './ui'

export type MeetingResponse = {
  meeting: MeetingCredentials
  started_at: string | null
  ended_at: string | null
}

export function JitsiFrame({
  props,
  i18n,
  consultationId,
  displayName,
  onJoined,
  onLeft,
  onClose,
}: {
  props: MountProps
  i18n: ReturnType<typeof translator>
  consultationId: string
  displayName: string
  /** Fired once the room is open — the meeting has been stamped by then. */
  onJoined?: () => void
  /** Fired once the room is closed and the time is banked. */
  onLeft?: () => void
  /** Jitsi's own hang-up asked to close the surface around it. */
  onClose?: () => void
}) {
  const { t } = i18n
  const container = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [connecting, setConnecting] = useState(true)

  useEffect(() => {
    let disposed = false
    let api: { dispose: () => void } | null = null

    setError(null)
    setConnecting(true)
    ;(async () => {
      try {
        const { meeting } = await apiGet<MeetingResponse>(
          props,
          `/api/consultations/${consultationId}/meeting`,
        )
        const JitsiMeetExternalAPI = await loadJitsi(meeting.domain)
        if (disposed || !container.current) return

        const instance = new JitsiMeetExternalAPI(meeting.domain, {
          ...meetingOptions({ credentials: meeting, displayName, lang: i18n.lang }),
          parentNode: container.current,
          width: '100%',
          height: '100%',
        })
        api = instance
        setConnecting(false)

        // The meeting starts when the room is OPENED, not when Jitsi says the
        // conference was joined: measured against meet.jit.si, a room that
        // visibly had our participant in it never fired `videoConferenceJoined`,
        // so nothing was stamped and leaving banked zero seconds. The event is
        // still listened for — stamping twice is free, the server COALESCEs.
        const start = () => {
          void apiPost(props, `/api/consultations/${consultationId}/meeting/start`, {})
            .catch(() => {})
            .then(() => onJoined?.())
        }
        start()
        instance.addListener('videoConferenceJoined', start)

        const leave = () => {
          void apiPost(props, `/api/consultations/${consultationId}/meeting/end`, {})
            .catch(() => {})
            .finally(() => onLeft?.())
        }
        instance.addListener('videoConferenceLeft', leave)
        instance.addListener('readyToClose', () => {
          leave()
          onClose?.()
        })
      } catch (err) {
        if (!disposed) {
          setError(err)
          setConnecting(false)
        }
      }
    })()

    return () => {
      disposed = true
      api?.dispose()
      void apiPost(props, `/api/consultations/${consultationId}/meeting/end`, {})
        .catch(() => {})
        .finally(() => onLeft?.())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId])

  return (
    <YStack flex={1} backgroundColor="$color2" minHeight={200}>
      {error ? (
        <YStack padding="$2">
          <ErrorNote>{t('meeting.error', { detail: errorMessage(error, i18n) })}</ErrorNote>
        </YStack>
      ) : null}
      {connecting ? (
        <YStack flex={1} alignItems="center" justifyContent="center" gap="$1" minHeight={160}>
          <Spinner />
          <Text fontSize={13} color="$color11">
            {t('meeting.connecting')}
          </Text>
        </YStack>
      ) : null}
      {/* Jitsi's node. Empty on purpose: React owns the wrapper, Jitsi owns
          everything inside it. */}
      <YStack flex={1} ref={container as never} />
    </YStack>
  )
}
