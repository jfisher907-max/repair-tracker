import { isMissingSchema } from './db-errors'
import type { Job, Vehicle } from './types'

/**
 * Aircraft paperwork (AVN-3, migration 0055): which paper a vehicle, quote or
 * invoice gets, and every word that differs between the two.
 *
 * Not 'use client' on purpose: the server routes (the Stripe deposit name) and
 * the client pages read the same table, so a word can never differ between
 * what the customer is charged under and what their paper says.
 *
 * automotive — the Alaska motor-vehicle repair act paper, exactly as it has
 *   always been: ESTIMATE, the AS 45.45.210 notice on every invoice, and the
 *   AS 45.45.190 New / Used / Rebuilt / Reconditioned part tags.
 * aviation — the same letterhead, but QUOTE, no motor-vehicle notice and no
 *   car part tags. AS 45.45 covers vehicles registered under AS 28.10 (AS
 *   45.45.240); aircraft register with the FAA (14 CFR Part 47). General
 *   information, not legal advice.
 *
 * Nothing on aircraft paper may read like a maintenance-record entry or a
 * return to service — that is the logbook's job (14 CFR 43.9), not the
 * invoice's. No wording here says either.
 *
 * All branching goes through this file, so a car path can only change if a
 * line here does. A missing value (a row read before 0055) is automotive.
 */

/** The same words as service_requests.service_line (0046). The only definition. */
export type ServiceLine = 'automotive' | 'aviation'

export const SERVICE_LINES: readonly ServiceLine[] = ['automotive', 'aviation']

/** A row's line. Anything but 'aviation' — including a row read before 0055 — is a car. */
export function lineOf(row: { service_line?: string | null } | null | undefined): ServiceLine {
  return row?.service_line === 'aviation' ? 'aviation' : 'automotive'
}

/** The shop's two starting labor rates, in cents per hour (Settings). */
export interface ShopRates {
  automotive: number
  /** null = no separate aircraft rate: aircraft work starts at the car rate. */
  aviation: number | null
}

/** The rates Settings holds (settings.default_labor_rate_cents / aviation_labor_rate_cents, 0064). */
export function shopRates(s: { default_labor_rate_cents?: number | null; aviation_labor_rate_cents?: number | null }): ShopRates {
  return { automotive: s.default_labor_rate_cents ?? 0, aviation: s.aviation_labor_rate_cents ?? null }
}

/** The labor rate a NEW job or quote starts at for this line (owner, 2026-09-30:
 *  aircraft work at its own rate). An existing one keeps the rate it carries. */
export function laborRateFor(line: ServiceLine, rates: ShopRates): number {
  return line === 'aviation' && rates.aviation != null ? rates.aviation : rates.automotive
}

// ---------------------------------------------------------------------------
// THE OWNER'S FIVE CHOICES (AVN-3, needsFromJake 1-5). Built with the spec's
// own picks; each is one constant, so changing one later is a one-line edit.
// They go on the owner's sheet to confirm.
// ---------------------------------------------------------------------------

/**
 * CHOICE 1 — the last line of an aircraft quote. The same promise the car
 * estimate makes (the price is a ceiling, raised only with the customer's OK),
 * without the word estimate.
 */
export const AIRCRAFT_QUOTE_FOOTER =
  'This is a quote, valid until the date shown above. Your authorization is required for any increase to this price.'

/**
 * CHOICE 2 — New / Used / Rebuilt / Reconditioned tags on aircraft paper.
 * false = left off: aircraft parts go by their own tags and the logbook entry,
 * so the app neither asks for a condition before invoicing an aircraft job nor
 * prints one. true = aircraft get the car behaviour back, ask and print both.
 */
export const AIRCRAFT_PART_TAGS = false

/**
 * CHOICE 3 — the hours an aircraft job records and its invoice prints:
 * airframe hours only. Engine times belong in the logbook entry (and a twin has
 * two sets). An "Engine times" line would be one more entry in aircraftMeta()
 * below, once a job records them.
 */
export const AIRCRAFT_HOURS_LABEL = 'Airframe hours'

/**
 * CHOICE 4 — no charge over the approved quote without the customer's recorded
 * OK. true = kept on aircraft jobs, as a SHOP rule (no statute cited): the
 * aircraft quote footer promises it. false would lift the billing limit on
 * aircraft jobs only; the approval view (job_authorized_totals) stays either
 * way and only the gates branch. Change CHOICE 1's footer with it.
 */
export const AIRCRAFT_HOLDS_TO_APPROVAL = true

/**
 * CHOICE 5 — the number called on a phone OK: REQUIRED on every job (review
 * blocker). The database's CHECK job_authorizations_phone_needs_number refuses
 * a phone OK with no number on any job, so flipping this alone does nothing
 * but let the form send a row the database refuses: it also needs that CHECK
 * replaced by a trigger that looks at the job's vehicle line.
 */
export const AIRCRAFT_PHONE_OK_NEEDS_NUMBER = true

// ---------------------------------------------------------------------------

