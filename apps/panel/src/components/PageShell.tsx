// Page chrome shared by every panel page: title, one-line subtitle, an actions
// slot and the body.
//
// The core's PageHeader is not vendored: it depends on PageChromeContext and a
// scroll notifier that only exist inside Daguito's shell. This is the same
// layout rebuilt on Tamagui primitives — the parts that carry the design system
// (tokens, type scale, spacing) come from the config, so it still matches.
import type { ReactNode } from 'react'
import { Text, XStack, YStack } from 'tamagui'

/**
 * The page has a reading width, and it is centred.
 *
 * Full-bleed was tried: on a 2000px monitor every list stretched edge to edge,
 * the flex columns swelled into a hand's width of nothing between a booking
 * and its dates, and the tiles, the chips and the title crowded the left edge
 * while the search sat alone at the far right — "muy amontonado". 1520px is
 * wide enough for the nine-column reservations list without truncating, and
 * narrow enough that the row reads as one line instead of a scan.
 */
export const PAGE_MAX_WIDTH = 1520

export function PageShell({
  title,
  titleAside,
  subtitle,
  actions,
  repeatsSection,
  children,
}: {
  title: string
  /** Drawn on the title line, after the text: a status badge, a count. */
  titleAside?: ReactNode
  /**
   * The title says the same thing as the open pill in the section bar right
   * above it, so on a phone it is a heading that costs a line and adds nothing.
   * Hidden there, kept on a wide screen where the room is free. Set only on the
   * section-level pages: a detail screen's title names the record rather than
   * the section, and has to show everywhere.
   */
  repeatsSection?: boolean
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    // Centred column with real margins: 36px at the sides and 24px between
    // blocks, so the title, the tiles, the chips and the table read as four
    // things and not as one pile. Narrower on a phone, where 20px is what keeps
    // a table from losing a column to its own padding at 390px.
    <YStack flex={1} width="100%" alignItems="center">
      <YStack
        flex={1}
        width="100%"
        maxWidth={PAGE_MAX_WIDTH}
        paddingHorizontal="$4"
        paddingVertical="$3.5"
        gap="$2.5"
        $sm={{ padding: '$2', gap: '$1.5' }}
      >
        <XStack
          alignItems="flex-start"
          justifyContent="space-between"
          gap="$1.5"
          flexWrap="wrap"
          marginBottom="$0.5"
        >
          <YStack gap="$0.25">
            <XStack gap="$0.75" alignItems="center" flexWrap="wrap">
              <Text
                fontSize={24}
                fontWeight="700"
                letterSpacing={-0.3}
                color="$color"
                $sm={repeatsSection ? { display: 'none' } : undefined}
              >
                {title}
              </Text>
              {titleAside}
            </XStack>
            {subtitle ? (
              <Text fontSize={13} color="$color11">
                {subtitle}
              </Text>
            ) : null}
          </YStack>
          {actions ? (
            // Stacked and full width on a phone: side by side they fought over
            // a 390px row, the search shrank to a slot and the button was
            // pushed off the edge. One control per line, each the width of the
            // screen, is also the easiest thing to hit with a thumb.
            <XStack
              gap="$0.75"
              alignItems="center"
              flexWrap="wrap"
              $sm={{ flexDirection: 'column', alignItems: 'stretch', width: '100%', gap: 10 }}
            >
              {actions}
            </XStack>
          ) : null}
        </XStack>
        {children}
      </YStack>
    </YStack>
  )
}

/** Error surface with the semantic tokens the core uses for failures. */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <YStack backgroundColor="$error100" padding="$1.5" borderRadius="$4">
      <Text fontSize={14} color="$error700">
        {children}
      </Text>
    </YStack>
  )
}
