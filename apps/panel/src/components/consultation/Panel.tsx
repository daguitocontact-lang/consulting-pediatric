/**
 * The chrome every panel of the consultation screen wears: a titled tab and a
 * fullscreen toggle, over a body that scrolls on its own.
 *
 * The legacy screen used flexlayout-react for this — a dock with draggable
 * splitters, saved to a cookie. That is a dependency and a saved layout to
 * migrate for a panel that is embedded in somebody else's page and gets, at
 * most, half a screen. The two things the doctor actually used are here: the
 * tabs (a panel can hold more than one view) and "make this one big", which is
 * what the maximise icon in the corner did.
 */
import { useState, type ReactNode } from 'react'
import { Maximize2, Minimize2 } from '@tamagui/lucide-icons'
import { Text, XStack, YStack } from 'tamagui'

export type PanelTab = { key: string; label: string; content: ReactNode }

export function Panel({
  tabs,
  aside,
  expanded,
  onToggleExpand,
  minHeight = 220,
}: {
  tabs: PanelTab[]
  /** Drawn in the tab strip, before the maximise button. */
  aside?: ReactNode
  /** Null when the surface cannot expand (a phone, where everything stacks). */
  expanded?: boolean
  onToggleExpand?: () => void
  minHeight?: number
}) {
  const [active, setActive] = useState(tabs[0]?.key ?? '')
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0]

  return (
    <YStack
      flex={1}
      minHeight={minHeight}
      borderRadius="$4"
      overflow="hidden"
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$background"
    >
      <XStack
        alignItems="center"
        gap="$0.5"
        paddingHorizontal="$1"
        paddingTop="$0.5"
        backgroundColor="$color3"
      >
        {tabs.map((tab) => {
          const selected = tab.key === current?.key
          return (
            <XStack
              key={tab.key}
              role="button"
              tabIndex={0}
              onPress={() => setActive(tab.key)}
              paddingHorizontal="$1"
              paddingVertical="$0.5"
              borderTopLeftRadius="$3"
              borderTopRightRadius="$3"
              backgroundColor={selected ? '$background' : 'transparent'}
              hoverStyle={{ backgroundColor: selected ? '$background' : '$color4' }}
              cursor="pointer"
            >
              <Text
                fontSize={13}
                fontWeight={selected ? '700' : '500'}
                color={selected ? '$color' : '$color11'}
              >
                {tab.label}
              </Text>
            </XStack>
          )
        })}
        <XStack flex={1} />
        {aside}
        {onToggleExpand ? (
          <XStack
            role="button"
            tabIndex={0}
            aria-label="expand"
            onPress={onToggleExpand}
            padding="$0.5"
            borderRadius="$2"
            hoverStyle={{ backgroundColor: '$color4' }}
            cursor="pointer"
          >
            {expanded ? (
              <Minimize2 size={14} color="$color11" />
            ) : (
              <Maximize2 size={14} color="$color11" />
            )}
          </XStack>
        ) : null}
      </XStack>
      <YStack flex={1} overflow="hidden">
        {current?.content}
      </YStack>
    </YStack>
  )
}

/** What a panel shows when it has nothing yet — the legacy screen's four
 *  "No hay … disponibles" states, in one shape. */
export function PanelEmpty({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <YStack flex={1} alignItems="center" justifyContent="center" gap="$0.75" padding="$2">
      {icon}
      <Text fontSize={13} color="$color11" textAlign="center">
        {label}
      </Text>
    </YStack>
  )
}
