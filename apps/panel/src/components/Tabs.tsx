// The segmented tab row, shared by the reservation wizard and its detail.
//
// One row of equal parts rather than loose pills: the sections are equal parts
// of the same record, and their widths should say so. Extracted from the wizard
// so the detail reads the same way — a reservation looked at and a reservation
// edited should not be two different shapes of screen.
//
// A stack of six cards is not a worse LAYOUT than six tabs, it is a worse
// ANSWER to "where is the payment": scrolling to find a section is a search,
// while a tab is a place. That is why the detail moved to this.
import { Text, XStack } from 'tamagui'

export type Tab<K extends string> = { key: K; label: string; badge?: string }

export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  fit,
}: {
  tabs: Tab<K>[]
  value: K
  onChange: (key: K) => void
  /**
   * Hug the labels instead of spanning the row. For a segmented control that
   * switches SCREENS (the sections of Operaciones) rather than the parts of one
   * record: stretched across a wide page, four words became a black bar the
   * height of a button and the width of the window, heavier than the title
   * above it.
   */
  fit?: boolean
}) {
  return (
    // A track with a raised segment, the same pill the section bar draws for
    // the open section ($color4 on $color1): the solid black-and-white block
    // it was read as a button the size of the page, and on the detail it was
    // the loudest thing on the screen.
    <XStack
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={10}
      padding={3}
      gap={2}
      backgroundColor="$color1"
      alignSelf={fit ? 'flex-start' : undefined}
      flexWrap={fit ? 'wrap' : undefined}
      // A phone scrolls the row rather than wrapping it, like the section bar
      // and the status chips: four sections of Operaciones on two rows read as
      // two controls, and the second row looked like a leftover.
      $sm={fit ? { flexWrap: 'nowrap', overflow: 'scroll' } : undefined}
    >
      {tabs.map((tab) => {
        const active = tab.key === value
        return (
          <XStack
            key={tab.key}
            flex={fit ? undefined : 1}
            flexShrink={fit ? 0 : undefined}
            paddingHorizontal={fit ? 14 : 8}
            role="button"
            aria-current={active}
            tabIndex={0}
            cursor="pointer"
            gap="$0.5"
            alignItems="center"
            justifyContent="center"
            paddingVertical={7}
            borderRadius={8}
            backgroundColor={active ? '$color4' : 'transparent'}
            hoverStyle={{ backgroundColor: active ? '$color4' : '$color2' }}
            outlineStyle="none"
            focusVisibleStyle={{
              outlineStyle: 'solid',
              outlineWidth: 2,
              outlineColor: '$borderColorFocus',
              outlineOffset: 1,
            }}
            onPress={() => onChange(tab.key)}
            onKeyDown={
              ((event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onChange(tab.key)
                }
              }) as never
            }
          >
            <Text
              fontSize={13}
              fontWeight={active ? '700' : '500'}
              color={active ? '$color' : '$color11'}
            >
              {tab.label}
            </Text>
            {/* The count belongs ON the tab: "Pasajeros 2" answers the question
                without opening it, which is most of why anyone clicks. */}
            {tab.badge ? (
              <Text fontSize={12} color="$color11">
                {tab.badge}
              </Text>
            ) : null}
          </XStack>
        )
      })}
    </XStack>
  )
}
