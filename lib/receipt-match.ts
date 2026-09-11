import { isPassThrough, isSalesTaxLine } from './markup'

/**
 * Pairing a supplier receipt with the parts the customer approved.
 *
 * A receipt FILLS the approved lines (migration 0030, fill_receipt): it brings
 * the real cost, and the approved price stays exactly as agreed. These helpers
 * only PROPOSE pairings. Every one is shown on the review screen and can be
 * changed, because the balance check proves the receipt adds up — not that a
 * caliper went to the right slot.
 *
 * Wording never pairs anything by itself: O'Reilly's web titles and its
 * counter shorthand share almost no words ("BrakeBest Brake Caliper -
 * Remanufactured" vs "BRACKTED CAL"). Part number first, then an exact
 * expected cost; anything else is Jake's pick.
 *
 * Regexes are built from strings with DOUBLE backslashes, as in lib/markup.ts:
 * a single '\b' inside a JS string is a backspace character and silently
 * matches nothing (that shipped once, in a82ef98).
 */

export type RowKind = 'part' | 'core' | 'fee' | 'tax'

/** A core deposit or its refund — the shop's money, never a part to match. */
const CORE_LINE = new RegExp('\\bcore\\s*(charge|chg|deposit|return|refund|credit)\\b', 'i')
/** Counter surcharges isPassThrough doesn't name (J008's receipt carried a SERVICE CHARGE). */
const EXTRA_FEE = new RegExp('\\b(service\\s*charge|surcharge)\\b', 'i')
/** The " - NUMBER" ending O'Reilly titles carry when pasted into a quote. Mirrors fill_receipt. */
const TITLE_PART_NUMBER = new RegExp(' - ([A-Za-z0-9][A-Za-z0-9-]{2,})$')
const HAS_DIGIT = new RegExp('[0-9]')
const LINE_CODE = new RegExp('^[A-Z]{2,4}$')
/** A 2-4 letter store line code in front of a part number ("BBR 980033RGS", "STD_ALS741"). */
const LEADING_LINE_CODE = new RegExp('^[A-Za-z]{2,4}[ _]+(?=\\S*[0-9])')
/** J14, j-014, Q8 -> J014 / Q008, the app's own numbering. */
const JOB_OR_QUOTE_REF = new RegExp('^([JQ])0*([0-9]{1,6})$')

/**
 * The part number as the app stores it: without the store's line code, so
 * "BBR 980033RGS" on the ticket and "980033RGS" on the quote read the same
 * on the job and the invoice. The receipt's own wording is kept separately.
 */
export function cleanPartNumber(pn: string | null | undefined): string {
  return (pn ?? '').trim().replace(LEADING_LINE_CODE, '')
}

/**
 * "BBR 19B2682B" -> { line_code: 'BBR', part_number: '19B2682B' }.
 *
 * A quote has one Part # box and no line-code box, so a pasted O'Reilly number
 * carries both — and the walk-in pricing learns per line code, which it could
 * never do while the code stayed buried in the part number.
 */
export function splitPartNumber(raw: string | null | undefined): {
  line_code: string | null
  part_number: string
} {
  const s = (raw ?? '').trim()
  const m = s.match(LEADING_LINE_CODE)
  if (!m) return { line_code: null, part_number: s }
  const code = m[0]
    .split('')
    .filter((c) => c !== ' ' && c !== '_')
    .join('')
    .toUpperCase()
  return { line_code: code || null, part_number: s.slice(m[0].length) }
}

