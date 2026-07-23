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

export function computeTotals(
  job: Pick<Job, 'labor_hours' | 'labor_rate_cents' | 'parts_charged_override_cents'>,
  lines: Pick<PartLine, 'line_total_cents' | 'line_charge_total_cents'>[],
): ComputedTotals {
  const labor = Math.round(Number(job.labor_hours) * job.labor_rate_cents)
  const partsCost = lines.reduce((sum, l) => sum + l.line_total_cents, 0)
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
