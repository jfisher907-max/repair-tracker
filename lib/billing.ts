import type { DepositKind, DocLine, Job, PartCondition, PartLine, Quote, QuoteLine } from './types'

// Client-side mirror of the quote_totals view — keep in sync with the SQL.
export interface QuoteComputedTotals {
  labor_cents: number
  lines_cents: number
  tax_cents: number
  total_cents: number
}

export function computeQuoteTotals(
  quote: Pick<Quote, 'labor_hours' | 'labor_rate_cents' | 'tax_rate_bp'>,
  lines: (Pick<QuoteLine, 'line_total_cents'> & { declined?: boolean })[],
): QuoteComputedTotals {
  const labor = Math.round(Number(quote.labor_hours) * quote.labor_rate_cents)
  // Customer-declined lines leave the total — the quote is worth what was
  // actually agreed to, not what was proposed.
  const lineSum = lines.filter((l) => !l.declined).reduce((s, l) => s + l.line_total_cents, 0)
  const tax = Math.round(((labor + lineSum) * quote.tax_rate_bp) / 10000)
  return {
    labor_cents: labor,
    lines_cents: lineSum,
    tax_cents: tax,
    total_cents: labor + lineSum + tax,
  }
}

/**
 * Mirror of SQL quote_deposit_cents — keep identical. Turns the deposit rule
 * into cents against the given totals (pass the KEPT lines' totals so the
 * figure follows what the customer is actually approving). Null = no deposit.
 */
export function depositForRule(
  kind: DepositKind,
  value: number | null,
  totals: Pick<QuoteComputedTotals, 'lines_cents' | 'total_cents'>,
): number | null {
  let raw = 0
  if (kind === 'parts') raw = totals.lines_cents
  else if (kind === 'percent') raw = Math.round((totals.total_cents * (value ?? 0)) / 10000)
  else if (kind === 'fixed') raw = value ?? 0
  const clamped = Math.max(0, Math.min(totals.total_cents, raw))
  return clamped > 0 ? clamped : null
}

export const DEPOSIT_KINDS: { value: DepositKind; label: string }[] = [
  { value: 'none', label: 'No deposit' },
  { value: 'parts', label: 'Parts' },
  { value: 'percent', label: '50%' },
  { value: 'fixed', label: 'Custom $' },
]

/** Human label for a stored rule, e.g. "50%" or "Parts" or "$200". */
export function depositRuleLabel(kind: DepositKind, value: number | null): string {
  if (kind === 'parts') return 'parts total'
  if (kind === 'percent') return `${((value ?? 0) / 100).toLocaleString()}%`
  if (kind === 'fixed') return `$${((value ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
  return 'none'
}

/**
 * "Rebuilt: Brake caliper. New: Brake pads, Rotors." — the AS 45.45.190
 * identification for a job whose parts print as one collapsed line, so the
 * disclosure survives the owner's parts override. Empty when no billed part
 * carries a condition (fees and the adjustment line are 'not_part').
 */
function conditionSummary(partLines: PartLine[]): string {
  const byCondition = new Map<PartCondition, string[]>()
  for (const l of partLines) {
    if (l.on_invoice === false || l.is_adjustment) continue
    if (!l.condition || l.condition === 'not_part') continue
    const list = byCondition.get(l.condition) ?? []
    list.push(l.description.trim())
    byCondition.set(l.condition, list)
  }
  const ORDER: PartCondition[] = ['new', 'used', 'rebuilt', 'reconditioned']
  return ORDER.filter((c) => byCondition.has(c))
    .map((c) => `${CONDITION_WORD[c]}: ${(byCondition.get(c) ?? []).join(', ')}`)
    .join('. ')
}

const CONDITION_WORD: Record<PartCondition, string> = {
  new: 'New',
  used: 'Used',
  rebuilt: 'Rebuilt',
  reconditioned: 'Reconditioned',
}

/**
 * Freeze a job's CUSTOMER-FACING math into an invoice snapshot. Later job
 * edits never change an issued invoice. Charge basis only — costs and profit
 * never enter an invoice. With a job-level parts override, per-line prices
 * would expose markup, so the parts collapse to a single line (same rule as
 * the printed report) — carrying the part conditions with them.
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
    // The prices collapse, but AS 45.45.190 doesn't: the invoice still has to
    // say which parts were new, used, rebuilt or reconditioned. Confirming the
    // conditions is demanded before invoicing, and this branch used to throw
    // every one of them away.
    const named = conditionSummary(partLines)
    lines = parts !== 0
      ? [
          {
            description: named ? `Parts & materials — ${named}` : 'Parts & materials',
            qty: 1,
            unit_charge_cents: parts,
            line_total_cents: parts,
          },
        ]
      : []
  } else {
    // The field map stays explicit on purpose: part lines also carry cost,
    // quote links and receipt wording, none of which may reach a customer.
    lines = partLines
      // Off-invoice lines are the shop's own cost (a core deposit, unquoted
      // freight). They charge exactly 0 and never print.
      .filter((l) => l.on_invoice !== false)
      .map((l) => ({
        description: withPartNumber(l.description, l.part_number),
        qty: Number(l.qty),
        unit_charge_cents: l.unit_charge_cents ?? l.unit_cost_cents,
        line_total_cents: l.line_charge_total_cents,
        // AS 45.45.190: each replaced part says new / used / rebuilt /
        // reconditioned. Fees, freight and the adjustment line carry none.
        ...(l.condition && l.condition !== 'not_part' ? { condition: l.condition } : {}),
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

/**
 * "Caliper - Remanufactured - 19B2688" already names its part; printing
 * "(#19B2688)" after it too is noise. Short or odd part numbers ("5%") are
 * appended as before rather than risk a false "already there".
 */
export function withPartNumber(description: string, partNumber: string | null): string {
  if (!partNumber) return description
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const pn = norm(partNumber)
  if (pn.length >= 3 && norm(description).includes(pn)) return description
  return `${description} (#${partNumber})`
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

/**
 * The tinted chip class for a status. The .chip-{status} classes in
 * globals.css are the single source of status colors, so 'paid' (and every
 * other word) looks identical on every screen.
 */
export function statusChipClass(status: string): string {
  const known = [
    'draft', 'sent', 'approved', 'declined', 'expired', 'paid', 'void',
    'unpaid', 'partial', 'open', 'booked', 'done', 'overdue',
  ]
  return known.includes(status) ? `chip chip-${status}` : 'chip'
}
