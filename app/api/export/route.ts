import JSZip from 'jszip'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientForRequest, unauthorized } from '@/lib/server'
import { BRAND_NAME, BRAND_SLUG } from '@/lib/brand'
import { isMissingSchema } from '@/lib/db-errors'

// "Export all data" — Jake's insurance policy against vendor lock-in.
// A zip of CSVs (money stays in integer cents, as stored) + every receipt image.

type Row = Record<string, unknown>

function csvEscape(value: unknown): string {
  if (value == null) return ''
  // jsonb columns (invoice/template lines, markup tiers, store suggestions)
  // arrive parsed — JSON is the only encoding that survives a round trip;
  // String() on an object is "[object Object]" and loses the data.
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(rows: Row[], columns: string[]): string {
  const header = columns.join(',')
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(',')).join('\r\n')
  return `${header}\r\n${body}\r\n`
}

/**
 * Never written to the backup: the bearer token behind a customer's /q, /i or
 * /s link. A copied zip must not open those pages.
 */
const NEVER_EXPORTED = new Set(['public_token'])

/**
 * The columns each CSV leads with, in this order. Every read is select('*'),
 * so a column a list doesn't name yet still lands in its CSV after these
 * (columnsFor): a new column arrives on its own. A table whose migration isn't
 * applied yet is skipped and named in README.txt — never a failed backup — so
 * the tables the planned builds add are listed ahead of their migrations.
 */
