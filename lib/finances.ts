import { supabase } from './supabase'
import { fetchJobsWithContext, type JobWithContext } from './data'
import { collectedForJob, unpaidBalanceCents } from './calc'

/**
 * The shop's money, in one place. The dashboard and the Billing page read
 * the same rows and the same arithmetic, so the two can never disagree
 * about what was billed, collected, or still owed.
 *
 * The rules that make the figures true, all of them verified against the live
 * data before this file existed — do not "simplify" any of them:
 *
 * - Deleted jobs are out of everything: their payments, their parts, their
 *   balances. Leaving a binned job's cash in would inflate profit and break
 *   collected + unpaid = billed.
 * - Void invoices are out. The governing invoice for a job is its LARGEST live
 *   one (the revision rule used everywhere else).
 * - Cash is dated by when it moved: payments by PAYMENT date, parts by PURCHASE
 *   date (falling back to the job date). Mixing the two made a December job
 *   paid in January read as a loss for the year.
 * - A job settled before the payments ledger existed has no ledger rows, only a
 *   cached status; it counts at its cached amount (or its full total when simply
 *   marked paid) so real cash is not under-reported. J001 is that job.
 * - Sales tax arrives inside payments but belongs to the state: it is prorated
 *   against every payment on the job and taken back out of profit.
 * - Parts spend counts the sales tax paid at the parts counter (receipts.tax_cents),
 *   which is a cost and never a customer charge.
 */
export interface FinanceRows {
  jobs: JobWithContext[]
  payments: { amount_cents: number; date: string; job_id: string; invoice_id: string | null }[]
  partOutflows: { date: string; cents: number }[]
  invoices: {
    id: string
    job_id: string
    status: string
    tax_cents: number
    total_cents: number
    due_date?: string | null
  }[]
  expenses: { amount_cents: number; date: string }[]
  /** Jobs still carrying approved parts with no cost entered: their profit reads high. */
  uncostedJobIds: Set<string>
}

export type MonthState = 'open' | 'future' | 'before'

export interface MonthFigures {
  /** 0 = January, as Date.getMonth() has it. */
  index: number
  jobs: number
  hours: number
  /** total_charged on the jobs dated this month, before sales tax. */
  billed: number
  /** Labor + parts margin on the jobs dated this month, paid or not. */
  earned: number
  /** Payments landing this month (a pre-ledger job's cash sits on its job date). */
  collected: number
  /** Parts and counter tax bought this month. */
  partsSpend: number
  /** collected − partsSpend − the sales tax inside this month's payments; the twelve sum to the year. */
  cashProfit: number
  /** Still owed on the jobs dated this month. */
  unpaid: number
  /** How many of this month's jobs are not paid. */
  unpaidJobs: number
  state: MonthState
}

export interface OldestOwed {
  jobId: string
  jobNumber: string
  title: string
  customer: string
  cents: number
  /** The job's date, YYYY-MM-DD. */
  date: string
}

