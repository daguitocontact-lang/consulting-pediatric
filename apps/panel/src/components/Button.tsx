// The panel's Button: Daguito's vendored one, painted from the theme.
//
// The frame and the label ARE the core's (`ButtonFrame` / `ButtonText`), so
// sizes, shapes, `fullWidth`, `disabled`, the press animation and the loading
// text all stay whatever Daguito says they are — and src/ui/ stays a byte-for-
// byte copy that scripts/sync-ui.sh can overwrite.
//
// What this adds is the two variants whose colors were hardcoded to one theme:
// `primary` and `secondary` read the fixed teal ramp, which left secondary's
// hover flashing a near-white pill on a black panel and primary too muted to
// pass contrast against it. Those colors now come from theme keys
// (theme/actions.ts), so light and dark each get their own.
//
// `ghost` and `neutral` are untouched: they already resolve through
// `$background`/`$color`, which are theme-aware. `danger` is repainted too,
// from a filled red to an outlined one (see PAINT).
import { cloneElement, isValidElement, type ReactNode } from 'react'
import { ButtonFrame, ButtonText, type ButtonProps } from '../ui/components/Button'

/** Only these two carried theme-blind colors; the rest keep the core's. */
const REPAINTED = ['primary', 'secondary', 'danger'] as const
type RepaintedVariant = (typeof REPAINTED)[number]

const isRepainted = (variant: string): variant is RepaintedVariant =>
  (REPAINTED as readonly string[]).includes(variant)

/**
 * The focus ring, on KEYBOARD focus only.
 *
 * The core paints it on `:focus`, and on the web a mouse click focuses too: press
 * «›» on the calendar and the button stays haloed until something else is
 * clicked — "siempre queda ahí". Every other control on the panel (chips, tabs,
 * tiles, the nav) already rings on `:focus-visible`; buttons now match. The
 * plain-focus ring is zeroed rather than left alone because the variant's own
 * `focusStyle` would otherwise still draw it.
 */
const ring = (outlineColor: string) =>
  ({
    focusStyle: { outlineWidth: 0 },
    focusVisibleStyle: { outlineColor, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 2 },
  }) as const

/** Frame colors and label ink, looked up together so one guard narrows both. */
const PAINT = {
  primary: {
    backgroundColor: '$actionFill',
    borderColor: '$actionFill',
    hoverStyle: { backgroundColor: '$actionFillHover', borderColor: '$actionFillHover' },
    pressStyle: { backgroundColor: '$actionFillPress', borderColor: '$actionFillPress' },
    ...ring('$actionRing'),
    ink: '$actionInk',
  },
  secondary: {
    backgroundColor: 'transparent',
    borderColor: '$actionText',
    hoverStyle: { backgroundColor: '$actionSurfaceHover', borderColor: '$actionText' },
    pressStyle: { backgroundColor: '$actionSurfacePress', borderColor: '$actionText' },
    ...ring('$actionRing'),
    ink: '$actionText',
  },
  // Quiet until hovered: red ink and a faint red edge, the fill only on hover.
  // The core's filled danger is a stop sign; on a board with one delete per
  // card it was the loudest thing on every card.
  danger: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(239,68,68,0.35)',
    hoverStyle: { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: '$error500' },
    pressStyle: { backgroundColor: 'rgba(239,68,68,0.2)', borderColor: '$error500' },
    ...ring('$error500'),
    ink: '$error500',
  },
} as const

export function Button({
  label,
  loading = false,
  loadingText = 'Loading...',
  variant = 'primary',
  size = 'md',
  shape = 'default',
  fullWidth,
  disabled,
  iconBefore,
  iconAfter,
  children,
  ...rest
}: ButtonProps): React.ReactElement {
  const isDisabled = disabled || loading
  // The frame keeps its variant either way: it is what carries the size, the
  // radius and the disabled treatment. The color props layered on top win over
  // the variant's, which is the whole override.
  // `ghost` and `neutral` keep the core's colours but take the same ring rule.
  const { ink, ...frame } = isRepainted(variant)
    ? PAINT[variant]
    : { ink: undefined, ...ring('$actionRing') }
  // The icons take the label's ink. Left alone, a lucide icon paints with the
  // page's text colour, which is how a white plus ended up on the mint
  // primary button.
  const painted = (icon: ReactNode) =>
    ink && isValidElement<{ color?: string }>(icon) && icon.props.color === undefined
      ? cloneElement(icon, { color: ink })
      : icon
  // An icon-only button passes its icon as the child; it takes the ink too.
  const content: ReactNode = loading ? loadingText : (label ?? painted(children))

  // One shape for every button on the panel: 8px corners (6px on the small
  // ones), not the core's pill. The pill is kept for the switches that ARE
  // pills here — chips, the section bar — so a button and a filter never look
  // like the same control. `shape="pill"` still asks for one explicitly.
  const radius = shape === 'pill' ? undefined : size === 'xs' || size === 'sm' ? 6 : 8

  return (
    <ButtonFrame
      variant={variant}
      size={size}
      shape={shape}
      fullWidth={fullWidth}
      disabled={isDisabled}
      aria-busy={loading}
      aria-disabled={isDisabled}
      borderRadius={radius}
      {...frame}
      {...rest}
    >
      {painted(iconBefore)}
      <ButtonText variant={variant} size={size} color={ink}>
        {content}
      </ButtonText>
      {painted(iconAfter)}
    </ButtonFrame>
  )
}

Button.displayName = 'Button'

export type { ButtonProps }