/** Normalizes a PO as typed at the counter to the app's J### / Q### form. */
export function normalizeRef(ref: string | null | undefined): string {
  const s = (ref ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const m = s.match(JOB_OR_QUOTE_REF)
  return m ? m[1] + m[2].padStart(3, '0') : s
}

export function classifyRow(description: string): RowKind {
  const d = description.trim()
  if (!d) return 'part'
  if (isSalesTaxLine(d)) return 'tax'
  if (CORE_LINE.test(d)) return 'core'
  if (isPassThrough(d) || EXTRA_FEE.test(d)) return 'fee'
  return 'part'
}

/** Letters and digits only, upper-cased: "hi1-5-30ep" and "HI1-5-30EP" agree. */
export function normalizePartNumber(pn: string | null | undefined): string {
  return (pn ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Same part? Equal once normalized, or differing only by a 2-4 letter store
 * line code in front ("STD UF504" vs "UF504"). Never a loose suffix or
 * contains test: HI1-5-30EP-5QT (the 5-quart jug) must not pair with
 * HI1-5-30EP (the quart), and 2682B is not 19B2682B. Mirrors the
 * substitution test in fill_receipt.
 */
export function samePart(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizePartNumber(a)
  const y = normalizePartNumber(b)
  if (x.length < 3 || y.length < 3) return false
  if (x === y) return true
  const [long, short] = x.length > y.length ? [x, y] : [y, x]
  return long.endsWith(short) && LINE_CODE.test(long.slice(0, long.length - short.length))
}

/** An approved line waiting for its cost. */
export interface Slot {
  id: string
  description: string
  qty: number
  unit_charge_cents: number | null
  /** quote_lines.part_number, when the quote recorded one. */
  quote_part_number: string | null
  /** quote_lines.unit_cost_cents — the cost Jake expected when he quoted. */
  expected_cost_cents: number | null
}

/** The quoted part number: the quote line's own, else a " - NUMBER" title ending. */
export function quotedPartNumber(slot: Pick<Slot, 'quote_part_number' | 'description'>): string | null {
  if (slot.quote_part_number && slot.quote_part_number.trim()) return slot.quote_part_number.trim()
  const m = slot.description.match(TITLE_PART_NUMBER)
  return m && HAS_DIGIT.test(m[1]) ? m[1] : null
}

export interface MatchRow {
  kind: RowKind
  part_number: string
  qty: number
  unit_cost_cents: number | null
}

/**
 * Proposes a slot for each receipt row (null = Jake picks). Only part rows
 * ever pair: tax, cores and fees go to their own places.
 *   1. part number (samePart against the quoted number);
 *   2. exact expected cost AND qty — only when the quote recorded a cost, and
 *      only when the candidates are interchangeable (same charge), so twin
 *      calipers pair in order but a $100 caliper never takes an $80 slot.
 */
/** Where a receipt row goes on save, when it isn't filling an approved line. */
export const COST_ONLY = 'cost_only'
export const BILLED = 'billed'
/** No home chosen yet: an approved part is still open, so the screen must ask
 *  rather than guess — guessing "bill it" charges that part a second time. */
export const UNSET = ''

export interface PlacementRow extends MatchRow {
  description: string
}

export interface Placement {
  /** Index of the receipt row this piece came from. */
  source: number
  /** Units of that row going to this target: a consolidated row can split. */
  qty: number
  /** A slot id, COST_ONLY, BILLED, or UNSET. */
  target: string
}

/** Two approved lines for the same thing at the same price — a left and a
 *  right caliper, quoted as separate lines and sold on one ticket line. */
function interchangeable(a: Slot, b: Slot): boolean {
  if (a.unit_charge_cents !== b.unit_charge_cents) return false
  const pa = quotedPartNumber(a)
  const pb = quotedPartNumber(b)
  if (pa && pb) return samePart(pa, pb)
  return a.description.trim().toLowerCase() === b.description.trim().toLowerCase()
}

/**
 * Every receipt row given a home, splitting where one ticket line pays for
 * more than one approved line.
 *
 * Two rules the screen can't get wrong without costing real money:
 *   - A consolidated row ("BRACKTED CAL 2 @ 94.99") against two identical
 *     approved lines fills BOTH. Paired to just one, the other kept waiting at
 *     $0 and the second unit landed on the shop's books, so entering its cost
 *     later counted it twice.
 *   - While ANY approved line is still open, an unpaired part row gets no
 *     default at all. Defaulting it to "bill the customer" charged a templated
 *     or quoted part twice over.
 */
export function planPlacements(
  rows: PlacementRow[],
  slots: Slot[],
  opts: { locked: boolean; quoted: boolean },
): Placement[] {
  const pairs = proposePairs(rows, slots)
  const claimed = new Set(pairs.filter((p): p is string => !!p))
  const byId = new Map(slots.map((s) => [s.id, s]))
  // A core deposit is the shop's money back when the old part goes in, so it
  // never defaults onto a customer's bill — which is what the screen's own
  // footer already told the owner it did. Freight and fees still default onto
  // a walk-in bill at face value: those are real costs of that job.
  const fallbackFor = (kind: RowKind) =>
    opts.locked || opts.quoted || kind === 'core' ? COST_ONLY : BILLED
  // null = decide once every split has claimed what it needs.
  const draft: { source: number; qty: number; target: string | null }[] = []

  rows.forEach((r, i) => {
    const qty = Number(r.qty) || 1
    const id = pairs[i]
    const slot = id ? byId.get(id) : undefined
    if (!id || !slot) {
      draft.push({ source: i, qty, target: null })
      return
    }
    if (qty <= slot.qty) {
      draft.push({ source: i, qty, target: id })
      return
    }
    draft.push({ source: i, qty: slot.qty, target: id })
    let rest = qty - slot.qty
    for (const twin of slots) {
      if (rest <= 0) break
      if (claimed.has(twin.id) || !interchangeable(twin, slot)) continue
      const take = Math.min(rest, twin.qty)
      claimed.add(twin.id)
      draft.push({ source: i, qty: take, target: twin.id })
      rest -= take
    }
    if (rest > 0) draft.push({ source: i, qty: rest, target: null })
  })

  const slotsOpen = slots.some((s) => !claimed.has(s.id))
  return draft.map((d) => ({
    source: d.source,
    qty: d.qty,
    target:
      d.target ??
      (slotsOpen && rows[d.source].kind === 'part' ? UNSET : fallbackFor(rows[d.source].kind)),
  }))
}

export function proposePairs(rows: MatchRow[], slots: Slot[]): (string | null)[] {
  const out: (string | null)[] = rows.map(() => null)
  const taken = new Set<string>()

  rows.forEach((r, i) => {
    if (r.kind !== 'part' || !r.part_number.trim()) return
    const hit = slots.find((s) => !taken.has(s.id) && samePart(r.part_number, quotedPartNumber(s)))
    if (hit) {
      out[i] = hit.id
      taken.add(hit.id)
    }
  })

  rows.forEach((r, i) => {
    if (out[i] || r.kind !== 'part' || r.unit_cost_cents == null) return
    const hits = slots.filter(
      (s) =>
        !taken.has(s.id) &&
        s.expected_cost_cents != null &&
        s.expected_cost_cents === r.unit_cost_cents &&
        Number(s.qty) === Number(r.qty),
    )
    if (hits.length > 0 && hits.every((h) => h.unit_charge_cents === hits[0].unit_charge_cents)) {
      out[i] = hits[0].id
      taken.add(hits[0].id)
    }
  })

  return out
}
