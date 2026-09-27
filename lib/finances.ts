import { supabase } from './supabase'
import { fetchJobsWithContext, type JobWithContext } from './data'
import { collectedForJob, governingInvoice, overCollectedCents, owedGrossCents, unpaidBalanceCents } from './calc'
import type { Job } from './types'

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
 * - INCLUDED sales tax (the owner's rule, 2026-09-12, migrations 0041/0045):
 *   an invoice that went out with no tax line still owes the state 5% OF its
 *   invoiced price — CBJ Procedure 130 does not let a seller who billed no tax
 *   back it out of the price, so the full price is the gross sale and the tax
 *   is on top of it. The customer paid the price and nothing more, so the shop
 *   absorbs the tax out of that money. That amount is
 *   invoices.included_tax_cents on the job's governing invoice, and it is
 *   handled as tax the shop owes out of what the customer paid:
 *     · it is prorated against the job's payments exactly as tax_cents is —
 *       the two are summed and share one running total per payment, and the
 *       included share is tracked in the same loop, so taxIncludedCollected is
 *       exact and taxCollected = tax charged + tax included;
 *     · charged and earned (and the per-month billed/earned) are NET of it:
 *       a job's included tax comes off in the job's own month, because it was
 *       never the shop's revenue. total_charged_cents itself is untouched —
 *       the customer paid exactly what the document said;
 *     · taxBilled counts it too (taxIncludedBilled is the included part), so
 *       "billed, not collected" still means tax on unpaid invoices only;
 *     · unpaid (and the per-month unpaid) is NET of the included tax on the
 *       share not yet paid — the exact complement of the proration, so what
 *       is still owed on the work never contains the state's money, exactly
 *       as a taxed invoice's tax line is never inside unpaid (on a partly
 *       paid taxed job, unpaidBalanceCents takes the tax riding in the cash
 *       back out). oldestOwed.cents is the customer's balance as their paper
 *       has it (owedGrossCents): GROSS of a tax line, the whole invoice.
 *   The identities survive: collected − taxCollected + unpaid = charged, and
 *   earned − cashProfit = unpaid, when nothing crosses a year line AND no job
 *   took more cash than it was owed — for a paid, unpaid or partly paid
 *   untaxed invoice alike. Cash over a job's bill (overCollected: J011 took
 *   $240.00 on a $231.00 invoice) is real cash that settles nothing billed,
 *   so it breaks both by exactly its amount; it is reported by name, never
 *   folded into "timing". Cash above the charge on a done job with NO
 *   invoice yet (paidAheadOfInvoice) breaks them the same way, and is named
 *   separately: it is the sales tax the coming invoice will bill, paid ahead.
 *   Both identities hold for ANY value of included_tax_cents: charged and
 *   earned subtract the same included figure the proration adds back into
 *   taxCollected, so moving the six untaxed invoices from the old back-out
 *   (total × 5/105) to 5% of the price (0045) changes the amounts, never the
 *   arithmetic. net := total − included stays true by definition.
 * - The governing invoice is the largest live one, ties to the NEWEST
 *   (created_at desc): the same order job_totals and the job page use, so the
 *   three never disagree on which invoice's tax counts.
 * - The proration runs over the SAME cash that `collected` counts: ledger rows,
 *   plus the cached-paid fallback for a pre-ledger job (dated on the job's
 *   date, like its cash). Before 0041 the fallback sat outside the proration;
 *   that was harmless only because no pre-ledger job carried tax. J001 now
 *   carries included tax, and leaving it out would break the first identity.
 * - JOB STAGE (the owner's ask, 2026-09-12, migration 0043): a job is
 *   scheduled (booked, not started), in_progress (on the lift) or done (work
 *   complete, ready to bill). Before 0043 "unpaid" also meant "not started",
 *   so three booked jobs read as owed, earned and "to invoice". Now:
 *     · only DONE jobs are WORK: count, hours, charged, labor/parts figures,
 *       earned, unpaid, owedJobs, uninvoicedJobs, oldestOwed, taxBilled, the
 *       months' jobs/hours/billed/earned/unpaid/unpaidJobs, and jobsToInvoice
 *       all skip a scheduled or in_progress job entirely;
 *     · CASH STAYS CASH: a payment on any job (a deposit on a scheduled job)
 *       counts in collected on its payment date, and parts bought for any job
 *       count in partsSpend on their purchase date. They are real money that
 *       moved; the books do not pretend otherwise;
 *     · the pipeline is exposed as `booked` (jobs, hours, cents, next) over
 *       the scheduled + in_progress jobs in scope, and the two cash pieces on
 *       them as depositsOnBooked (payments in scope on non-done jobs) and
 *       partsSpendOnBooked (parts outflows in scope for non-done jobs), so the
 *       ledger can still add on screen and name them;
 *     · the second identity becomes
 *         earned − unpaid − partsSpendOnBooked + depositsOnBooked = cashProfit
 *       (nothing crossing a year line). With no booked work it is the old one;
 *     · a row whose stage is MISSING (read before 0043 is applied, or a fixture
 *       row without the field) counts as done — the DB default, and exactly
 *       the pre-0043 figures. A row whose stage_changed_at is null is simply a
 *       row that never moved; it says nothing about the stage;
 *     · booked.next is the soonest booked date on or after today; when every
 *       booked job's date has passed, the EARLIEST of them — the one that has
 *       waited longest for its car — ties broken by job_number.
 */
export interface FinanceRows {
  jobs: JobWithContext[]
  payments: { amount_cents: number; date: string; job_id: string; invoice_id: string | null }[]
  /** One row per part line and per receipt's counter tax; job_id ties it to the job it was bought for (0043). */
  partOutflows: { date: string; cents: number; job_id: string }[]
  invoices: {
    id: string
    job_id: string
    status: string
    tax_cents: number
    /** Sales tax the shop owes on an untaxed invoice: 5% of its invoiced price (0041/0045); 0 when tax was charged. */
    included_tax_cents: number
    total_cents: number
    /** ISO timestamp; breaks a tie between equal-total invoices (newest governs). */
    created_at: string
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
  /** Done jobs dated this month. */
  jobs: number
  hours: number
  /** total_charged on the done jobs dated this month, before sales tax — less the tax the shop owes on any untaxed invoice. */
  billed: number
  /** Labor + parts margin on the done jobs dated this month, paid or not, net of included tax. */
  earned: number
  /** Payments landing this month, on any job (a pre-ledger job's cash sits on its job date). */
  collected: number
  /** Parts and counter tax bought this month, for any job. */
  partsSpend: number
  /** collected − partsSpend − the sales tax owed out of this month's payments; the twelve sum to the year. */
  cashProfit: number
  /** Still owed on the done jobs dated this month, before sales tax (net of the included tax on the unpaid share). */
  unpaid: number
  /** How many of this month's done jobs are not paid. */
  unpaidJobs: number
  state: MonthState
}

export interface OldestOwed {
  jobId: string
  jobNumber: string
  title: string
  customer: string
  /**
   * The customer's balance as the paper has it (owedGrossCents): the larger
   * of the job's charge and its governing invoice's total, less what was
   * collected — so it includes an invoice's tax line. GROSS, unlike
   * Finances.unpaid, which is before tax on purpose. With no invoice yet it
   * is the charge before tax (there is no paper to be gross of).
   */
  cents: number
  /** The job has a live invoice; false = `cents` is the charge before tax. */
  invoiced: boolean
  /** That invoice has a sales tax line, so `cents` includes tax. */
  taxLine: boolean
  /** The job's date, YYYY-MM-DD. */
  date: string
}

/** The soonest booked job, for the dashboard's Scheduled door. */
export interface BookedNext {
  jobId: string
  jobNumber: string
  /** The booked date, YYYY-MM-DD (job.date). */
  date: string
  title: string
  customer: string
  stage: 'scheduled' | 'in_progress'
}

/** The pipeline: scheduled + in_progress jobs in scope. Not work yet, not in the books. */
export interface Booked {
  jobs: number
  hours: number
  /** Labor + approved parts charge (job_totals.total_charged_cents), gross. */
  cents: number
  /** Soonest booked date on or after today; else the earliest (longest waiting). Null when nothing is booked. */
  next: BookedNext | null
}

export interface Finances {
  /** Done jobs in scope. */
  count: number
  hours: number
  /** Billed to customers on done jobs, before sales tax: total_charged less the tax the shop owes on its untaxed invoices. */
  charged: number
  /** Parts and counter tax bought in scope, for ANY job (partsSpendOnBooked is the part for jobs not done). */
  partsSpend: number
  /** Payments received in scope on ANY job, sales tax included (depositsOnBooked is the part on jobs not done). */
  collected: number
  /** All sales tax owed out of the payments: charged on a tax line + owed by the shop on an untaxed invoice. */
  taxCollected: number
  /** The part of taxCollected that had no tax line — 5% of those invoiced prices, which the shop pays out of what those customers paid. */
  taxIncludedCollected: number
  /** Sales tax on the governing invoices of this year's done jobs, collected or not (charged + included). */
  taxBilled: number
  /** The included part of taxBilled. */
  taxIncludedBilled: number
  /** Governing invoices of this year's done jobs that carry included tax (went out with no tax line). */
  taxIncludedInvoices: number
  /** collected − partsSpend − taxCollected: the cash side, before overhead. */
  cashProfit: number
  /**
   * Still owed on this year's done jobs, BEFORE sales tax: the balance net of
   * the included tax on the share not yet paid, so charged − unpaid is what
   * the work has brought in. A taxed invoice's tax line was never in here either.
   * The customer's own balance includes the tax line (owedGrossCents:
   * oldestOwed.cents, the job page, Reports' receivables).
   */
  unpaid: number
  laborCharged: number
  partsCharged: number
  partsCostOnJobs: number
  partsMarkup: number
  /** What the done work earned, paid or not: labor sold plus parts margin, net of included tax. */
  earned: number
  overhead: number
  /** Done jobs not paid (unpaid or partial). */
  owedJobs: number
  /** Of those, the ones with no live invoice at all. */
  uninvoicedJobs: number
  /** The oldest unpaid done job by job date, or null when nothing is owed. */
  oldestOwed: OldestOwed | null
  /** Scheduled + in_progress jobs in scope: the pipeline, not the books. */
  booked: Booked
  /** Payments in scope on jobs not done: cash held ahead of the work. Inside `collected`. */
  depositsOnBooked: number
  /** Parts outflows in scope for jobs not done: cash out ahead of the work. Inside `partsSpend`. */
  partsSpendOnBooked: number
  /**
   * Cash taken on done jobs in scope beyond what each was owed (the larger of
   * its charge and its governing invoice total). Inside `collected`. It is
   * money that settles nothing billed — a tip, or a refund owed — and is
   * named on its own, never as year-line timing.
   */
  overCollected: number
  /** The jobs behind overCollected, largest first. */
  overCollectedJobs: { jobId: string; jobNumber: string; cents: number }[]
  /**
   * Cash taken on done jobs in scope that have NO live invoice yet, beyond
   * their charge before tax. Inside `collected`. Not over-collection: the
   * invoice will add sales tax on top of the charge, so this is most likely
   * that tax, paid ahead. Named on its own, never as a tip or as timing.
   */
  paidAheadOfInvoice: number
  /** The jobs behind paidAheadOfInvoice, largest first. */
  paidAheadJobs: { jobId: string; jobNumber: string; cents: number }[]
  /**
   * True when some cash in scope belongs to a job dated outside it, or some
   * cash on a job in scope landed outside it (payments by payment date, parts
   * by purchase date). Only then can a residual honestly be called timing
   * across the year line. Always false for 'all'.
   */
  crossesYearLine: boolean
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

/**
 * Not done = scheduled or in progress. A missing stage (a row read before
 * 0043 is applied) is done — the DB default, and the pre-0043 arithmetic.
 */
export function isBookedJob(job: Pick<Job, 'stage'>): boolean {
  return job.stage === 'scheduled' || job.stage === 'in_progress'
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
    supabase.from('receipts').select('job_id, tax_cents, purchase_date, job:jobs(date, deleted_at)'),
    supabase
      .from('invoices')
      .select('id, job_id, tax_cents, included_tax_cents, total_cents, status, due_date, created_at')
      .neq('status', 'void'),
    supabase.from('expenses').select('amount_cents, date'),
  ])
  // Loud, not wrong: a failed read (a column the database does not have yet,
  // a policy, a network error) must surface, never render as zero money.
  if (paymentsRes.error) throw paymentsRes.error
  if (linesRes.error) throw linesRes.error
  if (receiptsRes.error) throw receiptsRes.error
  if (invoicesRes.error) throw invoicesRes.error
  if (expensesRes.error) throw expensesRes.error

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
      job_id: string
      tax_cents: number
      purchase_date: string | null
      job: { date: string; deleted_at: string | null } | null
    }[]) ?? []
  const partOutflows = [
    ...lineRows
      .filter((r) => r.job && !r.job.deleted_at)
      .map((r) => ({ date: r.purchase_date ?? r.job!.date, cents: r.line_total_cents, job_id: r.job_id })),
    ...taxRows
      .filter((r) => r.job && !r.job.deleted_at && r.tax_cents > 0)
      .map((r) => ({ date: r.purchase_date ?? r.job!.date, cents: r.tax_cents, job_id: r.job_id })),
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

/**
 * Cash on jobs settled before the payments ledger existed: no ledger rows,
 * only a cached status. Each counts at its cached amount (or its full charge
 * when simply marked paid — collectedForJob) and, having no dated payment,
 * sits on the job's own date. J001 ($150.00) is that job. The fallback RULE
 * itself is calc.collectedForJob (the job page and the collections surfaces
 * call it too); this is the one place its dated cash-in rows are built, for
 * Finances and Reports' cash view alike.
 */
export function preLedgerCash(
  jobs: readonly JobWithContext[],
  jobsWithLedger: ReadonlySet<string>,
): { amount_cents: number; date: string; job_id: string }[] {
  const out: { amount_cents: number; date: string; job_id: string }[] = []
  for (const it of jobs) {
    if (jobsWithLedger.has(it.job.id) || !it.totals) continue
    const cached = collectedForJob(it.job, it.totals.total_charged_cents, 0, false)
    if (cached === 0) continue
    out.push({ amount_cents: cached, date: it.job.date, job_id: it.job.id })
  }
  return out
}

const yearOf = (iso: string) => Number(iso.slice(0, 4))
const monthOf = (iso: string) => Number(iso.slice(5, 7)) - 1
/** The local calendar date of `d` as YYYY-MM-DD, comparable to job.date. */
const localDateOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

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
  let doneCount = 0
  // The loader already drops void invoices, but the arithmetic must not
  // depend on that: a void revision would otherwise count as "invoiced" and,
  // being the largest, become the governing invoice for the tax proration.
  const liveInvoices = rows.invoices.filter((i) => i.status !== 'void')
  const invoicedJobs = new Set(liveInvoices.map((i) => i.job_id))
  // The governing invoice of a job: its LARGEST live one, ties to the NEWEST
  // (total_cents desc, created_at desc — the view's order, and the job page's).
  // It carries both the tax charged on a line and the tax the shop owes on an
  // untaxed invoice (0041/0045). The select has no ORDER BY, so the tie is decided
  // by the shared rule (lib/calc governingInvoice) and never by whichever row
  // PostgREST happened to return first.
  const invoicesByJob = new Map<string, FinanceRows['invoices']>()
  for (const inv of liveInvoices) {
    const list = invoicesByJob.get(inv.job_id) ?? []
    list.push(inv)
    invoicesByJob.set(inv.job_id, list)
  }
  const govByJob = new Map<string, FinanceRows['invoices'][number]>()
  for (const [jobId, list] of invoicesByJob) {
    const gov = governingInvoice(list)
    if (gov) govByJob.set(jobId, gov)
  }
  const includedTaxOf = (jobId: string) => govByJob.get(jobId)?.included_tax_cents ?? 0
  // Every ledger row on a job, whatever its date: what the customer has paid
  // on it in all, for the balance they still owe and for over-collection.
  const ledgerByJob = new Map<string, number>()
  for (const p of rows.payments) ledgerByJob.set(p.job_id, (ledgerByJob.get(p.job_id) ?? 0) + p.amount_cents)
  let overCollected = 0
  const overCollectedJobs: { jobId: string; jobNumber: string; cents: number }[] = []
  let paidAheadOfInvoice = 0
  const paidAheadJobs: { jobId: string; jobNumber: string; cents: number }[] = []

  // The pipeline (0043): scheduled + in_progress jobs in scope. Their money
  // is not in the books yet — it is booked, and shown as that.
  const today = localDateOf(now)
  const booked: Booked = { jobs: 0, hours: 0, cents: 0, next: null }
  // Chosen in two tiers: any job dated today or later beats every job whose
  // date has passed; within a tier the earliest date wins, then job_number.
  let nextUpcoming: JobWithContext | null = null
  let nextPast: JobWithContext | null = null
  const earlier = (a: JobWithContext, b: JobWithContext) =>
    a.job.date < b.job.date || (a.job.date === b.job.date && a.job.job_number < b.job.job_number)

  for (const it of scoped) {
    const m = months[monthOf(it.job.date)]
    const h = Number(it.job.labor_hours)
    const t = it.totals
    if (isBookedJob(it.job)) {
      booked.jobs += 1
      booked.hours += h
      booked.cents += t?.total_charged_cents ?? 0
      if (it.job.date >= today) {
        if (!nextUpcoming || earlier(it, nextUpcoming)) nextUpcoming = it
      } else if (!nextPast || earlier(it, nextPast)) nextPast = it
      // Not work: nothing below counts it.
      continue
    }
    doneCount += 1
    hours += h
    m.jobs += 1
    m.hours += h
    if (it.job.payment_status !== 'paid') {
      owedJobs += 1
      m.unpaidJobs += 1
      if (!invoicedJobs.has(it.job.id)) uninvoicedJobs += 1
    }
    if (!t) continue
    // The tax the shop owes on an untaxed invoice (5% of its price, which the
    // customer did not pay on top) is not the shop's to keep: it comes off
    // billed and earned here, in the job's own month. Labor, parts and the
    // customer's balance are untouched — the document did not change.
    const included = includedTaxOf(it.job.id)
    charged += t.total_charged_cents - included
    laborCharged += t.labor_charge_cents
    partsCharged += t.parts_charged_cents
    partsCostOnJobs += t.parts_cost_cents
    const gov = govByJob.get(it.job.id)
    // Still owed on the work before any tax LINE: the tax riding in a partial
    // payment is taken back out (unpaidBalanceCents), so a payment the size of
    // the pre-tax total cannot read as settled while the tax line is owed.
    const owedBeforeLine = unpaidBalanceCents(it.job, t.total_charged_cents, gov)
    // The state's share of that unpaid balance on an untaxed invoice. It is the
    // exact COMPLEMENT of the proration below (included − round(included × paid
    // ÷ total)), not a second rounding of the unpaid share, so that collected −
    // taxCollected + unpaid = charged holds to the cent for a partly paid
    // untaxed invoice. (An untaxed invoice has tax_cents 0, so the line above
    // took nothing out and paid = charge − owedBeforeLine exactly.)
    let includedOwed = 0
    if (included > 0 && owedBeforeLine > 0 && gov) {
      const paidShare =
        gov.total_cents > 0
          ? Math.max(0, Math.min(1, (t.total_charged_cents - owedBeforeLine) / gov.total_cents))
          : 0
      includedOwed = included - Math.round(included * paidShare)
    }
    // Owed on the WORK, before tax: a taxed invoice's tax line was never in
    // here, and neither is the tax the shop owes on an untaxed one.
    const owed = owedBeforeLine - includedOwed
    // All the cash on this job, any date: the ledger, or the cached fallback
    // for a pre-ledger job — the same rule `collected` counts below.
    const collectedOnJob = collectedForJob(
      it.job,
      t.total_charged_cents,
      ledgerByJob.get(it.job.id) ?? 0,
      ledgerByJob.has(it.job.id),
    )
    const over = overCollectedCents(t.total_charged_cents, gov?.total_cents, collectedOnJob)
    if (over > 0) {
      if (gov) {
        // Over a real invoice: more cash than the bill.
        overCollected += over
        overCollectedJobs.push({ jobId: it.job.id, jobNumber: it.job.job_number, cents: over })
      } else {
        // No invoice yet, so "over" is measured against the charge BEFORE
        // tax — cash that is most likely the sales tax the coming invoice
        // will bill (deposits are sized on the quote total with tax). Not a
        // tip, not owed back: named as paid ahead of the invoice.
        paidAheadOfInvoice += over
        paidAheadJobs.push({ jobId: it.job.id, jobNumber: it.job.job_number, cents: over })
      }
    }
    unpaid += owed
    m.billed += t.total_charged_cents - included
    m.earned += t.labor_charge_cents + (t.parts_charged_cents - t.parts_cost_cents) - included
    m.unpaid += owed
    if (it.job.payment_status !== 'paid' && (oldestOwed === null || it.job.date < oldestOwed.date)) {
      oldestOwed = {
        jobId: it.job.id,
        jobNumber: it.job.job_number,
        title: it.job.title,
        customer: it.customer?.name ?? 'Unknown customer',
        // What their paper says they owe: the whole invoice, tax line included.
        cents: owedGrossCents(t.total_charged_cents, gov?.total_cents, collectedOnJob),
        invoiced: !!gov,
        taxLine: !!gov && gov.tax_cents > 0,
        date: it.job.date,
      }
    }
  }
  const nextIt = nextUpcoming ?? nextPast
  if (nextIt) {
    booked.next = {
      jobId: nextIt.job.id,
      jobNumber: nextIt.job.job_number,
      date: nextIt.job.date,
      title: nextIt.job.title,
      customer: nextIt.customer?.name ?? 'Unknown customer',
      stage: nextIt.job.stage === 'in_progress' ? 'in_progress' : 'scheduled',
    }
  }
  const partsMarkup = partsCharged - partsCostOnJobs
  // Every done job's included tax is taken back out of earned; the year's
  // total is the same subtraction the months made one job at a time.
  let includedOnJobs = 0
  for (const it of scoped) if (it.totals && !isBookedJob(it.job)) includedOnJobs += includedTaxOf(it.job.id)

  // The jobs not done, wherever they are dated: a deposit paid this year on
  // next year's booked job is still this year's cash, so the set is not scoped.
  const bookedJobIds = new Set(rows.jobs.filter((it) => isBookedJob(it.job)).map((it) => it.job.id))

  // Cash, not accrual. BOTH sides are cash-dated or the number is nonsense:
  // payments by PAYMENT date, parts by PURCHASE date. Any job's cash counts —
  // a deposit on a scheduled job moved on the day it moved.
  const jobsWithLedger = new Set(rows.payments.map((p) => p.job_id))
  let collected = 0
  let depositsOnBooked = 0
  // The cash the tax proration below sees: every counted payment, so that the
  // tax owed out of a pre-ledger job's cached amount is taken out like any other.
  const cashIn: { amount_cents: number; date: string; job_id: string }[] = []
  for (const p of rows.payments) {
    if (!inYear(p.date)) continue
    collected += p.amount_cents
    months[monthOf(p.date)].collected += p.amount_cents
    if (bookedJobIds.has(p.job_id)) depositsOnBooked += p.amount_cents
    cashIn.push(p)
  }
  // No dated payment row exists for these, so the cash sits on the job's date.
  for (const c of preLedgerCash(scoped, jobsWithLedger)) {
    collected += c.amount_cents
    months[monthOf(c.date)].collected += c.amount_cents
    if (bookedJobIds.has(c.job_id)) depositsOnBooked += c.amount_cents
    cashIn.push(c)
  }
  let partsSpend = 0
  let partsSpendOnBooked = 0
  for (const o of rows.partOutflows) {
    if (!inYear(o.date)) continue
    partsSpend += o.cents
    months[monthOf(o.date)].partsSpend += o.cents
    if (bookedJobIds.has(o.job_id)) partsSpendOnBooked += o.cents
  }

  // Sales tax is owed out of those payments and is the state's money, so it
  // is neither revenue nor profit. Because ALL job money settles an invoice
  // (a deposit included), tax is prorated against every payment on the job —
  // matched to the job's governing (largest) live invoice. The tax charged on
  // a line and the tax the shop owes on an untaxed invoice are ONE amount to
  // the state, so they prorate together; the included share is tracked
  // alongside so the split reported is exact and the two always sum to
  // taxCollected.
  //
  // Each payment carries the slice of tax its share of the invoice implies,
  // so a month holds the tax on the payments that landed in it and the twelve
  // months sum to the year: the running total is rounded once per payment and
  // the slices telescope to round(tax × paid ÷ total), the year figure.
  let taxCollected = 0
  let taxIncludedCollected = 0
  const taxByMonth = Array<number>(12).fill(0)
  for (const [jobId, inv] of govByJob) {
    const tax = inv.tax_cents + inv.included_tax_cents
    if (tax <= 0 || inv.total_cents <= 0) continue
    const onJob = cashIn
      .filter((p) => p.job_id === jobId)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    let paid = 0
    let taxSoFar = 0
    let includedSoFar = 0
    for (const p of onJob) {
      paid += p.amount_cents
      const share = Math.max(0, Math.min(1, paid / inv.total_cents))
      const cum = Math.round(tax * share)
      taxByMonth[monthOf(p.date)] += cum - taxSoFar
      taxSoFar = cum
      includedSoFar = Math.round(inv.included_tax_cents * share)
    }
    taxCollected += taxSoFar
    taxIncludedCollected += includedSoFar
  }

  // What the invoices of this year's done jobs carry in tax, paid or not: the
  // part above taxCollected is owed to the state the day those customers pay.
  // A job not done is not in charged, so its invoice (there should be none;
  // the invoice action is gated on done) is not in here either.
  let taxBilled = 0
  let taxIncludedBilled = 0
  let taxIncludedInvoices = 0
  for (const it of scoped) {
    if (isBookedJob(it.job)) continue
    const inv = govByJob.get(it.job.id)
    if (!inv) continue
    if (inv.tax_cents > 0) taxBilled += inv.tax_cents
    if (inv.included_tax_cents > 0) {
      taxBilled += inv.included_tax_cents
      taxIncludedBilled += inv.included_tax_cents
      taxIncludedInvoices += 1
    }
  }

  const overhead = rows.expenses.filter((e) => inYear(e.date)).reduce((s, e) => s + e.amount_cents, 0)

  // Does any cash cross this scope's year line? A payment or a part bought in
  // scope for a job dated outside it, or the reverse. Pre-ledger cash sits on
  // its job's date and never crosses. 'all' has no line to cross.
  let crossesYearLine = false
  if (year !== 'all') {
    const jobYear = new Map(rows.jobs.map((it) => [it.job.id, yearOf(it.job.date)]))
    const crosses = (date: string, jobId: string) => {
      const jy = jobYear.get(jobId)
      return jy !== undefined && (yearOf(date) === year) !== (jy === year)
    }
    crossesYearLine =
      rows.payments.some((p) => crosses(p.date, p.job_id)) ||
      rows.partOutflows.some((o) => crosses(o.date, o.job_id))
  }
  overCollectedJobs.sort((a, b) => b.cents - a.cents)
  paidAheadJobs.sort((a, b) => b.cents - a.cents)

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
    count: doneCount,
    hours,
    charged,
    partsSpend,
    collected,
    taxCollected,
    taxIncludedCollected,
    taxBilled,
    taxIncludedBilled,
    taxIncludedInvoices,
    cashProfit: collected - partsSpend - taxCollected,
    unpaid,
    laborCharged,
    partsCharged,
    partsCostOnJobs,
    partsMarkup,
    earned: laborCharged + partsMarkup - includedOnJobs,
    overhead,
    owedJobs,
    uninvoicedJobs,
    oldestOwed,
    booked,
    depositsOnBooked,
    partsSpendOnBooked,
    overCollected,
    overCollectedJobs,
    paidAheadOfInvoice,
    paidAheadJobs,
    crossesYearLine,
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

/**
 * Work done but never billed: DONE jobs not paid that have no live invoice,
 * oldest first. A scheduled or in-progress job is not work yet and never
 * appears here. The dashboard's Billing door counts them and the Billing page
 * lists them, from this one definition. Not year-scoped: it is a worklist.
 */
export function jobsToInvoice(rows: FinanceRows): JobWithContext[] {
  const invoiced = new Set(rows.invoices.filter((i) => i.status !== 'void').map((i) => i.job_id))
  return rows.jobs
    .filter((it) => !isBookedJob(it.job) && it.job.payment_status !== 'paid' && !invoiced.has(it.job.id))
    .sort((a, b) => (a.job.date < b.job.date ? -1 : a.job.date > b.job.date ? 1 : 0))
}
