import { isPassThrough, markedUpCharge, type MarkupTier } from './markup'

/**
 * Pricing a quote line once, when the quote is written.
 *
 * Jake prices to match what O'Reilly charges a walk-in customer, "or not much
 * more". The Pro screen shows his cost and a list price well above walk-in,
 * so finding the walk-in price meant building every quote twice — once on
 * the Pro site, once on oreillyauto.com. Now, every time he checks a part's
 * walk-in price, the app keeps it beside the cost (and list) and learns the
 * ratio, per O'Reilly line code because pricing follows the product line.
 * After a few parts it proposes the walk-in figure itself. He can still check
 * any line with one tap; he just stops needing to.
 *
 * The price is set here, once. After the customer approves, the receipt only
 * records cost — nothing re-prices approved work (migration 0030).
 */

export type QuotePricing = 'walkin' | 'matrix' | 'cost_plus' | 'cost' | 'manual'

export const QUOTE_PRICING_CHOICES: { value: QuotePricing; label: string; hint: string }[] = [
  { value: 'walkin', label: 'Match O’Reilly walk-in', hint: 'the walk-in price, plus your % if any' },
  { value: 'matrix', label: 'Markup matrix', hint: 'your cost through the tiers in Parts pricing' },
  { value: 'cost_plus', label: 'Cost + %', hint: 'your cost plus a flat percentage' },
  { value: 'cost', label: 'At cost', hint: 'what you pay O’Reilly' },
  { value: 'manual', label: 'I’ll type it', hint: 'no suggestion' },
]

/** A past line where Jake knew both his figures and the walk-in price. */
export interface WalkInSample {
  line_code: string | null
  unit_cost_cents: number | null
  unit_list_cents: number | null
  unit_retail_cents: number
}

export interface WalkInEstimate {
  cents: number
  /** e.g. "from 6 BB parts" or "from 14 parts". */
  basis: string
  from: 'cost' | 'list'
}

/** Below this many known prices there's nothing honest to estimate from. */
export const MIN_WALKIN_SAMPLES = 3

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** How steady the ratios are (median deviation over median): lower predicts better. */
function spread(xs: number[]): number {
  const m = median(xs)
  return m > 0 ? median(xs.map((x) => Math.abs(x - m))) / m : Infinity
}

/** Walk-in prices end in .99 — $74.99, $131.99 — so estimates do too. */
export function toRetailCents(cents: number): number {
  if (cents <= 0) return cents
  return Math.max(99, Math.ceil(cents / 100) * 100 - 1)
}

/**
 * Rounding for a price that has already had the shop's % added: up to the next
 * 9-cent step, not the next .99.
 *
 * Settings promises "the walk-in price plus X%" — Jake's "or not much more".
 * Rounding a bumped $5.24 up to $5.99 is another 14% on a part that small, so
 * the figure stopped matching the promise exactly where it mattered most.
 */
export function toBumpedCents(cents: number): number {
  if (cents <= 0) return cents
  return Math.max(9, Math.ceil((cents + 1) / 10) * 10 - 1)
}

/**
 * Estimates the walk-in price from the part's cost or list, whichever ratio
 * has been steadier: the part's own line code once it has enough known
 * prices, else every known price. Null until there's enough to go on.
 */