export interface Finances {
  count: number
  hours: number
  /** Billed to customers, before sales tax. */
  charged: number
  partsSpend: number
  /** Payments received, sales tax included. */
  collected: number
  taxCollected: number
  /** Sales tax on the governing invoices of this year's jobs, collected or not. */
  taxBilled: number
  /** collected − partsSpend − taxCollected: the cash side, before overhead. */
  cashProfit: number
  unpaid: number
  laborCharged: number
  partsCharged: number
  partsCostOnJobs: number
  partsMarkup: number
  /** What the work earned, paid or not: labor sold plus parts margin. */
  earned: number
  overhead: number
  /** Jobs not paid (unpaid or partial). */
  owedJobs: number
  /** Of those, the ones with no live invoice at all. */
  uninvoicedJobs: number
  /** The oldest unpaid job by job date, or null when nothing is owed. */
  oldestOwed: OldestOwed | null
  months: MonthFigures[]
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** 7 -> "Aug"; 7, true -> "August". */
export function monthLabel(index: number, long = false): string {
  const name = MONTH_NAMES[((index % 12) + 12) % 12]
  return long ? name : name.slice(0, 3)
}

/** The current page's fetches, unchanged in meaning: live jobs, live invoices. */
export async function loadFinanceRows(): Promise<FinanceRows> {
  const [jobs, paymentsRes, linesRes, receiptsRes, invoicesRes, expensesRes] = await Promise.all([
    fetchJobsWithContext(),
    // Payments on binned jobs must not count — their billed/parts/unpaid all
    // vanish with the job. (Reports already filters this way.)
    supabase.from('payments').select('amount_cents, date, job_id, invoice_id, job:jobs(deleted_at)'),
    supabase
      .from('part_lines')
      .select('job_id, line_total_cents, purchase_date, awaiting_cost, job:jobs(date, deleted_at)'),
    supabase.from('receipts').select('tax_cents, purchase_date, job:jobs(date, deleted_at)'),
    supabase
      .from('invoices')
      .select('id, job_id, tax_cents, total_cents, status, due_date')
      .neq('status', 'void'),
    supabase.from('expenses').select('amount_cents, date'),
  ])

  const paymentRows =
    (paymentsRes.data as unknown as {
      amount_cents: number
      date: string
      job_id: string
      invoice_id: string | null
      job: { deleted_at: string | null } | null
    }[]) ?? []
  const payments = paymentRows
    .filter((p) => !p.job?.deleted_at)
    .map((p) => ({
      amount_cents: p.amount_cents,
      date: p.date,
      job_id: p.job_id,
      invoice_id: p.invoice_id,
    }))

  // Parts spend is cash out the door, so it counts the sales tax paid at the
  // counter as well as the parts themselves (receipts.tax_cents).
  //
  // ONE KNOWN SIMPLIFICATION: confirming a core credit zeroes that line's cost
  // in place rather than recording a dated refund, so the deposit stops
  // counting as spend on the day it was PAID, not the day it came back. Within
  // a year it nets out; a core bought in December and credited in January
  // moves that money out of the earlier year. Cores here run $30-$45.
  const lineRows =
    (linesRes.data as unknown as {
      job_id: string
      line_total_cents: number
      purchase_date: string | null
      awaiting_cost: boolean
      job: { date: string; deleted_at: string | null } | null
    }[]) ?? []
  const taxRows =
    (receiptsRes.data as unknown as {
      tax_cents: number
      purchase_date: string | null
      job: { date: string; deleted_at: string | null } | null
    }[]) ?? []
  const partOutflows = [
    ...lineRows
      .filter((r) => r.job && !r.job.deleted_at)
      .map((r) => ({ date: r.purchase_date ?? r.job!.date, cents: r.line_total_cents })),
    ...taxRows
      .filter((r) => r.job && !r.job.deleted_at && r.tax_cents > 0)
      .map((r) => ({ date: r.purchase_date ?? r.job!.date, cents: r.tax_cents })),
  ]
  const uncostedJobIds = new Set(
    lineRows.filter((r) => r.awaiting_cost && r.job && !r.job.deleted_at).map((r) => r.job_id),
  )

  return {
    jobs,
    payments,
    partOutflows,
    invoices: (invoicesRes.data as FinanceRows['invoices'] | null) ?? [],
    expenses: (expensesRes.data as FinanceRows['expenses'] | null) ?? [],
    uncostedJobIds,
  }
}

const yearOf = (iso: string) => Number(iso.slice(0, 4))
const monthOf = (iso: string) => Number(iso.slice(5, 7)) - 1

/**
 * Every figure the dashboard shows, for one year or for all time.
 *
 * The year totals are the verified arithmetic from the dashboard, moved here
 * unchanged. The months are the same rows bucketed by calendar month — for
 * 'all', each calendar month summed across every year.
 */
export function computeFinances(rows: FinanceRows, year: 'all' | number, now: Date = new Date()): Finances {
  const inYear = (iso: string) => year === 'all' || yearOf(iso) === year
  const scoped = year === 'all' ? rows.jobs : rows.jobs.filter((it) => yearOf(it.job.date) === year)

  const months: MonthFigures[] = Array.from({ length: 12 }, (_, index) => ({
    index,
    jobs: 0,
    hours: 0,
    billed: 0,
    earned: 0,
    collected: 0,
    partsSpend: 0,
    cashProfit: 0,
    unpaid: 0,
    unpaidJobs: 0,
    state: 'open',
  }))

  let hours = 0
  let charged = 0
  let unpaid = 0
  // The two places a job's money is earned: hours sold, and the margin
  // between what parts cost and what they were charged at.
  let laborCharged = 0
  let partsCharged = 0
  let partsCostOnJobs = 0
  let owedJobs = 0
  let uninvoicedJobs = 0
  let oldestOwed: OldestOwed | null = null
  // The loader already drops void invoices, but the arithmetic must not
  // depend on that: a void revision would otherwise count as "invoiced" and,
  // being the largest, become the governing invoice for the tax proration.
  const liveInvoices = rows.invoices.filter((i) => i.status !== 'void')
  const invoicedJobs = new Set(liveInvoices.map((i) => i.job_id))

  for (const it of scoped) {
    const m = months[monthOf(it.job.date)]
    const h = Number(it.job.labor_hours)
    hours += h
    m.jobs += 1
    m.hours += h
    const t = it.totals
    if (it.job.payment_status !== 'paid') {
      owedJobs += 1
      m.unpaidJobs += 1
      if (!invoicedJobs.has(it.job.id)) uninvoicedJobs += 1
    }
    if (!t) continue
    charged += t.total_charged_cents
    laborCharged += t.labor_charge_cents
    partsCharged += t.parts_charged_cents
    partsCostOnJobs += t.parts_cost_cents
    const owed = unpaidBalanceCents(it.job, t.total_charged_cents)
    unpaid += owed
    m.billed += t.total_charged_cents
    m.earned += t.labor_charge_cents + (t.parts_charged_cents - t.parts_cost_cents)
    m.unpaid += owed
    if (it.job.payment_status !== 'paid' && (oldestOwed === null || it.job.date < oldestOwed.date)) {
      oldestOwed = {
        jobId: it.job.id,
        jobNumber: it.job.job_number,
        title: it.job.title,
        customer: it.customer?.name ?? 'Unknown customer',
        cents: owed,
        date: it.job.date,
      }
    }
  }
  const partsMarkup = partsCharged - partsCostOnJobs

  // Cash, not accrual. BOTH sides are cash-dated or the number is nonsense:
  // payments by PAYMENT date, parts by PURCHASE date.
  const jobsWithLedger = new Set(rows.payments.map((p) => p.job_id))
  let collected = 0
  for (const p of rows.payments) {
    if (!inYear(p.date)) continue
    collected += p.amount_cents
    months[monthOf(p.date)].collected += p.amount_cents
  }
  for (const it of scoped) {
    if (jobsWithLedger.has(it.job.id) || !it.totals) continue
    // No dated payment row exists, so this cash can only sit on the job's date.
    const cached = collectedForJob(it.job, it.totals.total_charged_cents, 0, false)
    collected += cached
    months[monthOf(it.job.date)].collected += cached
  }
  let partsSpend = 0
  for (const o of rows.partOutflows) {
    if (!inYear(o.date)) continue
    partsSpend += o.cents
    months[monthOf(o.date)].partsSpend += o.cents
  }

  // Sales tax arrives inside those payments but is the state's money, so it
  // is neither revenue nor profit. Because ALL job money settles an invoice
  // (a deposit included), tax is prorated against every payment on the job —
  // matched to the job's governing (largest) live invoice.
  const govByJob = new Map<string, { tax_cents: number; total_cents: number }>()
  for (const inv of liveInvoices) {
    const cur = govByJob.get(inv.job_id)
    if (!cur || inv.total_cents > cur.total_cents) {
      govByJob.set(inv.job_id, { tax_cents: inv.tax_cents, total_cents: inv.total_cents })
    }
  }
  // Each payment carries the slice of tax its share of the invoice implies,
  // so a month holds the tax on the payments that landed in it and the twelve
  // months sum to the year: the running total is rounded once per payment and
  // the slices telescope to round(tax × paid ÷ total), the year figure.
  let taxCollected = 0
  const taxByMonth = Array<number>(12).fill(0)
  for (const [jobId, inv] of govByJob) {
    if (inv.tax_cents <= 0 || inv.total_cents <= 0) continue
    const onJob = rows.payments
      .filter((p) => p.job_id === jobId && inYear(p.date))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    let paid = 0
    let taxSoFar = 0
    for (const p of onJob) {
      paid += p.amount_cents
      const cum = Math.round(inv.tax_cents * Math.max(0, Math.min(1, paid / inv.total_cents)))
      taxByMonth[monthOf(p.date)] += cum - taxSoFar
      taxSoFar = cum
    }
    taxCollected += taxSoFar
  }

  // What the invoices of this year's jobs carry in tax, paid or not: the part
  // above taxCollected is owed to the state the day those customers pay.
  let taxBilled = 0
  for (const it of scoped) {
    const inv = govByJob.get(it.job.id)
    if (inv && inv.tax_cents > 0) taxBilled += inv.tax_cents
  }

  const overhead = rows.expenses.filter((e) => inYear(e.date)).reduce((s, e) => s + e.amount_cents, 0)

  // Month state. The months before the first job ever logged weren't slow —
  // the shop just wasn't on the app yet; the months after today aren't here.
  // 'all' has no calendar to be before or after, so every month is open.
  if (year !== 'all') {
    let first: string | null = null
    for (const it of rows.jobs) if (first === null || it.job.date < first) first = it.job.date
    const firstKey = first ? yearOf(first) * 12 + monthOf(first) : null
    const nowKey = now.getFullYear() * 12 + now.getMonth()
    for (const m of months) {
      const key = year * 12 + m.index
      if (m.jobs > 0) continue // a job dated ahead still counts where it lands
      if (key > nowKey) m.state = 'future'
      else if (firstKey !== null && key < firstKey) m.state = 'before'
    }
  }
  for (const m of months) m.cashProfit = m.collected - m.partsSpend - taxByMonth[m.index]

  return {
    count: scoped.length,
    hours,
    charged,
    partsSpend,
    collected,
    taxCollected,
    taxBilled,
    cashProfit: collected - partsSpend - taxCollected,
    unpaid,
    laborCharged,
    partsCharged,
    partsCostOnJobs,
    partsMarkup,
    earned: laborCharged + partsMarkup,
    overhead,
    owedJobs,
    uninvoicedJobs,
    oldestOwed,
    months,
  }
}

/** The years with any activity — a job, or cash landing on last year's jobs. */
export function financeYears(rows: FinanceRows): number[] {
  const set = new Set<number>()
  for (const it of rows.jobs) set.add(yearOf(it.job.date))
  for (const p of rows.payments) set.add(yearOf(p.date))
  return [...set].sort((a, b) => b - a)
}
