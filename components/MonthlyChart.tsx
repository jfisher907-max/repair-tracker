'use client'

import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { formatCents, formatHours } from '@/lib/money'

/** One live job, reduced to what the month-by-month chart plots. */
export interface MonthlyJob {
  /** The job's date (YYYY-MM-DD) — the month its work lands in. */
  date: string
  hours: number
  /** job_totals.profit_cents: labor + parts charged − parts cost (counter tax included). */
  profitCents: number
  /** Approved parts still waiting on their receipt, so the job's profit reads high. */
  uncosted: boolean
}

/** Inline styles that also carry the custom properties the chart CSS reads. */
type ChartStyle = CSSProperties & Record<string, string | number>

/** future = not here yet; before = the shop wasn't on the app yet. Neither is a slow month. */
type MonthState = 'open' | 'future' | 'before'

interface Month {
  jobs: number
  hours: number
  profit: number
  uncosted: number
  state: MonthState
}

interface Series {
  name: string
  /** What the tallest bar is called in the panel header. */
  top: string
  color: string
  /** The darker step of the same hue at the baseline: the data gradient's other end. */
  base: string
  value: (m: Month) => number
  /** Header and table form: "$3,314", "6 jobs", "23 hr". */
  full: (v: number) => string
  /** Axis ticks and the label on the tallest bar: "$3.3k", "6", "23". */
  compact: (v: number) => string
  integer: boolean
  /** Mark months whose profit is overstated by parts not costed yet. */
  dots: boolean
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3))

const round1 = (n: number) => Math.round(n * 10) / 10
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** 331414 -> "$3.3k", 78500 -> "$785". Axis ticks and the tallest-bar cap only:
 *  abbreviation is accepted on the plot, never in a row or a reading. */
function compactDollars(cents: number): string {
  const d = Math.abs(cents) / 100
  let body: string
  if (d >= 1000) {
    const k = (d / 1000).toFixed(d >= 10000 ? 0 : 1)
    body = `${k.endsWith('.0') ? k.slice(0, -2) : k}k`
  } else {
    body = String(Math.round(d))
  }
  return `${cents < 0 ? '−' : ''}$${body}`
}

const SERIES: Series[] = [
  {
    name: 'Profit',
    top: 'best',
    color: 'var(--chart-profit)',
    base: 'var(--chart-profit-base)',
    value: (m) => m.profit,
    full: formatCents,
    compact: compactDollars,
    integer: true,
    dots: true,
  },
  {
    name: 'Jobs',
    top: 'busiest',
    color: 'var(--chart-busy)',
    base: 'var(--chart-busy-base)',
    value: (m) => m.jobs,
    full: (v) => plural(v, 'job'),
    compact: (v) => String(v),
    integer: true,
    dots: false,
  },
  {
    name: 'Labor hours',
    top: 'busiest',
    color: 'var(--chart-busy)',
    base: 'var(--chart-busy-base)',
    value: (m) => m.hours,
    full: (v) => formatHours(round1(v)),
    compact: (v) => String(round1(v)),
    integer: false,
    dots: false,
  },
]

/** The smallest 1 / 2 / 2.5 / 5 × 10^k that is at least `raw`. */
function niceStep(raw: number, integer: boolean): number {
  const exp = 10 ** Math.floor(Math.log10(raw))
  for (const f of [1, 2, 2.5, 5, 10]) {
    const step = f * exp
    if (integer && !Number.isInteger(step)) continue
    if (step >= raw) return step
  }
  return 10 * exp
}

/** A zero-anchored axis with about three clean gridlines. */
function scaleFor(values: number[], integer: boolean) {
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  if (max === 0 && min === 0) return { lo: 0, hi: 1, ticks: [0] }
  const step = niceStep(Math.max(max, -min) / 3, integer)
  const hi = Math.ceil(max / step) * step
  // A small loss gets half a step of room under the line instead of a whole
  // one — a $30 loss month shouldn't cost the bars a third of the plot.
  const lo = -min >= step / 2 ? -Math.ceil(-min / step) * step : min < 0 ? -step / 2 : 0
  // Only whole steps get a gridline, so the half-step floor stays unlabeled.
  const start = lo <= -step ? Math.round(lo / step) : 0
  const end = Math.round(hi / step)
  return { lo, hi, ticks: Array.from({ length: end - start + 1 }, (_, i) => (start + i) * step) }
}

/**
 * Profit, jobs, and labor hours per month for one year (or every year added
 * together), as three small charts on a shared Jan–Dec axis — three units, so
 * never one chart with two scales. Tapping a month lines it up in all three.
 */
