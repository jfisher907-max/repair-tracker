import { isPassThrough } from './markup'
import { isCoreDeposit } from './cores'
import type { PartCondition, PartLine } from './types'

/**
 * AS 45.45.190: when the customer takes the car back, the invoice identifies
 * every replaced part as new, used, rebuilt or reconditioned.
 *
 * These only SUGGEST. Jake confirms each part on the "before invoicing" check,
 * because a wrong "New" on a remanufactured caliper is a false statement on
 * the invoice — worse than the silence it replaces. Parts that are commonly
 * sold remanufactured are flagged and left for him to pick, never pre-set.
 *
 * Regexes are built from strings with DOUBLE backslashes (see lib/markup.ts).
 */

export type ConditionChoice = PartCondition | 'not_part'

const REBUILT_WORDING = new RegExp('\\b(reman|remanufactured|rebuilt|reconditioned)\\b', 'i')
const USED_WORDING = new RegExp('\\b(used|salvage|junkyard)\\b', 'i')
/** Commonly sold remanufactured with a core deposit: flagged "check", never pre-set. */
const OFTEN_REBUILT = new RegExp(
  '\\b(caliper|cal|alternator|starter|rack|steering\\s*gear|compressor|master\\s*cylinder|brake\\s*shoes?|axle|half-?shaft|cv|injector|turbo|transmission)\\b',
  'i',
)

export interface ConditionSuggestion {
  /** Null = Jake must pick; nothing safe to suggest. */
  value: ConditionChoice | null
  /** Highlight it: commonly remanufactured, so "New" may well be wrong. */
  check: boolean
}

export const CONDITION_CHOICES: { value: ConditionChoice; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'rebuilt', label: 'Rebuilt' },
  { value: 'reconditioned', label: 'Reconditioned' },
  { value: 'used', label: 'Used' },
  { value: 'not_part', label: 'Not a part' },
]

export function suggestCondition(
  l: Pick<PartLine, 'description' | 'unit_cost_cents'> & {
    is_adjustment?: boolean
    receipt_description?: string | null
  },
): ConditionSuggestion {
  const text = `${l.description} ${l.receipt_description ?? ''}`
  if (l.is_adjustment || isPassThrough(l.description) || isCoreDeposit(l)) {
    return { value: 'not_part', check: false }
  }
  if (REBUILT_WORDING.test(text)) return { value: 'rebuilt', check: false }
  if (USED_WORDING.test(text)) return { value: 'used', check: false }
  if (OFTEN_REBUILT.test(text)) return { value: null, check: true }
  return { value: 'new', check: false }
}
