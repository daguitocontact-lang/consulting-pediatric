/**
 * The chart pieces the metrics page is built from.
 *
 * Hand-drawn on Tamagui stacks rather than pulled from a chart library. The
 * panel is a runtime-loaded ESM bundle the host imports over the network and
 * already costs ~227 kB gzip for React + Tamagui; a charting dependency is
 * another 50–100 kB for four shapes — bars, a track, a tick and a tooltip —
 * that are twenty lines of flexbox each. It also keeps the theme honest: these
 * read the same tokens as every other surface, so they follow the host's
 * light/dark toggle with nothing to configure.
 *
 * COLOUR follows the HOST. Daguito paints its own metrics in ink — `$color` on
 * a `$color3` track (ChannelBreakdown) and a near-black/near-white line under a
 * fading fill (VolumeChart), both in apps/web/src/pages/home/charts.tsx — and
 * keeps colour for status. The panel renders inside that page, so charts in the
 * accent teal read as a foreign widget bolted on. Ink also solves what the
 * accent could not: one hue at one lightness has to work on both surfaces,
 * while ink flips with the theme and is always maximal contrast.
 *
 * With the mark itself in ink, the comparison mark cannot also be ink: it flips
 * to the page background where it overlaps the fill and back to ink past the
 * end. Identity still comes from each row's own label, so nothing is encoded in
 * colour alone and there is no legend to read.
 *
 * Every delta also carries its sign and an arrow in the text, so the good/bad
 * colouring is never the only thing saying which way a number moved.
 */
import { useState } from 'react'
import { Text, XStack, YStack } from 'tamagui'
import { tokens } from '../ui/tokens'

/** How a raw number becomes the string on screen. */
export type Format = (value: number) => string

export type Trend = { current: number; previous: number }

/**
 * Which direction is good. Revenue up is good, cancellations up is not, and a
 * lead time has no direction worth colouring — so it says `neutral` and the
 * chip stays grey rather than congratulating the operator on an arbitrary sign.
 */
export type Direction = 'up-good' | 'up-bad' | 'neutral'

function deltaOf(trend: Trend): number | null {
  // No baseline means no percentage. "+100%" against zero is a division the
  // operator would read as growth when the truth is "there was nothing before".
  if (trend.previous === 0) return null
  return ((trend.current - trend.previous) / Math.abs(trend.previous)) * 100
}

export function DeltaChip({
  trend,
  direction = 'up-good',
  newLabel,
  flatLabel,
}: {
  trend: Trend
  direction?: Direction
  /** Shown when there is no baseline to divide by. */
  newLabel: string
  /** Shown when both sides are zero — nothing happened either period. */
  flatLabel: string
}) {
  const delta = deltaOf(trend)

  if (delta === null) {
    const label = trend.current === 0 ? flatLabel : newLabel
    return <Chip tone="muted" text={label} />
  }

  const rounded = Math.round(delta)
  if (rounded === 0) return <Chip tone="muted" text="0%" />

  const up = rounded > 0
  const tone = direction === 'neutral' ? 'muted' : (direction === 'up-good') === up ? 'good' : 'bad'
  // The arrow is part of the string, not an icon beside it: the direction has to
  // survive a screenshot in greyscale and a reader who cannot see the tint.
  return <Chip tone={tone} text={`${up ? '↑' : '↓'} ${Math.abs(rounded)}%`} />
}

function Chip({ tone, text }: { tone: 'good' | 'bad' | 'muted'; text: string }) {
  const palette = {
    good: { bg: '$success100', ink: '$success700' },
    bad: { bg: '$error100', ink: '$error700' },
    muted: { bg: '$color3', ink: '$color11' },
  }[tone]
  return (
    <XStack
      backgroundColor={palette.bg}
      paddingHorizontal={7}
      paddingVertical={2}
      borderRadius={999}
      alignItems="center"
    >
      <Text fontSize={12} fontWeight="700" color={palette.ink}>
        {text}
      </Text>
    </XStack>
  )
}

