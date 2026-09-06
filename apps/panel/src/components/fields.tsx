// Native controls, wearing the design system.
//
// Tamagui has no Select and no date input, and neither does the core — so a raw
// `<select>` / `<input type="date">` is the only thing that keeps the platform
// picker, with its keyboard, its screen reader and, on a phone, the native
// wheel. What a raw element does NOT keep is the theme: the browser paints it
// light-on-light inside a dark panel, and that is exactly how the availability
// header looked. So the element stays native and only its skin is ours — the
// tokens InputFrame paints with, read from the live theme, plus `color-scheme`
// so the calendar popup and the option list follow the theme too.
//
// The CSS is injected once, through the same helper the vendored components use
// for keyframes: `:hover` and `:focus-visible` have no inline form, and a
// dozen lines behind one class is the "mínimo del micro" CLAUDE.md allows.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Text, XStack, YStack, useTheme, useThemeName } from 'tamagui'
import { Check, ChevronDown, Eye, Search, X } from '@tamagui/lucide-icons'
import { useIsMobile } from '../ui/hooks/useIsMobile'
import { ensureKeyframes } from '../ui/lib/keyframes'
import { Badge, Button, Label, type BadgeProps } from './ui'

/** `sm` and `md` are InputFrame's own sizes, to the pixel: these sit in a row
 *  with FormField and a mismatch of two pixels is what makes a form look cheap.
 *
 *  A field box is 40px at `sm` and 48px at `md`. The vendored Button does NOT
 *  use the same scale — its `sm` is 28px — so the button that lines up beside a
 *  field is `lg` (40px) next to `sm`, and `xl` (48px) next to `md`. Pairing the
 *  names instead of the heights is what leaves a Buscar floating above its own
 *  search bar. */
export type FieldSize = 'sm' | 'md'

const STYLE_ID = 'pediatric-fields'
const CSS = `
.pediatric-field {
  box-sizing: border-box;
  width: 100%;
  height: var(--pediatric-field-h);
  padding: 0 var(--pediatric-field-px);
  font-family: inherit;
  font-size: var(--pediatric-field-fs);
  line-height: 1;
  color: var(--pediatric-field-color);
  background-color: var(--pediatric-field-bg);
  border: 1px solid var(--pediatric-field-border);
  border-radius: var(--pediatric-field-radius);
  /* Focus ring as an outline, like InputFrame: a thicker border on focus would
     resize the box and shove the row by a pixel. */
  outline: 2px solid transparent;
  transition: border-color 120ms ease, outline-color 120ms ease;
  -webkit-appearance: none;
  appearance: none;
}
.pediatric-field--sm {
  --pediatric-field-h: 40px; --pediatric-field-px: 10px;
  --pediatric-field-fs: 13px; --pediatric-field-radius: 8px;
}
.pediatric-field--md {
  --pediatric-field-h: 48px; --pediatric-field-px: 14px;
  --pediatric-field-fs: 15px; --pediatric-field-radius: 10px;
}
.pediatric-field:hover:not(:disabled) { border-color: var(--pediatric-field-border-hover); }
.pediatric-field:focus-visible {
  border-color: var(--pediatric-field-border-focus);
  outline-color: var(--pediatric-field-border-focus);
}
.pediatric-field:disabled { opacity: 0.5; cursor: not-allowed; }
.pediatric-field--select { padding-right: calc(var(--pediatric-field-px) + 18px); cursor: pointer; }
/* The date input keeps the picker button it draws itself — appearance:none
   deletes it in WebKit, and then there is no way to open the calendar. */
.pediatric-field--date { -webkit-appearance: none; appearance: none; }
.pediatric-field--date::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 0.55; }
.pediatric-field--date::-webkit-calendar-picker-indicator:hover { opacity: 1; }
/* The search field leaves room for its icon, and gives back the space when it
   also has to hold a clear button. */
.pediatric-field--search { padding-left: calc(var(--pediatric-field-px) + 20px); }
/* Money leaves room for the peso sign the field draws itself, which sits at
   the same inset as the text so it never hugs the border. */
.pediatric-field--money { padding-left: calc(var(--pediatric-field-px) + 16px); }
.pediatric-money { position: relative; display: flex; align-items: center; width: 100%; }
.pediatric-money-sign {
  position: absolute;
  pointer-events: none;
  line-height: 1;
  color: var(--pediatric-field-muted);
}
.pediatric-money-sign[data-empty] { opacity: 0.5; }
.pediatric-money--sm .pediatric-money-sign { left: 10px; font-size: 13px; }
.pediatric-money--md .pediatric-money-sign { left: 14px; font-size: 15px; }
/* In a table cell the box has to disappear until it is being used: a grid of
   bordered inputs reads as a form, not as data. */
.pediatric-field--inline {
  height: 28px;
  padding: 0 6px;
  font-size: 13px;
  border-radius: 6px;
  border-color: transparent;
  background-color: transparent;
}
.pediatric-field--inline:hover:not(:disabled) { border-color: var(--pediatric-field-border-hover); }
.pediatric-field--inline:focus-visible { background-color: var(--pediatric-field-bg); }
/* An invisible select laid over a badge: the trigger is ours (a coloured pill
   that says the state), the menu is the platform's. */
.pediatric-overlay-select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: 0;
  padding: 0;
  margin: 0;
}
/* The checkbox keeps its native tick: stripping the appearance would leave an
   empty square to redraw in SVG for nothing. */
.pediatric-check {
  width: 18px;
  height: 18px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--pediatric-field-accent);
}
/* The counter's own box: the number sits between its two buttons. */
.pediatric-field--center { text-align: center; }
/* Spinners on a number field are a mis-click waiting to happen in a table row.
   Firefox does NOT take "appearance: none" for them — it wants the input to say
   it is a text field — so both spellings are here, or the two arrows come back
   on every browser that is not Chrome. */
.pediatric-field--number {
  -moz-appearance: textfield;
  appearance: textfield;
}
.pediatric-field--number::-webkit-outer-spin-button,
.pediatric-field--number::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
/* The typeahead's own menu. A native <select> cannot be filtered, so a long
   list gets this instead: the same box, plus a list under it.
   FIXED, and rendered into <body>: the filter row lives inside a Card, and a
   Card clips its children to its rounded corners — an absolutely positioned
   menu came out sliced in half at the card's edge. The palette travels with it
   as CSS variables on the element itself, so leaving the Tamagui wrapper costs
   nothing. */
.pediatric-menu {
  position: fixed;
  z-index: 1000;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
  background-color: var(--pediatric-field-bg);
  border: 1px solid var(--pediatric-field-border);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
}
.pediatric-menu__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.3;
  color: var(--pediatric-field-color);
  cursor: pointer;
}
.pediatric-menu__option--active { background-color: var(--pediatric-menu-hover); }
.pediatric-menu__option--picked { font-weight: 700; }
/* The tick that says which one is the current choice — bold alone reads as
   emphasis, not as "this is the one you have". */
.pediatric-menu__option--picked::after {
  content: '';
  width: 6px;
  height: 10px;
  margin-right: 2px;
  border: solid var(--pediatric-field-accent);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) translate(-1px, -1px);
}
.pediatric-menu__empty {
  padding: 8px 10px;
  font-size: 13px;
  color: var(--pediatric-field-muted);
}
`

