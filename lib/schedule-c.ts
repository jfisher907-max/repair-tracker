import { dbErrorWords } from './db-errors'
import type { ExpenseLine } from './types'

/**
 * The federal Schedule C line each expense goes on (EXP-2, owner 2026-09-29:
 * "Yes, and move the 4 existing expenses").
 *
 * expenses.category stores a stable KEY (ExpenseLine), guarded by a CHECK
 * (migration 0057). The line NUMBER is a per-tax-year fact kept here, not in
 * the database, because the 2026 draft form renumbers interest: 16a mortgage,
 * 16b vehicle loan (new), 16c other (16b on 2025 and earlier). A change on the
 * final 2026 form edits only this file; no row changes.
 *
 * Sources:
 *   2025 Schedule C             https://www.irs.gov/pub/irs-pdf/f1040sc.pdf
 *   2026 DRAFT (created 5/15/26) https://www.irs.gov/pub/irs-dft/f1040sc--dft.pdf
 *   2025 instructions           https://www.irs.gov/instructions/i1040sc
 *     line 23: "Licenses and regulatory fees for your trade or business paid
 *     each year to state or local governments"; Part V lists technology and
 *     software subscriptions, business start-up costs, and the de minimis
 *     safe harbor ($2,500 per item or invoice, deducted as other expenses).
 *
 * Left out because they do not fit a one-person shop with no employees: 12
 * depletion, 14 employee benefits, 16a mortgage, 16b vehicle loan (2026),
 * 19 pension plans, 26 wages, 27a energy-efficient buildings. Adding one later
 * is one key here plus one word in the CHECK.
 *
 * Deliberately NOT a key: parts bought for a customer's job. Those are cost of
 * goods sold (Part III), recorded as a receipt on the job, never as overhead.
 *
 * General information for Jake and his preparer, not tax advice: where a line
 * is a judgment call (card fees could go on line 10; a fee to FORM the LLC
 * could be a start-up cost), moving it is a one-line edit here.
 */

export interface ExpenseLineInfo {
  /** What Jake reads in the picker. */
  label: string
  /** The compact name for chips and list rows. */
  short: string
  /** The IRS's own words for a Part II line (the Reports page, for the
   *  preparer). Part V items print under 27b with their label instead. */
  formName: string
  /** The line on the 2025 (and earlier) form. */
  line2025: string
  /** The line on the 2026 draft form. */
  line2026: string
  /** Part II = its own line; Part V = listed under line 27b "Other expenses". */
  part: 'II' | 'V'
  /** One short sentence under the picker, or null. */
  hint: string | null
}

/** Every key, Part II in line order and then the Part V items. The order of
 *  this object IS the order chips and Reports list them in. */
