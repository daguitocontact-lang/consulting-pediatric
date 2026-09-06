// Filter chips — the status filter as one row of pills instead of a dropdown.
//
// A select hides the options and the current one behind a click; with six
// statuses that all fit on a line, the filter is worth showing open. It also
// carries counts, which is what turns a filter into a summary: "confirmadas 4"
// answers the question before it is asked.
import { Text, XStack } from 'tamagui'

export type Chip = { value: string; label: string; count?: number }

export function FilterChips({
  chips,
  value,
  onChange,
  ariaLabel,
}: {
  chips: Chip[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}) {
  return (
    // On a phone the row NEVER wraps, it scrolls — the same answer the section
    // bar gives (Shell.tsx). Seven statuses wrapped into three rows is 150px of
    // filter above a list you have not reached yet; sideways, it is one.
    <XStack
      gap={8}
      flexWrap="wrap"
      role="group"
      aria-label={ariaLabel}
      $sm={{ flexWrap: 'nowrap', overflow: 'scroll' }}
    >
      {chips.map((chip) => {
        const active = chip.value === value
        return (
          <XStack
            key={chip.value || 'all'}
            role="button"
            aria-pressed={active}
            tabIndex={0}
            alignItems="center"
            // A chip in a scrolling row keeps its full name rather than
            // squeezing: the row is as long as it needs to be.
            flexShrink={0}
            gap={6}
            paddingVertical={7}
            paddingHorizontal={14}
            borderRadius={999}
            borderWidth={1}
            cursor="pointer"
            // The open chip is the accent as an outline with a faint wash
            // behind it; the others are quiet pills in the page's own ink.
            // The open filter is an OUTLINE in the accent, not a filled pill:
            // filled, it competed with the one real primary action on the screen.
            borderColor={active ? '$actionText' : '$borderColorHover'}
            backgroundColor="transparent"
            hoverStyle={{ borderColor: active ? '$actionText' : '$borderColorPress' }}
            outlineStyle="none"
            focusVisibleStyle={{
              outlineStyle: 'solid',
              outlineWidth: 2,
              outlineColor: '$borderColorFocus',
              outlineOffset: 2,
            }}
            onPress={() => onChange(chip.value)}
            // Enter and Space, because a div that behaves like a button has to
            // answer to a keyboard like one. Typed loosely on purpose: Tamagui
            // types this as a React Native press event, which has no `key`.
            onKeyDown={
              ((event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onChange(chip.value)
                }
              }) as never
            }
          >
            <Text fontSize={13} fontWeight="600" color={active ? '$actionText' : '$color'}>
              {chip.label}
            </Text>
            {chip.count === undefined ? null : (
              <Text fontSize={13} fontWeight="600" color={active ? '$actionText' : '$color11'}>
                {`· ${chip.count}`}
              </Text>
            )}
          </XStack>
        )
      })}
    </XStack>
  )
}