/**
 * The theme, as the CSS variables the class above reads. Recomputed every
 * render on purpose: it is a handful of string reads, and memoizing against a
 * Tamagui theme proxy is what makes a panel keep the light palette after the
 * host switches to dark.
 */
function useFieldStyle(): CSSProperties {
  ensureKeyframes(STYLE_ID, CSS)
  const theme = useTheme()
  const name = useThemeName()
  // `.val`, not `.get()`: on web `get()` hands back `var(--color…)`, which only
  // resolves INSIDE the themed subtree — and the typeahead menu is portalled
  // into <body>, where that variable does not exist and the panel came out
  // transparent. `.val` is the colour itself, correct wherever it lands.
  const paint = (token?: { val?: unknown; get?: () => unknown }) =>
    (token?.val ?? token?.get?.()) as string | undefined
  return {
    '--pediatric-field-color': paint(theme.color),
    '--pediatric-field-bg': paint(theme.background),
    '--pediatric-field-border': paint(theme.borderColor),
    '--pediatric-field-border-hover': paint(theme.borderColorHover),
    '--pediatric-field-border-focus': paint(theme.borderColorFocus),
    // What the browser paints a ticked checkbox with.
    '--pediatric-field-accent': paint(theme.brand),
    // The typeahead menu's own two colours.
    '--pediatric-menu-hover': paint(theme.color3),
    '--pediatric-field-muted': paint(theme.color11),
    // Tells the browser which palette to draw the parts we cannot reach with:
    // the calendar popup, the option list, the caret.
    colorScheme: name.endsWith('dark') ? 'dark' : 'light',
  } as CSSProperties
}

/**
 * The box a field lives in.
 *
 * `width` is a fixed column — right for a filter that must not move as the
 * table beside it reflows. `flex` turns that same number into a MINIMUM: the
 * field grows to fill the row on a wide screen and wraps to its own line on a
 * narrow one. That is the difference between a search bar that fills a 1400px
 * panel and one that leaves half of it empty — or, on a phone, five stubby
 * boxes stacked in a column.
 */
function Field({
  label,
  width,
  flex,
  fillOnPhone,
  children,
}: {
  label?: string
  width?: number
  flex?: boolean
  /**
   * Take the whole row on a phone instead of holding `width`. `minWidth` is
   * what makes a field refuse to shrink, which is right in a filter row and
   * wrong beside a button on a title row: a rigid 340 pushed «+ Reserva» off
   * the right edge rather than giving way.
   */
  fillOnPhone?: boolean | 'half'
  children: ReactNode
}) {
  return (
    <YStack
      gap="$0.5"
      width={flex ? undefined : width}
      flexGrow={flex ? 1 : 0}
      flexBasis={flex ? width : undefined}
      minWidth={width ?? 0}
      // `half` is for the fields that pair — origin and destination, from and
      // to: a city name does not need the row, and two of them stacked is a
      // filter block taller than the list it filters.
      $sm={
        fillOnPhone === 'half'
          ? { width: 'auto', minWidth: 120, flexBasis: 140, flexGrow: 1 }
          : fillOnPhone
            ? { width: '100%', minWidth: 0, flexBasis: 'auto', flexGrow: 1 }
            : undefined
      }
    >
      {label ? <Label>{label}</Label> : null}
      {children}
    </YStack>
  )
}