export default function MonthlyChart({ jobs, year }: { jobs: MonthlyJob[]; year: 'all' | number }) {
  const [hover, setHover] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const active = hover ?? pinned

  const months = useMemo<Month[]>(() => {
    const now = new Date()
    const thisYear = now.getFullYear()
    const thisMonth = now.getMonth()
    // The first job ever logged, across ALL years: the months before it
    // weren't slow, the shop just wasn't on the app yet.
    let first: string | null = null
    for (const j of jobs) if (first === null || j.date < first) first = j.date
    const firstKey = first ? Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7)) - 1 : null

    const out: Month[] = Array.from({ length: 12 }, (_, m) => {
      let state: MonthState = 'open'
      if (year !== 'all') {
        const key = year * 12 + m
        if (key > thisYear * 12 + thisMonth) state = 'future'
        else if (firstKey !== null && key < firstKey) state = 'before'
      }
      return { jobs: 0, hours: 0, profit: 0, uncosted: 0, state }
    })
    for (const j of jobs) {
      if (year !== 'all' && Number(j.date.slice(0, 4)) !== year) continue
      const m = out[Number(j.date.slice(5, 7)) - 1]
      if (!m) continue
      m.jobs += 1
      m.hours += j.hours
      m.profit += j.profitCents
      if (j.uncosted) m.uncosted += 1
      // A job dated ahead (booked for next month) still counts where it lands.
      m.state = 'open'
    }
    return out
  }, [jobs, year])

  const totals = months.reduce(
    (t, m) => ({ jobs: t.jobs + m.jobs, hours: t.hours + m.hours, profit: t.profit + m.profit }),
    { jobs: 0, hours: 0, profit: 0 },
  )
  const anyUncosted = months.some((m) => m.uncosted > 0)

  function describe(i: number): string {
    const m = months[i]
    const label = year === 'all' ? `${MONTH_NAMES[i]}, all years` : `${MONTH_NAMES[i]} ${year}`
    if (m.state === 'future') return `${label}: not here yet`
    if (m.state === 'before') return `${label}: before you started logging jobs here`
    return `${label}: ${formatCents(m.profit)} profit · ${plural(m.jobs, 'job')} · ${formatHours(round1(m.hours))} of labor`
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    let next: number
    if (e.key === 'ArrowRight') next = active === null ? 0 : Math.min(11, active + 1)
    else if (e.key === 'ArrowLeft') next = active === null ? 11 : Math.max(0, active - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = 11
    else if (e.key === 'Escape') {
      setHover(null)
      setPinned(null)
      return
    } else return
    e.preventDefault()
    setHover(null)
    setPinned(next)
  }

  const idle =
    year === 'all'
      ? 'Every year added together — each bar is every January, every February…'
      : 'Tap a month to line it up in all three.'

  // The answer in words: the month that earned the most, and the busiest one
  // (most labor hours, ties broken by jobs). Only open months compete.
  const open = months.map((m, i) => ({ m, i })).filter(({ m }) => m.state === 'open' && m.jobs > 0)
  let answer: string | null = null
  let answerSub: string | null = null
  if (open.length > 0) {
    const best = open.reduce((a, b) => (b.m.profit > a.m.profit ? b : a))
    const busiest = open.reduce((a, b) =>
      b.m.hours > a.m.hours || (b.m.hours === a.m.hours && b.m.jobs > a.m.jobs) ? b : a,
    )
    const line = (m: Month) =>
      `${formatCents(m.profit)} earned · ${plural(m.jobs, 'job')} · ${formatHours(round1(m.hours))}`
    if (best.i === busiest.i) {
      answer = `Best and busiest month: ${MONTH_NAMES[best.i]}`
      answerSub = line(best.m)
    } else {
      answer = `Best month: ${MONTH_NAMES[best.i]} · Busiest: ${MONTH_NAMES[busiest.i]}`
      answerSub = `${MONTH_SHORT[best.i]} ${line(best.m)} · ${MONTH_SHORT[busiest.i]} ${line(busiest.m)}`
    }
  }

  return (
    <section className="card board-chart" aria-labelledby="mchart-title">
      <div className="chart-top">
        <div>
          <h2 id="mchart-title" className="label !mb-0">
            Month by month · {year === 'all' ? 'all years' : year}
          </h2>
          {answer && <p className="chart-answer">{answer}</p>}
          <p className="chart-live" aria-live="polite">
            {active !== null ? describe(active) : answerSub ? `${answerSub}. ${idle}` : idle}
          </p>
        </div>
        <p className="chart-note">
          Profit here is what each month&apos;s work earned, paid or not, before overhead
          {totals.jobs > 0 && (
            <>
              {' '}— <span className="money">{formatCents(totals.profit)}</span> for{' '}
              {year === 'all' ? 'all years' : year}
            </>
          )}
          . The Cash profit tile counts money when it reaches you.
        </p>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
        >
          {asTable ? 'Chart' : 'Table'}
        </button>
      </div>

      {totals.jobs === 0 ? (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--text3)' }}>
          No jobs dated in {year === 'all' ? 'any year' : year} yet.
        </p>
      ) : asTable ? (
        <MonthTable months={months} totals={totals} />
      ) : (
        <div
          key={String(year)}
          className="mchart-group"
          role="group"
          aria-label="Profit, jobs, and labor hours by month. Left and right arrow keys step through the months."
          tabIndex={0}
          onKeyDown={onKey}
        >
          {SERIES.map((s) => (
            <Panel
              key={s.name}
              series={s}
              months={months}
              active={active}
              onHover={setHover}
              onPick={(i) => setPinned((p) => (p === i ? null : i))}
            />
          ))}
        </div>
      )}

      {anyUncosted && (
        <p className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--text3)' }}>
          <i className="mchart-dot mt-[5px] shrink-0" aria-hidden="true" />
          <span>
            A month marked with a dot has a job whose approved parts are still waiting on their
            receipt, so its profit reads high until you enter it.
          </span>
        </p>
      )}
    </section>
  )
}