const TABLES: Record<string, string[]> = {
  customers: ['id', 'name', 'phone', 'email', 'notes', 'created_at', 'updated_at', 'deleted_at'],
  vehicles: [
    'id', 'customer_id', 'year', 'make', 'model', 'trim', 'engine', 'vin', 'license_plate',
    // Aircraft (AVN-3): which paper it gets, the tail number, the serial number.
    'service_line', 'registration', 'serial_number',
    'notes', 'created_at', 'updated_at', 'deleted_at',
  ],
  jobs: [
    'id', 'job_number', 'vehicle_id', 'date', 'odometer_miles', 'airframe_hours', 'title', 'work_performed',
    'labor_hours', 'labor_rate_cents', 'parts_charged_override_cents', 'payment_status',
    'amount_paid_cents', 'stage', 'stage_changed_at', 'warranty_months', 'warranty_miles',
    'promised_date', 'notes', 'created_at', 'updated_at', 'deleted_at',
  ],
  part_lines: [
    'id', 'job_id', 'receipt_id', 'purchase_date', 'store', 'part_number', 'description', 'qty',
    'unit_cost_cents', 'line_total_cents', 'unit_charge_cents', 'line_charge_total_cents',
    'core_returned_at', 'core_credited_at', 'core_denied_at', 'core_deposit_cents',
    'quote_line_id', 'awaiting_cost', 'on_invoice', 'substituted_from',
    'receipt_description', 'is_adjustment', 'condition', 'notes', 'created_at', 'updated_at',
  ],
  receipts: [
    'id', 'job_id', 'storage_path', 'store', 'purchase_date', 'receipt_total_cents',
    'tax_cents', 'extraction_status', 'saved_at', 'balance_note', 'po_ref', 'vendor_invoice_no',
    'created_at', 'updated_at',
  ],
  settings: [
    'id', 'business_name', 'business_phone', 'business_address', 'business_email',
    'default_labor_rate_cents', 'default_tax_rate_bp', 'default_invoice_terms_days',
    'invoice_payment_instructions', 'google_review_url', 'parts_markup_enabled',
    'parts_markup_tiers', 'quote_pricing', 'quote_markup_pct', 'store_suggestions',
    // The Juneau return's basis (0053) and the resale-card reminder's answer (TAX-3).
    'sales_tax_basis', 'resale_card_prompt', 'resale_card_prompt_at',
    'created_at', 'updated_at',
  ],
  quotes: [
    'id', 'quote_number', 'customer_id', 'vehicle_id', 'service_line', 'title', 'description', 'labor_hours',
    'labor_rate_cents', 'tax_rate_bp', 'status', 'valid_until', 'notes', 'job_id',
    'sent_at', 'viewed_at', 'decided_at', 'applied_at', 'approved_by_name', 'approval_consent', 'approval_ip',
    'approval_user_agent', 'approved_snapshot', 'deposit_kind', 'deposit_value', 'deposit_cents',
    'source_path', 'created_at', 'updated_at', 'deleted_at',
  ],
  quote_approvals: [
    'id', 'quote_id', 'response', 'by_name', 'consent', 'method', 'ip', 'user_agent',
    'snapshot', 'created_at',
  ],
  quote_lines: [
    'id', 'quote_id', 'description', 'qty', 'unit_charge_cents', 'line_total_cents', 'declined',
    'part_number', 'line_code', 'unit_cost_cents', 'unit_list_cents', 'unit_retail_cents',
    'price_basis', 'created_at', 'updated_at',
  ],
  // The AS 45.45.170(d) record of every OK over an approved estimate. Without
  // it an export can't show why a job was billed past its estimate.
  job_authorizations: [
    'id', 'job_id', 'previous_ceiling_cents', 'new_total_cents', 'delta_cents', 'description',
    'method', 'by_name', 'phone_called', 'authorized_at', 'recorded_at', 'corrected_at',
  ],
  invoices: [
    'id', 'invoice_number', 'job_id', 'customer_id', 'issue_date', 'due_date', 'status',
    'customer_name', 'vehicle_label', 'service_line', 'aircraft', 'job_title', 'work_performed',
    'lines', 'labor_hours', 'labor_rate_cents',
    'labor_cents', 'parts_cents', 'tax_rate_bp', 'tax_cents', 'included_tax_cents', 'included_tax_rate_bp',
    'tax_exempt_note',
    'total_cents', 'memo', 'authorizations', 'sent_at', 'paid_at', 'created_at', 'updated_at',
  ],
  payments: [
    'id', 'job_id', 'invoice_id', 'quote_id', 'date', 'method', 'amount_cents', 'note',
    'external_ref', 'created_at', 'updated_at',
  ],
  // Online payments still on their way — a bank transfer takes days (ACH-1).
  online_payments: [
    'id', 'checkout_session_id', 'payment_intent_id', 'invoice_id', 'job_id', 'method',
    'amount_cents', 'state', 'failure_reason', 'started_at', 'settled_at', 'payment_id',
    'created_at', 'updated_at',
  ],
  // Tips (0048): income, never payments toward a job — a backup without them
  // would under-report cash by exactly the tips.
  tips: ['id', 'job_id', 'date', 'method', 'amount_cents', 'note', 'created_at'],
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
  // category becomes a Schedule C line key with EXP-2; external_ref ties a
  // Stripe fee to its payment (0022).
  expenses: [
    'id', 'date', 'category', 'vendor', 'description', 'amount_cents', 'storage_path',
    'external_ref', 'created_at', 'updated_at',
  ],
  business_documents: [
    'id', 'name', 'storage_path', 'mime_type', 'expires_at', 'notes', 'created_at', 'updated_at',
  ],
  // Tax returns filed and tax paid, as recorded (0053). Federal estimated
  // payments are rows here too.
  tax_filings: [
    'id', 'obligation', 'period_start', 'period_end', 'due_date', 'filed_on', 'paid_on',
    'amount_cents', 'settles_return', 'method', 'confirmation', 'note', 'created_at', 'updated_at',
  ],
  // The amount planned for each federal estimated-tax installment (FED-1).
  federal_estimate_plans: [
    'tax_year', 'installment', 'planned_cents', 'set_by', 'note', 'created_at', 'updated_at',
  ],
  // Tools & equipment, for the city's property return and the preparer (ASSET-1).
  business_assets: [
    'id', 'name', 'cbj_class', 'make_model', 'serial_vin', 'origin', 'cost_cents', 'bought_on',
    'bought_on_approx', 'in_service_on', 'value_at_start_cents', 'business_use_pct', 'disposed_on',
    'disposed_price_cents', 'expense_id', 'storage_path', 'notes', 'created_at', 'updated_at',
  ],
  // The mileage log (MILE-1): the business's own vehicles (not customers'),
  // their yearly odometer readings, and the trips.
  business_vehicles: [
    'id', 'name', 'year', 'make', 'model', 'owned_by', 'deduction_method', 'first_business_use_on',
    'retired_on', 'notes', 'created_at', 'updated_at',
  ],
  vehicle_year_miles: ['vehicle_id', 'year', 'odometer_start', 'odometer_end', 'created_at', 'updated_at'],
  mileage_trips: [
    'id', 'vehicle_id', 'trip_date', 'purpose', 'from_place', 'to_place', 'odometer_start',
    'odometer_end', 'miles_tenths', 'job_id', 'created_at', 'updated_at',
  ],
  // The bank check (BANK-1): uploaded statements, their lines, and the entry
  // each line was matched to.
  bank_accounts: [
    'id', 'label', 'kind', 'last4', 'csv_money_in', 'csv_mapping', 'created_at', 'updated_at',
  ],
  bank_statements: [
    'id', 'account_id', 'source', 'file_name', 'storage_path', 'file_sha256', 'period_start',
    'period_end', 'opening_cents', 'closing_cents', 'created_at', 'updated_at',
  ],
  bank_statement_lines: [
    'id', 'statement_id', 'account_id', 'posted_on', 'amount_cents', 'description', 'check_number',
    'balance_cents', 'fingerprint', 'skip_reason', 'note', 'created_at', 'updated_at',
  ],
  bank_matches: [
    'id', 'line_id', 'payment_id', 'tip_id', 'expense_id', 'receipt_id', 'core_part_line_id',
    'tax_filing_id', 'amount_cents', 'how', 'stripe_payout_id', 'created_at',
  ],
  // Wings Hangar: which aircraft was assigned to which hangar when, and the
  // times the hangar was unavailable.
  hangar_sessions: [
    'id', 'aircraft', 'hangar', 'entry', 'exit', 'reason', 'note', 'exit_reason', 'exit_note', 'created_at',
  ],
  hangar_unavailability: ['id', 'start_time', 'end_time', 'note', 'created_at'],
  // Requests from the public site's form (0046).
  service_requests: [
    'id', 'name', 'phone', 'email', 'contact_pref', 'vehicle', 'service_line', 'message', 'status',
    'source', 'ip', 'user_agent', 'created_at', 'updated_at',
  ],
}