/** From this many options on, a select is filtered rather than scrolled. */
const SEARCHABLE_FROM = 10

/** Accent-blind and case-blind: typing "bogota" has to find "Bogotá". */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

type SelectOption = { value: string; label: string }

type SelectFieldProps = {
  label?: string
  /** Required when there is no visible label — a bare select says nothing. */
  ariaLabel?: string
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  size?: FieldSize
  width?: number
  /** Grow to fill the row, using `width` as the minimum. */
  flex?: boolean
  /** See Field: `true` takes the row on a phone, `'half'` shares it. */
  fillOnPhone?: boolean | 'half'
  disabled?: boolean
  /**
   * Force the typeahead on or off. Unset, it turns itself on from
   * `SEARCHABLE_FROM` options — the point where scrolling a menu to find a
   * hotel is slower than typing three letters of its name.
   */
  searchable?: boolean
}

/**
 * A select. Native while the list is short, a typeahead once it is long.
 *
 * The native menu is the better control whenever it can be used: it is the
 * platform's keyboard, its screen reader and, on a phone, its wheel. What it
 * cannot do is be FILTERED — with forty hotels in it, the operator scrolls a
 * list looking for a name they could have typed. So past a threshold the same
 * box becomes an input with a filtered list under it.
 *
 * A phone always keeps the native picker: typing to filter only beats the wheel
 * when there is a real keyboard in front of it.
 */
export function SelectField(props: SelectFieldProps) {
  const { isMobile } = useIsMobile()
  const searchable = (props.searchable ?? props.options.length >= SEARCHABLE_FROM) && !isMobile
  return searchable ? <SearchSelect {...props} /> : <NativeSelect {...props} />
}

function NativeSelect({
  label,
  ariaLabel,
  value,
  onChange,
  options,
  size = 'md',
  width,
  flex,
  fillOnPhone,
  disabled,
}: SelectFieldProps) {
  const style = useFieldStyle()
  return (
    <Field label={label} width={width} flex={flex} fillOnPhone={fillOnPhone}>
      <XStack alignItems="center" position="relative">
        <select
          className={`pediatric-field pediatric-field--${size} pediatric-field--select`}
          style={style}
          aria-label={ariaLabel ?? label}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {/* The chevron `appearance: none` removed, back as an icon that follows
            the theme — a data-URI arrow would be a hard-coded colour. */}
        <XStack position="absolute" right={size === 'sm' ? 8 : 10} pointerEvents="none">
          <ChevronDown size={size === 'sm' ? 13 : 15} color="$color11" />
        </XStack>
      </XStack>
    </Field>
  )
}

/**
 * The same box, filtered.
 *
 * The input shows the CHOSEN label while it is closed and the typed filter
 * while it is open, so it never sits there holding half a word nobody picked:
 * closing — by Escape, by blur, by picking — throws the query away and the
 * selection comes back. Only a listed option can be chosen; this is a select,
 * not a free-text field (that is `TextField`, with its datalist).
 */