/** The words on each line's paper. The car column is exactly what printed before 0055. */
export interface Paper {
  /** The quote's document word: "ESTIMATE Q008" / "QUOTE Q012". */
  quote: 'Estimate' | 'Quote'
  /** The same word mid-sentence. */
  quoteLower: 'estimate' | 'quote'
  quoteDate: string
  quotedTotal: string
  /** The meta label over the vehicle label. */
  asset: 'Vehicle' | 'Aircraft'
  /** The last line of the quote. */
  quoteFooter: string
  /** What apply_billing_plan writes when it takes the overage off (the SQL mirrors this). */
  adjustment: string
}

export const PAPER: Record<ServiceLine, Paper> = {
  automotive: {
    quote: 'Estimate',
    quoteLower: 'estimate',
    quoteDate: 'Estimate date',
    quotedTotal: 'Estimated total',
    asset: 'Vehicle',
    // Mirrors the posted notice AS 45.45.150 requires; see DocView's footer.
    quoteFooter:
      'This is an estimate, valid until the date shown above. Your authorization is required for any increase to this price.',
    adjustment: 'Adjustment to approved estimate',
  },
  aviation: {
    quote: 'Quote',
    quoteLower: 'quote',
    quoteDate: 'Quote date',
    quotedTotal: 'Quoted total',
    asset: 'Aircraft',
    quoteFooter: AIRCRAFT_QUOTE_FOOTER,
    adjustment: 'Adjustment to approved quote',
  },
}

/** The owner-facing shop rule behind an aircraft job's billing limit (CHOICE 4). No statute. */
export const AIRCRAFT_SHOP_RULE =
  'Shop rule: no charge over the approved quote without the customer’s OK, written down.'

/**
 * Part conditions — asked before invoicing and printed on the paper (AS
 * 45.45.190 for cars; CHOICE 2 for aircraft). One switch for both, so the app
 * never asks for a word it will not print, or prints one it never asked for.
 */
export function needsPartConditions(line: ServiceLine): boolean {
  return line === 'automotive' || AIRCRAFT_PART_TAGS
}

/** The AS 45.45.210 notice: motor-vehicle paper only. */
export function printsRepairActNotice(line: ServiceLine): boolean {
  return line === 'automotive'
}

/** Whether the job is held to what the customer approved (cars: the law; aircraft: CHOICE 4). */
export function holdsToApproval(line: ServiceLine): boolean {
  return line === 'automotive' || AIRCRAFT_HOLDS_TO_APPROVAL
}

/** Whether a phone OK must carry the number called (cars: the law; aircraft: CHOICE 5). */
export function phoneOkNeedsNumber(line: ServiceLine): boolean {
  return line === 'automotive' || AIRCRAFT_PHONE_OK_NEEDS_NUMBER
}

/**
 * The aircraft identity frozen onto an aviation invoice (invoices.aircraft).
 * get_public_invoice returns exactly these three keys, never the whole column.
 */
export interface AircraftSnapshot {
  registration: string | null
  serial_number: string | null
  airframe_hours: number | null
}

/** The frozen aircraft block for an invoice, or null for a car. */
export function aircraftSnapshot(
  vehicle: Pick<Vehicle, 'service_line' | 'registration' | 'serial_number'> | null | undefined,
  job: Pick<Job, 'airframe_hours'> | null | undefined,
): AircraftSnapshot | null {
  if (lineOf(vehicle) !== 'aviation') return null
  const hours = job?.airframe_hours
  return {
    registration: vehicle?.registration?.trim() || null,
    serial_number: vehicle?.serial_number?.trim() || null,
    // numeric(9,1) can arrive as a string; the snapshot stores a number.
    airframe_hours: hours == null || Number.isNaN(Number(hours)) ? null : Number(hours),
  }
}

const hoursFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** 1234.5 -> "1,234.5"; 1240 -> "1,240.0". Always one decimal place, as the logbook reads. */
export function formatAirframeHours(hours: number | string | null | undefined): string {
  if (hours == null || hours === '' || Number.isNaN(Number(hours))) return '—'
  return hoursFormat.format(Number(hours))
}

/**
 * Airframe hours as typed ("1,234.5", "1234") -> a number with at most one
 * decimal place; null when blank; NaN when it isn't a plain number (the caller
 * says so rather than saving a blank).
 */
export function parseAirframeHours(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '')
  if (cleaned === '') return null
  if (!/^\d+(\.\d)?$/.test(cleaned)) return Number.NaN
  return Number(cleaned)
}

/**
 * A tail number as stored: uppercase, whitespace removed, dashes kept (C-GABC,
 * G-ABCD). No format check — foreign-registered aircraft carry other marks
 * than N-numbers.
 */
export function normalizeRegistration(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase()
}

// ---------------------------------------------------------------------------
// AOG AND NIGHTS & WEEKENDS (migration 0065). The owner, 2026-09-30: "I think
// we keep the rate flexible, but we can definitely have a category for AOG and
// nights + weekends." Two markers an aircraft quote, job or invoice carries —
// either, both or neither — printed on the customer's paper. Words, never a
// price: nothing moves a labor rate because one is ticked. Car paper never
// carries them (0065's CHECKs on quotes and invoices refuse it).
// ---------------------------------------------------------------------------