export const EXPENSE_LINES: Record<ExpenseLine, ExpenseLineInfo> = {
  advertising: {
    label: 'Advertising', short: 'Advertising', formName: 'Advertising',
    line2025: '8', line2026: '8', part: 'II', hint: null,
  },
  car_truck: {
    label: 'Vehicle costs: parking and tolls (gas and repairs only for a vehicle not on the mileage log)',
    short: 'Vehicle costs', formName: 'Car and truck expenses',
    line2025: '9', line2026: '9', part: 'II',
    hint: 'Using the mileage log for this vehicle? Then only parking and tolls go here, not gas.',
  },
  commissions_fees: {
    label: 'Commissions & fees', short: 'Commissions & fees', formName: 'Commissions and fees',
    line2025: '10', line2026: '10', part: 'II', hint: null,
  },
  contract_labor: {
    label: 'Contract labor (people you paid who aren’t employees)', short: 'Contract labor', formName: 'Contract labor',
    line2025: '11', line2026: '11', part: 'II', hint: null,
  },
  // Line 13 is DEPRECIATION from Form 4562, not the purchase price. The key
  // stays so the purchase is recorded, but no screen ever totals it as line 13
  // (review correction): it is listed apart, for the preparer.
  equipment_large: {
    label: 'Tools & equipment over $2,500 each', short: 'Equipment over $2,500',
    formName: 'Depreciation (Form 4562)',
    line2025: '13 (via Form 4562)', line2026: '13 (via Form 4562)', part: 'II',
    hint: 'Kept apart for your preparer, who works out the write-off on Form 4562. It also goes on your equipment list.',
  },
  insurance: {
    label: 'Insurance (not health)', short: 'Insurance', formName: 'Insurance (other than health)',
    line2025: '15', line2026: '15', part: 'II', hint: null,
  },
  interest: {
    label: 'Interest on business loans', short: 'Interest', formName: 'Interest: other',
    line2025: '16b', line2026: '16c', part: 'II', hint: null,
  },
  legal_professional: {
    label: 'Tax preparer, accountant, lawyer', short: 'Legal & professional', formName: 'Legal and professional services',
    line2025: '17', line2026: '17', part: 'II', hint: null,
  },
  office: {
    label: 'Office supplies & postage', short: 'Office', formName: 'Office expense',
    line2025: '18', line2026: '18', part: 'II', hint: null,
  },
  rent_equipment: {
    label: 'Rent: equipment & vehicles', short: 'Rent: equipment', formName: 'Rent or lease: vehicles, machinery, and equipment',
    line2025: '20a', line2026: '20a', part: 'II', hint: null,
  },
  rent_property: {
    label: 'Rent: shop, hangar, storage', short: 'Rent: shop & storage', formName: 'Rent or lease: other business property',
    line2025: '20b', line2026: '20b', part: 'II', hint: null,
  },
  repairs: {
    label: 'Repairs to your own tools and shop', short: 'Repairs (own)', formName: 'Repairs and maintenance',
    line2025: '21', line2026: '21', part: 'II', hint: null,
  },
  supplies: {
    label: 'Shop supplies used up within a year', short: 'Shop supplies', formName: 'Supplies',
    line2025: '22', line2026: '22', part: 'II',
    hint: 'Parts for a customer’s job go on that job as a receipt, not here.',
  },
  taxes_licenses: {
    label: 'Taxes & licenses', short: 'Taxes & licenses', formName: 'Taxes and licenses',
    line2025: '23', line2026: '23', part: 'II', hint: null,
  },
  travel: {
    label: 'Travel away from home', short: 'Travel', formName: 'Travel',
    line2025: '24a', line2026: '24a', part: 'II', hint: null,
  },
  meals: {
    label: 'Meals while traveling (your preparer applies the limit)', short: 'Meals', formName: 'Deductible meals',
    line2025: '24b', line2026: '24b', part: 'II', hint: null,
  },
  utilities: {
    label: 'Utilities & phone', short: 'Utilities & phone', formName: 'Utilities',
    line2025: '25', line2026: '25', part: 'II', hint: null,
  },
  software: {
    label: 'Software, apps & web services', short: 'Software', formName: 'Software, apps & web services',
    line2025: '27b', line2026: '27b', part: 'V', hint: null,
  },
  equipment_small: {
    label: 'Tools & equipment $2,500 or less each', short: 'Tools & equipment', formName: 'Tools & equipment $2,500 or less each',
    line2025: '27b', line2026: '27b', part: 'V',
    hint: 'Over $2,500 each? Pick the over-$2,500 line. It also goes on your equipment list.',
  },
  // Stripe's fees land here by themselves (book_stripe_fee, 0057), and any
  // fee that function books later (bank transfer, disputes) does too. Venmo
  // fees are typed in by hand.
  card_fees: {
    label: 'Payment processing fees (card, bank transfer, Venmo)', short: 'Payment fees',
    formName: 'Payment processing fees (card, bank transfer, Venmo)',
    line2025: '27b', line2026: '27b', part: 'V',
    hint: 'Stripe’s card fees are added here on their own. Add Venmo or bank fees yourself.',
  },
  startup: {
    label: 'Start-up costs before opening', short: 'Start-up costs', formName: 'Start-up costs',
    line2025: '27b', line2026: '27b', part: 'V',
    hint: 'Spent before the business opened. Your preparer applies the limit.',
  },
  other: {
    label: 'Other (say what in the description)', short: 'Other', formName: 'Other',
    line2025: '27b', line2026: '27b', part: 'V',
    hint: 'Say what it is in the description.',
  },
}

/** The keys in list order: what the CHECK in 0057 allows, and what the
 *  receipt reader may answer. */
export const EXPENSE_LINE_KEYS = Object.keys(EXPENSE_LINES) as ExpenseLine[]

/** The picker's first choices, in this order; everything else sits under
 *  "More lines". */
export const COMMON: readonly ExpenseLine[] = [
  'supplies',
  'equipment_small',
  'car_truck',
  'software',
  'utilities',
  'insurance',
  'taxes_licenses',
  'other',
]

/** The rest of the keys, in line order. */
export const MORE_LINES: readonly ExpenseLine[] = EXPENSE_LINE_KEYS.filter((k) => !COMMON.includes(k))

/** The de minimis safe harbor: $2,500 per item or invoice. */
export const DE_MINIMIS_CENTS = 250_000

/** True for a stored key; false for a label saved before 0057 ('Other',
 *  'Licensing', typed text…). */
