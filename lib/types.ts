export type PaymentStatus = 'unpaid' | 'partial' | 'paid'
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
  /** Shop warranty on this job's parts and labor. Null = none given. */
  warranty_months: number | null
  warranty_miles: number | null
  /** When the customer was told the vehicle would be ready. */
  promised_date: string | null
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
  memo: string | null
  /** The approvals behind this bill, frozen with it (AS 45.45.170(d)). */
  authorizations: AuthorizationEntry[]
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

export type PaymentMethod = 'cash' | 'check' | 'venmo' | 'card' | 'other'

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

export interface Expense {
  id: string
  date: string
  category: string
  vendor: string | null
  description: string
  amount_cents: number
  storage_path: string | null
  created_at: string
  updated_at: string
}

/** "2015 Honda Civic LX" style label; falls back to whatever fields exist. */
export function vehicleLabel(
  v: Pick<Vehicle, 'year' | 'make' | 'model'> & Partial<Pick<Vehicle, 'trim'>> | null | undefined,
): string {
  if (!v) return 'Unknown vehicle'
  const label = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ')
  return label || 'Unlabeled vehicle'
}
