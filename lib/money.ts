const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const int = new Intl.NumberFormat('en-US')

/** 12345 -> "$123.45" (negatives render as -$1.23) */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return '—'
  return usd.format(cents / 100)
}

/** Dollars-and-cents user input ("123.45", "$1,234", "-5") -> integer cents, or null if unparseable. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const value = Number(cleaned)
  if (Number.isNaN(value)) return null
  return Math.round(value * 100)
}

/** Integer cents -> "123.45" for populating an <input>. Empty string for null. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toFixed(2)
}

/** 123456 -> "123,456" (mileage etc.) */
export function formatMiles(miles: number | null | undefined): string {
  if (miles == null) return '—'
  return int.format(miles)
}

export function formatHours(hours: number | null | undefined): string {
  if (hours == null) return '—'
  return `${Number(hours)} hr`
}
