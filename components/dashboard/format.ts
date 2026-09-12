import { formatCents } from '@/lib/money'

/** What a tile or ledger figure is: a count, hours, or cents. */
export type FigureKind = 'int' | 'hours' | 'money'

/** Money with a true minus sign: -12345 -> "−$123.45". Never rounded. */
export function money(cents: number): string {
  return cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents)
}

/** "23.0 hr" — one decimal, the app's hour unit. */
export function hours(h: number): string {
  return `${(Math.round(h * 10) / 10).toFixed(1)} hr`
}

/** The figure in its own unit, for the change-in-words line and the strip. */
export function figure(kind: FigureKind, v: number): string {
  if (kind === 'money') return money(v)
  if (kind === 'hours') return hours(v)
  return Math.round(v).toLocaleString('en-US')
}

/** The big tile figure: hours without the unit (the label carries it). */
export function bigFigure(kind: FigureKind, v: number): string {
  if (kind === 'hours') return (Math.round(v * 10) / 10).toFixed(1)
  return figure(kind, v)
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** "2026-08-12" -> "Aug 12". Local time, never UTC. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Whole days between an ISO date and now, floored at 0. */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(`${iso}T12:00:00`).getTime()
  if (Number.isNaN(then)) return 0
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000))
}

/** How old a debt is, in the shop's words. */
export function ageWords(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'a day old'
  if (days < 14) return `${days} days old`
  if (days < 28) return `${Math.floor(days / 7)} weeks old`
  if (days < 60) return 'a month old'
  if (days < 365) return `${Math.floor(days / 30)} months old`
  return days < 730 ? 'a year old' : `${Math.floor(days / 365)} years old`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}
