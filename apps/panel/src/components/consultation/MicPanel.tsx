/**
 * What fills the room's slot when there is no room.
 *
 * A presencial is two people in one office with one microphone: there is
 * nothing to show in a video panel, and opening a camera for them stamps a
 * meeting that never happened. The legacy app puts its `InPersonMicPanel` here
 * for exactly that reason, and this is that panel.
 *
 * The one change from the legacy: its bars are `Math.random()` heights on a CSS
 * animation — decoration that moves whether or not any audio is arriving. These
 * bars are driven by the microphone's real RMS, so a dead microphone looks
 * dead. That is the failure this panel exists to make visible: a consultation
 * recorded with a muted headset produces a perfect-looking screen and an empty
 * transcript, and nobody finds out until it is over.
 */
import { Mic, MicOff, Video } from '@tamagui/lucide-icons'
import { Text, XStack, YStack } from 'tamagui'
import type { translator } from '../../lib/i18n'
import type { StreamState } from '../../lib/useConsultationStream'
import { Button } from '../ui'

/** Five bars, tallest in the middle, the way a level meter reads. */
const WEIGHTS = [0.45, 0.75, 1, 0.75, 0.45]

export function MicPanel({
  i18n,
  state,
  onOpenRoom,
}: {
  i18n: ReturnType<typeof translator>
  state: StreamState
  /** A presencial can still open the room — a parent who could not come, an
   *  interpreter, a second opinion. It is a door, not the default. */
  onOpenRoom?: () => void
}) {
  const { t } = i18n
  const live = state.kind === 'live'
  const muted = live && state.muted
  const level = live && !muted ? state.level : 0
  const active = live && !muted

  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$1.5"
      padding="$3"
      backgroundColor="$color2"
    >
      <YStack
        width={84}
        height={84}
        borderRadius={999}
        alignItems="center"
        justifyContent="center"
        backgroundColor={active ? '$actionSurfaceHover' : '$color4'}
        borderWidth={3}
        borderColor={active ? '$actionText' : 'transparent'}
      >
        {active ? (
          <Mic size={34} color="$actionText" />
        ) : (
          <MicOff size={34} color="$color10" />
        )}
      </YStack>

      <YStack alignItems="center" gap="$0.25">
        <Text fontSize={16} fontWeight="700" color="$color">
          {state.kind === 'connecting'
            ? t('workspace.stream.connecting')
            : muted
              ? t('workspace.stream.muted')
              : live
                ? t('mic.active')
                : t('mic.idle')}
        </Text>
        <Text fontSize={13} color="$color11">
          {t('mic.inPerson')}
        </Text>
      </YStack>

      {/* The level meter. A bar has a floor of 3px so the row stays legible as
          a row when the room is silent, rather than collapsing to nothing. */}
      <XStack alignItems="flex-end" gap="$0.5" height={34}>
        {WEIGHTS.map((weight, index) => (
          <YStack
            key={index}
            width={6}
            borderRadius={3}
            // The RMS of speech sits well below 1; x6 puts normal conversation
            // across most of the meter instead of a permanent twitch.
            height={Math.max(3, Math.min(1, level * 6) * weight * 34)}
            backgroundColor={active ? '$actionText' : '$color6'}
          />
        ))}
      </XStack>

      {onOpenRoom ? (
        <Button size="sm" variant="ghost" iconBefore={<Video size={14} />} onPress={onOpenRoom}>
          {t('workspace.room.open')}
        </Button>
      ) : null}
    </YStack>
  )
}
