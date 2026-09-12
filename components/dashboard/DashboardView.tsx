'use client'

import Link from 'next/link'
import { useMemo, useState, useSyncExternalStore } from 'react'
import JobRow from '@/components/JobRow'
import MonthlyChart, { type MonthlyJob } from '@/components/MonthlyChart'
import type { BusinessDocument } from '@/components/BusinessDocuments'
import type { CoreOut } from '@/lib/cores'
import { computeFinances, financeYears, isBookedJob, type FinanceRows, type MonthFigures } from '@/lib/finances'
import ActionLane, { type BillingCounts } from './ActionLane'
import EarnedBar from './EarnedBar'
import MoneyLedger from './MoneyLedger'
import MonthVsStrip from './MonthVsStrip'
import ScheduleCalendar from './ScheduleCalendar'
import TrendTile, { type TrendScope } from './TrendTile'
import { ageWords, daysSince, money, plural, shortDate } from './format'

const LEDGER_KEY = 'dash-ledger-open'
const LEDGER_ID = 'dash-ledger'

// Whether the ledger is open sticks per device. It lives outside React (the
// browser's storage is the external system), read through useSyncExternalStore
// so the server renders it closed and the client picks up the saved choice
// without a hydration fight. A device that refuses storage still toggles.
let ledgerMemory: boolean | null = null
const ledgerListeners = new Set<() => void>()
function readLedgerOpen(): boolean {
  if (ledgerMemory !== null) return ledgerMemory
  try {
    return localStorage.getItem(LEDGER_KEY) === '1'
  } catch {
    return false
  }
}
function writeLedgerOpen(open: boolean) {
  ledgerMemory = open
  try {
    localStorage.setItem(LEDGER_KEY, open ? '1' : '0')
  } catch {}
  for (const l of ledgerListeners) l()
}
function subscribeLedger(listener: () => void) {
  ledgerListeners.add(listener)
  return () => {
    ledgerListeners.delete(listener)
  }
}

/**
 * The shop board. Presentational: everything it shows comes in as props, so a
 * throwaway route can render it with fixture data. It owns only the year
 * select and whether the ledger is open.
 */