/**
 * The listed columns first, then every other column the rows carry. A listed
 * column the table doesn't have yet (its migration isn't applied) is left out
 * rather than written blank; with no rows to look at, the list stands as is.
 */
function columnsFor(listed: string[], rows: Row[]): string[] {
  const keep = (c: string) => !NEVER_EXPORTED.has(c)
  if (rows.length === 0) return listed.filter(keep)
  const present = Object.keys(rows[0])
  const has = new Set(present)
  const lead = listed.filter((c) => has.has(c))
  const leadSet = new Set(lead)
  return [...lead, ...present.filter((c) => !leadSet.has(c))].filter(keep)
}

/**
 * Supabase caps a single select at 1000 rows — page through so the backup is
 * never silently partial. Throws the database's own error, so the caller can
 * read its code (isMissingSchema).
 */
async function fetchAllRows(supabase: SupabaseClient, table: string): Promise<Row[]> {
  const PAGE = 1000
  const rows: Row[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(offset, offset + PAGE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '_')
const extOf = (path: string) => path.split('.').pop() ?? 'bin'

/**
 * The files in the private 'receipts' bucket that ride along with their rows,
 * and where each lands in the zip. A skipped table has no rows, so it brings
 * no files.
 */
const FILES: { table: string; folder: string; name: (row: Row, path: string) => string; readme: string }[] = [
  {
    table: 'receipts',
    folder: 'receipts',
    name: (_row, path) => path.replace(/[^a-zA-Z0-9/._-]/g, '_'),
    readme: 'receipts/ contains the original receipt photos, organized by job id.',
  },
  // The shop's own paperwork — license, insurance — is the LAST thing a
  // backup should leave behind.
  {
    table: 'business_documents',
    folder: 'business-documents',
    name: (row, path) => `${safeName(String(row.name ?? 'document'))}.${extOf(path)}`,
    readme: 'business-documents/ contains the shop licensing and insurance files.',
  },
  {
    table: 'business_assets',
    folder: 'equipment',
    // The id keeps two items with the same name apart.
    name: (row, path) => `${safeName(String(row.name ?? 'item'))}-${String(row.id).slice(0, 8)}.${extOf(path)}`,
    readme: 'equipment/ contains the receipt photos on the tools & equipment list (business_assets.csv).',
  },
  {
    table: 'bank_statements',
    folder: 'bank-statements',
    name: (_row, path) => safeName(path.split('/').pop() ?? path),
    readme: 'bank-statements/ contains the uploaded bank statements, named as in bank_statements.csv storage_path.',
  },
]

export async function GET(request: Request) {
  const auth = await clientForRequest(request)
  if (!auth) return unauthorized()
  const { supabase } = auth

  const zip = new JSZip()

  const rowsByTable = new Map<string, Row[]>()
  /** Tables whose migration isn't applied yet, named in README.txt. */
  const skipped: string[] = []
  try {
    for (const [table, listed] of Object.entries(TABLES)) {
      let rows: Row[]
      try {
        rows = await fetchAllRows(supabase, table)
      } catch (e) {
        // Not in the database yet: leave it out and say so. Anything else (a
        // refusal, a dropped connection) still fails the whole backup — a
        // silently partial one is worse than none.
        if (isMissingSchema(e)) {
          skipped.push(table)
          continue
        }
        throw new Error(`${table}: ${(e as { message?: string } | null)?.message ?? String(e)}`)
      }
      rowsByTable.set(table, rows)
      zip.file(`${table}.csv`, toCsv(rows, columnsFor(listed, rows)))
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }

  // The files, from the already-fetched, fully-paginated rows.
  const folders: string[] = []
  for (const f of FILES) {
    let added = 0
    for (const row of rowsByTable.get(f.table) ?? []) {
      const path = row.storage_path
      if (typeof path !== 'string' || !path) continue
      const { data: blob } = await supabase.storage.from('receipts').download(path)
      if (blob) {
        zip.file(`${f.folder}/${f.name(row, path)}`, await blob.arrayBuffer())
        added++
      }
    }
    // The two folders every backup has always described stay described.
    if (added > 0 || f.table === 'receipts' || f.table === 'business_documents') folders.push(f.readme)
  }

  zip.file(
    'README.txt',
    [
      `${BRAND_NAME} export`,
      `Generated: ${new Date().toISOString()}`,
      '',
      'All *_cents columns are money in integer US cents (divide by 100 for dollars).',
      ...(rowsByTable.has('mileage_trips') ? ['mileage_trips.miles_tenths is miles in tenths (divide by 10).'] : []),
      ...folders,
      ...(skipped.length > 0
        ? [
            '',
            'Not in this backup: these tables come with database updates that aren’t applied yet, so nothing is stored in them.',
            ...skipped.map((t) => `  ${t}`),
          ]
        : []),
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
