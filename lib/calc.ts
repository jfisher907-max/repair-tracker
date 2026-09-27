import type { Job, PartLine } from './types'

// Client-side mirror of the job_totals Postgres view. Keep the two in sync —
// the view is the authoritative definition.
export interface ComputedTotals {
  labor_charge_cents: number
  parts_cost_cents: number
  parts_charged_cents: number
  total_charged_cents: number
  included_tax_cents: number
  profit_cents: number
}

/**
 * Client-side mirror of the SQL job_totals view — keep them identical.
 *
 * receiptTaxCents is the sales tax paid at the parts counter across this job's
 * receipts. It is a COST and never a customer charge: it raises parts cost and
 * lowers profit, and touches nothing on the charged side (see migration 0027).
 * Omitting it here while the view counts it is exactly how the two drift.
 *
 * includedTaxCents is the governing (largest live) invoice's included_tax_cents:
 * the sales tax the shop owes on an invoice that went out with no tax line —
 * 5% OF the invoiced price, not a slice backed out of it (CBJ Procedure 130:
 * a seller who billed no tax may not back it out; migrations 0041, 0045). The
 * customer paid the invoiced price and nothing more, so the shop absorbs it:
 * it lowers profit only. It is not a cost of the job and not a charge,
 * so parts cost and total_charged are untouched — the customer paid exactly
 * what the invoice said. The view reads it off the invoice itself; a caller
 * that has the job's invoices passes it, and a caller that omits it gets a
 * profit that reads high by that amount on the six pre-rule jobs.
 */
export function computeTotals(
  job: Pick<Job, 'labor_hours' | 'labor_rate_cents' | 'parts_charged_override_cents'>,
  lines: Pick<PartLine, 'line_total_cents' | 'line_charge_total_cents'>[],
  receiptTaxCents = 0,
  includedTaxCents = 0,
): ComputedTotals {
  const labor = Math.round(Number(job.labor_hours) * job.labor_rate_cents)
  const partsCost =
    lines.reduce((sum, l) => sum + l.line_total_cents, 0) + receiptTaxCents
  const lineCharges = lines.reduce(
    (sum, l) => sum + (l.line_charge_total_cents ?? l.line_total_cents),
    0,
  )
  const partsCharged = job.parts_charged_override_cents ?? lineCharges
  const total = labor + partsCharged
  return {
    labor_charge_cents: labor,
    parts_cost_cents: partsCost,
    parts_charged_cents: partsCharged,
    total_charged_cents: total,
    included_tax_cents: includedTaxCents,
    profit_cents: total - partsCost - includedTaxCents,
  }
}

/**
 * What a job has actually brought in.
 *
 * The payments ledger is the source of truth, but jobs settled before the
 * ledger existed have no rows — only a cached status. Ignoring those would
 * under-report real cash and break the identity collected + unpaid = billed,
 * so a job with no ledger entries falls back to its cached amount (or its
 * full total when simply marked paid). Same rule the job page uses.
 */
export function collectedForJob(
  job: Pick<Job, 'payment_status' | 'amount_paid_cents'>,
  totalChargedCents: number,
  ledgerPaidCents: number,
  hasLedgerEntries: boolean,
): number {
  if (hasLedgerEntries) return ledgerPaidCents
  return job.amount_paid_cents ?? (job.payment_status === 'paid' ? totalChargedCents : 0)
}

/**
 * Outstanding balance on the WORK, before any sales tax line: full total when
 * unpaid, the remainder when partial. This is the pre-tax figure the books
 * use (Finances.unpaid); the customer's own balance is owedGrossCents.
 *
 * `governing` is the job's governing live invoice (governingInvoice), when it
 * has one. The cash in amount_paid_cents is GROSS — it carries that invoice's
 * tax line — so on a partial job the tax riding in it is taken back out
 * before it is set against the pre-tax total: the same proration finances.ts
 * applies (round(tax × min(1, paid ÷ invoice total))). Without that, a payment
 * equal to the pre-tax total zeroed the balance while the whole tax line was
 * still owed. An untaxed invoice (tax_cents 0) has no line to take out, so it
 * reads as before; its included tax is finances.ts's business, not this one's.
 */
export function unpaidBalanceCents(
  job: Pick<Job, 'payment_status' | 'amount_paid_cents'>,
  totalChargedCents: number,
  governing?: { tax_cents: number; total_cents: number } | null,
): number {
  if (job.payment_status === 'paid') return 0
  if (job.payment_status === 'partial') {
    const paid = job.amount_paid_cents ?? 0
    const taxInPaid =
      governing && governing.tax_cents > 0 && governing.total_cents > 0
        ? Math.round(governing.tax_cents * Math.max(0, Math.min(1, paid / governing.total_cents)))
        : 0
    return Math.max(0, totalChargedCents - (paid - taxInPaid))
  }
  return totalChargedCents
}

/**
 * A job's governing invoice: its LARGEST live (non-void) one, ties to the
 * NEWEST — the rule job_totals, finances.ts and the job page all use. Every
 * invoice snapshots the whole job, so two live invoices are revisions of one
 * bill, never two bills. Null when the job has no live invoice.
 */
export function governingInvoice<T extends { status: string; total_cents: number; created_at: string }>(
  invoices: readonly T[],
): T | null {
  let best: T | null = null
  for (const i of invoices) {
    if (i.status === 'void') continue
    if (
      !best ||
      i.total_cents > best.total_cents ||
      (i.total_cents === best.total_cents && i.created_at >= best.created_at)
    ) {
      best = i
    }
  }
  return best
}

/**
 * What the customer still owes on a job, GROSS — the balance as their paper
 * has it: the larger of the job's charge and its governing live invoice's
 * total (an issued invoice can add sales tax on top of the job's charge
 * math), less the money collected on the job (collectedForJob). Never below 0.
 *
 * The one definition for every collections surface (the job page, Reports'
 * receivables and aging, the customer page, the dashboard's oldest-owed). It
 * is NOT Finances.unpaid, which is the pre-tax figure on purpose.
 */
export function owedGrossCents(
  totalChargedCents: number,
  governingInvoiceTotalCents: number | null | undefined,
  collectedCents: number,
): number {
  return Math.max(0, Math.max(totalChargedCents, governingInvoiceTotalCents ?? 0) - collectedCents)
}

/**
 * Over-collection: cash taken on a job beyond what it is owed (the larger of
 * its charge and its governing invoice's total). 0 when nothing is over.
 * J011 is the live case: $240.00 cash against a $231.00 invoice.
 */
export function overCollectedCents(
  totalChargedCents: number,
  governingInvoiceTotalCents: number | null | undefined,
  collectedCents: number,
): number {
  return Math.max(0, collectedCents - Math.max(totalChargedCents, governingInvoiceTotalCents ?? 0))
}
