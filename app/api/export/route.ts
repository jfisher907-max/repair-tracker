import JSZip from 'jszip'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientForRequest, unauthorized } from '@/lib/server'
import { BRAND_NAME, BRAND_SLUG } from '@/lib/brand'

// "Export all data" — Jake's insurance policy against vendor lock-in.
// A zip of CSVs (money stays in integer cents, as stored) + every receipt image.

function csvEscape(value: unknown): string {
  if (value == null) return ''
  // jsonb columns (invoice/template lines, markup tiers, store suggestions)
  // arrive parsed — JSON is the only encoding that survives a round trip;
  // String() on an object is "[object Object]" and loses the data.
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(',')
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(',')).join('\r\n')
  return `${header}\r\n${body}\r\n`
}

const TABLES: Record<string, string[]> = {
  customers: ['id', 'name', 'phone', 'email', 'notes', 'created_at', 'updated_at', 'deleted_at'],
  vehicles: [
    'id', 'customer_id', 'year', 'make', 'model', 'trim', 'engine', 'vin', 'license_plate', 'notes',
    'created_at', 'updated_at', 'deleted_at',
  ],
  jobs: [
    'id', 'job_number', 'vehicle_id', 'date', 'odometer_miles', 'title', 'work_performed',
    'labor_hours', 'labor_rate_cents', 'parts_charged_override_cents', 'payment_status',
    'amount_paid_cents', 'warranty_months', 'warranty_miles', 'promised_date',
    'notes', 'created_at', 'updated_at', 'deleted_at',
  ],
  part_lines: [
    'id', 'job_id', 'receipt_id', 'purchase_date', 'store', 'part_number', 'description', 'qty',
    'unit_cost_cents', 'line_total_cents', 'unit_charge_cents', 'line_charge_total_cents',
    'core_returned_at', 'notes', 'created_at', 'updated_at',
  ],
  receipts: [
    'id', 'job_id', 'storage_path', 'store', 'purchase_date', 'receipt_total_cents',
    'tax_cents', 'extraction_status', 'created_at', 'updated_at',
  ],
  settings: [
    'id', 'business_name', 'business_phone', 'business_address', 'business_email',
    'default_labor_rate_cents', 'default_tax_rate_bp', 'default_invoice_terms_days',
    'invoice_payment_instructions', 'google_review_url', 'parts_markup_enabled',
    'parts_markup_tiers', 'store_suggestions', 'created_at', 'updated_at',
  ],
  quotes: [
    'id', 'quote_number', 'customer_id', 'vehicle_id', 'title', 'description', 'labor_hours',
    'labor_rate_cents', 'tax_rate_bp', 'status', 'valid_until', 'notes', 'job_id',
    'sent_at', 'decided_at', 'applied_at', 'approved_by_name', 'approval_consent', 'approval_ip',
    'approval_user_agent', 'approved_snapshot', 'deposit_kind', 'deposit_value', 'deposit_cents',
    'created_at', 'updated_at', 'deleted_at',
  ],
  quote_approvals: [
    'id', 'quote_id', 'response', 'by_name', 'consent', 'method', 'ip', 'user_agent',
    'snapshot', 'created_at',
  ],
  quote_lines: [
    'id', 'quote_id', 'description', 'qty', 'unit_charge_cents', 'line_total_cents', 'declined',
    'created_at', 'updated_at',
  ],
  invoices: [
    'id', 'invoice_number', 'job_id', 'customer_id', 'issue_date', 'due_date', 'status',
    'customer_name', 'vehicle_label', 'job_title', 'lines', 'labor_hours', 'labor_rate_cents',
    'labor_cents', 'parts_cents', 'tax_rate_bp', 'tax_cents', 'total_cents', 'memo',
    'sent_at', 'paid_at', 'created_at', 'updated_at',
  ],
  payments: [
    'id', 'job_id', 'invoice_id', 'quote_id', 'date', 'method', 'amount_cents', 'note',
    'external_ref', 'created_at', 'updated_at',
  ],
  job_templates: [
    'id', 'name', 'title', 'work_performed', 'labor_hours', 'lines', 'created_at', 'updated_at',
  ],
  job_photos: [
    'id', 'job_id', 'storage_path', 'caption', 'show_on_quote', 'show_on_invoice',
    'customer_visible', 'created_at', 'updated_at',
  ],
  recommendations: [
    'id', 'job_id', 'vehicle_id', 'description', 'status', 'target_date',
    'estimate_cents', 'resolved_job_id', 'resolved_at', 'created_at', 'updated_at',
  ],
  vehicle_reminders: [
    'id', 'vehicle_id', 'name', 'interval_miles', 'interval_months',
    'last_done_date', 'last_done_miles', 'created_at', 'updated_at',
  ],
  expenses: [
    'id', 'date', 'category', 'vendor', 'description', 'amount_cents', 'storage_path',
    'created_at', 'updated_at',
  ],
  business_documents: [
    'id', 'name', 'storage_path', 'mime_type', 'expires_at', 'notes', 'created_at', 'updated_at',
  ],
}

/** Supabase caps a single select at 1000 rows — page through so the backup is never silently partial. */
async function fetchAllRows(
  supabase: SupabaseClient,
  table: string,
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000
  const rows: Record<string, unknown>[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(offset, offset + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...((data ?? []) as Record<string, unknown>[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

export async function GET(request: Request) {
  const auth = await clientForRequest(request)
  if (!auth) return unauthorized()
  const { supabase } = auth

  const zip = new JSZip()

  let allReceiptRows: Record<string, unknown>[] = []
  let allDocRows: Record<string, unknown>[] = []
  try {
    for (const [table, columns] of Object.entries(TABLES)) {
      const rows = await fetchAllRows(supabase, table)
      if (table === 'receipts') allReceiptRows = rows
      if (table === 'business_documents') allDocRows = rows
      zip.file(`${table}.csv`, toCsv(rows, columns))
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }

  // Receipt images (from the already-fetched, fully-paginated receipt rows)
  const paths = allReceiptRows.map((r) => r.storage_path as string)
  for (const path of paths) {
    const { data: blob } = await supabase.storage.from('receipts').download(path)
    if (blob) {
      zip.file(`receipts/${path.replace(/[^a-zA-Z0-9/._-]/g, '_')}`, await blob.arrayBuffer())
    }
  }

  // The shop's own paperwork — license, insurance — is the LAST thing a
  // backup should leave behind.
  for (const r of allDocRows) {
    const path = r.storage_path as string
    const { data: blob } = await supabase.storage.from('receipts').download(path)
    if (blob) {
      const safeName = String(r.name ?? 'document').replace(/[^a-zA-Z0-9._-]+/g, '_')
      const ext = path.split('.').pop() ?? 'bin'
      zip.file(`business-documents/${safeName}.${ext}`, await blob.arrayBuffer())
    }
  }

  zip.file(
    'README.txt',
    [
      `${BRAND_NAME} export`,
      `Generated: ${new Date().toISOString()}`,
      '',
      'All *_cents columns are money in integer US cents (divide by 100 for dollars).',
      'receipts/ contains the original receipt photos, organized by job id.',
      'business-documents/ contains the shop licensing and insurance files.',
    ].join('\r\n'),
  )

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${BRAND_SLUG}-export-${stamp}.zip"`,
    },
  })
}