/**
 * One number, what it was, and the move between them.
 *
 * The previous value is spelled out under the delta on purpose. A bare "+39%"
 * is unauditable — it can hide a jump from 1 to 1.4 — and the baseline is the
 * first thing anyone asks for when a percentage looks surprising.
 */
export function MetricTile({
  label,
  value,
  trend,
  format,
  direction = 'up-good',
  beforeLabel,
  newLabel,
  flatLabel,
  spark,
  note,
}: {
  label: string
  value: string
  trend?: Trend
  format?: Format
  direction?: Direction
  /** "antes {value}" — the caller owns the copy. */
  beforeLabel?: (formatted: string) => string
  newLabel: string
  flatLabel: string
  /** One value per day of the period, drawn beside the number. The shape is
   *  the point — a month that sold everything on the 2nd and a month that sold
   *  steadily are the same total and a different business. */
  spark?: number[]
  /** A line under the number for what a delta cannot say (a date range). */
  note?: string
}) {
  return (
    <YStack
      flex={1}
      minWidth={158}
      // No maxWidth: capped tiles left a ragged strip of dead page at the right
      // of every row on a wide screen. `flex: 1` off a shared minWidth makes
      // each row divide its full width evenly instead.
      gap="$0.5"
      padding="$1.5"
      borderRadius="$4"
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$color1"
    >
      <Text fontSize={12} color="$color11" textTransform="uppercase" letterSpacing={0.5}>
        {label}
      </Text>
      <XStack alignItems="center" gap="$1">
        <Text fontSize={24} fontWeight="600" letterSpacing={-0.4} color="$color" flexShrink={0}>
          {value}
        </Text>
        {spark ? (
          <YStack flex={1} minWidth={40} height={30} justifyContent="center">
            <Sparkline values={spark} trend={trend} direction={direction} />
          </YStack>
        ) : null}
      </XStack>
      {note ? (
        <Text fontSize={12} color="$color11">
          {note}
        </Text>
      ) : null}
      {trend ? (
        <XStack gap="$0.5" alignItems="center" flexWrap="wrap">
          <DeltaChip
            trend={trend}
            direction={direction}
            newLabel={newLabel}
            flatLabel={flatLabel}
          />
          {beforeLabel && format ? (
            <Text fontSize={12} color="$color11">
              {beforeLabel(format(trend.previous))}
            </Text>
          ) : null}
        </XStack>
      ) : null}
    </YStack>
  )
}

/**
 * The line inside a tile: no axis, no grid, no readout.
 *
 * It answers "how did we get to this number", not "what was it on the 12th" —
 * so it is drawn in the delta's own colour and nothing else. A flat run of
 * zeros still draws a line on the floor rather than nothing, because an empty
 * card and a card with no sales are different facts.
 */
