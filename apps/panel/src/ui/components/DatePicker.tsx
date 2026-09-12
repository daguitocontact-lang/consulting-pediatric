import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Stack, Text, XStack, YStack } from 'tamagui'
import { Calendar as CalendarIcon, X } from '@tamagui/lucide-icons'
import { Calendar } from './Calendar'

// ---------------------------------------------------------------------------
// DatePicker — input-styled trigger (matches the shared Input `field` look) +
// portal popover holding the custom Calendar. String value contract so it drops
// into forms that today use native <input type="date" | "datetime-local">.
//   mode 'date'     → 'YYYY-MM-DD'
//   mode 'datetime' → 'YYYY-MM-DDTHH:mm'
// ---------------------------------------------------------------------------

export type DatePickerMode = 'date' | 'datetime'

export type DatePickerProps = {
  value: string
  onChange: (value: string) => void
  mode?: DatePickerMode
  placeholder?: string
  ariaLabel?: string
  min?: string
  max?: string
  locale?: string
  fullWidth?: boolean
  disabled?: boolean
  clearable?: boolean
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function parseValue(v: string): Date | null {
  if (!v) return null
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return null
  const [, y, mo, d, hh, mm] = m
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0))
}

function formatValue(d: Date, mode: DatePickerMode): string {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (mode === 'date') return date
  return `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatLabel(d: Date, mode: DatePickerMode, locale: string): string {
  const opts: Intl.DateTimeFormatOptions =
    mode === 'datetime'
      ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'short', year: 'numeric' }
  return new Intl.DateTimeFormat(locale, opts).format(d)
}

export function DatePicker({
  value,
  onChange,
  mode = 'date',
  placeholder = 'Selecciona una fecha',
  ariaLabel,
  min,
  max,
  locale = 'es-ES',
  fullWidth = true,
  disabled = false,
  clearable = true,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const parsed = useMemo(() => parseValue(value), [value])
  const minDate = useMemo(() => parseValue(min ?? ''), [min])
  const maxDate = useMemo(() => parseValue(max ?? ''), [max])
  const label = parsed ? formatLabel(parsed, mode, locale) : placeholder
  const isEmpty = !parsed
  const showClear = clearable && !isEmpty && hovered && !disabled && !open

  function commit(next: Date) {
    onChange(formatValue(next, mode))
  }

  function handleSelectDay(day: Date) {
    // Keep any previously chosen time when only the day changes.
    const base = parsed ?? day
    const next =
      mode === 'datetime'
        ? new Date(
            day.getFullYear(),
            day.getMonth(),
            day.getDate(),
            base.getHours(),
            base.getMinutes(),
          )
        : day
    commit(next)
    if (mode === 'date') setOpen(false)
  }

  function handleTime(hours: number, minutes: number) {
    const base = parsed ?? new Date()
    commit(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes))
  }

  function handleClear(e: { stopPropagation: () => void; preventDefault?: () => void }) {
    e.stopPropagation()
    e.preventDefault?.()
    onChange('')
  }

  return (
    <Stack tag="span" position={'relative' as never} width={fullWidth ? '100%' : undefined}>
      <XStack
        ref={triggerRef as never}
        tag="button"
        role="button"
        aria-label={ariaLabel ?? placeholder}
        aria-expanded={open}
        aria-disabled={disabled}
        onPress={() => !disabled && setOpen((o) => !o)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        alignItems="center"
        justifyContent="space-between"
        gap="$2"
        height={48}
        width={fullWidth ? '100%' : undefined}
        paddingHorizontal="$3.5"
        borderRadius={10}
        borderWidth={1}
        borderColor={open ? '$borderColorFocus' : '$borderColor'}
        backgroundColor="$background"
        cursor={disabled ? 'not-allowed' : 'pointer'}
        opacity={disabled ? 0.5 : 1}
        animation="fast"
        hoverStyle={{ borderColor: '$borderColorHover' }}
      >
        <XStack alignItems="center" gap="$2" flex={1} minWidth={0}>
          <CalendarIcon size={15} color="var(--color11)" />
          <Text
            fontFamily="$body"
            fontSize={15}
            color={isEmpty ? '$color11' : '$color'}
            numberOfLines={1}
            ellipse
            userSelect="none"
          >
            {label}
          </Text>
        </XStack>
        {showClear ? (
          <Stack
            onPress={handleClear}
            hitSlop={6}
            cursor="pointer"
            padding={2}
            borderRadius={100}
            hoverStyle={{ backgroundColor: '$color3' }}
          >
            <X size={14} color="$color11" />
          </Stack>
        ) : null}
      </XStack>

      {open ? (
        <DatePickerPopover anchorRef={triggerRef} onClose={() => setOpen(false)}>
          <Calendar
            value={parsed}
            onSelect={handleSelectDay}
            min={minDate ?? undefined}
            max={maxDate ?? undefined}
            locale={locale}
          />
          {mode === 'datetime' ? <TimeRow value={parsed} onChange={handleTime} /> : null}
        </DatePickerPopover>
      ) : null}
    </Stack>
  )
}

function TimeRow({
  value,
  onChange,
}: {
  value: Date | null
  onChange: (h: number, m: number) => void
}) {
  const hours = value ? value.getHours() : 9
  const minutes = value ? value.getMinutes() : 0
  return (
    <XStack
      alignItems="center"
      gap="$2"
      marginTop="$2"
      paddingTop="$2"
      borderTopWidth={1}
      borderTopColor="$borderColor"
    >
      <Text fontFamily="$body" fontSize={13} color="$color11" userSelect="none">
        Hora
      </Text>
      <XStack alignItems="center" gap="$1">
        <TimeInput value={hours} max={23} onChange={(h) => onChange(h, minutes)} ariaLabel="Hora" />
        <Text fontFamily="$body" fontSize={15} color="$color11">
          :
        </Text>
        <TimeInput
          value={minutes}
          max={59}
          onChange={(m) => onChange(hours, m)}
          ariaLabel="Minutos"
        />
      </XStack>
    </XStack>
  )
}

function TimeInput({
  value,
  max,
  onChange,
  ariaLabel,
}: {
  value: number
  max: number
  onChange: (n: number) => void
  ariaLabel: string
}) {
  return (
    <Stack
      height={36}
      width={52}
      borderRadius={8}
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$background"
      justifyContent="center"
      alignItems="center"
    >
      <input
        aria-label={ariaLabel}
        inputMode="numeric"
        value={pad(value)}
        onChange={(e) => {
          const n = Number(e.currentTarget.value.replace(/\D/g, ''))
          if (Number.isNaN(n)) return
          onChange(Math.max(0, Math.min(max, n)))
        }}
        style={{
          border: 'none',
          background: 'transparent',
          outline: 'none',
          textAlign: 'center',
          width: '100%',
          fontSize: 14,
          color: 'var(--color)',
        }}
      />
    </Stack>
  )
}

type PopoverProps = {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
  children: React.ReactNode
}

function DatePickerPopover({ anchorRef, onClose, children }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    function reposition() {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const width = 312
      const height = 360
      const gap = 4
      let left = rect.left
      const maxLeft = window.innerWidth - width - 8
      if (left > maxLeft) left = maxLeft
      if (left < 8) left = 8
      let top = rect.bottom + gap
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - height - gap)
      }
      setPos({ top, left })
    }
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [anchorRef])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onClose])

  if (!pos || typeof document === 'undefined') return null

  return createPortal(
    <YStack
      ref={popoverRef as never}
      // Marks this as a nested floating layer so an ancestor Popover's
      // outside-click handler doesn't treat a day click here as "outside".
      {...{ 'data-floating-layer': 'datepicker' }}
      position={'fixed' as never}
      top={pos.top}
      left={pos.left}
      backgroundColor="$background"
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$4"
      padding="$3"
      zIndex={100001 as never}
      shadowColor="rgba(0,0,0,0.15)"
      shadowRadius={20}
      shadowOffset={{ width: 0, height: 8 }}
      animation="fast"
      enterStyle={{ y: -4, opacity: 0 }}
      exitStyle={{ y: -4, opacity: 0 }}
    >
      {children}
    </YStack>,
    document.body,
  )
}

DatePicker.displayName = 'DatePicker'
