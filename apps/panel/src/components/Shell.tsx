// The panel's own top bar, and the frame every section is drawn inside.
//
// Daguito carries ONE menu row for this custom (manifest.ts), so the sections
// are switched here: a strip above the page, the way the host itself used to
// draw the manifest before its custom-panel nav moved into the sidebar. Keeping
// it inside the remote means the day a section is added or dropped, no change
// lands in Daguito.
import { useEffect, useRef, type ReactNode } from 'react'
import { Text, XStack, YStack } from 'tamagui'
import { CalendarCheck, ClipboardList, FileText, LayoutGrid, Stethoscope } from '@tamagui/lucide-icons'
import { SECTIONS, type NavSectionId } from '../manifest'
import type { Translator } from '../lib/i18n'
import { PAGE_MAX_WIDTH } from './PageShell'

// Typed off a real icon so the map needs neither the icon prop type nor the
// global JSX namespace. The section `icon` names are resolved here, inside the
// panel, so they are not bound to Daguito's closed custom-panel icon registry.
type IconComponent = typeof LayoutGrid

const ICONS: Record<string, IconComponent> = {
  Stethoscope,
  FileText,
  CalendarCheck,
  ClipboardList,
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
  // under the finger that just touched it.
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
        style={{ position: 'sticky', top: 0 }}
        zIndex={20}
        justifyContent="center"
        paddingHorizontal="$4"
        paddingTop={14}
        paddingBottom={10}
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
        $md={{ paddingHorizontal: '$1.5', paddingTop: 8, paddingBottom: 8 }}
      >
        <XStack
          flex={1}
          maxWidth={PAGE_MAX_WIDTH}
          gap={4}
          flexWrap="nowrap"
          overflow="scroll"
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
                aria-label={i18n.t(section.labelKey)}
                aria-current={selected}
                tabIndex={0}
                cursor="pointer"
                flex={1}
                minWidth={132}
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
                borderRadius={999}
                backgroundColor={selected ? '$color4' : 'transparent'}
                hoverStyle={{
                  backgroundColor: selected ? '$color4' : '$color2',
                }}
                pressStyle={{ backgroundColor: '$color5' }}
                outlineStyle="none"
                focusVisibleStyle={{
                  outlineStyle: 'solid',
                  outlineWidth: 2,
                  outlineColor: '$borderColorFocus',
                  outlineOffset: 1,
                }}
                onPress={() => onSelect(section.id)}
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
