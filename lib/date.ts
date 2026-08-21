/**
 * "2026-07-22" -> "July 22, 2026". Parses as local time (not UTC) so the
 * printed date never shifts a day across timezones. Falls back to the raw
 * string for anything unparseable.
 */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** "2026-07-22" -> "Jul 22, 2026". For list rows, where the long month runs wide. */
export function formatDateShort(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Today as YYYY-MM-DD in the LOCAL timezone. toISOString() is UTC, which is
 * already tomorrow for part of the day and made date comparisons fire early.
 */
export function todayLocalIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