export default function DashboardView({
  rows,
  cores,
  docAlerts,
  newRequests,
  billing,
  businessName,
  now: nowProp,
}: {
  rows: FinanceRows
  cores: CoreOut[]
  docAlerts: BusinessDocument[]
  newRequests: number
  billing: BillingCounts
  businessName: string
  now?: Date
}) {
  const [year, setYear] = useState<'all' | number>('all')
  // One clock for the whole render, so the memos below do not churn.
  const [now] = useState(() => nowProp ?? new Date())
  // Closed by default — it is a "how am I really doing" panel, not a glance
  // panel. The choice sticks per device.
  const ledgerOpen = useSyncExternalStore(subscribeLedger, readLedgerOpen, () => false)
  const toggleLedger = () => writeLedgerOpen(!ledgerOpen)

  const years = useMemo(() => financeYears(rows), [rows])
  const f = useMemo(() => computeFinances(rows, year, now), [rows, year, now])
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth()
  // The strip and the tiles' "so far" lines are about NOW, whatever year the
  // big figures show: all time and this year read the live months; a past
  // year's tiles read its own December, and the strip stays on today.
  const live = useMemo(
    () => (year === thisYear ? f : computeFinances(rows, thisYear, now)),
    [rows, year, thisYear, now, f],
  )
  const liveScope: TrendScope | null =
    year === 'all' || year === thisYear
      ? { months: live.months, now: thisMonth, running: true }
      : year < thisYear
        ? { months: f.months, now: 11, running: false }
        : null
  const previousMonth: MonthFigures | null = useMemo(() => {
    if (thisMonth > 0) return live.months[thisMonth - 1]
    return computeFinances(rows, thisYear - 1, now).months[11]
  }, [rows, live, thisYear, thisMonth, now])

  // The chart buckets by JOB date, so profit, job count and hours for a month
  // all come from the same jobs and the three panels line up. It does its own
  // year filtering (it needs all years to know when tracking started), so it
  // gets every DONE job, not the scoped list: a scheduled or in-progress job
  // is not work yet (0043), the same rule the tiles read from Finances.
  const chartJobs = useMemo<MonthlyJob[]>(
    () =>
      rows.jobs
        .filter((it) => !isBookedJob(it.job))
        .map((it) => ({
          date: it.job.date,
          hours: Number(it.job.labor_hours),
          profitCents: it.totals?.profit_cents ?? 0,
          uncosted: rows.uncostedJobIds.has(it.job.id),
        })),
    [rows],
  )

  const scopedJobs = useMemo(
    () => (year === 'all' ? rows.jobs : rows.jobs.filter((it) => Number(it.job.date.slice(0, 4)) === year)),
    [rows, year],
  )
  const recent = scopedJobs.slice(0, 6)

  const today = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const yearWords = year === 'all' ? 'all time' : year === thisYear ? 'this year' : String(year)

  const oldest = f.oldestOwed
  const oldestAge = oldest ? daysSince(oldest.date, now) : 0

  // "The rest is the unpaid jobs" is only true when earned − cash profit is
  // exactly what is owed; cash or parts crossing the year line breaks that,
  // and the ledger below names the timing gap, so the tile must not deny it.
  // Scheduled work (0043) is the other piece: parts bought for it are cash
  // out before any work is earned, and deposits held on it are cash in — the
  // identity is earned − owed − parts for scheduled work + deposits held =
  // cash profit, and the scheduled pieces are named only when they are there.
  const bridgeGap = f.earned - f.unpaid - f.partsSpendOnBooked + f.depositsOnBooked - f.cashProfit
  // The pieces that WIDEN the gap between earned and cash (owed, parts out
  // ahead of the work, timing) read "plus"; deposits held NARROW it — cash
  // in ahead of the work — so they carry their own sign, "less".
  const plusParts = [
    f.owedJobs > 0 ? plural(f.owedJobs, 'unpaid job') : '',
    f.partsSpendOnBooked > 0 ? `${money(f.partsSpendOnBooked)} of parts bought for scheduled work` : '',
    bridgeGap !== 0 ? 'timing across the year line' : '',
  ].filter(Boolean)
  const lessDeposits =
    f.depositsOnBooked > 0 ? `less ${money(f.depositsOnBooked)} held as deposits on scheduled work` : ''
  const restWords =
    plusParts.length === 0
      ? lessDeposits
        ? `; ${money(f.depositsOnBooked)} of it is deposits held on scheduled work`
        : ''
      : plusParts.length === 1 && f.owedJobs > 0 && !lessDeposits
        ? `; the rest is the ${plusParts[0]}`
        : `; the rest is ${plusParts.join(', plus ')}${lessDeposits ? `, ${lessDeposits}` : ''}`
  const cashHint =
    f.taxCollected > 0
      ? `collected − parts − ${money(f.taxCollected)} sales tax${restWords}`
      : `collected − parts${restWords || ', before overhead'}`

  return (
    <div className="board">
      <div className="board-head">
        <div>
          <div className="board-eyebrow">{today}</div>
          <h1>{businessName || 'Dashboard'}</h1>
        </div>
        <div className="board-tools">
          <label className="sr-only" htmlFor="dash-year">
            Year
          </label>
          <select
            id="dash-year"
            className="select"
            value={String(year)}
            onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All time</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <Link href="/quotes/new" className="btn">
            + New Quote
          </Link>
          <Link href="/jobs/new" className="btn btn-primary">
            + New Job
          </Link>
        </div>
      </div>

      <ActionLane f={f} cores={cores} docAlerts={docAlerts} newRequests={newRequests} billing={billing} now={now} />

      {/* The drop-off calendar (owner, 2026-09-12) sits right under the lane
          on both layouts; on the desktop board it is a full-width row, so the
          board scrolls — accepted. It reads every job, not the year's: a
          booking is about a day, not a year of books. */}
      <ScheduleCalendar jobs={rows.jobs} now={now} />

      <section className="board-tiles" aria-label={`${yearWords} so far`} key={String(year)}>
        <TrendTile
          label="Jobs"
          kind="int"
          total={f.count}
          series="busy"
          t={0}
          trend={liveScope ? { scope: liveScope, pick: (m) => m.jobs } : undefined}
          hint={`jobs done, dated ${yearWords}, paid or not`}
        />
        <TrendTile
          label="Labor hours"
          kind="hours"
          total={f.hours}
          series="busy"
          t={1}
          trend={liveScope ? { scope: liveScope, pick: (m) => m.hours } : undefined}
          hint="hours sold on those jobs"
        />
        <TrendTile
          label="Billed"
          kind="money"
          total={f.charged}
          series="neutral"
          t={2}
          trend={liveScope ? { scope: liveScope, pick: (m) => m.billed } : undefined}
          hint="what the done work came to, before tax"
        />
        <TrendTile
          label="Collected"
          kind="money"
          total={f.collected}
          valueTone="in"
          series="profit"
          t={3}
          trend={liveScope ? { scope: liveScope, pick: (m) => m.collected } : undefined}
          hint="payments received, tax included"
        />
        <TrendTile
          label="Parts spend"
          kind="money"
          total={f.partsSpend}
          series="neutral"
          t={4}
          wide
          trend={liveScope ? { scope: liveScope, pick: (m) => m.partsSpend } : undefined}
          hint="your cost when bought, counter tax in"
        />
        <TrendTile
          label="Cash profit"
          kind="money"
          total={f.cashProfit}
          valueTone={f.cashProfit >= 0 ? 'in' : 'owed'}
          tone={f.cashProfit >= 0 ? 'ok' : 'stop'}
          series="profit"
          wide
          lead="lead"
          t={5}
          sub={
            <>
              of <b>{money(f.earned)}</b> earned on the work
            </>
          }
          expandable={{ open: ledgerOpen, onToggle: toggleLedger, controls: LEDGER_ID, name: 'Ledger' }}
          hint={cashHint}
        >
          <EarnedBar earned={f.earned} cashProfit={f.cashProfit} unpaid={f.unpaid} />
        </TrendTile>
        {/* Always in the DOM (hidden when closed) so aria-controls resolves, and
            right after the tile it expands so reading order matches the eye;
            .ledger-card's own grid-column and order keep it where it was. */}
        <MoneyLedger f={f} year={year} id={LEDGER_ID} now={now} hidden={!ledgerOpen} />
        <TrendTile
          label="Unpaid balance"
          kind="money"
          total={f.unpaid}
          valueTone={f.unpaid > 0 ? 'owed' : undefined}
          tone={f.unpaid > 0 ? 'stop' : 'ok'}
          series="loss"
          wide
          lead="second"
          t={6}
          trend={
            liveScope
              ? {
                  scope: liveScope,
                  pick: (m) => m.unpaid,
                  subExtra: (m) => (m.unpaidJobs > 0 ? ` across ${plural(m.unpaidJobs, 'job')}` : ''),
                }
              : undefined
          }
          hint={
            oldest ? (
              <>
                <span className="wnt-id">{oldest.jobNumber}</span> {money(oldest.cents)} · {shortDate(oldest.date)} ·{' '}
                {ageWords(oldestAge)}
                <span className="hint-long">
                  {' '}
                  — {oldest.title} for {oldest.customer}.
                  {f.uninvoicedJobs > 0 &&
                    ` ${f.uninvoicedJobs === f.owedJobs ? (f.owedJobs === 1 ? 'It is not invoiced' : `None of the ${f.owedJobs} is invoiced`) : `${f.uninvoicedJobs} of the ${f.owedJobs} are not invoiced`}; their parts are already bought.`}
                </span>
              </>
            ) : (
              'nothing owed to you'
            )
          }
        />
        <MonthVsStrip current={live.months[thisMonth]} previous={previousMonth} now={now} t={7} />
      </section>

      <MonthlyChart jobs={chartJobs} year={year} />

      <section className="recent" aria-label="Recent jobs">
        <div className="recent-head">
          <h2 className="section-title">Recent jobs</h2>
          <Link href="/jobs">View all →</Link>
        </div>
        {recent.map((it, i) => (
          <div key={it.job.id} className={`recent-item${i >= 3 ? ' recent-extra' : ''}`}>
            <JobRow item={it} />
          </div>
        ))}
      </section>

      <div className="doors">
        <Link href="/quotes/new" className="btn">
          + New Quote
        </Link>
        <Link href="/reports" className="btn">
          Reports
        </Link>
        <Link href="/expenses" className="btn">
          Expenses
        </Link>
      </div>
    </div>
  )
}