export function estimateWalkIn(
  part: { line_code: string | null; unit_cost_cents: number | null; unit_list_cents: number | null },
  samples: WalkInSample[],
): WalkInEstimate | null {
  const code = part.line_code?.trim().toUpperCase() || null
  const candidates: { from: 'cost' | 'list'; base: number; ratios: number[]; basis: string }[] = []
  for (const from of ['cost', 'list'] as const) {
    const base = from === 'cost' ? part.unit_cost_cents : part.unit_list_cents
    if (!base || base <= 0) continue
    const denom = (s: WalkInSample) => (from === 'cost' ? s.unit_cost_cents : s.unit_list_cents)
    const usable = samples.filter((s) => (denom(s) ?? 0) > 0 && s.unit_retail_cents > 0)
    const ratios = (list: WalkInSample[]) => list.map((s) => s.unit_retail_cents / (denom(s) as number))
    const sameLine = code
      ? usable.filter((s) => (s.line_code ?? '').trim().toUpperCase() === code)
      : []
    if (sameLine.length >= MIN_WALKIN_SAMPLES) {
      candidates.push({ from, base, ratios: ratios(sameLine), basis: `${sameLine.length} ${code} parts` })
    } else if (usable.length >= MIN_WALKIN_SAMPLES) {
      candidates.push({ from, base, ratios: ratios(usable), basis: `${usable.length} parts` })
    }
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => spread(a.ratios) - spread(b.ratios))
  const best = candidates[0]
  return {
    cents: toRetailCents(Math.round(best.base * median(best.ratios))),
    basis: `from ${best.basis}`,
    from: best.from,
  }
}

export interface PriceProposal {
  /** Proposed customer price per unit; null = nothing to propose yet. */
  cents: number | null
  /** One short line explaining where the figure came from. */
  basis: string
}

/**
 * The customer price the shop's rule proposes for one line. The matrix here
 * always uses the saved tiers — it is a quoting rule, independent of whether
 * receipts are auto-priced (Settings > Parts pricing).
 */
export function proposePrice(
  rule: QuotePricing,
  pct: number,
  part: {
    description: string
    line_code: string | null
    unit_cost_cents: number | null
    unit_list_cents: number | null
    unit_retail_cents: number | null
  },
  samples: WalkInSample[],
  tiers: MarkupTier[],
): PriceProposal {
  const cost = part.unit_cost_cents
  const bump = (c: number) => Math.round(c * (1 + pct / 100))
  // Freight, fees, cores and credits pass at face value under EVERY rule, not
  // just the matrix: the pass-through invariant is the whole system's, and an
  // inflated freight line auto-filled with a "walk-in" label reads like a real
  // price nobody double-checks.
  if (cost != null && cost <= 0) return { cents: cost, basis: 'passed through as it stands' }
  if (isPassThrough(part.description)) {
    const face = cost ?? part.unit_retail_cents
    return face == null
      ? { cents: null, basis: 'enter your cost' }
      : { cents: face, basis: 'at cost (fees, freight and cores aren’t marked up)' }
  }
  switch (rule) {
    case 'walkin': {
      if (part.unit_retail_cents != null && part.unit_retail_cents > 0) {
        const cents = pct ? toBumpedCents(bump(part.unit_retail_cents)) : part.unit_retail_cents
        return { cents, basis: `walk-in ${fmt(part.unit_retail_cents)} (checked)${pct ? ` + ${pct}%` : ''}` }
      }
      const est = estimateWalkIn(part, samples)
      if (!est) return { cents: null, basis: 'check the walk-in price once — the app learns from it' }
      const cents = pct ? toBumpedCents(bump(est.cents)) : est.cents
      return { cents, basis: `walk-in ≈ ${fmt(est.cents)} ${est.basis}${pct ? ` + ${pct}%` : ''}` }
    }
    case 'matrix': {
      if (cost == null) return { cents: null, basis: 'enter your cost' }
      const m = markedUpCharge(cost, { enabled: true, tiers }, part.description)
      return { cents: m ?? cost, basis: m == null ? 'at cost (fees, freight and cores aren’t marked up)' : 'your markup matrix' }
    }
    case 'cost_plus':
      return cost == null ? { cents: null, basis: 'enter your cost' } : { cents: bump(cost), basis: `cost + ${pct}%` }
    case 'cost':
      return cost == null ? { cents: null, basis: 'enter your cost' } : { cents: cost, basis: 'at cost' }
    default:
      return { cents: null, basis: '' }
  }
}

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** One tap from a quote line to the part's walk-in price on O'Reilly's public site. */
export function walkInSearchUrl(partNumber: string): string {
  return `https://www.oreillyauto.com/search?q=${encodeURIComponent(partNumber.trim())}`
}
