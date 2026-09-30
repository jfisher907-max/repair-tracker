import { governingInvoice } from './calc'
import { cashInRows, isBookedJob, prorateInvoiceTax, type CashIn, type FinanceRows } from './finances'
import { formatDate } from './date'
import { formatCents } from './money'
import { supabase } from './supabase'
import { reminderEdge, type ReminderEdge } from './tax-calendar'
import type { TaxBasis, TaxFiling } from './types'

/**
 * The City and Borough of Juneau sales-tax return, computed from the books.
 * The Taxes page, the dashboard's Taxes door and the money ledger read it; it
 * never files or pays anything and gives no advice.
 *
 * The rules (verified 2026-09-27; see migration 0053 and the tax plan):
 *
 * - QUARTERLY: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec. A return is due the LAST
 *   DAY OF THE MONTH AFTER the quarter (Q3 → Oct 31). A due date on a weekend
 *   moves to the next business day (Sat Oct 31, 2026 → Mon Nov 2). A city
 *   holiday can move it too; no holiday table is kept here, so the page says
 *   so. The city counts the day it RECEIVES a return, so reminders aim at the
 *   official date, not the weekend grace day. A return is required even with
 *   no sales.
 * - LATE: a $25 fee, plus 5% of the tax for each month late up to 25%, plus
 *   interest at 12% a year (about 1% a month).
 * - THE FOUR LINES, on either basis, from the governing (largest live,
 *   ties to newest — lib/calc governingInvoice) invoice of each live job:
 *     gross   = invoice total less any tax LINE (an untaxed invoice's whole
 *               price is the sale: CBJ Procedure 130, the 0045 rule);
 *     exempt  = the sales on invoices with tax_cents 0 that record the
 *               customer's exemption (tax_exempt_note);
 *     taxable = gross − exempt;
 *     tax     = tax lines + included_tax_cents (the 5% the shop owes on an
 *               invoice sent with no tax line). An exempt invoice owes none.
 *   Tips are never counted (they are not in the payments the proration
 *   reads, and not on any invoice). Void invoices never count. A job in the
 *   bin (soft-deleted) is out, with its invoices and its cash.
 * - ACCRUAL: invoices ISSUED (sent or paid, not draft) in the quarter, by
 *   issue date, whole.
 * - CASH: each invoice's sale and tax counted in proportion to how much of it
 *   was paid in the quarter, by payment date — prorateInvoiceTax, the SAME
 *   proration the dashboard runs for the year, over the same cash (ledger
 *   payments, plus the pre-ledger fallback dated on its job's date: J001).
 *   Cash on a job with no invoice yet has no sale/tax split to prorate
 *   against, so it is left out and named (uninvoicedCash) until invoiced.
 */

export const CBJ_FILING_URL = 'https://juneau.org/finance/sales-tax-online-payment'

export interface Quarter {
  year: number
  q: 1 | 2 | 3 | 4
  /** First day, YYYY-MM-DD. */
  start: string
  /** Last day, YYYY-MM-DD. */
  end: string
}

const p2 = (n: number) => String(n).padStart(2, '0')
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** A calendar date as a local Date at noon (never shifts a day across zones). */
function at(iso: string): Date {
  return new Date(`${iso}T12:00:00`)
}
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}
/** The local calendar date of `d`, YYYY-MM-DD. */
export function localIso(d: Date): string {
  return isoOf(d)
}
export function addDays(iso: string, n: number): string {
  const d = at(iso)
  d.setDate(d.getDate() + n)
  return isoOf(d)
}
/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((at(to).getTime() - at(from).getTime()) / 86_400_000)
}

