import { useEffect, type ReactNode } from 'react'
import { Stack, Text, XStack, YStack } from 'tamagui'
import { X } from '@tamagui/lucide-icons'
import { ensureCommonKeyframes } from '../lib/keyframes'
import { useIsMobile } from '../hooks/useIsMobile'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_MAX_WIDTH: Record<ModalSize, number> = {
  sm: 380,
  md: 560,
  lg: 720,
  xl: 960,
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  /** Replaces the default header (title + close X) entirely. */
  header?: ReactNode
  /** Sticky footer rendered below the scrollable body. Usually action buttons. */
  footer?: ReactNode
  /** Body content. The body is automatically scrollable when it overflows. */
  children?: ReactNode
  size?: ModalSize
  /** Closes when clicking the backdrop. Defaults to true. */
  closeOnBackdrop?: boolean
  /**
   * Pads the scrollable body. Defaults to true. Set false when the children
   * bring their own edge-to-edge chrome (e.g. a detail view with its own
   * header + padded sections) so it isn't double-padded.
   */
  bodyPadding?: boolean
  /**
   * Overrides the horizontal gutter shared by header, body and footer.
   * Defaults to the responsive `$5` (mobile) / `$4` (desktop). Pass a smaller
   * token to tighten a compact form without touching every other modal.
   */
  gutterX?: string
  /** Overrides the header's vertical padding. Defaults to `$3`. */
  headerPaddingVertical?: string
}

/**
 * Modal — fixed-position dialog with bounded height.
 *
 * Why this shape:
 *  - Height is capped at 90vh so tall forms scroll INSIDE the modal — the
 *    footer (with Cancel / Submit) stays visible no matter how long the body.
 *  - Header and footer are sticky; only the middle body scrolls.
 *  - Backdrop click closes by default (override with `closeOnBackdrop={false}`
 *    for unsaved-state guards).
 *
 * Use this instead of hand-rolled `position: fixed` overlays. The previous
 * pattern (each modal building its own overlay + sizing) drifted: some had
 * scroll, some didn't, some footers slid off-screen.
 */
export function Modal({
  open,
  onClose,
  title,
  header,
  footer,
  children,
  size = 'md',
  closeOnBackdrop = true,
  bodyPadding = true,
  gutterX,
  headerPaddingVertical = '$3',
}: ModalProps) {
  const { isMobile } = useIsMobile()
  useEffect(() => {
    if (open) ensureCommonKeyframes()
  }, [open])

  // Lock the background while open. Without this, focusing an input inside the
  // modal on a phone makes the browser scroll the page BEHIND it (iOS shifts
  // the document to reveal the focused field, and the keyboard resizes the
  // viewport), so the content behind the modal visibly jumps around. Pinning
  // the body with `position: fixed` freezes it; we restore the scroll offset on
  // close. Imperative on `body` because there is no Tamagui hook for the
  // document element (same reason the overlay below is a raw `<div>`).
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const { body } = document
    const scrollY = window.scrollY
    // Reserve the space the scrollbar occupied so pinning the body doesn't
    // widen the page by the scrollbar width (a horizontal jump on desktop).
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    }
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      Object.assign(body.style, prev)
      window.scrollTo(0, scrollY)
    }
  }, [open])

  if (!open) return null
  const showDefaultHeader = !header && (title || onClose)
  // Full-bleed on mobile puts the content flush against the screen edges, so it
  // needs a wider gutter than the desktop card to breathe.
  const padX = gutterX ?? (isMobile ? '$5' : '$4')
  return (
    <div
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,10,10,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        // Full-bleed on a phone: the centered card leaves too little room for
        // tall forms, so the modal takes the whole viewport instead.
        padding: isMobile ? 0 : 20,
      }}
    >
      <YStack
        width="100%"
        maxWidth={isMobile ? undefined : SIZE_MAX_WIDTH[size]}
        height={isMobile ? '100dvh' : undefined}
        maxHeight={isMobile ? '100dvh' : '90vh'}
        backgroundColor="$color1"
        borderRadius={isMobile ? 0 : 14}
        borderWidth={isMobile ? 0 : 1}
        borderColor="$borderColor"
        paddingBottom={isMobile ? ('env(safe-area-inset-bottom, 0px)' as never) : undefined}
        overflow="hidden"
      >
        {header ? (
          <Stack
            borderBottomWidth={1}
            borderBottomColor="$borderColor"
            paddingHorizontal={padX}
            paddingVertical={headerPaddingVertical}
          >
            {header}
          </Stack>
        ) : showDefaultHeader ? (
          <XStack
            alignItems="center"
            justifyContent="space-between"
            paddingHorizontal={padX}
            paddingVertical={headerPaddingVertical}
            borderBottomWidth={1}
            borderBottomColor="$borderColor"
            gap="$2"
          >
            {title ? (
              <Text fontSize={15} fontWeight="800" color="$color" letterSpacing={-0.3}>
                {title}
              </Text>
            ) : (
              <Stack flex={1} />
            )}
            <Stack
              cursor="pointer"
              padding="$1"
              borderRadius={6}
              hoverStyle={{ backgroundColor: '$color3' }}
              onPress={onClose}
            >
              <X size={14} color="$color11" />
            </Stack>
          </XStack>
        ) : null}

        <YStack
          flex={1}
          overflow="scroll"
          paddingHorizontal={bodyPadding ? padX : 0}
          paddingVertical={bodyPadding ? '$3' : 0}
          gap={bodyPadding ? '$3' : 0}
        >
          {children}
        </YStack>

        {footer ? (
          <XStack
            gap="$2"
            justifyContent="flex-end"
            alignItems="center"
            paddingHorizontal={padX}
            paddingVertical="$3"
            borderTopWidth={1}
            borderTopColor="$borderColor"
            backgroundColor="$color2"
          >
            {footer}
          </XStack>
        ) : null}
      </YStack>
    </div>
  )
}
