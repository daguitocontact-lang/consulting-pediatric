// Value formatting shared by the pages. Pure functions, no DOM: the same numbers
// are rendered by React now, and the panel had these scattered across pages
// before.

/** Nights sold — what the operator counts, not calendar days. */
export function nights(checkIn: string, checkOut: string): number {
  const ms = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)
  return Number.isFinite(ms) ? Math.max(Math.round(ms / 86_400_000), 0) : 0
}

/** COP with no decimals: prices here are always whole pesos. */
export function money(value: string | number | null): string {
  if (value === null || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? `$${Math.round(n).toLocaleString('es-CO')}` : '—'
}

/** Today in the browser's timezone — the property's day, not UTC's. */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/**
 * A date shifted by `days`, or the input back when it is not a date at all.
 *
 * The guard is not defensive dressing: `<input type="date">` reports '' for
 * every incomplete value, so a half-typed day reaches here as an empty string —
 * and `new Date('T00:00:00Z').toISOString()` THROWS. Thrown from an onPress
 * handler that is exactly a button that does nothing when pressed.
 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d.toISOString().slice(0, 10) < to;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/**
 * A date as reception says it: "10 sep", or "10 sep 2027" when the year is not
 * the current one. Built from the parts rather than from `new Date(iso)`, which
 * reads a bare YYYY-MM-DD as UTC midnight and shows the day before for anyone
 * west of Greenwich — Colombia included.
 */
export function shortDate(iso: string, lang: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(y, m - 1, d)
  const sameYear = y === new Date().getFullYear()
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'es-CO', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
    .format(date)
    .replace('.', '')
}

/** 'today' | 'tomorrow' | 'yesterday' for the dates worth a word, else null. */
export function nearDay(iso: string): 'today' | 'tomorrow' | 'yesterday' | null {
  const now = today()
  if (iso === now) return 'today'
  if (iso === addDays(now, 1)) return 'tomorrow'
  if (iso === addDays(now, -1)) return 'yesterday'
  return null
}

/**
 * Money for an axis gutter: `$1,7M`, `$320k`.
 *
 * `money()` is the right answer everywhere a figure is read on its own, and the
 * wrong one in a 34px column — "$1.716.000" either clips or pushes the plot
 * sideways. Two significant figures is all an axis label is for; the exact
 * number is one hover away in the readout.
 */
export function compactMoney(value: number, lang = 'es'): string {
  const locale = lang === 'en' ? 'en-GB' : 'es-CO'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`
  if (abs >= 1_000) return `$${Math.round(value / 1_000).toLocaleString(locale)}k`
  return `$${Math.round(value).toLocaleString(locale)}`
}
