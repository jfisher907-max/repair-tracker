'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { computeTotals } from '@/lib/calc'
import { centsToInput, formatCents, formatMiles, parseMoney } from '@/lib/money'
import {
  vehicleLabel,
  type Customer,
  type Job,
  type PartLine,
  type PaymentStatus,
  type Receipt,
  type Vehicle,
} from '@/lib/types'

interface LineDraft {
  purchase_date: string
  store: string
  part_number: string
  description: string
  qty: string
  unit_cost: string
}

const emptyDraft: LineDraft = {
  purchase_date: '', store: '', part_number: '', description: '', qty: '1', unit_cost: '',
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [job, setJob] = useState<Job | null>(null)
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [lines, setLines] = useState<PartLine[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const [addingPart, setAddingPart] = useState(false)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [draft, setDraft] = useState<LineDraft>(emptyDraft)
  const [addedFlash, setAddedFlash] = useState<string | null>(null)
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set())
  const descriptionRef = useRef<HTMLInputElement | null>(null)
  const [storeSuggestions, setStoreSuggestions] = useState<string[]>([])
  const [editingOverride, setEditingOverride] = useState(false)
  const [overrideInput, setOverrideInput] = useState('')

  const load = useCallback(async () => {
    const { data: j, error: jErr } = await supabase
      .from('jobs')
      .select('*, vehicle:vehicles(*, customer:customers(*))')
      .eq('id', id)
      .single()
    if (jErr) {
      setError(jErr.message)
      return
    }
    const { vehicle: v, ...jobRow } = j as Job & { vehicle: Vehicle & { customer: Customer | null } }
    setJob(jobRow as Job)
    setVehicle(v ?? null)
    setCustomer(v?.customer ?? null)

    const [linesRes, receiptsRes, settingsRes] = await Promise.all([
      supabase.from('part_lines').select('*').eq('job_id', id).order('created_at'),
      supabase.from('receipts').select('*').eq('job_id', id).order('created_at'),
      supabase.from('settings').select('store_suggestions').single(),
    ])
    setLines((linesRes.data as PartLine[]) ?? [])
    const recs = (receiptsRes.data as Receipt[]) ?? []
    setReceipts(recs)
    setStoreSuggestions(settingsRes.data?.store_suggestions ?? [])

    if (recs.length) {
      const urls: Record<string, string> = {}
      await Promise.all(
        recs.map(async (r) => {
          const { data } = await supabase.storage.from('receipts').createSignedUrl(r.storage_path, 3600)
          if (data?.signedUrl) urls[r.id] = data.signedUrl
        }),
      )
      setReceiptUrls(urls)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <p style={{ color: 'var(--red)' }}>{error}</p>
  if (!job) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  const totals = computeTotals(job, lines)

  async function updateJob(patch: Partial<Job>) {
    const { error } = await supabase.from('jobs').update(patch).eq('id', id)
    if (error) alert(error.message)
    else await load()
  }

  async function saveLine() {
    if (!draft.description.trim()) {
      alert('Description is required.')
      return
    }
    const payload = {
      job_id: id,
      purchase_date: draft.purchase_date || null,
      store: draft.store.trim() || null,
      part_number: draft.part_number.trim() || null,
      description: draft.description.trim(),
      qty: draft.qty ? Number(draft.qty) : 1,
      unit_cost_cents: parseMoney(draft.unit_cost) ?? 0,
    }
    const result = editingLineId
      ? await supabase.from('part_lines').update(payload).eq('id', editingLineId)
      : await supabase.from('part_lines').insert(payload)
    if (result.error) {
      alert(result.error.message)
      return
    }
    if (editingLineId) {
      setAddingPart(false)
      setEditingLineId(null)
      setDraft(emptyDraft)
    } else {
      // Adding stays open for the next part — a parts run is rarely one line.
      // Store and date carry over since they're usually the same receipt/trip.
      setDraft({ ...emptyDraft, store: draft.store, purchase_date: draft.purchase_date })
      setAddedFlash(draft.description.trim())
      setTimeout(() => setAddedFlash(null), 2500)
      descriptionRef.current?.focus()
    }
    await load()
  }

  async function deleteLine(lineId: string) {
    if (!confirm('Delete this part line?')) return
    const { error } = await supabase.from('part_lines').delete().eq('id', lineId)
    if (error) alert(error.message)
    else await load()
  }

  async function deleteReceipt(r: Receipt) {
    if (!confirm('Delete this receipt photo? Part lines from it stay.')) return
    await supabase.storage.from('receipts').remove([r.storage_path])
    const { error } = await supabase.from('receipts').delete().eq('id', r.id)
    if (error) alert(error.message)
    else await load()
  }

  async function softDeleteJob() {
    if (!confirm(`Delete job ${job!.job_number}? You can restore it from Settings.`)) return
    const { error } = await supabase
      .from('jobs')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) alert(error.message)
    else router.push('/jobs')
  }

  function startEditLine(l: PartLine) {
    setEditingLineId(l.id)
    setAddingPart(true)
    setDraft({
      purchase_date: l.purchase_date ?? '',
      store: l.store ?? '',
      part_number: l.part_number ?? '',
      description: l.description,
      qty: String(l.qty),
      unit_cost: centsToInput(l.unit_cost_cents),
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div className="card space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold" style={{ color: 'var(--accent2)' }}>{job.job_number}</span>
              <span className={`chip chip-${job.payment_status}`}>{job.payment_status}</span>
            </div>
            <h1 className="text-2xl">{job.title}</h1>
            <div className="text-sm" style={{ color: 'var(--text2)' }}>
              {customer && (
                <Link href={`/customers/${customer.id}`} style={{ color: 'var(--blue)' }}>
                  {customer.name}
                </Link>
              )}
              {' · '}
              {vehicle && (
                <Link href={`/vehicles/${vehicle.id}`} style={{ color: 'var(--blue)' }}>
                  {vehicleLabel(vehicle)}
                </Link>
              )}
              {' · '}{job.date}
              {job.odometer_miles != null && ` · ${formatMiles(job.odometer_miles)} mi`}
            </div>
          </div>
          <Link href={`/jobs/${id}/edit`} className="btn btn-sm">Edit</Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/jobs/${id}/scan`} className="btn btn-sm btn-primary">📷 Scan receipt</Link>
          <button
            className="btn btn-sm"
            onClick={() => {
              setAddingPart(true)
              setEditingLineId(null)
              setDraft(emptyDraft)
            }}
          >
            + Add part manually
          </button>
          {customer && (
            <Link href={`/report?customer=${customer.id}`} className="btn btn-sm">
              🖨️ Print history
            </Link>
          )}
          {job.payment_status !== 'paid' && (
            <button
              className="btn btn-sm"
              style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
              onClick={() => updateJob({ payment_status: 'paid' })}
            >
              ✓ Mark paid
            </button>
          )}
        </div>
      </div>

      {/* Work performed */}
      {job.work_performed && (
        <div className="card">
          <div className="label">Work performed</div>
          <p className="whitespace-pre-wrap">{job.work_performed}</p>
        </div>
      )}

      {/* Parts */}
      <div className="card space-y-2">
        <div className="label">Parts</div>
        {lines.length === 0 && !addingPart && (
          <p className="text-sm" style={{ color: 'var(--text3)' }}>
            No parts yet — scan a receipt or add one manually.
          </p>
        )}
        {lines.map((l) => (
          <div
            key={l.id}
            className="flex items-center justify-between gap-2 border-b pb-2 last:border-b-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="min-w-0">
              <div className="truncate font-medium">
                {l.description}
                {l.part_number && (
                  <span className="ml-2 text-xs" style={{ color: 'var(--text3)' }}>#{l.part_number}</span>
                )}
              </div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>
                {[l.store, l.purchase_date, l.receipt_id ? '📎 receipt' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <div className="money font-medium">{formatCents(l.line_total_cents)}</div>
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  {Number(l.qty)} × {formatCents(l.unit_cost_cents)}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => startEditLine(l)}>✎</button>
              <button className="btn btn-sm btn-danger" onClick={() => deleteLine(l.id)}>✕</button>
            </div>
          </div>
        ))}

        {addingPart && (
          <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border2)' }}>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="label">Description *</label>
                <input
                  ref={descriptionRef}
                  className="input"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Part #</label>
                <input
                  className="input"
                  value={draft.part_number}
                  onChange={(e) => setDraft({ ...draft, part_number: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Store</label>
                <input
                  className="input"
                  list="store-suggestions"
                  value={draft.store}
                  onChange={(e) => setDraft({ ...draft, store: e.target.value })}
                />
                <datalist id="store-suggestions">
                  {storeSuggestions.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <label className="label">Qty</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={draft.qty}
                  onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Unit cost ($)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="Negative for returns"
                  value={draft.unit_cost}
                  onChange={(e) => setDraft({ ...draft, unit_cost: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="label">Purchase date</label>
                <input
                  className="input"
                  type="date"
                  value={draft.purchase_date}
                  onChange={(e) => setDraft({ ...draft, purchase_date: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-primary btn-sm" onClick={saveLine}>
                {editingLineId ? 'Save part' : '+ Add this part'}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setAddingPart(false)
                  setEditingLineId(null)
                  setDraft(emptyDraft)
                }}
              >
                {editingLineId ? 'Cancel' : 'Done'}
              </button>
              {addedFlash && (
                <span className="text-sm" style={{ color: 'var(--green)' }}>
                  Added “{addedFlash}” ✓ — next part?
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Receipts */}
      {receipts.length > 0 && (
        <div className="card space-y-2">
          <div className="label">Receipts</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {receipts.map((r) => {
              const pdf = /\.pdf$/i.test(r.storage_path)
              const showImage = receiptUrls[r.id] && !pdf && !failedThumbs.has(r.id)
              return (
                <div key={r.id} className="relative">
                  <a href={receiptUrls[r.id]} target="_blank" rel="noreferrer">
                    {showImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={receiptUrls[r.id]}
                        alt=""
                        className="h-24 w-full rounded-t-lg border border-b-0 object-cover"
                        style={{ borderColor: 'var(--border)' }}
                        onError={() => setFailedThumbs((prev) => new Set(prev).add(r.id))}
                      />
                    ) : (
                      // PDFs and formats the browser can't render (e.g. HEIC
                      // photos) get a clean placeholder; the file still opens.
                      <div
                        className="flex h-24 items-center justify-center rounded-t-lg border border-b-0 text-3xl"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
                      >
                        {pdf ? '📄' : '🧾'}
                      </div>
                    )}
                    <div
                      className="rounded-b-lg border p-1.5"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
                    >
                      <div className="truncate text-sm font-semibold">
                        {r.store ?? (pdf ? 'PDF receipt' : 'Receipt')}
                      </div>
                      <div className="truncate text-xs" style={{ color: 'var(--text3)' }}>
                        {[r.purchase_date, formatCents(r.receipt_total_cents)]
                          .filter((x) => x && x !== '—')
                          .join(' · ') || r.extraction_status}
                      </div>
                    </div>
                  </a>
                  <button
                    className="absolute right-1 top-1 rounded-full px-1.5 text-xs"
                    style={{ background: 'rgba(0,0,0,0.6)', color: 'var(--red)' }}
                    onClick={() => deleteReceipt(r)}
                    aria-label="Delete receipt"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Money summary */}
      <div className="card space-y-1">
        <div className="label">Money</div>
        <Row label={`Labor (${Number(job.labor_hours)} hr × ${formatCents(job.labor_rate_cents)})`} value={totals.labor_charge_cents} />
        <Row label="Parts cost (what you paid)" value={totals.parts_cost_cents} />
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--text2)' }}>
            Parts charged{' '}
            {job.parts_charged_override_cents != null && (
              <span className="text-xs" style={{ color: 'var(--accent2)' }}>(override)</span>
            )}
            <button
              className="ml-2 text-xs underline"
              style={{ color: 'var(--blue)' }}
              onClick={() => {
                setEditingOverride(!editingOverride)
                setOverrideInput(centsToInput(job.parts_charged_override_cents))
              }}
            >
              edit
            </button>
          </span>
          <span className="money">{formatCents(totals.parts_charged_cents)}</span>
        </div>
        {editingOverride && (
          <div className="flex items-center gap-2 py-1">
            <input
              className="input !min-h-[38px]"
              inputMode="decimal"
              placeholder="Blank = charge actual parts cost"
              value={overrideInput}
              onChange={(e) => setOverrideInput(e.target.value)}
            />
            <button
              className="btn btn-sm btn-primary"
              onClick={async () => {
                await updateJob({
                  parts_charged_override_cents: overrideInput.trim() === '' ? null : parseMoney(overrideInput),
                })
                setEditingOverride(false)
              }}
            >
              Save
            </button>
          </div>
        )}
        <div className="border-t pt-1" style={{ borderColor: 'var(--border2)' }}>
          <Row label="Total charged" value={totals.total_charged_cents} bold />
        </div>
        <div
          className="mt-2 flex items-center justify-between rounded-lg px-3 py-2"
          style={{ background: 'var(--bg2)', border: '1px dashed var(--border2)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text3)' }}>
            🔒 Profit (never shown to customers)
          </span>
          <span className="money font-bold" style={{ color: totals.profit_cents >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {formatCents(totals.profit_cents)}
          </span>
        </div>
      </div>

      {/* Payment */}
      <div className="card space-y-2">
        <div className="label">Payment</div>
        <div className="grid grid-cols-2 gap-2">
          <select
            className="select"
            value={job.payment_status}
            onChange={(e) => {
              const status = e.target.value as PaymentStatus
              updateJob({
                payment_status: status,
                amount_paid_cents: status === 'partial' ? job.amount_paid_cents : null,
              })
            }}
          >
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partially paid</option>
            <option value="paid">Paid</option>
          </select>
          {job.payment_status === 'partial' && (
            <input
              className="input"
              inputMode="decimal"
              placeholder="Amount paid ($)"
              defaultValue={centsToInput(job.amount_paid_cents)}
              onBlur={(e) => updateJob({ amount_paid_cents: parseMoney(e.target.value) })}
            />
          )}
        </div>
      </div>

      {/* Notes + danger zone */}
      {job.notes && (
        <div className="card">
          <div className="label">Private notes</div>
          <p className="whitespace-pre-wrap text-sm">{job.notes}</p>
        </div>
      )}
      <div className="pb-4 text-right">
        <button className="btn btn-sm btn-danger" onClick={softDeleteJob}>
          Delete job
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'var(--text2)' }} className={bold ? 'font-bold' : ''}>{label}</span>
      <span className={`money ${bold ? 'text-lg font-bold' : ''}`}>{formatCents(value)}</span>
    </div>
  )
}
