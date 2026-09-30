import type { AircraftSnapshot, ServiceLine } from './service-line'

export type PaymentStatus = 'unpaid' | 'partial' | 'paid'
/**
 * Where a job is in the shop (migration 0043). scheduled = approved and
 * booked, not started (job.date is the booked date); in_progress = on the
 * lift; done = work complete, ready to bill. Money statuses apply to done jobs.
 */
export type JobStage = 'scheduled' | 'in_progress' | 'done'
export type ExtractionStatus = 'pending' | 'extracted' | 'manual' | 'failed'

export interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  /** Statement link token — /s/[token] shows this customer's open balances. */
  public_token: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/**
 * Which paper a vehicle, quote or invoice gets: the same words as
 * service_requests.service_line (0046). lib/service-line.ts owns the one
 * definition (and every word that differs between the two); a type-only
 * import, so nothing loads at runtime.
 */
type LineWord = ServiceLine

export interface Vehicle {
  id: string
  customer_id: string
  year: number | null
  make: string | null
  model: string | null
  trim: string | null
  engine: string | null
  vin: string | null
  license_plate: string | null
  notes: string | null
  /** automotive (every row before AVN-3's migration) or aviation; fixed once
   *  the vehicle has a live job or quote. Optional: a row read before it —
   *  a missing value reads as automotive. */
  service_line?: LineWord
  /** Aircraft tail number (registration mark), uppercase. Aviation only. */
  registration?: string | null
  /** Aircraft serial number. Aviation only. */
  serial_number?: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Job {
  id: string
  vehicle_id: string
  job_number: string
  date: string
  odometer_miles: number | null
  title: string
  work_performed: string | null
  /** Customer-facing notes for future work; seeds invoice.memo. */
  recommendations: string | null
  labor_hours: number
  labor_rate_cents: number
  parts_charged_override_cents: number | null
  payment_status: PaymentStatus
  amount_paid_cents: number | null
  /** scheduled | in_progress | done (0043). DB default 'done'; every app INSERT passes it explicitly. */
  stage: JobStage
  /** When stage last changed; null on rows that predate 0043 (they are done). */
  stage_changed_at: string | null
  /** Shop warranty on this job's parts and labor. Null = none given. */
  warranty_months: number | null
  warranty_miles: number | null
  /** When the customer was told the vehicle would be ready. */
  promised_date: string | null
  /** Airframe hours at this job (aircraft); the aviation counterpart of
   *  odometer_miles. Optional: a row read before AVN-3's migration. */
  airframe_hours?: number | null
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface PartLine {
  id: string
  job_id: string
  receipt_id: string | null
  purchase_date: string | null
  store: string | null
  part_number: string | null
  description: string
  qty: number
  unit_cost_cents: number
  line_total_cents: number
  /** Per-unit customer price; null = charge at cost. */
  unit_charge_cents: number | null
  /** Generated: qty × (unit_charge ?? unit_cost). What the customer pays for this line. */
  line_charge_total_cents: number
  /** For core-charge lines: when the old unit went back. Null on a core line = still in the shop. */
  core_returned_at: string | null
  /** When the supplier's credit was confirmed (0038). Handed back but null = unverified. */
  core_credited_at: string | null
  /** When the supplier REFUSED the core (0037). Set = the deposit is gone for good. */
  core_denied_at: string | null
  /** The original deposit (0040). unit_cost_cents is the LIVE cost and goes to 0 once credited. */
  core_deposit_cents: number | null
  /** The approved quote line this part carries onto the job (migration 0030). */
  quote_line_id: string | null
  /** An approved or template part with no real cost yet. Cleared by any cost write. */
  awaiting_cost: boolean
  /** False = the shop's own cost (a core, unquoted freight): never printed, charges exactly 0. */
  on_invoice: boolean
  /** The quoted part number when the part actually installed differs. Owner-only. */
  substituted_from: string | null
  /** The store's wording as printed on the receipt. Owner-only. */
  receipt_description: string | null
  /** The one "Adjustment to approved estimate" line (migration 0032). */
  is_adjustment: boolean
  /** AS 45.45.190 condition; null = not confirmed yet (asked before invoicing). */
  condition: 'new' | 'used' | 'rebuilt' | 'reconditioned' | 'not_part' | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Receipt {
  id: string
  job_id: string
  storage_path: string
  store: string | null
  purchase_date: string | null
  receipt_total_cents: number | null
  /** Sales tax printed on the purchase receipt — a cost, never a customer charge. */
  tax_cents: number
  extraction_status: ExtractionStatus
  extraction_raw: unknown
  /** When the review screen saved it. Null = uploaded but never finished; it can be resumed. */
  saved_at: string | null
  /** Why lines + tax don't equal the printed total, when they don't. */
  balance_note: string | null
  /** PO printed on the supplier ticket — the job (J014) or quote (Q008) number. */
  po_ref: string | null
  /** The supplier's own ticket / invoice number. */
  vendor_invoice_no: string | null
  created_at: string
  updated_at: string
}

export interface Settings {
  id: number
  business_name: string
  business_phone: string
  business_address: string
  business_email: string
  default_labor_rate_cents: number
  default_tax_rate_bp: number
  /** 0 = due on receipt; otherwise Net N days stamped on new invoices. */
  default_invoice_terms_days: number
  invoice_payment_instructions: string
  /** Google review link shared after an invoice is paid; blank hides the button. */
  google_review_url: string | null
  store_suggestions: string[]
  /** Basis for the Juneau sales-tax return (0053): must match the federal
   *  return. Null = not chosen yet. Optional: a row read before 0053. */
  sales_tax_basis?: TaxBasis | null
  /** The owner's answer to the one-time resale-card reminder (TAX-3): null =
   *  not answered yet. Optional: a row read before TAX-3's migration. */
  resale_card_prompt?: 'asked' | 'hidden' | null
  /** When he answered it. */
  resale_card_prompt_at?: string | null
  created_at: string
  updated_at: string
}

/** Cash = by payment date; accrual = by invoice issue date. */
export type TaxBasis = 'cash' | 'accrual'
export type TaxObligation = 'cbj_sales_tax' | 'federal_estimate' | 'cbj_property' | 'other'
export type TaxPaymentMethod = 'ach' | 'card' | 'check' | 'cash' | 'other'

/**
 * A tax return filed and/or tax paid, as the owner recorded it (0053). The app
 * never files or pays; it reads these to turn the dashboard's Taxes door off
 * and to net "sales tax held for the state" down by what was paid.
 */
export interface TaxFiling {
  id: string
  obligation: TaxObligation
  period_start: string
  period_end: string
  due_date: string | null
  filed_on: string | null
  paid_on: string | null
  amount_cents: number
  /** The owner marked this payment as the full amount the city asked for (0053). */
  settles_return: boolean
  method: TaxPaymentMethod | null
  confirmation: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'declined' | 'expired'
export type DepositKind = 'none' | 'parts' | 'percent' | 'fixed'
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void'

export interface Quote {
  id: string
  quote_number: string
  customer_id: string
  vehicle_id: string | null
  title: string
  description: string | null
  labor_hours: number
  labor_rate_cents: number
  tax_rate_bp: number
  status: QuoteStatus
  valid_until: string | null
  notes: string | null
  job_id: string | null
  public_token: string
  /** Deposit RULE the owner asks for; resolved against the approved lines. */
  deposit_kind: DepositKind
  /** percent: basis points; fixed: cents; null otherwise. */
  deposit_value: number | null
  /** The resolved deposit, frozen at approval. Null until approved / none. */
  deposit_cents: number | null
  sent_at: string | null
  decided_at: string | null
  approved_by_name: string | null
  approval_consent: boolean | null
  approval_ip: string | null
  approval_user_agent: string | null
  approved_snapshot: unknown | null
  /** When this quote's lines landed on a job — conversion for regular quotes,
      apply for add-ons. Guards against applying twice. */
  applied_at: string | null
  /** First time the customer opened the public link. Null = never viewed. */
  viewed_at: string | null
  /** The supplier quote file (O'Reilly screenshot/PDF) this quote was read from. */
  source_path: string | null
  /** Which paper the customer gets: automotive = Estimate, aviation = Quote.
   *  Follows the quote's vehicle; fixed once sent. Optional: a row read before
   *  AVN-3's migration — a missing value reads as automotive. */
  service_line?: LineWord
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface QuoteLine {
  id: string
  quote_id: string
  description: string
  qty: number
  unit_charge_cents: number
  line_total_cents: number
  /** Ticked off by the customer's response — out of the total, into follow-ups at conversion. */
  declined: boolean
  /** Supplier part number this line was priced from. Owner-only; never on /q. */
  part_number: string | null
  /** Owner-only supplier figures (migration 0034) — never on the customer's quote. */
  line_code: string | null
  unit_cost_cents: number | null
  unit_list_cents: number | null
  /** The walk-in price Jake checked for this part. Feeds the next estimate. */
  unit_retail_cents: number | null
  price_basis: 'walkin' | 'matrix' | 'cost_plus' | 'cost' | 'manual' | null
  created_at: string
  updated_at: string
}

/** AS 45.45.190: every replaced part is identified as one of these. */
export type PartCondition = 'new' | 'used' | 'rebuilt' | 'reconditioned'

/** One customer-facing line frozen into an invoice snapshot. */
export interface DocLine {
  description: string
  qty: number
  unit_charge_cents: number
  line_total_cents: number
  /** Parts only (fees, freight and adjustments carry none). Absent on invoices
   *  issued before 0032 — they render exactly as issued. */
  condition?: PartCondition
}

/** One approval behind a bill, frozen onto the invoice (AS 45.45.170(d)). */
export interface AuthorizationEntry {
  /** 'quote' = an estimate approved; 'ok' = a recorded OK past the estimate. */
  kind: 'quote' | 'ok'
  /** e.g. "Estimate Q008 approved" or "Additional work OK'd: rear pads". */
  label: string
  by_name: string | null
  /** online / phone / in_person / text */
  method: string | null
  /** Full on the owner's copy; last four digits only on the public link. */
  phone_called: string | null
  /** ISO timestamp of the approval. */
  at: string
  /** The pre-tax total approved at that point. */
  amount_cents: number
}

export interface Invoice {
  id: string
  invoice_number: string
  job_id: string
  customer_id: string
  issue_date: string
  due_date: string | null
  status: InvoiceStatus
  customer_name: string
  vehicle_label: string
  job_title: string
  work_performed: string | null
  lines: DocLine[]
  labor_hours: number
  labor_rate_cents: number
  labor_cents: number
  parts_cents: number
  tax_rate_bp: number
  tax_cents: number
  total_cents: number
  /** Sales tax the shop owes beyond any tax line (0041/0045/0047): the city
   *  rate on the selling price (total − tax_cents) less the tax line. With no
   *  tax line that is 5% OF the invoiced price (CBJ Procedure 130 — it cannot
   *  be backed out of a price that billed none); with a line below the rate
   *  it is the shortfall. Paid by the shop out of what the customer paid.
   *  Books only — the document the customer sees is total_cents, unchanged.
   *  Written by the invoices_book_included_tax trigger (0047) while the
   *  invoice is a draft and as it leaves draft; frozen once sent or paid.
   *  0 when the tax line is at the rate, when tax_exempt_note is set, and on
   *  a void draft. */
  included_tax_cents: number
  /** The city rate included_tax_cents was booked at, pinned by 0047 when the
   *  invoice was first issued; a paid invoice that falls back to draft keeps
   *  it. Null on a never-issued draft. Optional: a row read before 0047. */
  included_tax_rate_bp?: number | null
  /** The customer's sales-tax exemption when the invoice legitimately carries
   *  no tax (e.g. "CBJ senior card #1234"). Null = not exempt. Owner-side
   *  only: get_public_invoice does not return it. Optional because a row
   *  read before 0047 is applied has no such key. */
  tax_exempt_note?: string | null
  memo: string | null
  /** The approvals behind this bill, frozen with it (AS 45.45.170(d)). */
  authorizations: AuthorizationEntry[]
  /** Frozen at creation from the job's vehicle; frozen once issued. aviation =
   *  no AS 45.45.210 notice and no part-condition tags. Optional: a row read
   *  before AVN-3's migration — a missing value reads as automotive. */
  service_line?: LineWord
  /** Frozen aircraft identity on an aviation invoice (AVN-3's AircraftSnapshot);
   *  null otherwise. Optional: a row read before AVN-3's migration. */
  aircraft?: AircraftSnapshot | null
  public_token: string
  sent_at: string | null
  paid_at: string | null
  created_at: string
  updated_at: string
}

export interface JobTotals {
  job_id: string
  labor_charge_cents: number
  parts_cost_cents: number
  parts_charged_cents: number
  total_charged_cents: number
  /** The governing (largest live) invoice's included_tax_cents; 0 when none. */
  included_tax_cents: number
  /** total_charged − parts cost − included tax. total_charged itself is untouched. */
  profit_cents: number
}

/** One line returned by the AI receipt extraction endpoint. */
export interface ExtractedLine {
  part_number: string | null
  description: string
  qty: number
  unit_cost: number
  confidence: 'high' | 'low'
}

export interface ExtractionResult {
  store: string | null
  purchase_date: string | null
  receipt_total: number | null
  /** Sales tax as printed. A cost of the job, reported separately so it can
   *  never become a customer-billed line. */
  sales_tax: number | null
  /** PO / job reference printed on the ticket (the shop writes its job number there). */
  po_number?: string | null
  /** The store's own invoice / ticket number. */
  invoice_number?: string | null
  lines: ExtractedLine[]
}

/** 'ach' = bank transfer (ACH-1). No picker offers it until ACH-1 adds it to
 *  PAYMENT_METHODS, after its migration widens the payments/tips CHECKs. */
export type PaymentMethod = 'cash' | 'check' | 'venmo' | 'card' | 'ach' | 'other'

export interface Payment {
  id: string
  job_id: string
  invoice_id: string | null
  /** Set on deposits: the quote this money was put down against. */
  quote_id?: string | null
  date: string
  method: PaymentMethod
  amount_cents: number
  note: string | null
  created_at: string
  updated_at: string
}

/**
 * A tip on a job (0048): income and cash on its own date, never a payment
 * toward the job and never part of the sale — a voluntary tip is not taxable
 * in Juneau, so it stays out of the sales-tax base and out of every "owed" /
 * "paid" figure.
 */
export interface Tip {
  id: string
  job_id: string
  amount_cents: number
  method: PaymentMethod
  date: string
  note: string | null
  created_at: string
}

/**
 * The Schedule C line an expense belongs to (EXP-2): a stable key, stored in
 * expenses.category. Line numbers and labels per tax year live in
 * lib/schedule-c.ts. Part II lines first, then the Part V (line 27b) keys.
 */
export type ExpenseLine =
  | 'advertising'
  | 'car_truck'
  | 'commissions_fees'
  | 'contract_labor'
  | 'equipment_large'
  | 'insurance'
  | 'interest'
  | 'legal_professional'
  | 'office'
  | 'rent_equipment'
  | 'rent_property'
  | 'repairs'
  | 'supplies'
  | 'taxes_licenses'
  | 'travel'
  | 'meals'
  | 'utilities'
  | 'software'
  | 'equipment_small'
  | 'card_fees'
  | 'startup'
  | 'other'

export interface Expense {
  id: string
  date: string
  /** An ExpenseLine key. Still plain text on a row read before EXP-2's
   *  migration moves the old labels ('Other', 'Licensing'…). */
  category: ExpenseLine | (string & {})
  vendor: string | null
  description: string
  amount_cents: number
  storage_path: string | null
  created_at: string
  updated_at: string
}

/**
 * "2015 Honda Civic LX" style label; falls back to whatever fields exist.
 * An aircraft (AVN-3) reads "N123AB · 2008 Make Model": the tail first, then
 * year make model, joined by ' · ' (U+00B7) — the same label get_public_quote
 * builds in SQL (0055), so every list and search carries the tail number.
 */
export function vehicleLabel(
  v:
    | (Pick<Vehicle, 'year' | 'make' | 'model'> &
        Partial<Pick<Vehicle, 'trim' | 'service_line' | 'registration'>>)
    | null
    | undefined,
): string {
  if (!v) return 'Unknown vehicle'
  if (v.service_line === 'aviation') {
    const aircraft = [v.registration?.trim(), [v.year, v.make, v.model].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(' · ')
    return aircraft || 'Unlabeled aircraft'
  }
  const label = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ')
  return label || 'Unlabeled vehicle'
}
