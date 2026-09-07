/**
 * The empty state a panel shows when it has nothing yet.
 *
 * The panel CHROME — the tab strip, the maximise button — used to live here
 * too. It moved to `Dock.tsx` when the tabs became draggable between groups:
 * a strip that is also a drag source and a drop target cannot be a component
 * that knows nothing about the layout around it.
 */
import type { ReactNode } from 'react'
import { Text, YStack } from 'tamagui'

/**
 * The empty state a panel shows when it has nothing yet.
 *
 * A dashed ring, a title and one line saying what will fill it. The dashed ring
 * is the point: an empty panel that looks finished reads as broken, and one
 * that says what is coming reads as waiting.
 */
export function PanelEmpty({
  icon,
  label,
  hint,
}: {
  icon?: ReactNode
  label: string
  /** What will put something here. */
  hint?: string
}) {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$1.25"
      paddingHorizontal="$3"
      paddingVertical="$4"
    >
      {icon ? (
        <YStack
          width={52}
          height={52}
          borderRadius={26}
          borderWidth={1.5}
          borderColor="$borderColor"
          borderStyle="dashed"
          alignItems="center"
          justifyContent="center"
        >
          {icon}
        </YStack>
      ) : null}
      <Text fontSize={14.5} fontWeight="600" color="$color" textAlign="center">
        {label}
      </Text>
      {hint ? (
        <Text
          fontSize={13}
          color="$color10"
          textAlign="center"
          maxWidth={260}
          lineHeight={19}
        >
          {hint}
        </Text>
      ) : null}
    </YStack>
  )
}
