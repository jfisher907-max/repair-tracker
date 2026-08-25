import type { Job, PartLine } from './types'

// Client-side mirror of the job_totals Postgres view. Keep the two in sync —
// the view is the authoritative definition.
export interface ComputedTotals {
  labor_charge_cents: number
  parts_cost_cents: number
  parts_charged_cents: number
  total_charged_cents: number
  profit_cents: number
}

/**
 * Client-side mirror of the SQL job_totals view — keep them identical.
 *
 * receiptTaxCents is the sales tax paid at the parts counter across this job's
 * receipts. It is a COST and never a customer charge: it raises parts cost and
 * lowers profit, and touches nothing on the charged side (see migration 0027).
 * Omitting it here while the view counts it is exactly how the two drift.
 */
export function computeTotals(
  job: Pick<Job, 'labor_hours' | 'labor_rate_cents' | 'parts_charged_override_cents'>,
  lines: Pick<PartLine, 'line_total_cents' | 'line_charge_total_cents'>[],
  receiptTaxCents = 0,
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
    profit_cents: total - partsCost,
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

/** Outstanding balance for a job given its total: full total when unpaid, remainder when partial. */
export function unpaidBalanceCents(
  job: Pick<Job, 'payment_status' | 'amount_paid_cents'>,
  totalChargedCents: number,
): number {
  if (job.payment_status === 'paid') return 0
  if (job.payment_status === 'partial') {
    return Math.max(0, totalChargedCents - (job.amount_paid_cents ?? 0))
  }
  return totalChargedCents
}