function Panel({
  series,
  months,
  active,
  onHover,
  onPick,
}: {
  series: Series
  months: Month[]
  active: number | null
  onHover: (i: number | null) => void
  onPick: (i: number) => void
}) {
  const values = months.map(series.value)
  const { lo, hi, ticks } = scaleFor(values, series.integer)
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100
  const zero = pct(0)
  const total = values.reduce((s, v) => s + v, 0)

  // Label only the extreme; a tie across three or more months labels none.
  const openValues = values.filter((_, i) => months[i].state === 'open')
  const max = openValues.length ? Math.max(...openValues) : 0
  const best = values.map((v, i) => max > 0 && v === max && months[i].state === 'open')
  const bestCount = best.filter(Boolean).length
  const firstBest = best.indexOf(true)

  let reading: string
  if (active !== null) {
    const m = months[active]
    reading =
      m.state === 'future'
        ? `${MONTH_SHORT[active]} · not yet`
        : m.state === 'before'
          ? `${MONTH_SHORT[active]} · before the app`
          : `${MONTH_SHORT[active]} · ${series.full(values[active])}`
  } else {
    reading =
      firstBest >= 0
        ? `${series.full(total)} · ${series.top} ${MONTH_SHORT[firstBest]}`
        : series.full(total)
  }

  return (
    <div className="mchart-panel" style={{ '--bar': series.color, '--bar-base': series.base } as ChartStyle}>
      <div className="mchart-head">
        <span className="mchart-name">{series.name}</span>
        <span className="mchart-read">{reading}</span>
      </div>
      <div className="mchart-body">
        <div className="mchart-y" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ bottom: `${pct(t)}%` }}>
              {series.compact(t)}
            </span>
          ))}
        </div>
        <div
          className="mchart-plot"
          data-has-active={active !== null || undefined}
          onPointerLeave={() => onHover(null)}
        >
          {ticks.map((t) => (
            <div
              key={t}
              className="mchart-grid"
              data-zero={t === 0 || undefined}
              style={{ bottom: `${pct(t)}%` }}
            />
          ))}
          {months.map((m, i) => {
            const v = values[i]
            const neg = v < 0
            const barStyle: ChartStyle = neg
              ? { top: `${100 - zero}%`, height: `${zero - pct(v)}%`, '--i': i }
              : { bottom: `${zero}%`, height: `${pct(v) - zero}%`, '--i': i }
            return (
              <div
                key={i}
                className="mchart-col"
                data-active={active === i || undefined}
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse') onHover(i)
                }}
                onClick={() => onPick(i)}
              >
                {v !== 0 && <div className="mchart-bar" data-neg={neg || undefined} style={barStyle} />}
                {best[i] && bestCount <= 2 && (
                  <span className="mchart-cap" style={{ bottom: `calc(${pct(v)}% + 3px)` }}>
                    {series.compact(v)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mchart-x" aria-hidden="true">
        {months.map((m, i) => (
          <span
            key={i}
            data-muted={m.state !== 'open' || undefined}
            data-active={active === i || undefined}
          >
            {MONTH_SHORT[i]}
            {series.dots && m.uncosted > 0 && <i className="mchart-dot" />}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The chart's twin: every value readable without hovering or tapping. */
function MonthTable({
  months,
  totals,
}: {
  months: Month[]
  totals: { jobs: number; hours: number; profit: number }
}) {
  return (
    <table className="mchart-table">
      <thead>
        <tr>
          <th scope="col">Month</th>
          <th scope="col">Jobs</th>
          <th scope="col">Labor</th>
          <th scope="col">Profit</th>
        </tr>
      </thead>
      <tbody>
        {months.map((m, i) => (
          <tr key={i} data-muted={m.state !== 'open' || undefined}>
            <th scope="row">
              {MONTH_NAMES[i]}
              {m.uncosted > 0 && <i className="mchart-dot ml-1.5 !inline-block align-middle" aria-label="profit reads high — a parts receipt isn't in yet" />}
            </th>
            {m.state === 'open' ? (
              <>
                <td>{m.jobs}</td>
                <td>{formatHours(round1(m.hours))}</td>
                <td className={m.profit < 0 ? 'money-owed' : undefined}>{formatCents(m.profit)}</td>
              </>
            ) : (
              <td colSpan={3}>{m.state === 'future' ? 'not yet' : 'before the app'}</td>
            )}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total</th>
          <td>{totals.jobs}</td>
          <td>{formatHours(round1(totals.hours))}</td>
          <td className={totals.profit < 0 ? 'money-owed' : undefined}>{formatCents(totals.profit)}</td>
        </tr>
      </tfoot>
    </table>
  )
}
