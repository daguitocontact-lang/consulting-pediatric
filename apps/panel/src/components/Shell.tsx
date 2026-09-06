// The panel's own top bar, and the frame every section is drawn inside.
//
// Daguito carries ONE menu row for this custom (manifest.ts), so the sections
// are switched here: a strip above the page, the way the host itself used to
// draw the manifest before its custom-panel nav moved into the sidebar. Keeping
// it inside the remote means the day a section is added or dropped, no change
// lands in Daguito.
import { useEffect, useRef, type ReactNode } from 'react'
import { Text, XStack, YStack } from 'tamagui'
import {
  BarChart3,
  BedDouble,
  CalendarDays,
  ConciergeBell,
  LayoutGrid,
  Package,
  Ticket,
} from '@tamagui/lucide-icons'
import { SECTIONS, type NavSectionId } from '../manifest'
import type { Translator } from '../lib/i18n'
import { PAGE_MAX_WIDTH } from './PageShell'

// Typed off a real icon so the map needs neither the icon prop type nor the
// global JSX namespace.
type IconComponent = typeof LayoutGrid

const ICONS: Record<string, IconComponent> = {
  BarChart3,
  BedDouble,
  CalendarDays,
  ConciergeBell,
  Package,
  Ticket,
}

export function Shell({
  active,
  i18n,
  onSelect,
  children,
}: {
  /** `null` while a page id the bundle does not know is being reported. */
  active: NavSectionId | null
  i18n: Translator
  onSelect: (id: NavSectionId) => void
  children: ReactNode
}) {
  // The open section is brought into view ONCE, when the panel opens on a
  // section that may be off the right edge. NOT on every change: a tap is proof
  // the pill was already on screen, so scrolling then yanks the row out from
  // under the finger that just touched it — press Servicios and the whole bar
  // slides away. `scrolled` is a ref rather than state because this must not
  // cause a render, and it survives the section changes it deliberately ignores.
  const openTab = useRef<HTMLElement | null>(null)
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current) return
    scrolled.current = true
    openTab.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [active])

  return (
    <YStack flex={1} minHeight="100%">
      <XStack
        role="navigation"
        aria-label={i18n.t('nav.group')}
        backgroundColor="$background"
        // Pinned to the top so the section switcher stays reachable while a long
        // list (Hoteles, Paquetes) scrolls beneath it. `sticky` rides on `style`
        // because Tamagui's typed `position` prop rejects the web-only value.
        style={{ position: 'sticky', top: 0 }}
        zIndex={20}
        justifyContent="center"
        // Aligned with the page below it: the same side padding and the same
        // centred reading width (PageShell), so the bar reads as the first row
        // of the page and not as a strip laid over it — and so six pills are
        // not stretched across a 2000px monitor with a screen's width of gap
        // between one word and the next.
        paddingHorizontal="$4"
        // The host gives the panel no chrome of its own, so the bar sits flush
        // against the top of the window: without this it reads as pinned to the
        // edge rather than as the first row of the page.
        paddingTop={14}
        paddingBottom={10}
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
        // On a phone the bar is the first thing on screen and the least
        // interesting: six labels wrapped into three rows pushed the page
        // itself below the fold.
        $md={{ paddingHorizontal: '$1.5', paddingTop: 8, paddingBottom: 8 }}
      >
        <XStack
          flex={1}
          maxWidth={PAGE_MAX_WIDTH}
          gap={4}
          // NEVER wraps. Six sections that do not fit used to fall into a
          // second and third row, which pushed the page down and read as three
          // separate bars; sideways is the one answer that looks the same at
          // every width. Wrapping was the desktop path, so a tablet — too wide
          // for the phone rules, too narrow for six equal parts — got the
          // stacked version nobody designed.
          flexWrap="nowrap"
          overflow="scroll"
          // A track with the open section raised inside it, rather than six
          // pills floating on the page: the sections are parts of one switch,
          // and grouping them says so in a third of the ink.
          $md={{
            gap: 2,
            backgroundColor: '$color1',
            borderRadius: 12,
            padding: 3,
            borderWidth: 1,
            borderColor: '$borderColor',
          }}
        >
          {SECTIONS.map((section) => {
            const Icon = ICONS[section.icon] ?? LayoutGrid
            const selected = section.id === active
            return (
              <XStack
                key={section.id}
                ref={selected ? (openTab as never) : undefined}
                role="button"
                // The label is hidden on a phone for every section but the open
                // one, so the name has to survive here for a screen reader.
                aria-label={i18n.t(section.labelKey)}
                aria-current={selected}
                tabIndex={0}
                cursor="pointer"
                // Equal parts across the whole width, like the tab row inside a
                // reservation: six sections of the same panel, and their widths
                // should say so. `minWidth` is what makes them wrap into a second
                // full-width row on a phone instead of squeezing to nothing.
                flex={1}
                minWidth={132}
                // On a phone they hug their content instead: equal parts of a
                // width that is not there only buys three stacked rows.
                // Below a desktop width every section keeps its name and its
                // own edge and hugs it, instead of six equal parts of a width
                // that is not there.
                $md={{
                  flex: 0,
                  flexGrow: 0,
                  flexShrink: 0,
                  minWidth: 0,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  gap: 7,
                  borderRadius: 9,
                }}
                alignItems="center"
                justifyContent="center"
                gap={7}
                paddingVertical={6}
                paddingHorizontal={12}
                // A pill, like every other switch in this design system (the
                // status chips right below it are the same shape).
                borderRadius={999}
                backgroundColor={selected ? '$color4' : 'transparent'}
                hoverStyle={{
                  backgroundColor: selected ? '$color4' : '$color2',
                }}
                pressStyle={{ backgroundColor: '$color5' }}
                // The browser's own ring is drawn on a click, not just on a
                // keyboard focus, so the open tab kept a blue outline around it.
                // Ours shows only when the keyboard is what moved the focus.
                outlineStyle="none"
                focusVisibleStyle={{
                  outlineStyle: 'solid',
                  outlineWidth: 2,
                  outlineColor: '$borderColorFocus',
                  outlineOffset: 1,
                }}
                onPress={() => onSelect(section.id)}
                // Enter and Space, because a div that behaves like a button has
                // to answer to a keyboard like one. Typed loosely on purpose:
                // Tamagui types this as a React Native press event, which has no
                // `key`.
                onKeyDown={
                  ((event: KeyboardEvent) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(section.id)
                    }
                  }) as never
                }
              >
                <Icon size={17} color={selected ? '$color' : '$color11'} />
                <Text
                  fontSize={13}
                  fontWeight={selected ? '700' : '500'}
                  color={selected ? '$color' : '$color11'}
                >
                  {i18n.t(section.labelKey)}
                </Text>
              </XStack>
            )
          })}
        </XStack>
      </XStack>
      <YStack flex={1}>{children}</YStack>
    </YStack>
  )
}