function SearchSelect({
  label,
  ariaLabel,
  value,
  onChange,
  options,
  size = 'md',
  width,
  flex,
  fillOnPhone,
  disabled,
}: SelectFieldProps) {
  const style = useFieldStyle()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // Where the menu goes, in viewport coordinates: it is rendered into <body>,
  // so it has to be told, and told again whenever the page moves under it.
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = options.find((option) => option.value === value)
  const needle = fold(query.trim())
  const shown = needle ? options.filter((option) => fold(option.label).includes(needle)) : options

  // Closing on an outside mousedown rather than on blur alone: blur does not
  // fire when the click lands on the panel's own chrome inside an iframe-less
  // host, and a menu left hanging over the page is worse than a stray click.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // The page can move under a fixed menu — a scrolling table, a resized window,
  // the host's own layout settling. Follow it rather than leave the list
  // hanging beside the box it belongs to.
  useEffect(() => {
    if (!open) return
    const follow = () => measure()
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [open])

  // Arrowing past the visible rows has to bring them along.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('.pediatric-menu__option--active')?.scrollIntoView({
      block: 'nearest',
    })
  }, [open, active])

  /**
   * The menu's place on screen.
   *
   * Below the box when there is room for it, above when there is not — a filter
   * row near the bottom of the window would otherwise drop its list off the
   * fold. The width is the box's, so the two read as one control.
   */
  function measure() {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const height = Math.min(280, Math.max(120, options.length * 34 + 8))
    const below = window.innerHeight - rect.bottom
    const up = below < height + 8 && rect.top > below
    setBox({
      left: rect.left,
      top: up ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
      width: rect.width,
    })
  }

  function show() {
    if (disabled || open) return
    measure()
    setQuery('')
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    )
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setQuery('')
  }

  function pick(option: SelectOption) {
    onChange(option.value)
    close()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) return show()
      if (!shown.length) return
      setActive((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1
        return (next + shown.length) % shown.length
      })
      return
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault()
      const option = shown[active]
      if (option) pick(option)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
    }
  }

  return (
    <Field label={label} width={width} flex={flex} fillOnPhone={fillOnPhone}>
      <div ref={rootRef} style={{ position: 'relative', width: '100%' }}>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          className={`pediatric-field pediatric-field--${size} pediatric-field--select`}
          style={style}
          aria-label={ariaLabel ?? label}
          disabled={disabled}
          value={open ? query : (selected?.label ?? '')}
          // While open and empty the box would say nothing at all, so the
          // current choice stays visible as the placeholder.
          placeholder={selected?.label ?? ''}
          onFocus={show}
          onClick={show}
          onBlur={close}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
        />
        <XStack
          position="absolute"
          top={0}
          bottom={0}
          right={size === 'sm' ? 8 : 10}
          alignItems="center"
          pointerEvents="none"
        >
          <ChevronDown size={size === 'sm' ? 13 : 15} color="$color11" />
        </XStack>
        {open && box && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={listRef}
                role="listbox"
                aria-label={ariaLabel ?? label}
                className="pediatric-menu"
                style={{ ...style, left: box.left, top: box.top, width: box.width }}
              >
                {shown.length === 0 ? (
                  <div className="pediatric-menu__empty">—</div>
                ) : (
                  shown.map((option, index) => (
                    <div
                      key={option.value}
                      role="option"
                      aria-selected={option.value === value}
                      className={[
                        'pediatric-menu__option',
                        index === active ? 'pediatric-menu__option--active' : '',
                        option.value === value ? 'pediatric-menu__option--picked' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      // mousedown, not click: the click would land after the input
                      // blurred, and the blur has already closed the menu.
                      onMouseDown={(event) => {
                        event.preventDefault()
                        pick(option)
                      }}
                      onMouseEnter={() => setActive(index)}
                    >
                      {option.label}
                    </div>
                  ))
                )}
              </div>,
              document.body,
            )
          : null}
      </div>
    </Field>
  )
}

