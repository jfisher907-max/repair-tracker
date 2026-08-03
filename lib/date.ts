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
