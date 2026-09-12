import { useMemo, useState } from 'react'
import { Stack, Text, XStack, YStack } from 'tamagui'
import { ChevronLeft, ChevronRight } from '@tamagui/lucide-icons'

// ---------------------------------------------------------------------------
// Calendar — custom month grid. No external date library: plain Date math,
// localized labels via Intl. Controlled selection; the viewed month is local
// state so paging never mutates the selected value.
// ---------------------------------------------------------------------------

export type CalendarProps = {
  value: Date | null
  onSelect: (date: Date) => void
  min?: Date
  max?: Date
  locale?: string
  /** 0 = Sunday, 1 = Monday (default, matches es-ES). */
  weekStartsOn?: 0 | 1
  /** Local `YYYY-MM-DD` keys to mark (e.g. days that have bookings). */
  markedDays?: ReadonlySet<string>
}

/** Local (not UTC) `YYYY-MM-DD` key, matching how the grid builds days. */
export function calendarDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isBefore(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() < startOfDay(b).getTime()
}

// A grid is always 6 rows × 7 cols so the popover height never jumps between
// months (some months straddle 6 weeks, most span 5).
function buildGrid(view: Date, weekStartsOn: 0 | 1): Date[] {
  const first = startOfMonth(view)
  const firstWeekday = first.getDay() // 0..6, Sun..Sat
  const lead = (firstWeekday - weekStartsOn + 7) % 7
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - lead)
  return Array.from({ length: 42 }, (_, i) => {
    return new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
  })
}

function weekdayLabels(locale: string, weekStartsOn: 0 | 1): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  // 2024-01-07 is a Sunday — a stable anchor to read localized weekday names.
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(2024, 0, 7 + weekStartsOn + i)
    return fmt.format(day).replace('.', '')
  })
}

export function Calendar({
  value,
  onSelect,
  min,
  max,
  locale = 'es-ES',
  weekStartsOn = 1,
  markedDays,
}: CalendarProps) {
  const today = useMemo(() => startOfDay(new Date()), [])
  const [view, setView] = useState<Date>(() => startOfMonth(value ?? today))

  const grid = useMemo(() => buildGrid(view, weekStartsOn), [view, weekStartsOn])
  const labels = useMemo(() => weekdayLabels(locale, weekStartsOn), [locale, weekStartsOn])
  const title = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(view),
    [locale, view],
  )

  const isDisabled = (d: Date): boolean => {
    if (min && isBefore(d, min)) return true
    if (max && isBefore(max, d)) return true
    return false
  }

  return (
    <YStack gap="$2" width={280}>
      <XStack alignItems="center" justifyContent="space-between">
        <NavButton onPress={() => setView((v) => addMonths(v, -1))} ariaLabel="Mes anterior">
          <ChevronLeft size={16} color="var(--color11)" />
        </NavButton>
        <Text
          fontFamily="$body"
          fontSize={14}
          fontWeight="700"
          color="$color"
          textTransform="capitalize"
          userSelect="none"
        >
          {title}
        </Text>
        <NavButton onPress={() => setView((v) => addMonths(v, 1))} ariaLabel="Mes siguiente">
          <ChevronRight size={16} color="var(--color11)" />
        </NavButton>
      </XStack>

      <XStack>
        {labels.map((lbl, i) => (
          <Stack key={i} flex={1} alignItems="center" paddingVertical="$1">
            <Text
              fontFamily="$body"
              fontSize={11}
              fontWeight="600"
              color="$color11"
              textTransform="capitalize"
              userSelect="none"
            >
              {lbl}
            </Text>
          </Stack>
        ))}
      </XStack>

      <YStack>
        {Array.from({ length: 6 }, (_, row) => (
          <XStack key={row}>
            {grid.slice(row * 7, row * 7 + 7).map((day) => {
              const outside = day.getMonth() !== view.getMonth()
              const selected = value ? isSameDay(day, value) : false
              const current = isSameDay(day, today)
              const disabled = isDisabled(day)
              return (
                <DayCell
                  key={day.getTime()}
                  day={day.getDate()}
                  outside={outside}
                  selected={selected}
                  current={current}
                  disabled={disabled}
                  marked={!!markedDays?.has(calendarDayKey(day))}
                  onPress={() => !disabled && onSelect(startOfDay(day))}
                />
              )
            })}
          </XStack>
        ))}
      </YStack>
    </YStack>
  )
}

function NavButton({
  onPress,
  ariaLabel,
  children,
}: {
  onPress: () => void
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <Stack
      tag="button"
      role="button"
      aria-label={ariaLabel}
      onPress={onPress}
      width={28}
      height={28}
      borderRadius={8}
      alignItems="center"
      justifyContent="center"
      cursor="pointer"
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$background"
      hoverStyle={{ backgroundColor: '$color2' }}
    >
      {children}
    </Stack>
  )
}

function DayCell({
  day,
  outside,
  selected,
  current,
  disabled,
  marked,
  onPress,
}: {
  day: number
  outside: boolean
  selected: boolean
  current: boolean
  disabled: boolean
  marked?: boolean
  onPress: () => void
}) {
  const textColor = selected ? '$background' : outside ? '$color11' : '$color'
  return (
    <Stack flex={1} alignItems="center" paddingVertical={2}>
      <Stack
        tag="button"
        role="button"
        aria-current={current ? 'date' : undefined}
        aria-selected={selected}
        onPress={onPress}
        width={34}
        height={34}
        borderRadius={100}
        alignItems="center"
        justifyContent="center"
        cursor={disabled ? 'not-allowed' : 'pointer'}
        opacity={disabled ? 0.35 : outside ? 0.55 : 1}
        borderWidth={current && !selected ? 1 : 0}
        borderColor="$borderColor"
        backgroundColor={selected ? '$color' : 'transparent'}
        hoverStyle={disabled ? {} : { backgroundColor: selected ? '$color' : '$color2' }}
        animation="fast"
        position="relative"
      >
        <Text
          fontFamily="$body"
          fontSize={13}
          fontWeight={selected || current ? '700' : '500'}
          color={textColor}
          userSelect="none"
        >
          {day}
        </Text>
        {marked && !selected ? (
          <Stack
            position="absolute"
            bottom={3}
            width={5}
            height={5}
            borderRadius={100}
            backgroundColor="$color"
          />
        ) : null}
      </Stack>
    </Stack>
  )
}

Calendar.displayName = 'Calendar'