export function quarterFor(year: number, q: 1 | 2 | 3 | 4): Quarter {
  const firstMonth = (q - 1) * 3 // 0-based
  const lastDay = new Date(year, firstMonth + 3, 0).getDate()
  return {
    year,
    q,
    start: `${year}-${p2(firstMonth + 1)}-01`,
    end: `${year}-${p2(firstMonth + 3)}-${p2(lastDay)}`,
  }
}
export function quarterOf(iso: string): Quarter {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7)) - 1
  return quarterFor(y, (Math.floor(m / 3) + 1) as 1 | 2 | 3 | 4)
}
export function shiftQuarter(qt: Quarter, n: number): Quarter {
  const idx = qt.year * 4 + (qt.q - 1) + n
  return quarterFor(Math.floor(idx / 4), ((idx % 4) + 1) as 1 | 2 | 3 | 4)
}
export function quarterKey(qt: Quarter): string {
  return `${qt.year}-Q${qt.q}`
}
export function quarterFromKey(key: string): Quarter | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key)
  return m ? quarterFor(Number(m[1]), Number(m[2]) as 1 | 2 | 3 | 4) : null
}
/** "Q3 2026" */
export function quarterShort(qt: Quarter): string {
  return `Q${qt.q} ${qt.year}`
}
/** "July–September 2026" */
export function quarterWords(qt: Quarter): string {
  const f = (qt.q - 1) * 3
  return `${MONTHS[f]}–${MONTHS[f + 2]} ${qt.year}`
}
/** Every quarter from `a` through `b`, in order. */
export function quartersBetween(a: Quarter, b: Quarter): Quarter[] {
  const out: Quarter[] = []
  for (let qt = a; qt.start <= b.start; qt = shiftQuarter(qt, 1)) out.push(qt)
  return out
}

export interface DueDates {
  /** The last day of the month after the quarter: the date reminders count to. */
  official: string
  /** `official`, moved past a weekend to the next weekday. */
  effective: string
  /** The weekend moved it. */
  moved: boolean
}

/** Q3 2026 → official 2026-10-31 (a Saturday), effective 2026-11-02. */
export function cbjDueDates(qt: Quarter): DueDates {
  const firstMonthAfter = qt.q * 3 // 0-based month index of the month after the quarter
  const last = new Date(qt.year, firstMonthAfter + 1, 0, 12)
  const official = isoOf(last)
  const d = at(official)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  const effective = isoOf(d)
  return { official, effective, moved: effective !== official }
}

