import JSZip from 'jszip'
import { clientForRequest, unauthorized } from '@/lib/server'

// "Export all data" — Jake's insurance policy against vendor lock-in.
// A zip of CSVs (money stays in integer cents, as stored) + every receipt image.

function csvEscape(value: unknown): string {
  if (value == null) return ''
  const s = Array.isArray(value) ? value.join('; ') : String(value)
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
    'amount_paid_cents', 'notes', 'created_at', 'updated_at', 'deleted_at',
  ],
  part_lines: [
    'id', 'job_id', 'receipt_id', 'purchase_date', 'store', 'part_number', 'description', 'qty',
    'unit_cost_cents', 'line_total_cents', 'unit_charge_cents', 'line_charge_total_cents',
    'notes', 'created_at', 'updated_at',
  ],
  receipts: [
    'id', 'job_id', 'storage_path', 'store', 'purchase_date', 'receipt_total_cents',
    'extraction_status', 'created_at', 'updated_at',
  ],
}

export async function GET(request: Request) {
  const auth = await clientForRequest(request)
  if (!auth) return unauthorized()
  const { supabase } = auth

  const zip = new JSZip()

  for (const [table, columns] of Object.entries(TABLES)) {
    const { data, error } = await supabase.from(table).select('*')
    if (error) return Response.json({ error: `${table}: ${error.message}` }, { status: 500 })
    zip.file(`${table}.csv`, toCsv((data ?? []) as Record<string, unknown>[], columns))
  }

  // Receipt images
  const { data: receipts } = await supabase.from('receipts').select('storage_path')
  const paths = (receipts ?? []).map((r) => r.storage_path as string)
  for (const path of paths) {
    const { data: blob } = await supabase.storage.from('receipts').download(path)
    if (blob) {
      zip.file(`receipts/${path.replace(/[^a-zA-Z0-9/._-]/g, '_')}`, await blob.arrayBuffer())
    }
  }

  zip.file(
    'README.txt',
    [
      'Repair Tracker export',
      `Generated: ${new Date().toISOString()}`,
      '',
      'All *_cents columns are money in integer US cents (divide by 100 for dollars).',
      'receipts/ contains the original receipt photos, organized by job id.',
    ].join('\r\n'),
  )

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="repair-tracker-export-${stamp}.zip"`,
    },
  })
}