/** The two markers as quotes, jobs and invoices store them (0065). */
export interface ServiceMarks {
  aog: boolean
  after_hours: boolean
}

/** A row that may carry the markers — or a row read before 0065, which has none. */
type MarksLike = { aog?: boolean | null; after_hours?: boolean | null } | null | undefined

export const NO_MARKS: ServiceMarks = { aog: false, after_hours: false }

/** The markers in the order the forms and the paper list them, with their words. */
export const SERVICE_MARKS: readonly { key: keyof ServiceMarks; label: string }[] = [
  { key: 'aog', label: 'AOG' },
  { key: 'after_hours', label: 'Nights & weekends' },
]

/** What the paper prints them under (DocView's meta row). */
export const SERVICE_MARK_LABEL = 'Service'

/** A row's markers. A missing key (a row read before 0065) is not set. */
export function marksOf(row: MarksLike): ServiceMarks {
  return { aog: row?.aog === true, after_hours: row?.after_hours === true }
}

/** The markers in words: 'AOG', 'Nights & weekends', 'AOG · Nights & weekends',
 *  or null when neither is set. The customer's paper and the owner's chips both
 *  read this; callers show it on aircraft work only. */
export function serviceMarkText(row: MarksLike): string | null {
  const marks = marksOf(row)
  const words = SERVICE_MARKS.filter((m) => marks[m.key]).map((m) => m.label)
  return words.length ? words.join(' · ') : null
}

/**
 * The two columns as a save sends them. Aircraft work sends what is ticked;
 * anything else sends false. Either way they go only when a marker is set now
 * or was set on the saved row (so it clears): a save with no marker, car or
 * aircraft, is the same request it was before 0065.
 */
export function marksPayload(line: ServiceLine, ticked: MarksLike, saved?: MarksLike): Partial<ServiceMarks> {
  const next = line === 'aviation' ? marksOf(ticked) : NO_MARKS
  const had = marksOf(saved)
  return next.aog || next.after_hours || had.aog || had.after_hours ? next : {}
}

/** The meta rows aircraft paper prints after the dates (DocView; CHOICE 3 lives here). */
export function aircraftMeta(a: Partial<AircraftSnapshot> | null | undefined): { label: string; value: string }[] {
  if (!a) return []
  const rows: { label: string; value: string }[] = []
  if (a.serial_number) rows.push({ label: 'Serial number', value: a.serial_number })
  if (a.airframe_hours != null) rows.push({ label: AIRCRAFT_HOURS_LABEL, value: formatAirframeHours(a.airframe_hours) })
  return rows
}

/**
 * The paperwork guards (0055) in plain words, or null when the error is none
 * of them — the caller then keeps whatever it already said. A trigger's name
 * is not a message, and neither is a constraint's.
 */
export function paperErrorWords(e: unknown): string | null {
  const message = (e as { message?: string } | null)?.message ?? (typeof e === 'string' ? e : '')
  if (message.includes('quote_service_line_fixed'))
    return 'This quote already went to the customer, so it stays on the paper it went out on (vehicle or aircraft). Make a new quote for the other one.'
  if (message.includes('quote_needs_aircraft'))
    return 'Attach the aircraft before this quote goes to the customer — its paper prints the tail and serial number. Pick it on the quote (✎ Edit), or add it on the customer’s page first.'
  if (message.includes('vehicle_service_line_fixed'))
    return 'This one already has a job or quote on it, so it stays the kind it is. If it was entered as the wrong kind, add it again as the right one.'
  if (message.includes('invoice_paper_frozen'))
    return 'This invoice was already issued, so its paperwork can’t change. Void it and issue a new one.'
  if (message.includes('vehicles_line_fields_check'))
    return 'A vehicle can’t carry a tail or serial number, and an aircraft can’t carry a VIN or plate. Clear the other kind’s fields and save again.'
  if (message.includes('vehicles_service_line_check') || message.includes('quotes_service_line_check') || message.includes('invoices_service_line_check'))
    return 'That paperwork kind isn’t one the app knows. Pick Vehicle or Aircraft.'
  if (message.includes('jobs_airframe_hours_check'))
    return 'Airframe hours can’t be negative.'
  if (message.includes('invoices_aircraft_check'))
    return 'Only an aircraft invoice can carry aircraft details. Reload the job and create the invoice again.'
  if (message.includes('quotes_aog_after_hours_check') || message.includes('invoices_aog_after_hours_check'))
    return 'AOG and Nights & weekends are for aircraft work only. Untick them, or pick the aircraft, and save again.'
  // The app is ahead of the database: a marker was ticked before 0065 landed.
  if (isMissingSchema(e) && /\b(aog|after_hours)\b/.test(message))
    return 'AOG and Nights & weekends need a database update (0065) that isn’t applied yet. Untick them to save for now.'
  return null
}
