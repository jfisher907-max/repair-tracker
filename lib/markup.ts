import { supabase } from './supabase'

export interface MarkupTier {
  /** Top of this cost bracket, in cents. null = the open-ended top tier. */
  up_to_cents: number | null
  multiplier: number
}

export interface MarkupConfig {
  enabled: boolean
  tiers: MarkupTier[]
}

/** Cheap parts carry a high multiple, expensive parts a low one. */
export const DEFAULT_TIERS: MarkupTier[] = [
  { up_to_cents: 500, multiplier: 3.0 },
  { up_to_cents: 2500, multiplier: 2.4 },
  { up_to_cents: 7500, multiplier: 2.0 },
  { up_to_cents: 15000, multiplier: 1.8 },
  { up_to_cents: 30000, multiplier: 1.6 },
  { up_to_cents: null, multiplier: 1.45 },
]

/**
 * The charge for one unit at this cost, or null when the matrix is off or has
 * nothing to say. Null keeps the old meaning — charge at cost — so turning the
 * feature off restores exactly the previous behaviour.
 *
 * Never marks up a credit: a return or a core refund is a negative cost and
 * must come back to the customer at face value.
 */
/**
 * Lines that are somebody else's money passing through — the tax and freight
 * the supplier charged, a discount, a refundable core deposit. Marking these up
 * bills the customer twice for tax and reads badly on an itemised invoice.
 */
const PASS_THROUGH =
  /(saless*)?tax|freight|shipping|delivery|core|discount|credit|refund|deposit|disposal|environmental|fee/i

export function isPassThrough(description: string | null | undefined): boolean {
  return PASS_THROUGH.test((description ?? '').trim())
}

export function markedUpCharge(
  costCents: number,
  config: MarkupConfig,
  description?: string | null,
): number | null {
  if (!config.enabled || costCents <= 0) return null
  if (isPassThrough(description)) return null
  const tiers = [...config.tiers].sort((a, b) => {
    if (a.up_to_cents == null) return 1
    if (b.up_to_cents == null) return -1
    return a.up_to_cents - b.up_to_cents
  })
  const tier = tiers.find((t) => t.up_to_cents == null || costCents <= t.up_to_cents)
  if (!tier || !Number.isFinite(tier.multiplier) || tier.multiplier <= 0) return null
  return Math.round(costCents * tier.multiplier)
}

/** Reads the matrix once per page that adds part lines. */
export async function loadMarkupConfig(): Promise<MarkupConfig> {
  const { data } = await supabase
    .from('settings')
    .select('parts_markup_enabled, parts_markup_tiers')
    .single()
  return {
    enabled: !!data?.parts_markup_enabled,
    tiers: (data?.parts_markup_tiers as MarkupTier[]) ?? [],
  }
}

export function describeTier(t: MarkupTier): string {
  const pct = Math.round((t.multiplier - 1) * 100)
  const cap = t.up_to_cents == null ? 'above' : `up to $${(t.up_to_cents / 100).toFixed(2)}`
  return `${cap} → ×${t.multiplier} (+${pct}%)`
}
