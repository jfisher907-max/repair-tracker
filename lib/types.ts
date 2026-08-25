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
  created_at: string
  updated_at: string
}

/** One customer-facing line frozen into an invoice snapshot. */
export interface DocLine {
  description: string
  qty: number
  unit_charge_cents: number
  line_total_cents: number
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
