import type { Job } from '@/lib/types'

/**
 * Actual time vs book time (0068). Owner-only: none of this ever reaches the
 * customer's paper or the public token pages.
 *
 * Book time is jobs.labor_hours, the hours billed. Actual time is what Jake
 * logged on himself: jobs.actual_hours, plus the clock while it runs.
 * Efficiency = book / actual. 100% = on book, above = beat it.
 */

/**
 * What the clock functions actually touch. Separate from TimeFields because
 * only the efficiency maths needs the billed hours: the running-clock bar
 * reads four columns off a job and must not have to select a fifth it will
 * never use.
 */
type ClockFields = {
  actual_hours?: number | string | null
  clock_started_at?: string | null
}

type TimeFields = Pick<Job, 'labor_hours'> & ClockFields

/** Hours since the clock started, never negative. 0 when it isn't running. */
export function runningHours(clockStartedAt: string | null | undefined, now = Date.now()): number {
  if (!clockStartedAt) return 0
  const ms = now - new Date(clockStartedAt).getTime()
  return Number.isFinite(ms) && ms > 0 ? ms / 3_600_000 : 0
}

/** Logged hours plus the running clock. Null = time not tracked on this job. */
export function actualHours(job: ClockFields, now = Date.now()): number | null {
  const running = runningHours(job.clock_started_at, now)
  if (job.actual_hours == null && !job.clock_started_at) return null
  return Number(job.actual_hours ?? 0) + running
}

/** What Start writes: the clock runs from now; an untracked job starts at 0 logged. */
export function clockStartPatch(job: ClockFields): { clock_started_at: string; actual_hours: number } {
  return { clock_started_at: new Date().toISOString(), actual_hours: Number(job.actual_hours ?? 0) }
}

/** What Stop writes: the running time is added to the logged hours and the clock clears. */
export function clockStopPatch(job: ClockFields): { actual_hours: number; clock_started_at: null } {
  return {
    actual_hours: roundHours(Number(job.actual_hours ?? 0) + runningHours(job.clock_started_at)),
    clock_started_at: null,
  }
}

/**
 * Fired after a clock is started or stopped anywhere in the app, so the
 * running-clock bar in the shell can refresh at once instead of waiting for
 * its backstop poll. A plain window event rather than a store: the bar is the
 * only listener, and the two buttons that start and stop a clock
 * (JobClockButton, JobTimeCard) are nowhere near it in the tree.
 */
export const CLOCK_CHANGED = 'wnt:clock-changed'

export function notifyClockChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLOCK_CHANGED))
}

/** Rounded to the hundredth the column stores. */
export function roundHours(h: number): number {
  return Math.round(h * 100) / 100
}

/** Book / actual as a percentage, or null when there is nothing to compare. */
export function efficiencyPct(bookHours: number, actual: number | null): number | null {
  if (actual == null || actual <= 0 || !(bookHours > 0)) return null
  return Math.round((bookHours / actual) * 100)
}

export function formatPct(pct: number | null): string {
  return pct == null ? '—' : `${pct}%`
}

/** 1.5 → "1.5 hr", 0.25 → "0.25 hr". */
export function formatHours(h: number): string {
  return `${Number(roundHours(h).toFixed(2))} hr`
}

/** 0.75 → "0:45" for the running clock. */
export function formatClock(h: number): string {
  const totalMin = Math.floor(h * 60)
  return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`
}

/** Green when beating book, amber within 15% under, red past that. */
export function efficiencyColor(pct: number | null): string {
  if (pct == null) return 'var(--text3)'
  if (pct >= 100) return 'var(--green)'
  if (pct >= 85) return 'var(--orange)'
  return 'var(--red)'
}

export interface EfficiencySummary {
  jobs: number
  bookHours: number
  actualHours: number
  pct: number | null
}

/** Totals over jobs that have actual time logged and book time billed. */
export function summarizeEfficiency(jobs: TimeFields[], now = Date.now()): EfficiencySummary {
  let count = 0
  let book = 0
  let actual = 0
  for (const j of jobs) {
    const a = actualHours(j, now)
    const b = Number(j.labor_hours) || 0
    if (a == null || a <= 0 || b <= 0) continue
    count++
    book += b
    actual += a
  }
  return { jobs: count, bookHours: book, actualHours: actual, pct: efficiencyPct(book, count ? actual : null) }
}
