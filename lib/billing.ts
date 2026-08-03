import type { DocLine, Job, PartLine, Quote, QuoteLine } from './types'

// Client-side mirror of the quote_totals view — keep in sync with the SQL.
export interface QuoteComputedTotals {
  labor_cents: number
  lines_cents: number
  tax_cents: number
  total_cents: number
}

export function computeQuoteTotals(
  quote: Pick<Quote, 'labor_hours' | 'labor_rate_cents' | 'tax_rate_bp'>,
  lines: Pick<QuoteLine, 'line_total_cents'>[],
): QuoteComputedTotals {
  const labor = Math.round(Number(quote.labor_hours) * quote.labor_rate_cents)
  const lineSum = lines.reduce((s, l) => s + l.line_total_cents, 0)
  const tax = Math.round(((labor + lineSum) * quote.tax_rate_bp) / 10000)
  return {
    labor_cents: labor,
    lines_cents: lineSum,
    tax_cents: tax,
    total_cents: labor + lineSum + tax,
  }
}

/**
 * Freeze a job's CUSTOMER-FACING math into an invoice snapshot. Later job
 * edits never change an issued invoice. Charge basis only — costs and profit
 * never enter an invoice. With a job-level parts override, per-line prices
 * would expose markup, so the parts collapse to a single line (same rule as
 * the printed report).
 */
export function buildInvoiceSnapshot(
  job: Job,
  partLines: PartLine[],
  taxRateBp: number,
): {
  lines: DocLine[]
  labor_hours: number
  labor_rate_cents: number
  labor_cents: number
  parts_cents: number
  tax_rate_bp: number
  tax_cents: number
  total_cents: number
} {
  const labor = Math.round(Number(job.labor_hours) * job.labor_rate_cents)
  let lines: DocLine[]
  let parts: number
  if (job.parts_charged_override_cents != null) {
    parts = job.parts_charged_override_cents
    lines = parts !== 0
      ? [{ description: 'Parts & materials', qty: 1, unit_charge_cents: parts, line_total_cents: parts }]
      : []
  } else {
    lines = partLines.map((l) => ({
      description: l.part_number ? `${l.description} (#${l.part_number})` : l.description,
      qty: Number(l.qty),
      unit_charge_cents: l.unit_charge_cents ?? l.unit_cost_cents,
      line_total_cents: l.line_charge_total_cents,
    }))
    parts = lines.reduce((s, l) => s + l.line_total_cents, 0)
  }
  const tax = Math.round(((labor + parts) * taxRateBp) / 10000)
  return {
    lines,
    labor_hours: Number(job.labor_hours),
    labor_rate_cents: job.labor_rate_cents,
    labor_cents: labor,
    parts_cents: parts,
    tax_rate_bp: taxRateBp,
    tax_cents: tax,
    total_cents: labor + parts + tax,
  }
}

export function formatTaxRate(bp: number): string {
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`
}

export const quoteStatusColors: Record<string, string> = {
  draft: 'var(--text3)',
  sent: 'var(--blue)',
  approved: 'var(--green)',
  declined: 'var(--red)',
  expired: 'var(--orange)',
  paid: 'var(--green)',
  void: 'var(--text3)',
}