export function DateField({
  label,
  ariaLabel,
  value,
  onChange,
  size = 'md',
  width,
  flex,
  min,
  max,
}: {
  label?: string
  ariaLabel?: string
  value: string
  onChange: (value: string) => void
  size?: FieldSize
  width?: number
  /** Grow to fill the row, using `width` as the minimum. */
  flex?: boolean
  min?: string
  max?: string
}) {
  const style = useFieldStyle()
  return (
    <Field label={label} width={width} flex={flex}>
      <input
        type="date"
        className={`pediatric-field pediatric-field--${size} pediatric-field--date`}
        style={style}
        aria-label={ariaLabel ?? label}
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

/**
 * What a numeric box lets through.
 *
 * `integer`: the LEADING run of digits — stripping the dot out of "2.5" leaves
 * 25, and one mistyped key would put ten people in a cabin. Otherwise a price:
 * digits and at most one decimal point. `max` is a real ceiling, not a hint:
 * a room type with four beds free cannot take a party of ten however fast it
 * is typed.
 */
function cleanNumber(raw: string, integer?: boolean, max?: number): string {
  if (!integer) return raw.match(/^\d*\.?\d*/)?.[0] ?? ''
  const digits = (raw.match(/^\d*/)?.[0] ?? '').replace(/^0+(?=\d)/, '')
  if (digits === '' || max === undefined) return digits
  return String(Math.min(Number(digits), Math.max(max, 0)))
}

/**
 * The change handler every numeric box shares — and the write-back is the whole
 * point of it.
 *
 * A controlled input only goes back to what React holds when React RE-RENDERS.
 * Type "a" into a box that already reads "2" and the browser shows "2a", the
 * filter returns "2", and setting the state to "2" changes nothing — so no
 * render happens and the letter stays on screen for good. Putting the cleaned
 * value straight back on the node closes that hole; without it the box rejects
 * letters only while the number itself happens to be changing.
 */
function numericChange(
  target: HTMLInputElement,
  onChange: (value: string) => void,
  integer?: boolean,
  max?: number,
): void {
  const next = cleanNumber(target.value, integer, max)
  if (next !== target.value) target.value = next
  onChange(next)
}

export function NumberField({
  label,
  ariaLabel,
  value,
  onChange,
  size = 'md',
  width,
  flex,
  integer,
  max,
  placeholder,
  disabled,
}: {
  label?: string
  ariaLabel?: string
  value: string
  onChange: (value: string) => void
  size?: FieldSize
  width?: number
  /** Grow to fill the row, using `width` as the minimum. */
  flex?: boolean
  /**
   * A count, not a measurement: adults, children, quantities. The API answers a
   * decimal head count with a 400 (`t.Integer`), which reaches the operator as
   * a reservation saved without its room.
   */
  integer?: boolean
  /** Ceiling for an integer box: what is left, in beds or in units. */
  max?: number
  placeholder?: string
  disabled?: boolean
}) {
  const style = useFieldStyle()
  /**
   * `type=text`, not `type=number`, on purpose.
   *
   * A number input does NOT keep letters out — it only refuses to report them.
   * Firefox lets "abc" be typed, shows it, and hands `value === ''` to the
   * change handler; React then "corrects" the field to the empty string it
   * already believes is there, so nothing re-renders and the letters sit in the
   * box for good. Chrome hides the same state behind swallowed keystrokes.
   *
   * With a text input every keystroke arrives as text, this filter runs on it,
   * and what cannot be a number never reaches the field. `inputMode` is what
   * keeps the numeric keypad on a phone, which is the only thing `type=number`
   * was really buying here.
   */
  return (
    <Field label={label} width={width} flex={flex}>
      <input
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        pattern={integer ? '[0-9]*' : undefined}
        autoComplete="off"
        className={`pediatric-field pediatric-field--${size} pediatric-field--number`}
        style={style}
        aria-label={ariaLabel ?? label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => numericChange(event.target, onChange, integer, max)}
      />
    </Field>
  )
}

/** Cents. Prices here are whole pesos, but the two zeros say it is money. */
const MONEY_DECIMALS = 2

/** `1000000` → `1.000.000`. Digits only; the caller has already cleaned them. */
const groupThousands = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/** A stored number → what the box shows: `180000.5` → `180.000,50`. */
export function moneyDisplay(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const n = Number(text)
  if (!Number.isFinite(n)) return ''
  const [int, dec] = Math.abs(n).toFixed(MONEY_DECIMALS).split('.')
  return `${n < 0 ? '-' : ''}${groupThousands(int!)},${dec}`
}

/**
 * A keystroke → what the box shows and what the caller stores.
 *
 * Half-typed states are kept as typed (`10.000,` while the cents are still
 * coming); only blur rounds the value out to two decimals.
 */
function moneyTyped(text: string): { display: string; raw: string } {
  const [whole, ...rest] = text.replace(/[^\d,]/g, '').split(',')
  // '007' is what a stray leading zero looks like; the number is 7.
  const digits = (whole ?? '').replace(/^0+(?=\d)/, '')
  if (rest.length === 0) return { display: groupThousands(digits), raw: digits }
  const dec = rest.join('').slice(0, MONEY_DECIMALS)
  return {
    display: `${groupThousands(digits) || '0'},${dec}`,
    raw: `${digits || '0'}.${dec || '0'}`,
  }
}

/**
 * Where the caret goes once the dots have moved.
 *
 * Reformatting rewrites the whole string, and a caret restored by index alone
 * jumps a place every time a separator is inserted — type into the middle of a
 * price and the cursor walks away from the digit being typed. Counting the
 * DIGITS to its left instead is what keeps it on the same one.
 */
function caretAfterFormat(before: string, caret: number, after: string): number {
  const typed = before.slice(0, caret).replace(/[^\d,]/g, '').length
  let seen = 0
  let index = 0
  while (index < after.length && seen < typed) {
    if (/[\d,]/.test(after[index]!)) seen += 1
    index += 1
  }
  return index
}

/**
 * Money, written the way Colombia writes it: `10.000.000,00`.
 *
 * A bare number box asks the operator to count zeros. `10000000` and `1000000`
 * differ by one keystroke and by nine million pesos, and the only place that
 * mistake shows up is on the invoice. Grouped as it is typed, the same two
 * numbers are `10.000.000` and `1.000.000` — a different SHAPE, not a digit
 * hidden in a row of them.
 *
 * The box shows the format; the caller keeps a plain number string ('10000000',
 * '10000000.50'), so nothing between here and the API learns about separators.
 *
 * The decimal separator is the comma. A typed `.` is DROPPED rather than read
 * as a decimal point: the operator who types `10.000.000` out of habit gets the
 * number they meant, and the dots they typed are the ones the field was going
 * to insert anyway.
 */
export function MoneyField({
  label,
  ariaLabel,
  value,
  onChange,
  size = 'md',
  width,
  flex,
  placeholder,
  disabled,
}: {
  label?: string
  ariaLabel?: string
  /** A plain number string, as the API stores it — never the formatted one. */
  value: string
  onChange: (value: string) => void
  size?: FieldSize
  width?: number
  /** Grow to fill the row, using `width` as the minimum. */
  flex?: boolean
  placeholder?: string
  disabled?: boolean
}) {
  const style = useFieldStyle()
  const [display, setDisplay] = useState(() => moneyDisplay(value))
  // What we last handed the caller. A `value` that differs from it came from
  // OUTSIDE (a dialog reopened on another record, a reset) and reformats the
  // box; the echo of our own keystroke does not, or every comma typed would be
  // rounded to ',00' before the cents arrive.
  const emitted = useRef(value)

  useEffect(() => {
    if (value === emitted.current) return
    emitted.current = value
    setDisplay(moneyDisplay(value))
  }, [value])

  const type = (target: HTMLInputElement) => {
    const caret = target.selectionStart ?? target.value.length
    const { display: next, raw } = moneyTyped(target.value)
    const at = caretAfterFormat(target.value, caret, next)
    // Straight onto the node, like numericChange: React re-renders only when
    // the value it holds changes, and a keystroke that formats to the same
    // string ('1.000' + '.') would otherwise stay on screen.
    target.value = next
    target.setSelectionRange(at, at)
    setDisplay(next)
    emitted.current = raw
    onChange(raw)
  }

  return (
    <Field label={label} width={width} flex={flex}>
      {/* Plain elements, not XStack: the optimizing compiler turned the sign's
          two conditional props (size → left, empty → opacity) into a branch
          chain and dropped `left` from the "empty" branch, so the sign hugged
          the border in exactly the state every new form opens in. A CSS rule
          has no branches to lose. */}
      <div className={`pediatric-money pediatric-money--${size}`} style={style}>
        <span className="pediatric-money-sign" data-empty={display ? undefined : ''} aria-hidden>
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={`pediatric-field pediatric-field--${size} pediatric-field--money`}
          style={style}
          aria-label={ariaLabel ?? label}
          value={display}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => type(event.target)}
          // The cents are only filled in once the operator has stopped typing:
          // ',00' appended mid-keystroke would sit between them and the digits
          // they were about to write.
          onBlur={() => setDisplay(moneyDisplay(emitted.current))}
        />
      </div>
    </Field>
  )
}

/**
 * A head count, as the control a booking engine uses: minus, the number, plus.
 *
 * Typing still works — it is the same filtered box — but the two buttons are
 * the gesture, and they are the ones that make the ceiling obvious: when the
 * type has no beds left, plus stops. A bare text box asked the operator to know
 * how many people fit and to be careful; this one just refuses to go past it.
 */
export function CounterField({
  label,
  ariaLabel,
  value,
  onChange,
  max,
  size = 'sm',
  width = 128,
  disabled,
}: {
  label?: string
  ariaLabel?: string
  value: string
  onChange: (value: string) => void
  /** Beds left for this type, this row included. */
  max?: number
  size?: FieldSize
  width?: number
  disabled?: boolean
}) {
  const style = useFieldStyle()
  const box = size === 'sm' ? 40 : 48
  const count = Number(value || 0)
  const ceiling = max === undefined ? Infinity : Math.max(max, 0)
  const step = (delta: number) =>
    onChange(String(Math.max(0, Math.min(ceiling, (Number.isFinite(count) ? count : 0) + delta))))

  const Step = ({ sign, to, off }: { sign: string; to: number; off: boolean }) => (
    <XStack
      role="button"
      tabIndex={off ? -1 : 0}
      aria-label={`${sign === '+' ? '+' : '-'} ${ariaLabel ?? label ?? ''}`}
      width={box}
      height={box}
      alignItems="center"
      justifyContent="center"
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$3"
      opacity={off ? 0.4 : 1}
      cursor={off ? 'not-allowed' : 'pointer'}
      hoverStyle={off ? undefined : { backgroundColor: '$backgroundHover' }}
      onPress={off ? undefined : () => step(to)}
      onKeyDown={
        ((event: KeyboardEvent) => {
          if (off) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            step(to)
          }
        }) as never
      }
    >
      <Text fontSize={18} fontWeight="700" lineHeight={box}>
        {sign}
      </Text>
    </XStack>
  )

  return (
    <Field label={label} width={width}>
      <XStack alignItems="center" gap="$0.5">
        <Step sign="−" to={-1} off={Boolean(disabled) || count <= 0} />
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          className={`pediatric-field pediatric-field--${size} pediatric-field--number pediatric-field--center`}
          style={style}
          aria-label={ariaLabel ?? label}
          value={value}
          disabled={disabled}
          onChange={(event) => numericChange(event.target, onChange, true, max)}
        />
        <Step sign="+" to={1} off={Boolean(disabled) || count >= ceiling} />
      </XStack>
    </Field>
  )
}

