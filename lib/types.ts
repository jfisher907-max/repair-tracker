export type PaymentStatus = 'unpaid' | 'partial' | 'paid'
export type ExtractionStatus = 'pending' | 'extracted' | 'manual' | 'failed'

export interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
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
  labor_hours: number
  labor_rate_cents: number
  parts_charged_override_cents: number | null
  payment_status: PaymentStatus
  amount_paid_cents: number | null
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
  extraction_status: ExtractionStatus
  extraction_raw: unknown
  created_at: string
  updated_at: string
}

export interface Settings {
  id: number
  business_name: string
  default_labor_rate_cents: number
  store_suggestions: string[]
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
  lines: ExtractedLine[]
}

/** "2015 Honda Civic LX" style label; falls back to whatever fields exist. */
export function vehicleLabel(
  v: Pick<Vehicle, 'year' | 'make' | 'model'> & Partial<Pick<Vehicle, 'trim'>> | null | undefined,
): string {
  if (!v) return 'Unknown vehicle'
  const label = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ')
  return label || 'Unlabeled vehicle'
}