export function Sparkline({
  values,
  trend,
  direction = 'up-good',
  height = 30,
}: {
  values: number[]
  trend?: Trend
  direction?: Direction
  height?: number
}) {
  if (values.length < 2) return null
  const max = values.reduce((m, v) => Math.max(m, v), 0)
  const top = max > 0 ? max : 1
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100
      const y = 28 - (value / top) * 24
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
  // Same reading as the chip beside it: up is good unless the caller says the
  // opposite, and a period with nothing to compare against is drawn neutral.
  const delta = trend ? trend.current - trend.previous : 0
  const good = direction === 'up-bad' ? delta < 0 : delta > 0
  const stroke = !trend || delta === 0 ? '#94a3b8' : good ? '#16a34a' : '#e11d48'
  return (
    <svg
      viewBox="0 0 100 30"
      width="100%"
      height={height}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <path
        d={points}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** Tiles wrap instead of scrolling: three across a laptop, one on a phone. */
export function TileRow({ children }: { children: React.ReactNode }) {
  return (
    <XStack gap="$1" flexWrap="wrap">
      {children}
    </XStack>
  )
}

/**
 * Volume over time as a smooth filled area line with a scrubber.
 *
 * Rebuilt to match Daguito's own charts (apps/web/src/pages/home/charts.tsx):
 * the host draws its metrics this way and the panel sits INSIDE the host, so a
 * different chart idiom two centimetres from theirs reads as a foreign widget.
 * Same geometry, same gutter, same scrubber, same ink.
 *
 * Ink, not the accent. Daguito paints its data marks in `$color` — near-black on
 * light, near-white on dark — and reserves colour for status. It also sidesteps
 * the problem the flat teal bars had: a single hue at one lightness has to work
 * on both surfaces, while ink flips with the theme and is always maximal
 * contrast.
 *
 * `preserveAspectRatio="none"` is why the Y labels are HTML in a fixed gutter
 * rather than SVG `<text>`: the plot stretches to its box, and any glyph drawn
 * inside would stretch with it. They sit at the fractions the gridlines use, so
 * label and line always agree.
 *
 * Hover is a native `mousemove` on the SVG mapping cursor X to the nearest
 * point, not Tamagui's `onHoverIn` — the host learned that `onHoverIn` does not
 * fire reliably on an SVG. Touch is ours: the operator reads this on a phone,
 * where there is no cursor to follow.
 */

/** Plot geometry, in viewBox units. Matches the host's chart exactly. */
const PLOT_H = 100
// 8, not the host's 12: their chart sits in a short dashboard panel where the
// scrubber dot needs the clearance. This one is given real height, and 24% of
// it as blank margin was most of why it read as an empty box.
const PLOT_PAD = 8
/** Width of the Y-label gutter. The X axis is padded by the same amount. */
const Y_AXIS_W = 40

/**
 * Gridline (and Y-label) fractions.
 *
 * Five, not the host's three. Their plot is ~70px tall, where three lines is
 * already a line every 23px; at the height this one gets, three left large
 * empty bands and nothing to read a mid-value against.
 */
const GRID = [0, 0.25, 0.5, 0.75, 1] as const

/** X position (0..100) of point `i` across `n` points. */
function xFrac(i: number, n: number): number {
  return n <= 1 ? 0 : (i / (n - 1)) * 100
}

/** Y position of `v` within the padded plot, inverted (0 at the top). */
function yPlot(v: number, max: number): number {
  const usable = PLOT_H - PLOT_PAD * 2
  const ratio = max > 0 ? v / max : 0
  return PLOT_PAD + (1 - ratio) * usable
}

/**
 * Straight segments. For a CUMULATIVE series the spline is not a nicety but a
 * lie: a month that sold nothing until the 24th is a step, and a curve through
 * a step dips below zero on its way up — drawing a fall in a total that can
 * only ever rise.
 */
function stepPath(values: number[], max: number): string {
  if (values.length === 0) return ''
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFrac(i, values.length)} ${yPlot(v, max)}`)
    .join(' ')
}

/** Smooth Catmull-Rom-ish path through the values. */
function linePath(values: number[], max: number): string {
  const pts = values.map((v, i) => ({ x: xFrac(i, values.length), y: yPlot(v, max) }))
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M 0 ${pts[0]!.y} L 100 ${pts[0]!.y}`
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6},`
    d += ` ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6},`
    d += ` ${p2.x} ${p2.y}`
  }
  return d
}

/** The line closed down to the baseline, for the gradient fill. */
function areaPath(values: number[], max: number, smooth = true): string {
  const line = smooth ? linePath(values, max) : stepPath(values, max)
  if (!line) return ''
  const n = values.length
  return `${line} L ${xFrac(n - 1, n)} ${PLOT_H} L ${xFrac(0, n)} ${PLOT_H} Z`
}

/**
 * At most `max` evenly-spaced labels, always including the first and last, with
 * repeats blanked. Labelling all thirty days collides into a grey smear.
 */
function axisLabels(labels: string[], max = 6): string[] {
  const total = labels.length
  const shown = new Set<number>()
  if (total <= max) {
    labels.forEach((_, i) => shown.add(i))
  } else {
    const step = (total - 1) / (max - 1)
    for (let k = 0; k < max; k += 1) shown.add(Math.round(k * step))
  }
  let prev = ''
  return labels.map((label, i) => {
    if (!shown.has(i)) return ''
    if (label === prev) return ''
    prev = label
    return label
  })
}

export function SeriesChart({
  points,
  compare,
  seriesLabel,
  smooth = true,
  maxAxisLabels = 6,
  format,
  axisFormat,
  emptyLabel,
  hint,
  mode,
  height = 150,
}: {
  points: { day: string; value: number; label: string; axisLabel?: string }[]
  /**
   * A second line under the first — the period this one is being read against.
   * It shares the scale, which is the whole point: two charts side by side with
   * their own maxima is how "we doubled" gets drawn as "we drew level".
   */
  compare?: { values: number[]; label: string }
  /** Names the main line. Only used to label the legend a comparison needs. */
  seriesLabel?: string
  /** Off for running totals — see stepPath. */
  smooth?: boolean
  /** How many ticks the X axis may show. A month of days fits 31; a series of
   *  dates does not, and collides into a grey smear at more than six. */
  maxAxisLabels?: number
  /** Full value, for the readout. */
  format: Format
  /** Compact value, for the Y gutter. */
  axisFormat: Format
  emptyLabel: string
  /** Shown in the readout slot until something is hovered. */
  hint: string
  /** The host's theme, so the ink flips with it. */
  mode: 'light' | 'dark'
  height?: number
}) {
  const [active, setActive] = useState<number | null>(null)

  const ink = mode === 'dark' ? '#fafafa' : '#0a0a0a'
  const grid = mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)'
  /**
   * With TWO periods on one plot the reading changes: the line being asked
   * about is the accent, the one it is measured against is ink — the same
   * split the system they read today uses. Alone, the series stays ink under
   * its fill, which is how every other chart in the host is drawn.
   */
  const accent = tokens.color.teal600.val as string
  const line = compare ? accent : ink

  const values = points.map((p) => p.value)
  const past = compare?.values ?? []
  const max = [...values, ...past].reduce((m, v) => Math.max(m, v), 0)
  const n = points.length

  if (!n || max <= 0) {
    return (
      <YStack height={height} justifyContent="center">
        <Text fontSize={13} color="$color11">
          {emptyLabel}
        </Text>
      </YStack>
    )
  }

  const current = active !== null ? points[active] : undefined
  const labels = axisLabels(
    points.map((p) => p.axisLabel ?? p.label),
    maxAxisLabels,
  )

  /** Cursor/finger X within the plot → the nearest point's index. */
  const pick = (clientX: number, rect: DOMRect) => {
    if (rect.width === 0) return
    const ratio = (clientX - rect.left) / rect.width
    setActive(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))))
  }

  return (
    <YStack gap="$1">
      {/* Fixed height and clipped: the readout must never be what decides how
          wide the card is, or the layout twitches as the cursor moves. */}
      {/* Two lines need saying which is which — the titles above the card name
          both periods, but not which colour got which. */}
      {compare && seriesLabel ? (
        <XStack gap="$1.5" alignItems="center" flexWrap="wrap" flexShrink={0}>
          <LegendDot color={line} label={seriesLabel} />
          <LegendDot color={ink} label={compare.label} />
        </XStack>
      ) : null}

      <XStack height={18} overflow="hidden" alignItems="center" gap="$0.75" flexShrink={0}>
        {current ? (
          <>
            <Text fontSize={14} fontWeight="800" color="$color" flexShrink={0}>
              {format(current.value)}
            </Text>
            <Text fontSize={12} color="$color11" numberOfLines={1} flex={1} minWidth={0}>
              {compare && active !== null && past[active] !== undefined
                ? `${current.label} · ${compare.label} ${format(past[active]!)}`
                : current.label}
            </Text>
          </>
        ) : (
          <Text fontSize={12} color="$color11" numberOfLines={1}>
            {hint}
          </Text>
        )}
      </XStack>

      <XStack height={height} width="100%">
        {/* Y gutter: HTML, at the same fractions as the gridlines below. */}
        <YStack width={Y_AXIS_W} flexShrink={0} position="relative">
          {[...GRID].reverse().map((f) => (
            <Text
              key={f}
              position="absolute"
              top={`${(yPlot(f * max, max) / PLOT_H) * 100}%`}
              right="$0.75"
              y={-6}
              fontSize={9}
              color="$color11"
              numberOfLines={1}
            >
              {axisFormat(f * max)}
            </Text>
          ))}
        </YStack>

        <YStack flex={1} minWidth={0}>
          <svg
            viewBox={`0 0 100 ${PLOT_H}`}
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            style={{ display: 'block', touchAction: 'pan-y' }}
            onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => setActive(null)}
            onTouchStart={(e) => {
              const touch = e.touches[0]
              if (touch) pick(touch.clientX, e.currentTarget.getBoundingClientRect())
            }}
            onTouchMove={(e) => {
              const touch = e.touches[0]
              if (touch) pick(touch.clientX, e.currentTarget.getBoundingClientRect())
            }}
            // No `onTouchEnd`: clearing on release makes a tap flash the value
            // and wipe it before it can be read. The readout stays until the
            // next scrub, which on a phone is what "tap to inspect" means.
          >
            <defs>
              <linearGradient
                id="pediatric-series-fill"
                x1="0"
                y1={PLOT_PAD}
                x2="0"
                y2={PLOT_H}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor={ink} stopOpacity="0.18" />
                <stop offset="100%" stopColor={ink} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* `vectorEffect` on every stroke: the viewBox is stretched to the
                box, so an unqualified 1px line comes out thick and blurry. */}
            {GRID.map((f) => (
              <line
                key={f}
                x1={0}
                y1={yPlot(f * max, max)}
                x2={100}
                y2={yPlot(f * max, max)}
                stroke={grid}
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {/* Last period first, so the line being read is never crossed by
                it. Solid and full weight, like the board they read today: it
                is the other half of the comparison, not a ghost. */}
            {compare && past.length > 1 ? (
              <path
                d={smooth ? linePath(past, max) : stepPath(past, max)}
                fill="none"
                stroke={ink}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {/* No fill under a comparison: two filled curves stacked read as
                one shaded area and the line underneath disappears into it. */}
            {compare ? null : (
              <path d={areaPath(values, max, smooth)} fill="url(#pediatric-series-fill)" />
            )}
            <path
              d={smooth ? linePath(values, max) : stepPath(values, max)}
              fill="none"
              stroke={line}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {current ? (
              <>
                <line
                  x1={xFrac(active ?? 0, n)}
                  y1={0}
                  x2={xFrac(active ?? 0, n)}
                  y2={PLOT_H}
                  stroke={grid}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
                {/* A hairline circle grown by its own stroke: a real `r` would
                    be squashed into an ellipse by the stretched viewBox. */}
                <circle
                  cx={xFrac(active ?? 0, n)}
                  cy={yPlot(current.value, max)}
                  r={0.1}
                  fill={line}
                  stroke={line}
                  strokeWidth={7}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              </>
            ) : null}
          </svg>
        </YStack>
      </XStack>

      {/* Offset by the gutter so each date sits under its own point. */}
      <XStack width="100%" overflow="hidden" flexShrink={0} paddingLeft={Y_AXIS_W}>
        {labels.map((label, i) => (
          <YStack key={points[i]?.day ?? i} flex={1} alignItems="center" overflow="hidden">
            <Text fontSize={9} color="$color11" numberOfLines={1}>
              {label}
            </Text>
          </YStack>
        ))}
      </XStack>
    </YStack>
  )
}

/** A colour and what it means, for a chart that carries two lines. */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <XStack gap="$0.5" alignItems="center">
      <div style={{ width: 14, height: 3, borderRadius: 2, background: color }} />
      <Text fontSize={12} color="$color11">
        {label}
      </Text>
    </XStack>
  )
}
