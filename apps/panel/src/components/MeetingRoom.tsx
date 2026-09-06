/**
 * The Jitsi room in a modal, opened from a row of the listing.
 *
 * The mounting itself lives in JitsiFrame — the consultation screen embeds the
 * same component in its Meeting panel, and the rules about disposing the api
 * and not letting React reconcile Jitsi's node are not worth having twice.
 */
import { Text, XStack, YStack } from 'tamagui'
import type { MountProps } from '../lib/api'
import type { translator } from '../lib/i18n'
import { canJoinMeeting } from '../lib/jitsi'
import { JitsiFrame } from './JitsiFrame'
import { Button, Modal } from './ui'

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
  if (!consultation) return null

  return (
    <Modal
      open
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
      <YStack height={520} $sm={{ height: 380 }}>
        <JitsiFrame
          props={props}
          i18n={i18n}
          consultationId={consultation.id}
          displayName={consultation.label}
          onJoined={onEnded}
          onLeft={onEnded}
          onClose={onClose}
        />
      </YStack>
    </Modal>
  )
}
