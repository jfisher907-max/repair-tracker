import { supabase } from './supabase'
import { isPassThrough, isSalesTaxLine } from './markup'
import { quotedPartNumber, samePart } from './receipt-match'
import type { AuthorizationEntry, PartLine } from './types'

/**
 * What the customer approved vs. what the job adds up to — the Alaska
 * Automobile Repair Act check (AS 45.45.140 / .170: no charge over an approved
 * estimate without the customer's OK, given first and recorded).
 *
 * The estimate is the job's TOTAL before tax, not a per-line promise: a part
 * can come in over its quote line while labor comes in under, and the bill
 * is still within what was approved. So everything here compares totals.
 */

/** One row of the job_authorized_totals view (migration 0032). */
export interface JobAuthorization {
  job_id: string
  /** The job came from a quote, so there is an estimate to hold to. */
  checked: boolean
  quoted_cents: number
  /** An approval with no frozen snapshot — rebuilt from the quote's lines. */
  reconstructed: boolean
  ok_delta_cents: number
  authorized_cents: number
  current_cents: number
  over_cents: number
}

/**
 * Fails CLOSED. Swallowing the error returned null, isOverApproval(null) is
 * false, and "couldn't check" then looked exactly like "inside the estimate" —
 * no banner, invoice written anyway. The view has a row for every live job, so
 * an error is the only way this comes back empty; both write paths call it
 * inside a try/catch that shows the message and writes nothing.
 */
export async function loadJobAuthorization(jobId: string): Promise<JobAuthorization | null> {
  const { data, error } = await supabase
    .from('job_authorized_totals')
    .select('*')
    .eq('job_id', jobId)
    .maybeSingle()
  if (error) throw error
  return (data as JobAuthorization | null) ?? null
}

export function isOverApproval(a: JobAuthorization | null | undefined): boolean {
  return !!a && a.checked && a.over_cents > 0
}

/** Mirror of SQL snapshot_pre_tax_cents: labor + non-declined lines, pre-tax. */
export function snapshotPreTaxCents(s: unknown): number | null {
  if (!s || typeof s !== 'object') return null
  const o = s as { labor_hours?: unknown; labor_rate_cents?: unknown; lines?: unknown }
  const labor = Math.round((Number(o.labor_hours) || 0) * (Number(o.labor_rate_cents) || 0))
  const lines = Array.isArray(o.lines) ? (o.lines as { declined?: boolean; line_total_cents?: unknown }[]) : []
  return labor + lines.filter((l) => !l.declined).reduce((sum, l) => sum + (Number(l.line_total_cents) || 0), 0)
}

const METHOD_FALLBACK = 'online'

/**
 * The approvals behind a job's bill, oldest first, frozen onto each invoice
 * (AS 45.45.170(d)). Built ONLY from real records — quote_approvals rows
 * (online or recorded) and job_authorizations. Never synthesized from
 * quotes.decided_at: on Q001/Q003/Q004 that is just the moment of conversion,
 * and printing it as "approved" would put a false date on the invoice.
 */
export async function buildAuthorizationTrail(jobId: string): Promise<AuthorizationEntry[]> {
  const entries: AuthorizationEntry[] = []
  const { data: qs } = await supabase
    .from('quotes')
    .select('id, quote_number')
    .eq('job_id', jobId)
    .not('applied_at', 'is', null)
  const quotes = (qs ?? []) as { id: string; quote_number: string }[]
  if (quotes.length) {
    const numberById = new Map(quotes.map((q) => [q.id, q.quote_number]))
    const { data: appr } = await supabase
      .from('quote_approvals')
      .select('quote_id, response, by_name, method, created_at, snapshot')
      .in('quote_id', quotes.map((q) => q.id))
      .eq('response', 'approved')
      .order('created_at')
    for (const a of (appr ?? []) as {
      quote_id: string
      by_name: string | null
      method: string | null
      created_at: string
      snapshot: unknown
    }[]) {
      entries.push({
        kind: 'quote',
        label: `Estimate ${numberById.get(a.quote_id) ?? ''} approved`.replace('  ', ' '),
        by_name: a.by_name,
        method: a.method ?? METHOD_FALLBACK,
        phone_called: null,
        at: a.created_at,
        amount_cents: snapshotPreTaxCents(a.snapshot) ?? 0,
      })
    }
  }
  const { data: oks } = await supabase
    .from('job_authorizations')
    .select('description, method, by_name, phone_called, authorized_at, new_total_cents')
    .eq('job_id', jobId)
    .order('authorized_at')
  for (const o of (oks ?? []) as {
    description: string
    method: string
    by_name: string
    phone_called: string | null
    authorized_at: string
    new_total_cents: number
  }[]) {
    entries.push({
      kind: 'ok',
      label: `Additional work OK'd: ${o.description}`,
      by_name: o.by_name,
      method: o.method,
      phone_called: o.phone_called,
      at: o.authorized_at,
      amount_cents: o.new_total_cents,
    })
  }
  return entries.sort((x, y) => x.at.localeCompare(y.at))
}

/** One explicit, reviewable step of "bill the approved amount" (apply_billing_plan). */
export interface PlanStep {
  op: 'set_charge' | 'move_tax' | 'cost_only'
  line_id: string
  unit_charge_cents?: number
  quote_line_id?: string
  /** What the owner reads on the preview. */
  label: string
  /** The line's billed amount before and after this step. */
  from_cents: number
  to_cents: number
}

interface ApprovedLine {
  id: string
  description: string
  qty: number
  unit_charge_cents: number
  line_total_cents: number
  part_number: string | null
}