/**
 * Free text with a suggestion list — origin and destination cities, which grow
 * with use and so cannot be a closed `SelectField`. The suggestions come from
 * what is already stored, and typing something new is still just typing.
 *
 * `<datalist>` rather than a custom dropdown: it is the browser's own
 * combobox, so it costs no popup, no keyboard handling and no focus trap.
 */
export function TextField({
  label,
  ariaLabel,
  value,
  onChange,
  suggestions,
  listId,
  size = 'md',
  width,
  placeholder,
}: {
  label?: string
  ariaLabel?: string
  value: string
  onChange: (value: string) => void
  /** Offered, never enforced. */
  suggestions?: string[]
  /** Must be unique on the page — two inputs sharing one id share its options. */
  listId?: string
  size?: FieldSize
  width?: number
  placeholder?: string
}) {
  const style = useFieldStyle()
  const id = suggestions?.length ? (listId ?? `pediatric-list-${label ?? ariaLabel}`) : undefined
  return (
    <Field label={label} width={width}>
      <input
        type="text"
        className={`pediatric-field pediatric-field--${size}`}
        style={style}
        aria-label={ariaLabel ?? label}
        value={value}
        list={id}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {id ? (
        <datalist id={id}>
          {suggestions?.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </Field>
  )
}

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  ariaLabel,
  size = 'sm',
  width = 220,
}: {
  /** Sits above the box, like every other field in a filter row. Without it a
   *  search input is the one control in the row with nothing naming it. */
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel: string
  size?: FieldSize
  width?: number
}) {
  const style = useFieldStyle()
  return (
    // On a phone the search sits beside a button on the title row, so it gives
    // way and the button wraps under it rather than off the screen.
    <Field label={label} width={width} fillOnPhone>
      <XStack alignItems="center" position="relative" width={width} $sm={{ width: '100%' }}>
        <XStack position="absolute" left={size === 'sm' ? 8 : 10} pointerEvents="none">
          <Search size={size === 'sm' ? 13 : 15} color="$color11" />
        </XStack>
        <input
          type="search"
          className={`pediatric-field pediatric-field--${size} pediatric-field--search`}
          style={style}
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </XStack>
    </Field>
  )
}

/**
 * A value edited where it is read.
 *
 * Committing on Enter or on blur, reverting on Escape — the three keys anyone
 * expects from a cell. The save is optimistic in the caller (the row already
 * shows the new value); what this owns is the input, and putting the old value
 * back if `onSave` throws, so a rejected edit never leaves a lie on screen.
 */
export function InlineEdit({
  value,
  onSave,
  ariaLabel,
  type = 'text',
  width = 90,
  placeholder,
  render,
}: {
  value: string
  onSave: (value: string) => Promise<void>
  ariaLabel: string
  /** `money` groups the thousands as it is typed, like MoneyField; what
   *  `onSave` gets is still the plain number string. */
  type?: 'text' | 'number' | 'money'
  width?: number
  placeholder?: string
  /** How the value reads while it is not being edited (money, a dash, …). */
  render?: (value: string) => string
}) {
  const style = useFieldStyle()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  // Money is the one type whose box does not show what it stores: the draft
  // stays a plain number for `onSave`, and this is what the operator reads.
  const [shown, setShown] = useState('')
  const [busy, setBusy] = useState(false)

  async function commit() {
    setEditing(false)
    if (draft === value) return
    setBusy(true)
    try {
      await onSave(draft)
    } catch {
      // The caller reports the failure; here the job is to stop showing a value
      // the server never accepted.
      setDraft(value)
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    const read = render ? render(value) : value
    return (
      // The affordance is a tint that appears under the cursor — the way a cell
      // behaves in a spreadsheet. An always-on underline was worse than no hint
      // at all: three underlined values in a row read as three links.
      <XStack
        paddingHorizontal={5}
        paddingVertical={2}
        marginHorizontal={-5}
        borderRadius={6}
        opacity={busy ? 0.5 : 1}
        cursor="text"
        hoverStyle={{ backgroundColor: '$backgroundHover' }}
        onPress={() => {
          setDraft(value)
          setShown(moneyDisplay(value))
          setEditing(true)
        }}
      >
        <Text fontSize={14} color={read ? '$color' : '$color11'}>
          {read || placeholder || '—'}
        </Text>
      </XStack>
    )
  }

  return (
    <input
      type={type === 'number' ? 'number' : 'text'}
      inputMode={type === 'money' ? 'decimal' : undefined}
      className="pediatric-field pediatric-field--inline"
      style={{ ...style, width }}
      aria-label={ariaLabel}
      autoFocus
      value={type === 'money' ? shown : draft}
      onChange={(event) => {
        if (type !== 'money') {
          setDraft(event.target.value)
          return
        }
        const target = event.target
        const caret = target.selectionStart ?? target.value.length
        const { display, raw } = moneyTyped(target.value)
        const at = caretAfterFormat(target.value, caret, display)
        target.value = display
        target.setSelectionRange(at, at)
        setShown(display)
        setDraft(raw)
      }}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void commit()
        if (event.key === 'Escape') {
          setDraft(value)
          setShown(moneyDisplay(value))
          setEditing(false)
        }
      }}
    />
  )
}

