'use client'

import Link from 'next/link'
import { useMemo, useState, useSyncExternalStore } from 'react'
import JobRow from '@/components/JobRow'
import MonthlyChart, { type MonthlyJob } from '@/components/MonthlyChart'
import type { BusinessDocument } from '@/components/BusinessDocuments'
import type { CoreOut } from '@/lib/cores'
import { resalePromptDue, salesTaxPaid, taxReminder } from '@/lib/sales-tax'
import type { Job, Settings, TaxBasis, TaxFiling } from '@/lib/types'
import {
  computeFinances,
  financeYears,
  isBookedJob,
  jobsToInvoice,
  type FinanceRows,
  type MonthFigures,
} from '@/lib/finances'
import ActionLane, { type BillingCounts } from './ActionLane'
import EarnedBar from './EarnedBar'
import MoneyLedger from './MoneyLedger'
import MonthVsStrip from './MonthVsStrip'
import ScheduleCalendar from './ScheduleCalendar'
import { Bench, Waiting, type Loaded, type NewRequest, type OpenInvoice, type OpenQuote } from './TodayLists'
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
 * The doors Today's lists stand in for; the lane leaves them out. Scheduled
 * stays: it carries the booked money and leads to work booked further out
 * than the bench shows.
 */
const LISTED_ON_TODAY = ['Billing', 'Requests', 'Quotes'] as const

/**
 * The shop board. Presentational: everything it shows comes in as props, so a
 * throwaway route can render it with fixture data. It owns only the year
 * select and whether the ledger is open.
 *
 * Two views on a phone (owner, 2026-11-16), switched by the URL so a link can
 * name either: Today is the work itself (on the bench, waiting on him, the
 * calendar, recent jobs) and Money is the figures (the tiles, the ledger, the
 * month chart). A desk has the room for both, so there the switch is hidden
 * and the board shows everything, Today's lists first.
 */