/** "Saturday, October 31, 2026" */
export function longDate(iso: string): string {
  return at(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

/** One invoice behind the return's numbers, on one basis. */
export interface ReturnInvoice {
  invoiceId: string
  invoiceNumber: string
  jobId: string
  jobNumber: string
  customer: string
  issueDate: string
  /** Accrual: the issue date. Cash: the payment dates in the quarter. */
  dates: string[]
  /** Gross sale counted this quarter (the invoiced price before any tax line, or its paid share). */
  sale: number
  exempt: boolean
  exemptNote: string | null
  /** Tax charged on the invoice's tax line (or its paid share). */
  taxLine: number
  /** Tax the shop owes on an invoice sent with no tax line (or its paid share). */
  included: number
  /** Cash only: the payments in the quarter on this invoice. 0 on accrual. */
  received: number
  /** Cash only: the job has no payment row; its cash sits on the job's date (pre-ledger). */
  preLedger: boolean
}

export interface SalesTaxReturn {
  basis: TaxBasis
  quarter: Quarter
  gross: number
  exempt: number
  taxable: number
  tax: number
  /** The tax-line part of `tax`. */
  taxLines: number
  /** The included part of `tax` (invoices sent with no tax line). */
  taxIncluded: number
  /** Invoices with included tax behind taxIncluded. */
  includedInvoices: number
  invoices: ReturnInvoice[]
  /** Cash only: cash in the quarter on jobs with no invoice yet, not in the figures. */
  uninvoicedCash: { jobId: string; jobNumber: string; cents: number }[]
}

type Inv = FinanceRows['invoices'][number]

/** The governing live invoice of every live job, keyed by job id. */
function governingByJob(rows: FinanceRows): Map<string, Inv> {
  const live = new Set(rows.jobs.map((it) => it.job.id))
  const byJob = new Map<string, Inv[]>()
  for (const inv of rows.invoices) {
    if (inv.status === 'void' || !live.has(inv.job_id)) continue
    const list = byJob.get(inv.job_id) ?? []
    list.push(inv)
    byJob.set(inv.job_id, list)
  }
  const out = new Map<string, Inv>()
  for (const [jobId, list] of byJob) {
    const gov = governingInvoice(list)
    if (gov) out.set(jobId, gov)
  }
  return out
}

const isExempt = (inv: Inv) => inv.tax_cents === 0 && !!inv.tax_exempt_note?.trim()
const inQuarter = (iso: string | undefined, qt: Quarter) => !!iso && iso >= qt.start && iso <= qt.end

/** The Juneau return for one quarter on one basis. */
export function computeSalesTaxReturn(rows: FinanceRows, qt: Quarter, basis: TaxBasis): SalesTaxReturn {
  const gov = governingByJob(rows)
  const jobById = new Map(rows.jobs.map((it) => [it.job.id, it]))
  const invoices: ReturnInvoice[] = []
  const uninvoicedCash: SalesTaxReturn['uninvoicedCash'] = []

  const base = (inv: Inv) => {
    const it = jobById.get(inv.job_id)
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number ?? '',
      jobId: inv.job_id,
      jobNumber: it?.job.job_number ?? '',
      customer: it?.customer?.name ?? 'Unknown customer',
      issueDate: inv.issue_date ?? '',
      exempt: isExempt(inv),
      exemptNote: inv.tax_exempt_note?.trim() || null,
    }
  }

  if (basis === 'accrual') {
    for (const inv of gov.values()) {
      if (inv.status !== 'sent' && inv.status !== 'paid') continue
      if (!inQuarter(inv.issue_date, qt)) continue
      const exempt = isExempt(inv)
      invoices.push({
        ...base(inv),
        dates: [inv.issue_date!],
        sale: inv.total_cents - inv.tax_cents,
        taxLine: inv.tax_cents,
        // An exempt invoice owes nothing; the 0047 trigger books 0 there, and
        // it is forced here too so a hand-set figure cannot leak in.
        included: exempt ? 0 : inv.included_tax_cents,
        received: 0,
        preLedger: false,
      })
    }
  } else {
    const cash = cashInRows(rows)
    const ledgerJobs = new Set(rows.payments.map((p) => p.job_id))
    const cashByJob = new Map<string, CashIn[]>()
    for (const c of cash) {
      if (!jobById.has(c.job_id)) continue
      const list = cashByJob.get(c.job_id) ?? []
      list.push(c)
      cashByJob.set(c.job_id, list)
    }
    for (const [jobId, list] of cashByJob) {
      const inv = gov.get(jobId)
      if (!inv) {
        const cents = list.filter((c) => inQuarter(c.date, qt)).reduce((s, c) => s + c.amount_cents, 0)
        if (cents > 0) uninvoicedCash.push({ jobId, jobNumber: jobById.get(jobId)?.job.job_number ?? '', cents })
        continue
      }
      const exempt = isExempt(inv)
      const slices = prorateInvoiceTax(
        { tax_cents: inv.tax_cents, included_tax_cents: exempt ? 0 : inv.included_tax_cents, total_cents: inv.total_cents },
        list,
      ).filter((s) => inQuarter(s.date, qt))
      if (slices.length === 0) continue
      const tax = slices.reduce((s, x) => s + x.taxCents, 0)
      const included = slices.reduce((s, x) => s + x.includedCents, 0)
      invoices.push({
        ...base(inv),
        dates: [...new Set(slices.map((s) => s.date))],
        sale: slices.reduce((s, x) => s + x.saleCents, 0),
        taxLine: tax - included,
        included,
        received: slices.reduce((s, x) => s + x.amount_cents, 0),
        preLedger: !ledgerJobs.has(jobId),
      })
    }
  }

  invoices.sort((a, b) =>
    a.dates[0] < b.dates[0] ? -1 : a.dates[0] > b.dates[0] ? 1 : a.invoiceNumber.localeCompare(b.invoiceNumber),
  )
  const gross = invoices.reduce((s, i) => s + i.sale, 0)
  const exempt = invoices.filter((i) => i.exempt).reduce((s, i) => s + i.sale, 0)
  const taxLines = invoices.reduce((s, i) => s + i.taxLine, 0)
  const taxIncluded = invoices.reduce((s, i) => s + i.included, 0)
  return {
    basis,
    quarter: qt,
    gross,
    exempt,
    taxable: gross - exempt,
    tax: taxLines + taxIncluded,
    taxLines,
    taxIncluded,
    includedInvoices: invoices.filter((i) => i.included > 0).length,
    invoices,
    uninvoicedCash,
  }
}

/** Both bases at once: the page shows them side by side until one is chosen. */
export function computeBothReturns(rows: FinanceRows, qt: Quarter): Record<TaxBasis, SalesTaxReturn> {
  return { cash: computeSalesTaxReturn(rows, qt, 'cash'), accrual: computeSalesTaxReturn(rows, qt, 'accrual') }
}

/** The tax to plan for: the chosen basis, or the larger of the two until one is chosen. */
export function taxToPlanFor(both: Record<TaxBasis, SalesTaxReturn>, basis: TaxBasis | null | undefined): number {
  return basis ? both[basis].tax : Math.max(both.cash.tax, both.accrual.tax)
}

/** What filing this return late would add, in cents (shown as a cost, never charged). */
export function lateCost(taxCents: number) {
  return {
    fee: 2500,
    /** 5% of the tax for each month late… */
    penaltyPerMonth: Math.round(taxCents * 0.05),
    /** …up to 25% of it. */
    penaltyCap: Math.round(taxCents * 0.25),
    /** 12% a year, about 1% a month. */
    interestPerMonth: Math.round(taxCents * 0.01),
  }
}

export interface FilingStatus {
  /** Every cbj_sales_tax row recorded for EXACTLY this quarter, newest first. */
  rows: TaxFiling[]
  filedOn: string | null
  paidOn: string | null
  /** The payments recorded for the quarter, summed. */
  paidCents: number
  /** The tax this status was measured against (the page's planTax). */
  taxDue: number
  /** Tax still to pay after the recorded payments; 0 once paid in full or settled. */
  balance: number
  /** More recorded paid than the tax: a payment may be recorded twice. */
  overpaidCents: number
  /** A recorded payment is marked as the full amount the city asked for (settles_return). */
  settled: boolean
  /**
   * Filed, and PAID IN FULL — the recorded payments reach the tax, or one is
   * marked as the city's full amount — or filed with nothing to pay (a return
   * with no tax is still required, and filing it is the whole job). A short,
   * mistyped or $0 payment never counts as done.
   */
  done: boolean
}

export function filingStatus(filings: readonly TaxFiling[] | null, qt: Quarter, taxDue: number): FilingStatus {
  // Both ends must match: a row for July alone (a monthly deposit, a typo in
  // the period) is not the quarter's return.
  const rows = (filings ?? [])
    .filter((f) => f.obligation === 'cbj_sales_tax' && f.period_start === qt.start && f.period_end === qt.end)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const filedOn = rows.map((r) => r.filed_on).filter((d): d is string => !!d).sort()[0] ?? null
  const paidRows = rows.filter((r) => !!r.paid_on)
  const paidDates = paidRows.map((r) => r.paid_on as string).sort()
  const paidOn = paidDates[paidDates.length - 1] ?? null
  const paidCents = paidRows.reduce((s, r) => s + r.amount_cents, 0)
  const settled = paidRows.some((r) => r.settles_return === true && r.amount_cents > 0)
  const paidInFull = taxDue === 0 || paidCents >= taxDue || settled
  return {
    rows,
    filedOn,
    paidOn,
    paidCents,
    taxDue,
    balance: paidInFull ? 0 : taxDue - paidCents,
    overpaidCents: Math.max(0, paidCents - taxDue),
    settled,
    done: !!filedOn && paidInFull,
  }
}

// The plain-words error helpers live in lib/db-errors.ts (no imports, so a
// server route can use them); re-exported here for the pages that import them
// from this file. dbErrorWords takes an optional third argument naming the
// database update a missing table or column belongs to.
export { dbErrorWords, isMissingSchema } from './db-errors'

/** The first date the books have anything on: a done job, a payment or an issued invoice. */
export function firstActivity(rows: FinanceRows): string | null {
  let first: string | null = null
  const see = (d: string | null | undefined) => {
    if (d && (first === null || d < first)) first = d
  }
  for (const it of rows.jobs) if (!isBookedJob(it.job)) see(it.job.date)
  for (const p of rows.payments) see(p.date)
  for (const i of rows.invoices) if (i.status === 'sent' || i.status === 'paid') see(i.issue_date)
  return first
}

/**
 * The quarters a return may be owed for: from the first quarter with any
 * activity through the quarter containing today. Returns are required even
 * with no sales, so an empty quarter in between is still on the list.
 */
export function returnQuarters(rows: FinanceRows, today: string): Quarter[] {
  const first = firstActivity(rows)
  const now = quarterOf(today)
  if (!first) return [now]
  const start = quarterOf(first)
  return start.start > now.start ? [now] : quartersBetween(start, now)
}

/**
 * The return the Taxes page opens on: the earliest quarter that has ENDED and
 * is not yet recorded as filed and paid; when every ended one is done, the
 * quarter in progress (the next return).
 */
export function quarterToShow(
  rows: FinanceRows,
  filings: readonly TaxFiling[] | null,
  basis: TaxBasis | null | undefined,
  today: string,
): Quarter {
  const list = returnQuarters(rows, today)
  for (const qt of list) {
    if (qt.end >= today) break
    if (!filingStatus(filings, qt, taxToPlanFor(computeBothReturns(rows, qt), basis)).done) return qt
  }
  return quarterOf(today)
}

export interface TaxReminder {
  quarter: Quarter
  due: DueDates
  /** Days from today to the OFFICIAL date; negative once it has passed. */
  daysLeft: number
  edge: ReminderEdge
  both: Record<TaxBasis, SalesTaxReturn>
  basis: TaxBasis | null
  /** What is recorded for the quarter so far: the door shows the balance, not the whole tax. */
  status: FilingStatus
}

/**
 * The dashboard's Taxes door (owner's TAX-7 recommendation): "wait" from 30
 * days before the OFFICIAL due date, "stop" from 7 days before and once it has
 * passed (lib/tax-calendar reminderEdge, the rule every tax door shares); gone
 * once that quarter is recorded as filed and paid. The earliest such quarter
 * wins, so an overdue return is never hidden by the next one. `filings` null
 * (the table could not be read) counts as nothing recorded: the reminder errs
 * toward showing.
 */
export function taxReminder(
  rows: FinanceRows,
  filings: readonly TaxFiling[] | null,
  basis: TaxBasis | null | undefined,
  now: Date,
): TaxReminder | null {
  const today = localIso(now)
  for (const qt of returnQuarters(rows, today)) {
    if (qt.end >= today) break
    const due = cbjDueDates(qt)
    const daysLeft = daysBetween(today, due.official)
    // Null = more than 30 days out; later quarters are further out still.
    const edge = reminderEdge(daysLeft)
    if (!edge) break
    const both = computeBothReturns(rows, qt)
    const status = filingStatus(filings, qt, taxToPlanFor(both, basis))
    if (status.done) continue
    return { quarter: qt, due, daysLeft, edge, both, basis: basis ?? null, status }
  }
  return null
}

/**
 * Sales tax recorded as PAID to the city (cbj_sales_tax rows with a paid date),
 * for the money ledger, scoped by the year the filing period starts in.
 */
export function salesTaxPaid(filings: readonly TaxFiling[], year: 'all' | number): number {
  return filings
    .filter(
      (f) =>
        f.obligation === 'cbj_sales_tax' &&
        !!f.paid_on &&
        (year === 'all' || Number(f.period_start.slice(0, 4)) === year),
    )
    .reduce((s, f) => s + f.amount_cents, 0)
}

export interface ReadyRef {
  label: string
  href: string
}

export interface ReadyItem {
  key: string
  /** true = done; false = needs a hand; null = only the owner can say. */
  ok: boolean | null
  title: string
  detail?: string
  refs?: ReadyRef[]
}

/**
 * Owner, 2026-09-28: "Currently not getting paid for the hangar tracking right
 * now, that's a work in progress." Until Airlift Northwest has an invoice,
 * Wings Hangar sessions in a quarter that began on or before this day are not
 * missing income. Later quarters ask again (a reminder, not a to-do) until the
 * first invoice goes out; from then on the unbilled-sessions check applies.
 */
export const HANGAR_UNPAID_AS_OF = '2026-09-28'

/**
 * The quarter's readiness checklist, computed from the books wherever the
 * books can say. Items that only the owner can answer say so plainly.
 */
export function readiness(input: {
  rows: FinanceRows
  quarter: Quarter
  both: Record<TaxBasis, SalesTaxReturn>
  basis: TaxBasis | null | undefined
  status: FilingStatus
  /**
   * Wings Hangar sessions overlapping the quarter — the hangar with billing
   * meaning; an ALNW-hangar row is an assignment to their own hangar, not
   * Airlift Northwest occupying Wings. null = could not be read.
   */
  hangarSessions: number | null
  /** The Airlift Northwest customer's id; null = there is none; undefined = the lookup failed. */
  alnwCustomerId: string | null | undefined
  today: string
}): ReadyItem[] {
  const { rows, quarter: qt, both, basis, status, hangarSessions, alnwCustomerId, today } = input
  const items: ReadyItem[] = []
  const gov = governingByJob(rows)
  const ledgerJobs = new Set(rows.payments.map((p) => p.job_id))
  const jobRef = (jobId: string, jobNumber: string, extra = ''): ReadyRef => ({
    label: `${jobNumber}${extra}`,
    href: `/jobs/${jobId}`,
  })

  // 1. Every job finished in the quarter is billed.
  const notBilled = rows.jobs.filter((it) => {
    if (isBookedJob(it.job) || !inQuarter(it.job.date, qt)) return false
    const inv = gov.get(it.job.id)
    return !inv || (inv.status !== 'sent' && inv.status !== 'paid')
  })
  items.push(
    notBilled.length === 0
      ? { key: 'invoiced', ok: true, title: 'Every job finished this quarter has an invoice sent' }
      : {
          key: 'invoiced',
          ok: false,
          title: `${notBilled.length} finished job${notBilled.length === 1 ? ' has' : 's have'} no invoice sent`,
          detail:
            'Send the invoice (or void it, or bin the job if it should never be billed). Until then that sale is not in these figures.',
          refs: notBilled.map((it) =>
            jobRef(it.job.id, it.job.job_number, gov.get(it.job.id) ? ' (draft only)' : ''),
          ),
        },
  )

  // 2. Every paid invoice behind this return has a payment on record.
  const inReturn = new Map<string, ReturnInvoice>()
  for (const r of [...both.accrual.invoices, ...both.cash.invoices]) inReturn.set(r.invoiceId, r)
  const noPayment = [...inReturn.values()].filter((r) => {
    const inv = gov.get(r.jobId)
    return inv?.status === 'paid' && !ledgerJobs.has(r.jobId)
  })
  items.push(
    noPayment.length === 0
      ? { key: 'payments', ok: true, title: 'Every paid invoice has its payment on record' }
      : {
          key: 'payments',
          ok: false,
          title: `${noPayment.map((r) => r.jobNumber).join(', ')} ${noPayment.length === 1 ? 'is' : 'are'} marked paid with no payment on record`,
          detail:
            'Add how and when the customer paid on the job page. The city wants the records kept 3 years, and until then the cash basis dates that money on the job’s own date.',
          refs: noPayment.map((r) => jobRef(r.jobId, r.jobNumber)),
        },
  )

  // 3. Invoices with no tax carry their exemption note.
  const untaxedNoNote = [...inReturn.values()].filter((r) => {
    const inv = gov.get(r.jobId)
    return !!inv && inv.tax_cents === 0 && inv.included_tax_cents === 0 && !r.exempt && inv.total_cents > 0
  })
  const exempts = [...inReturn.values()].filter((r) => r.exempt)
  items.push(
    untaxedNoNote.length > 0
      ? {
          key: 'exempt',
          ok: false,
          title: `${untaxedNoNote.length} invoice${untaxedNoNote.length === 1 ? ' carries' : 's carry'} no tax and no exemption note`,
          detail: 'Record the customer’s exemption on the invoice, or it owes 5% like any other sale.',
          refs: untaxedNoNote.map((r) => ({ label: r.invoiceNumber, href: `/invoices/${r.invoiceId}` })),
        }
      : exempts.length > 0
        ? {
            key: 'exempt',
            ok: true,
            title: `${exempts.length} exempt invoice${exempts.length === 1 ? '' : 's'}, each with its note`,
            detail: 'Keep each customer’s exemption certificate on file with your records.',
            refs: exempts.map((r) => ({ label: r.invoiceNumber, href: `/invoices/${r.invoiceId}` })),
          }
        : { key: 'exempt', ok: true, title: 'No exempt sales this quarter' },
  )

  // 4. Airlift Northwest: hangar work with no invoice.
  if (hangarSessions === null || (hangarSessions > 0 && alnwCustomerId === undefined)) {
    items.push({
      key: 'alnw',
      ok: null,
      title:
        hangarSessions === null
          ? 'Airlift Northwest: the hangar records could not be read'
          : 'Airlift Northwest: their customer record could not be read, so this page can’t tell whether they were billed',
      detail: 'If they paid you for hangar work this quarter, that money may belong on this return.',
    })
  } else if (hangarSessions > 0) {
    const alnwJob = (jobId: string) =>
      !!alnwCustomerId && rows.jobs.find((it) => it.job.id === jobId)?.customer?.id === alnwCustomerId
    /** Any live invoice to Airlift Northwest, any quarter: billing has begun. */
    const billingStarted = [...gov.values()].some((inv) => alnwJob(inv.job_id))
    const alnwInvoices = [...gov.values()].filter(
      (inv) => alnwJob(inv.job_id) && (inReturn.has(inv.id) || inQuarter(inv.issue_date, qt)),
    ).length
    const sessionsWord = `${hangarSessions} Wings Hangar session${hangarSessions === 1 ? '' : 's'}`
    items.push(
      alnwInvoices > 0
        ? {
            key: 'alnw',
            ok: true,
            title: `Airlift Northwest is billed (${alnwInvoices} invoice${alnwInvoices === 1 ? '' : 's'} this quarter)`,
          }
        : !billingStarted && qt.start <= HANGAR_UNPAID_AS_OF
          ? {
              key: 'alnw',
              ok: true,
              title: 'Airlift Northwest: the hangar isn’t paid yet, so nothing from it goes on this return',
              detail: `You said on September 28 that you aren’t being paid for the hangar tracking yet (${sessionsWord} this quarter). The first invoice to Airlift Northwest turns this check back on.`,
            }
          : !billingStarted
            ? {
                key: 'alnw',
                ok: null,
                title: `Airlift Northwest: ${sessionsWord} this quarter, still no invoices`,
                detail:
                  'On September 28 you said the hangar isn’t paid yet. If they have started paying you, bill them with an invoice so the money lands on this return.',
                refs: [{ label: 'Hangar reports', href: '/hangar/reports' }],
              }
            : {
                key: 'alnw',
                ok: false,
                title: `Airlift Northwest: ${sessionsWord} this quarter, no invoices`,
                detail:
                  'If they paid you for hangar work in these months, that money is not in these figures and may belong on this return. Whether it is taxable is the city’s call — confirm with your tax preparer or the city before you file.',
                refs: [{ label: 'Hangar reports', href: '/hangar/reports' }],
              },
    )
  }

  // 5. Cash taken on work with no invoice yet (cash basis only sees invoiced cash).
  const pending = both.cash.uninvoicedCash
  if (pending.length > 0) {
    items.push({
      key: 'uninvoiced-cash',
      ok: null,
      title: `Cash taken this quarter on ${pending.length} job${pending.length === 1 ? '' : 's'} with no invoice yet`,
      detail:
        'Deposits on work not invoiced yet have no sale and tax to split, so they are not in the cash figures until the invoice goes out. Confirm with your tax preparer how to report them.',
      refs: pending.map((p) => jobRef(p.jobId, p.jobNumber)),
    })
  }

  // 6. The basis matches the federal return.
  items.push(
    basis
      ? { key: 'basis', ok: true, title: `Basis chosen: ${basis === 'cash' ? 'cash (by payment date)' : 'accrual (by invoice date)'}` }
      : {
          key: 'basis',
          ok: both.cash.tax === both.accrual.tax && both.cash.gross === both.accrual.gross ? null : false,
          title: 'Cash or accrual not chosen yet',
          detail:
            both.cash.tax === both.accrual.tax && both.cash.gross === both.accrual.gross
              ? 'This quarter comes out the same either way, but the city requires the same basis as your federal return — confirm with your tax preparer and set it below.'
              : 'The two bases give different figures this quarter. The city requires the same basis as your federal return — confirm with your tax preparer and set it below.',
        },
  )

  // 7. Filed and paid, recorded.
  const due = cbjDueDates(qt)
  const m = (c: number) => formatCents(c)
  const partPaid = status.paidCents > 0 && status.balance > 0
  items.push(
    status.done
      ? { key: 'filed', ok: true, title: `Filed ${formatDate(status.filedOn)}${status.paidOn ? `, paid ${formatDate(status.paidOn)}` : ''}` }
      : qt.end >= today
        ? {
            key: 'filed',
            ok: false,
            title: 'Quarter still open',
            detail: `The quarter closes ${formatDate(qt.end)}. File after that, by ${formatDate(due.official)}.`,
          }
        : {
            key: 'filed',
            ok: false,
            title: partPaid
              ? `${status.filedOn ? 'Filed; paid' : 'Paid'} ${m(status.paidCents)} of ${m(status.taxDue)}, ${m(status.balance)} still to pay`
              : status.filedOn
                ? 'Filed; payment not recorded yet'
                : status.paidCents > 0
                  ? 'Paid in full; not recorded as filed yet'
                  : 'Not filed yet',
            detail: partPaid
              ? 'Record the rest when you pay it. If the city’s return asked for exactly what you paid, remove that payment under “Filings recorded” and record it again with “This was the full amount the city asked for” ticked.'
              : 'Once you file and pay on the city’s site, record it below with the confirmation number.',
          },
  )
  return items
}

/** Loads every recorded filing. Throws on a failed read — callers decide how loud. */
export async function loadTaxFilings(): Promise<TaxFiling[]> {
  const { data, error } = await supabase
    .from('tax_filings')
    .select('*')
    .order('period_start', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as TaxFiling[] | null) ?? []
}