/**
 * A status, shown as the badge it already is, that opens the moves it allows.
 *
 * The table used to carry two columns for this — one to read the state, one
 * empty box to change it. The state IS the control now: the badge keeps its
 * colour and its meaning, and a native `<select>` sits invisibly on top so the
 * menu, the keyboard and the screen reader are the platform's, not ours.
 *
 * With no move available the badge is rendered plain: a control that cannot do
 * anything should not look like one.
 */
export function StatusSelect({
  value,
  label,
  variant,
  options,
  onChange,
  ariaLabel,
}: {
  value: string
  label: string
  variant?: BadgeProps['variant']
  /** The moves offered. Empty means the status is terminal. */
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  ariaLabel: string
}) {
  const style = useFieldStyle()
  if (!options.length) return <Badge variant={variant}>{label}</Badge>
  return (
    // The chevron sits beside the pill, not inside it: Badge wraps whatever it
    // is given in a Text, and an icon nested in a Text is a span holding a div.
    <XStack position="relative" alignItems="center" gap={3}>
      <Badge variant={variant}>{label}</Badge>
      <ChevronDown size={11} color="$color11" />
      <select
        className="pediatric-overlay-select"
        style={style}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => {
          if (event.target.value !== value) onChange(event.target.value)
        }}
      >
        {/* The current status is the selected option, so the menu opens on it
            and picking it again is a no-op rather than a bogus transition. */}
        <option value={value}>{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </XStack>
  )
}