/**
 * Proposes the steps that bring a job back to what the customer approved.
 * Charges only ever come DOWN (the RPC refuses anything else):
 *   - a line linked to an approved line, priced above it, returns to it;
 *   - an unlinked line is paired to an approved line by part number, else by
 *     cost = approved price and the same qty (Jake's at-cost quotes), and
 *     priced back to it;
 *   - counter tax typed as a part moves onto its receipt (cost, never charge);
 *   - a store discount stays Jake's saving unless he passes it on;
 *   - anything else not on the quote becomes shop cost.
 * Whatever is still over after that (extra labor, say) the database takes off
 * as one "Adjustment to approved estimate" line.
 */
export async function buildBillingPlan(
  jobId: string,
  lines: PartLine[],
  opts: { passDiscount: boolean },
): Promise<PlanStep[]> {
  const { data: qs } = await supabase
    .from('quotes')
    .select('id')
    .eq('job_id', jobId)
    .eq('status', 'approved')
    .not('applied_at', 'is', null)
  const quoteIds = ((qs ?? []) as { id: string }[]).map((q) => q.id)
  let approved: ApprovedLine[] = []
  if (quoteIds.length) {
    const { data } = await supabase
      .from('quote_lines')
      .select('id, description, qty, unit_charge_cents, line_total_cents, part_number')
      .in('quote_id', quoteIds)
      .eq('declined', false)
      .order('created_at')
    approved = ((data ?? []) as ApprovedLine[]).map((l) => ({ ...l, qty: Number(l.qty) }))
  }

  const steps: PlanStep[] = []
  const billedNow = (l: PartLine) => l.line_charge_total_cents
  const taken = new Set(lines.map((l) => l.quote_line_id).filter((x): x is string => !!x))

  for (const l of lines) {
    if (l.on_invoice === false || l.is_adjustment) continue
    const unit = l.unit_charge_cents ?? l.unit_cost_cents

    // The RPC enforces the approved LINE TOTAL, so a line that bought more
    // units than were quoted has to come back to total/qty, not to the quoted
    // unit price — proposing the unit price made the RPC refuse the step and
    // throw away the whole plan with it (one transaction).
    const perUnitCap = (a: ApprovedLine) =>
      Math.floor(a.line_total_cents / Math.max(1, Number(l.qty)))

    // Already linked to what the customer approved.
    if (l.quote_line_id) {
      const a = approved.find((x) => x.id === l.quote_line_id)
      if (a) {
        const target = Math.min(a.unit_charge_cents, perUnitCap(a))
        if (unit > target) {
          steps.push({
            op: 'set_charge',
            line_id: l.id,
            unit_charge_cents: target,
            quote_line_id: a.id,
            label: `${l.description}: back to the approved price`,
            from_cents: billedNow(l),
            to_cents: Math.round(Number(l.qty) * target),
          })
        }
      }
      continue
    }

    if (l.receipt_id && isSalesTaxLine(l.description)) {
      steps.push({
        op: 'move_tax',
        line_id: l.id,
        label: `${l.description}: counter tax — moves onto its receipt as your cost`,
        from_cents: billedNow(l),
        to_cents: 0,
      })
      continue
    }

    if (l.unit_cost_cents < 0 && isPassThrough(l.description)) {
      // A store discount or credit: Jake's saving, or the customer's.
      if (!opts.passDiscount) {
        steps.push({
          op: 'cost_only',
          line_id: l.id,
          label: `${l.description}: kept as your saving`,
          from_cents: billedNow(l),
          to_cents: 0,
        })
      }
      continue
    }

    const byNumber = approved.find(
      (a) => !taken.has(a.id) && samePart(l.part_number, quotedPartNumber({ quote_part_number: a.part_number, description: a.description })),
    )
    const match =
      byNumber ??
      approved.find(
        (a) => !taken.has(a.id) && a.unit_charge_cents === l.unit_cost_cents && a.qty === Number(l.qty),
      ) ??
      // The same triple migration 0031 pairs on. Placeholders written before
      // 0030 carry no part number and no cost, so wording is all that is left —
      // and it is exact wording, same qty, same price, or no match.
      approved.find(
        (a) =>
          !taken.has(a.id) &&
          a.qty === Number(l.qty) &&
          a.unit_charge_cents === (l.unit_charge_cents ?? -1) &&
          a.description.trim().toLowerCase() === l.description.trim().toLowerCase(),
      )
    if (match) {
      taken.add(match.id)
      const target = Math.min(unit, match.unit_charge_cents, perUnitCap(match))
      if (target < unit || !l.quote_line_id) {
        steps.push({
          op: 'set_charge',
          line_id: l.id,
          unit_charge_cents: target,
          quote_line_id: match.id,
          label:
            target < unit
              ? `${l.description}: the approved “${match.description}” price`
              : `${l.description}: linked to the approved “${match.description}”`,
          from_cents: billedNow(l),
          to_cents: Math.round(Number(l.qty) * target),
        })
      }
      continue
    }

    // An approved part the receipt never filled: no cost, no receipt, but a
    // real approved charge. It IS the work the customer agreed to — zeroing it
    // billed them LESS than they approved, and nothing ever corrected upward.
    if (l.awaiting_cost || (!l.receipt_id && l.unit_cost_cents === 0 && (l.unit_charge_cents ?? 0) > 0)) {
      continue
    }

    steps.push({
      op: 'cost_only',
      line_id: l.id,
      label: `${l.description}: not on the approved quote — becomes your cost`,
      from_cents: billedNow(l),
      to_cents: 0,
    })
  }
  return steps
}