export function isExpenseLine(v: unknown): v is ExpenseLine {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EXPENSE_LINES, v)
}

/**
 * The form line for that tax year: '23', '16c', '27b'. equipment_large reads
 * '13 (via Form 4562)': its line-13 figure is depreciation, never the price.
 * Null for a value that is not a key (a row saved before 0057).
 */
export function lineFor(key: string, taxYear: number): string | null {
  if (!isExpenseLine(key)) return null
  const info = EXPENSE_LINES[key]
  return taxYear <= 2025 ? info.line2025 : info.line2026
}

/** The picker label; a legacy value reads as its own text, so a row saved
 *  before 0057 still shows something true. */
export function labelFor(key: string): string {
  return isExpenseLine(key) ? EXPENSE_LINES[key].label : key
}

/** The compact name for chips and rows; a legacy value reads as its own text. */
export function shortFor(key: string): string {
  return isExpenseLine(key) ? EXPENSE_LINES[key].short : key
}

/** The hint under the picker, or null. */
export function hintFor(key: string): string | null {
  return isExpenseLine(key) ? EXPENSE_LINES[key].hint : null
}

/** A picker choice: 'Taxes & licenses · line 23', or
 *  'Software, apps & web services · Part V (27b)'. */
export function pickerText(key: ExpenseLine, taxYear: number): string {
  const info = EXPENSE_LINES[key]
  const line = lineFor(key, taxYear)
  return info.part === 'V' ? `${info.label} · Part V (${line})` : `${info.label} · line ${line}`
}

/** The line in a list row's brackets: '23', '27b'; 'Form 4562' for
 *  equipment over $2,500. Null for a legacy value. */
export function rowLine(key: string, taxYear: number): string | null {
  if (key === 'equipment_large') return 'Form 4562'
  return lineFor(key, taxYear)
}

/**
 * A set of expenses totalled the way the form reads, for the year chips and
 * Reports. Three things are deliberately kept OUT of the line totals:
 *   - equipment over $2,500: its line-13 figure is depreciation worked out on
 *     Form 4562, never the price, so it is listed apart for the preparer;
 *   - the Part V items are summed into 27b and also listed one by one;
 *   - a row still on an old label (saved before 0057) is listed as itself.
 * Every cent lands in exactly one of partII, partVCents, equipmentLarge or
 * legacy, so their sum is the plain total.
 */
export interface LineTotals {
  /** Part II lines in form order: '8' … '25' (equipment_large excluded). */
  partII: { key: ExpenseLine; line: string; cents: number }[]
  /** The Part V items, all on line 27b, in list order. */
  partV: { key: ExpenseLine; cents: number }[]
  /** The line the Part V items total onto: '27b'. */
  partVLine: string
  /** That line's figure: the sum of partV. */
  partVCents: number
  /** Equipment over $2,500 (purchase price), or null when there is none. */
  equipmentLarge: number | null
  /** Old labels, largest first. */
  legacy: { label: string; cents: number }[]
}

export function totalsByLine(
  rows: readonly { category: string; amount_cents: number }[],
  taxYear: number,
): LineTotals {
  const byKey = new Map<string, number>()
  for (const r of rows) byKey.set(r.category, (byKey.get(r.category) ?? 0) + r.amount_cents)

  const partII: LineTotals['partII'] = []
  const partV: LineTotals['partV'] = []
  let partVCents = 0
  for (const key of EXPENSE_LINE_KEYS) {
    const cents = byKey.get(key)
    if (cents == null || key === 'equipment_large') continue
    if (EXPENSE_LINES[key].part === 'V') {
      partV.push({ key, cents })
      partVCents += cents
    } else {
      partII.push({ key, line: lineFor(key, taxYear) ?? '', cents })
    }
  }
  const legacy = [...byKey.entries()]
    .filter(([label]) => !isExpenseLine(label))
    .map(([label, cents]) => ({ label, cents }))
    .sort((a, b) => b.cents - a.cents)

  return {
    partII,
    partV,
    partVLine: lineFor('other', taxYear) ?? '27b',
    partVCents,
    equipmentLarge: byKey.get('equipment_large') ?? null,
    legacy,
  }
}

/**
 * An expenses write refused, in plain words. The only CHECK on expenses is
 * the line key (0057), so 23514 means the line is not one on the list: a
 * page saved before the migration, or an old label. Everything else goes
 * through the house helper; never a constraint name or a code.
 */
export function expenseErrorWords(e: unknown, what: string): string {
  const code = (e as { code?: string } | null)?.code
  if (code === '23514') return 'Pick a line from the list, then save.'
  return dbErrorWords(e, what, 'expenses')
}