export default function DashboardView({
  rows,
  cores,
  docAlerts,
  newRequests,
  aogRequests = 0,
  billing,
  businessName,
  taxFilings,
  taxBasis = null,
  resaleCardPrompt,
  now: nowProp,
  view = 'today',
  requests,
  openInvoices,
  openQuotes,
  onJobPatch,
}: {
  /** Which half a phone shows. A desk shows both. */
  view?: 'today' | 'money'
  /** Unanswered requests, for Today's list. undefined = loading; null = the read failed. */
  requests?: Loaded<NewRequest>
  /** Invoices out or in draft, for Today's list. */
  openInvoices?: Loaded<OpenInvoice>
  /** Quotes out or in draft, for Today's list. */
  openQuotes?: Loaded<OpenQuote>
  /** Saves a clock start or stop from a bench card. */
  onJobPatch?: (jobId: string, patch: Partial<Job>) => Promise<void>
  rows: FinanceRows
  cores: CoreOut[]
  docAlerts: BusinessDocument[]
  newRequests: number
  /** How many of those open requests are AOG (0071); defaults to none. */
  aogRequests?: number
  billing: BillingCounts
  businessName: string
  /** Recorded tax filings (0053). undefined = still loading; null = could not be read. */
  taxFilings?: TaxFiling[] | null
  /** settings.sales_tax_basis; null = not chosen yet. */
  taxBasis?: TaxBasis | null
  /** settings.resale_card_prompt (0056): null = not answered yet; undefined = not read, or the column isn't there. */
  resaleCardPrompt?: Settings['resale_card_prompt']
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
  // The Taxes door waits for the filings read to finish, so a return already
  // recorded as filed never flashes up. A failed read (null) counts as
  // nothing recorded: the reminder errs toward showing.
  const taxes = useMemo(
    () => (taxFilings === undefined ? null : taxReminder(rows, taxFilings, taxBasis, now)),
    [rows, taxFilings, taxBasis, now],
  )
  const taxPaid = taxFilings === undefined ? undefined : taxFilings === null ? null : salesTaxPaid(taxFilings, year)
  // The resale-card door is the opposite: it errs toward staying away. Only a
  // settings row that says "not answered" (null, not undefined) and filings
  // that show the first return filed bring it up, so it never asks a question
  // whose "Hide this" could not save.
  const resaleCard = resalePromptDue(taxFilings, { resale_card_prompt: resaleCardPrompt })
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

  // The chart buckets by JOB date, so profit, job count, hours and parts cost
  // for a month all come from the same jobs and the four panels line up. It
  // does its own year filtering (it needs all years to know when tracking
  // started), so it gets every DONE job, not the scoped list: a scheduled or
  // in-progress job is not work yet (0043), the same rule the tiles read from
  // Finances.
  //
  // partsCostCents is job_totals.parts_cost_cents — what the parts ON THIS JOB
  // cost, counter tax included. It is deliberately NOT the Parts spend tile's
  // figure: that one is cash by PURCHASE date and includes parts bought for
  // work still scheduled. One basis per chart.
  const chartJobs = useMemo<MonthlyJob[]>(
    () =>
      rows.jobs
        .filter((it) => !isBookedJob(it.job))
        .map((it) => ({
          date: it.job.date,
          hours: Number(it.job.labor_hours),
          profitCents: it.totals?.profit_cents ?? 0,
          partsCostCents: it.totals?.parts_cost_cents ?? 0,
          uncosted: rows.uncostedJobIds.has(it.job.id),
        })),
    [rows],
  )

  const scopedJobs = useMemo(
    () => (year === 'all' ? rows.jobs : rows.jobs.filter((it) => Number(it.job.date.slice(0, 4)) === year)),
    [rows, year],
  )
  const recent = scopedJobs.slice(0, 6)

  // Today's lists read every job and every payment, whatever year the money
  // figures are showing: work on the bench and a bill unpaid are about now.
  const toInvoice = useMemo(() => jobsToInvoice(rows), [rows])
  const paidByJob = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of rows.payments) m.set(p.job_id, (m.get(p.job_id) ?? 0) + p.amount_cents)
    return m
  }, [rows])

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
  // Tips (0048) are cash profit that no job earned: they are in cashProfit and
  // nowhere in earned, so they enter the identity by name, like deposits.
  const bridgeGap = f.earned - f.unpaid - f.partsSpendOnBooked + f.depositsOnBooked + f.tips - f.cashProfit
  // PAYMENT cash taken over a job's bill (a tip not recorded as one, or money
  // owed back) is cash in that settles nothing billed. It is named as that, never as timing —
  // and what is left after it is called timing only when some cash in scope
  // really does cross the year line (Finances.crossesYearLine).
  // Cash above the charge on a done job with no invoice yet (paid ahead of the
  // invoice: the sales tax it will bill) narrows the gap the same way.
  const gapRest = bridgeGap + f.overCollected + f.paidAheadOfInvoice
  // Written out: earned − cash profit = owed + parts for scheduled work −
  // deposits held − tips − cash over a bill − cash paid ahead + gapRest. gapRest
  // keeps its OWN sign: positive widens the gap and reads "plus", negative
  // narrows it and reads "less". Its sign is never dropped.
  const restWord = f.crossesYearLine ? 'timing across the year line' : 'not reconciled'
  // Timing is named without an amount; an unexplained residual with one.
  const restPhrase = (cents: number) => (f.crossesYearLine ? restWord : `${money(cents)} ${restWord}`)
  // The pieces that WIDEN the gap between earned and cash (owed, parts out
  // ahead of the work, a positive residual) read "plus"; deposits held, tips, cash
  // over a bill, cash paid ahead of an invoice and a negative residual
  // NARROW it — cash in ahead of, or beyond, the work — and read "less".
  const plusParts = [
    f.owedJobs > 0 ? plural(f.owedJobs, 'unpaid job') : '',
    f.partsSpendOnBooked > 0 ? `${money(f.partsSpendOnBooked)} of parts bought for scheduled work` : '',
    gapRest > 0 ? restPhrase(gapRest) : '',
  ].filter(Boolean)
  const overWords =
    f.overCollected > 0
      ? `${money(f.overCollected)} collected over the invoice (${f.overCollectedJobs.map((j) => j.jobNumber).join(', ')})`
      : ''
  const aheadWords =
    f.paidAheadOfInvoice > 0
      ? `${money(f.paidAheadOfInvoice)} paid ahead of the invoice (${f.paidAheadJobs.map((j) => j.jobNumber).join(', ')})`
      : ''
  const restLessWords = gapRest < 0 ? restPhrase(-gapRest) : ''
  const tipWords = f.tips > 0 ? `${money(f.tips)} in tips` : ''
  const lessDeposits = [
    f.depositsOnBooked > 0 ? `${money(f.depositsOnBooked)} held as deposits on scheduled work` : '',
    tipWords,
    overWords,
    aheadWords,
    restLessWords,
  ]
    .filter(Boolean)
    .map((w) => `less ${w}`)
    .join(', ')
  const restWords =
    plusParts.length === 0
      ? lessDeposits
        ? `; ${[
            f.depositsOnBooked > 0 ? `${money(f.depositsOnBooked)} of it is deposits held on scheduled work` : '',
            tipWords ? `${money(f.tips)} of it is tips` : '',
            overWords ? `${overWords.replace(' collected', ' of it was collected')}` : '',
            aheadWords ? `${aheadWords.replace(' paid ahead', ' of it was paid ahead')}` : '',
            restLessWords
              ? f.crossesYearLine
                ? `some of it is ${restWord}`
                : `${money(-gapRest)} of it is ${restWord}`
              : '',
          ]
            .filter(Boolean)
            .join('; ')}`
        : ''
      : plusParts.length === 1 && f.owedJobs > 0 && !lessDeposits
        ? `; the rest is the ${plusParts[0]}`
        : `; the rest is ${plusParts.join(', plus ')}${lessDeposits ? `, ${lessDeposits}` : ''}`
  const tipsTerm = f.tips > 0 ? ` + ${money(f.tips)} tips` : ''
  const cashHint =
    f.taxCollected > 0
      ? `collected${tipsTerm} − parts − ${money(f.taxCollected)} sales tax${restWords}`
      : `collected${tipsTerm} − parts${restWords || ', before overhead'}`

  return (
    <div className="board" data-view={view}>
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
            className="select board-year"
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

      {/* Links, not buttons: the URL is the view, as on Jobs | Quotes. Both
          carry their value explicitly; a link that only drops a param does not
          navigate from inside a static page. Hidden on a desk, which shows
          both halves. */}
      <nav className="seg-track board-switch" aria-label="Today or money">
        <Link
          href="/dashboard?view=today"
          aria-current={view === 'today' ? 'page' : undefined}
          className={`seg-item ${view === 'today' ? 'on' : ''}`}
        >
          Today
        </Link>
        <Link
          href="/dashboard?view=money"
          aria-current={view === 'money' ? 'page' : undefined}
          className={`seg-item ${view === 'money' ? 'on' : ''}`}
        >
          Money
        </Link>
      </nav>

      {/* Above the lists on purpose: an aircraft on the ground and a return
          that is due outrank whatever is on the bench. */}
      <ActionLane
        f={f}
        cores={cores}
        docAlerts={docAlerts}
        newRequests={newRequests}
        aogRequests={aogRequests}
        billing={billing}
        taxes={taxes}
        resaleCard={resaleCard}
        now={now}
        listed={LISTED_ON_TODAY}
      />

      <Bench jobs={rows.jobs} now={now} onJobPatch={onJobPatch} />
      <Waiting
        requests={requests}
        toInvoice={toInvoice}
        invoices={openInvoices}
        quotes={openQuotes}
        paidByJob={paidByJob}
        now={now}
      />

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
          t={0}
          trend={liveScope ? { scope: liveScope, pick: (m) => m.jobs } : undefined}
          hint={`jobs done, dated ${yearWords}, paid or not`}
        />
        <TrendTile
          label="Labor hours"
          kind="hours"
          total={f.hours}
          t={1}
          trend={liveScope ? { scope: liveScope, pick: (m) => m.hours } : undefined}
          hint="hours sold on those jobs"
        />
        <TrendTile
          label="Billed"
          kind="money"
          total={f.charged}
          t={2}
          trend={liveScope ? { scope: liveScope, pick: (m) => m.billed } : undefined}
          hint="what the done work came to, before tax"
        />
        <TrendTile
          label="Collected"
          kind="money"
          total={f.collected}
          valueTone="in"
          t={3}
          trend={liveScope ? { scope: liveScope, pick: (m) => m.collected } : undefined}
          hint="payments received, tax included"
        />
        <TrendTile
          label="Parts spend"
          kind="money"
          total={f.partsSpend}
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
        <MoneyLedger f={f} year={year} id={LEDGER_ID} now={now} hidden={!ledgerOpen} taxPaid={taxPaid} />
        <TrendTile
          // f.unpaid is the books' figure, BEFORE tax on purpose (the ledger
          // and the monthly trend use it). The hint's per-job figure is the
          // customer's paper balance, so the two are labelled by basis.
          label="Unpaid balance, before tax"
          kind="money"
          total={f.unpaid}
          valueTone={f.unpaid > 0 ? 'owed' : undefined}
          tone={f.unpaid > 0 ? 'stop' : 'ok'}
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
                <span className="wnt-id">{oldest.jobNumber}</span> {money(oldest.cents)}{' '}
                {oldest.taxLine ? 'due with tax' : oldest.invoiced ? 'due' : 'before tax'} · {shortDate(oldest.date)} ·{' '}
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
        <Link href="/taxes" className="btn">
          Taxes
        </Link>
      </div>
    </div>
  )
}
