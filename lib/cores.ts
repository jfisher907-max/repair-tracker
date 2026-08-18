import { supabase } from './supabase'
import type { Customer, Job, PartLine, Vehicle } from './types'

/**
 * A core charge is a refundable deposit on the old unit — the shop's money
 * until the dirty part goes back to the supplier. These helpers find the
 * deposits still outstanding so none of them quietly expire on a shelf.
 *
 * Detection is by description, same rule the markup pass-through uses: only a
 * "core charge/deposit" phrase counts, so a Heater Core is never mistaken for
 * a deposit. Returns and refunds are the money coming back, not going out.
 */
const CORE_DEPOSIT = new RegExp('\\bcore\\s*(charge|chg|deposit)\\b', 'i')
const CORE_CREDIT = new RegExp('\\b(return|refund|credit)\\b', 'i')

export function isCoreDeposit(line: Pick<PartLine, 'description' | 'unit_cost_cents'>): boolean {
  return (
    line.unit_cost_cents > 0 &&
    CORE_DEPOSIT.test(line.description) &&
    !CORE_CREDIT.test(line.description)
  )
}

export interface CoreOut extends PartLine {
  job: (Job & { vehicle: (Vehicle & { customer: Customer | null }) | null }) | null
}

/** Every core deposit not yet marked returned, oldest first. */
export async function listCoresOut(): Promise<CoreOut[]> {
  const { data, error } = await supabase
    .from('part_lines')
    .select('*, job:jobs!inner(*, vehicle:vehicles(*, customer:customers(*)))')
    .ilike('description', '%core%')
    .is('core_returned_at', null)
    .is('job.deleted_at', null)
    .order('created_at')
  if (error) throw error
  return ((data as CoreOut[]) ?? []).filter(isCoreDeposit)
}

export async function markCoreReturned(lineId: string, returned: boolean): Promise<void> {
  const { error } = await supabase
    .from('part_lines')
    .update({ core_returned_at: returned ? new Date().toISOString() : null })
    .eq('id', lineId)
  if (error) throw error
}
