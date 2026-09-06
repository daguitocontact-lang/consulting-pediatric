// The four numbers reception opens the day with, as pressable tiles.
//
// They exist here because the arrivals board is no longer in the menu: the
// question it answered ("who comes in today, who leaves, who is in the house")
// is the first thing asked of the reservations screen, and a tile that filters
// the list on press answers it without a second page.
//
// One card, four cells: an icon in a tinted square, the number, the label
// under it. The tint is the tile's meaning (blue for in the house, amber for
// what still needs an answer), and the pressed tile is the one whose square
// takes the accent.
import type { ReactNode } from 'react'
import { Text, XStack, YStack } from 'tamagui'

export type StatTone = 'neutral' | 'info' | 'warning'

const TONE: Record<StatTone, { background: string; color: string }> = {
  neutral: { background: '$color3', color: '$color' },
  info: { background: 'rgba(96,165,250,0.18)', color: '#60A5FA' },
  warning: { background: 'rgba(251,191,36,0.18)', color: '#FBBF24' },
}

export function StatTiles({
  tiles,
  value,
  onChange,
}: {
  tiles: { value: string; label: string; count: number; icon?: ReactNode; tone?: StatTone }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    // Four separate cards on a phone rather than four cells sharing one frame:
    // each tile is its own filter, and a card with its own edge reads as
    // something you press. One frame with hairlines reads as a table.
    <XStack flexWrap="wrap" gap={0} $sm={{ gap: 10 }}>
      {tiles.map((tile, index) => {
        const active = tile.value === value
        const tone = TONE[tile.tone ?? 'neutral']
        return (
          <XStack
            key={tile.value}
            role="button"
            aria-pressed={active}
            tabIndex={0}
            flexGrow={1}
            // 200 fits two across a laptop but only ONE across a 390px phone,
            // so the four tiles became four rows and ate half the screen before
            // the list started. 140 keeps two per row there and changes nothing
            // wider, where they still share the width.
            flexBasis={200}
            // A percentage rather than a pixel basis: 140px happens to fit three
            // across a 560px screen and two across a 390px one, so the four
            // tiles came out 3 + 1 in between. 45% is two per row at every
            // phone width.
            $sm={{ flexBasis: '45%', paddingVertical: 10, paddingHorizontal: 12, gap: 6 }}
            gap={14}
            alignItems="center"
            paddingVertical={18}
            paddingHorizontal={22}
            borderLeftWidth={index === 0 ? 0 : 1}
            borderLeftColor="$borderColor"
            $md={{
              borderWidth: 1,
              borderLeftWidth: 1,
              borderColor: '$borderColor',
              borderRadius: 14,
              backgroundColor: '$color1',
            }}
            cursor="pointer"
            backgroundColor={active ? '$color2' : '$color1'}
            hoverStyle={{ backgroundColor: '$color2' }}
            outlineStyle="none"
            focusVisibleStyle={{
              outlineStyle: 'solid',
              outlineWidth: 2,
              outlineColor: '$borderColorFocus',
              outlineOffset: -2,
            }}
            onPress={() => onChange(active ? '' : tile.value)}
            onKeyDown={
              ((event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onChange(active ? '' : tile.value)
                }
              }) as never
            }
          >
            {tile.icon ? (
              <XStack
                width={38}
                height={38}
                // 26, not 30: the four pixels are what "Por confirmar" — the
                // longest label, and the one beside the widest number — needs
                // to stay on one line, and a tile that wraps its label is
                // taller than the three that did not.
                $sm={{ width: 26, height: 26, borderRadius: 8 }}
                borderRadius={10}
                alignItems="center"
                justifyContent="center"
                backgroundColor={active ? '$actionSurfaceHover' : tone.background}
                borderWidth={1}
                borderColor={active ? '$actionText' : 'transparent'}
                flexShrink={0}
              >
                <YStack>{tile.icon}</YStack>
              </XStack>
            ) : null}
            {/* One line on a phone — "2 Llegan hoy" — instead of the number
                stacked over its label. Four tiles two rows deep took 300px of
                a 844px screen before the first booking; laid out flat they
                take a third of that and say the same thing. */}
            <YStack
              gap={2}
              minWidth={0}
              $sm={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1 }}
            >
              <Text
                fontSize={24}
                $sm={{ fontSize: 20, lineHeight: 24 }}
                fontWeight="600"
                lineHeight={28}
                letterSpacing={-0.4}
                color={tile.count === 0 ? '$color11' : active ? '$actionText' : '$color'}
              >
                {tile.count}
              </Text>
              {/* 12px, not 13: "Por confirmar" is the longest label reception
                  has, and at 13 it wrapped — which made one row of tiles
                  taller than the other for the sake of two pixels. */}
              <Text fontSize={14} $sm={{ fontSize: 12 }} color="$color11" numberOfLines={2}>
                {tile.label}
              </Text>
            </YStack>
          </XStack>
        )
      })}
    </XStack>
  )
}

/** The colour an icon takes inside its tile, so the caller can paint it. */
export function statIconColor(tone: StatTone = 'neutral'): string {
  return TONE[tone].color
}
