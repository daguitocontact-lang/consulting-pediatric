/**
 * The Jitsi room, in a modal, for any consultation.
 *
 * Mounting rules that are not optional:
 *
 *   - Jitsi renders into a plain DOM node it OWNS. React must never reconcile
 *     that node's children, so the container is an empty <div> with a ref and
 *     nothing inside it.
 *   - The api object has to be disposed on unmount. Skipping it leaves the
 *     iframe running: the microphone stays live and the doctor stays "in the
 *     room" for everyone else after they closed the dialog.
 */
import { useEffect, useRef, useState } from 'react'
import { Text, XStack, YStack } from 'tamagui'
import { apiGet, apiPost, errorMessage, type MountProps } from '../lib/api'
import type { translator } from '../lib/i18n'
import { canJoinMeeting, loadJitsi, meetingOptions, type MeetingCredentials } from '../lib/jitsi'
import { ErrorNote } from './PageShell'
import { Button, Modal, Spinner } from './ui'

type MeetingResponse = {
  meeting: MeetingCredentials
  started_at: string | null
  ended_at: string | null
}

export function MeetingRoom({
  props,
  i18n,
  consultation,
  onClose,
  onEnded,
}: {
  props: MountProps
  i18n: ReturnType<typeof translator>
  /** The consultation whose room to open; null closes the dialog. */
  consultation: { id: string; label: string; status: string } | null
  onClose: () => void
  /** Fired once the room is closed, so the listing can pick up the new
   *  duration and status without the operator reloading. */
  onEnded: () => void
}) {
  const { t } = i18n
  const open = consultation !== null
  const container = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (!open || !consultation) return
    let disposed = false
    let api: { dispose: () => void } | null = null

    setError(null)
    setConnecting(true)
    ;(async () => {
      try {
        const { meeting } = await apiGet<MeetingResponse>(
          props,
          `/api/consultations/${consultation.id}/meeting`,
        )
        const JitsiMeetExternalAPI = await loadJitsi(meeting.domain)
        // The dialog may have been closed while the script was loading; a room
        // that starts after that is a microphone nobody can see.
        if (disposed || !container.current) return

        const instance = new JitsiMeetExternalAPI(meeting.domain, {
          ...meetingOptions({
            credentials: meeting,
            displayName: consultation.label,
            lang: i18n.lang,
          }),
          parentNode: container.current,
          width: '100%',
          height: '100%',
        })
        api = instance
        setConnecting(false)

        // The meeting starts when the room is OPENED, not when Jitsi says the
        // conference was joined.
        //
        // `videoConferenceJoined` was the obvious hook and it is not reliable:
        // measured against meet.jit.si, a room that visibly had our participant
        // in it never fired it, so nothing was stamped and the leave banked
        // zero seconds onto the consultation. The event is still listened for —
        // it is the right signal when it does arrive, and stamping twice is
        // free (the server COALESCEs) — but the open is what counts.
        const start = () => {
          void apiPost(props, `/api/consultations/${consultation.id}/meeting/start`, {})
            .catch(() => {})
            .then(onEnded)
        }
        start()
        instance.addListener('videoConferenceJoined', start)
        // Both events fire on the way out depending on how the room was left
        // (hang up vs. closing the dialog); ending twice is harmless — the
        // second call banks no time (see endMeeting).
        const leave = () => {
          void apiPost(props, `/api/consultations/${consultation.id}/meeting/end`, {})
            .catch(() => {})
            .finally(onEnded)
        }
        instance.addListener('videoConferenceLeft', leave)
        instance.addListener('readyToClose', () => {
          leave()
          onClose()
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
      // Dispose, then close the room on the server: the iframe has to go even
      // if the request fails.
      api?.dispose()
      void apiPost(props, `/api/consultations/${consultation.id}/meeting/end`, {})
        .catch(() => {})
        .finally(onEnded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, consultation?.id])

  if (!consultation) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('meeting.title', { name: consultation.label })}
      size="xl"
      bodyPadding={false}
      // Leaving by clicking outside would hang up a live consultation by
      // accident; the room is left with its own button or the header's X.
      closeOnBackdrop={false}
      footer={
        <XStack justifyContent="space-between" alignItems="center" gap="$1" flexWrap="wrap">
          <Text fontSize={12} color="$color11">
            {canJoinMeeting(consultation.status) ? t('meeting.hint') : t('meeting.finishedHint')}
          </Text>
          <Button variant="secondary" size="sm" onPress={onClose}>
            {t('meeting.leave')}
          </Button>
        </XStack>
      }
    >
      <YStack height={520} $sm={{ height: 380 }} backgroundColor="$color2">
        {error ? (
          <YStack padding="$2">
            <ErrorNote>{t('meeting.error', { detail: errorMessage(error, i18n) })}</ErrorNote>
          </YStack>
        ) : null}
        {connecting ? (
          <YStack flex={1} alignItems="center" justifyContent="center" gap="$1">
            <Spinner />
            <Text fontSize={13} color="$color11">
              {t('meeting.connecting')}
            </Text>
          </YStack>
        ) : null}
        {/* Jitsi's own node. Empty on purpose: React owns the wrapper, Jitsi
            owns everything inside it. */}
        <YStack flex={1} ref={container as never} />
      </YStack>
    </Modal>
  )
}