/**
 * A yes/no, as the checkbox it is.
 *
 * The alternative was a two-option select, which is what this panel did before:
 * three of those in a row read as three questions the operator has to open one
 * by one, when the answer is visible in a tick.
 */
/** What a file slot is showing: nothing, what the server already has, or what
 *  the operator just picked and has not saved yet. */
export type FileSlot = { kind: 'none' } | { kind: 'stored' } | { kind: 'staged'; name: string }

/**
 * A file the operator hands over — today, the two faces of a passenger's ID.
 *
 * The native `<input type="file">` is kept (it is the only thing that opens the
 * phone's camera roll) but never shown: browsers paint its "Choose File" button
 * themselves and no stylesheet reaches it, so it sits hidden behind a real
 * Button. What the row shows instead is the STATE — picked, saved, missing —
 * because that is the question the operator asks it: is this passenger's
 * document already on file?
 */
export function FileField({
  label,
  accept = 'image/jpeg,image/png,image/webp,application/pdf',
  value,
  labels,
  onPick,
  onView,
  onClear,
  size = 'md',
  width,
  flex,
  disabled,
}: {
  label?: string
  accept?: string
  value: FileSlot
  /** Copy comes from the page: this file holds no strings. */
  labels: {
    choose: string
    replace: string
    view: string
    remove: string
    stored: string
    empty: string
  }
  onPick: (file: File) => void
  /** Absent while the passenger has no id yet — nothing to fetch. */
  onView?: () => void
  onClear?: () => void
  size?: FieldSize
  width?: number
  flex?: boolean
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement | null>(null)
  const filled = value.kind !== 'none'
  return (
    <Field label={label} width={width} flex={flex}>
      <XStack gap="$0.5" alignItems="center" minHeight={size === 'md' ? 48 : 40}>
        <input
          ref={input}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          aria-label={label}
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared on purpose: picking the SAME file twice (after a failed
            // save, say) fires no change event while the node still holds it.
            event.target.value = ''
            if (file) onPick(file)
          }}
        />
        <Button
          size={size === 'md' ? 'xl' : 'lg'}
          variant="secondary"
          disabled={disabled}
          onPress={() => input.current?.click()}
        >
          {filled ? labels.replace : labels.choose}
        </Button>
        <XStack gap="$0.25" alignItems="center" flexShrink={1} minWidth={0}>
          {value.kind === 'stored' ? <Check size={14} color="$brand" /> : null}
          <Text fontSize={12} color="$color11" numberOfLines={1}>
            {value.kind === 'staged'
              ? value.name
              : value.kind === 'stored'
                ? labels.stored
                : labels.empty}
          </Text>
        </XStack>
        {value.kind === 'stored' && onView ? (
          <Button size="sm" variant="ghost" aria-label={labels.view} onPress={onView}>
            <Eye size={13} />
          </Button>
        ) : null}
        {filled && onClear ? (
          <Button size="sm" variant="ghost" aria-label={labels.remove} onPress={onClear}>
            <X size={13} />
          </Button>
        ) : null}
        {/* Eats the leftover width so the buttons stay beside the status, not
            pushed against the field that comes next in the row. */}
        <XStack flex={1} />
      </XStack>
    </Field>
  )
}

export function ToggleField({
  label,
  value,
  onChange,
  hint,
  compact,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
  hint?: string
  /** The tick alone — the label survives for a screen reader. For a checkbox
   *  inside a narrow card, where spelling "Confirmado" next to every passenger
   *  costs more width than it explains. */
  compact?: boolean
}) {
  const style = useFieldStyle()
  if (compact) {
    return (
      <input
        type="checkbox"
        className="pediatric-check"
        style={style}
        aria-label={label}
        title={label}
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  }
  return (
    // The row itself has to be allowed to shrink, not just the label inside it:
    // Tamagui inherits React Native's `flexShrink: 0`, so in a table cell the
    // toggle sized itself to the label and ran under the next column.
    <XStack gap="$0.75" alignItems="center" flexShrink={1} minWidth={0}>
      <input
        type="checkbox"
        className="pediatric-check"
        style={style}
        aria-label={label}
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
      {/* flexShrink is spelled out because Tamagui inherits React Native's
          `flexShrink: 0`: without it a long label grows its own cell instead of
          wrapping inside it, and in a table row it runs under the next column. */}
      <YStack gap={1} flex={1} flexShrink={1} minWidth={0}>
        <Text fontSize={14} cursor="pointer" flexShrink={1} onPress={() => onChange(!value)}>
          {label}
        </Text>
        {hint ? (
          <Text fontSize={12} color="$color11">
            {hint}
          </Text>
        ) : null}
      </YStack>
    </XStack>
  )
}
