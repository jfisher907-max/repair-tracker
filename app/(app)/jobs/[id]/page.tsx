'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { computeTotals } from '@/lib/calc'
import { buildInvoiceSnapshot, statusChipClass } from '@/lib/billing'
import { centsToInput, formatCents, formatMiles, parseMoney } from '@/lib/money'
import { PAYMENT_METHODS, deletePayment, recordPayment, syncJobPayment } from '@/lib/payments'
import { formatDate, todayLocalIso } from '@/lib/date'
import { saveJobAsTemplate } from '@/lib/templates'
import JobPhotos from '@/components/JobPhotos'
import RecommendationList from '@/components/RecommendationList'
import { listForJob, toMemo, type Recommendation } from '@/lib/recommendations'
import { markedUpCharge, type MarkupConfig } from '@/lib/markup'
import {
  vehicleLabel,
  type Customer,
  type Invoice,
  type Job,
  type PartLine,
  type Payment,
  type PaymentMethod,
  type Quote,
  type Receipt,
  type Vehicle,
} from '@/lib/types'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface LineDraft {
  purchase_date: string
  store: string
  part_number: string
  description: string
  qty: string
  unit_cost: string
  unit_charge: string
}

const emptyDraft: LineDraft = {
  purchase_date: '', store: '', part_number: '', description: '', qty: '1', unit_cost: '', unit_charge: '',
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [job, setJob] = useState<Job | null>(null)
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [lines, setLines] = useState<PartLine[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invoicing, setInvoicing] = useState(false)
  const [payments, setPayments] = useState<Payment[]>([])
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [payDate, setPayDate] = useState(todayIso())
  const [payingBusy, setPayingBusy] = useState(false)
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const [addingPart, setAddingPart] = useState(false)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [savingLine, setSavingLine] = useState(false)
  const [busyLineId, setBusyLineId] = useState<string | null>(null)
  const [lineMsg, setLineMsg] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [payQuickOpen, setPayQuickOpen] = useState(false)
  const [payQuickMethod, setPayQuickMethod] = useState<PaymentMethod>('cash')
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [draft, setDraft] = useState<LineDraft>(emptyDraft)
  const [addedFlash, setAddedFlash] = useState<string | null>(null)
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set())
  /** Correcting the sales tax recorded on a receipt after the fact. */
  const [taxEditId, setTaxEditId] = useState<string | null>(null)
  const [taxInput, setTaxInput] = useState('')
  const [taxBusy, setTaxBusy] = useState(false)
  const descriptionRef = useRef<HTMLInputElement | null>(null)
  const [storeSuggestions, setStoreSuggestions] = useState<string[]>([])
  const [markup, setMarkup] = useState<MarkupConfig>({ enabled: false, tiers: [] })
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [editingLabor, setEditingLabor] = useState(false)
  const [savingLabor, setSavingLabor] = useState(false)
  const [laborHoursInput, setLaborHoursInput] = useState('')
  const [laborRateInput, setLaborRateInput] = useState('')
  const [editingOverride, setEditingOverride] = useState(false)
  const [overrideInput, setOverrideInput] = useState('')
  const [linkedQuotes, setLinkedQuotes] = useState<(Quote & { total_cents: number | null })[]>([])

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

    const [linesRes, receiptsRes, settingsRes, invoicesRes, paymentsRes] = await Promise.all([
      supabase.from('part_lines').select('*').eq('job_id', id).order('created_at'),
      supabase.from('receipts').select('*').eq('job_id', id).order('created_at'),
      supabase.from('settings').select('store_suggestions, parts_markup_enabled, parts_markup_tiers').single(),
      supabase.from('invoices').select('*').eq('job_id', id).order('created_at'),
      supabase.from('payments').select('*').eq('job_id', id).order('date'),
    ])
    setLines((linesRes.data as PartLine[]) ?? [])
    const recs = (receiptsRes.data as Receipt[]) ?? []
    setReceipts(recs)
    setStoreSuggestions(settingsRes.data?.store_suggestions ?? [])
    setRecs(await listForJob(id))
    setMarkup({
      enabled: !!settingsRes.data?.parts_markup_enabled,
      tiers: settingsRes.data?.parts_markup_tiers ?? [],
    })
    setInvoices((invoicesRes.data as Invoice[]) ?? [])
    setPayments((paymentsRes.data as Payment[]) ?? [])

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

    // Quotes tied to this job: the one it came from plus any add-on quotes
    // for extra work found mid-job.
    const { data: lq } = await supabase
      .from('quotes')
      .select('*')
      .eq('job_id', id)
      .is('deleted_at', null)
      .order('created_at')
    const quoteRows = (lq as Quote[]) ?? []
    const totalsByQuote: Record<string, number> = {}
    if (quoteRows.length) {
      const { data: qt } = await supabase
        .from('quote_totals')
        .select('*')
        .in('quote_id', quoteRows.map((q) => q.id))
      for (const t of (qt as { quote_id: string; total_cents: number }[]) ?? [])
        totalsByQuote[t.quote_id] = t.total_cents
    }
    setLinkedQuotes(quoteRows.map((q) => ({ ...q, total_cents: totalsByQuote[q.id] ?? null })))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <p style={{ color: 'var(--red)' }}>{error}</p>
  if (!job) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  /** Sales tax paid at the parts counter, across this job's receipts — a cost,
   *  never a customer charge. Folded into parts cost the same way job_totals
   *  does it, and broken out below the cost line so the figure can be
   *  reconciled against the paper receipt. */
  const receiptTaxCents = receipts.reduce((s, r) => s + (r.tax_cents ?? 0), 0)
  const totals = computeTotals(job, lines, receiptTaxCents)
  // Ledger is authoritative once it has entries; jobs settled before payment
  // tracking existed fall back to their cached status/amount.
  const paidFromLedger = payments.reduce((s, p) => s + p.amount_cents, 0)
  const legacyPaid =
    payments.length === 0
      ? (job.amount_paid_cents ?? (job.payment_status === 'paid' ? totals.total_charged_cents : 0))
      : 0
  // What the customer actually owes: an issued invoice can add sales tax on
  // top of the job's charge math, so the balance targets the larger figure.
  //
  // LARGEST live invoice, never the sum — every invoice snapshots the WHOLE
  // job, so two live invoices are revisions of one debt, not two debts.
  // (Same rule as syncJobPayment; summing here made the quick-settle panel
  // offer to collect double.)
  const invoicedTotal = invoices
    .filter((i) => i.status !== 'void')
    .reduce((s, i) => Math.max(s, i.total_cents), 0)
  const owedTarget = Math.max(totals.total_charged_cents, invoicedTotal)
  const balanceDue = Math.max(0, owedTarget - paidFromLedger - legacyPaid)
  // Payments recorded here default onto the job's open invoice so it settles.
  const openInvoice = invoices.find((i) => i.status === 'draft' || i.status === 'sent')

  /** First ledger entry on a legacy-partial job carries the old credit in, so it isn't erased. */
  async function ensureLegacyCredit() {
    if (payments.length > 0 || legacyPaid <= 0 || job!.payment_status === 'paid') return
    const { error } = await supabase.from('payments').insert({
      job_id: id,
      amount_cents: legacyPaid,
      method: 'other',
      date: job!.date,
      note: 'Balance recorded before payment tracking',
    })
    if (error) throw error
  }

  /** resyncPayments: money-changing edits must re-derive cached payment status from the ledger. */
  async function updateJob(patch: Partial<Job>, opts: { resyncPayments?: boolean } = {}) {
    const { error } = await supabase.from('jobs').update(patch).eq('id', id)
    if (error) {
      alert(error.message)
      return
    }
    if (opts.resyncPayments) {
      try {
        await syncJobPayment(id)
      } catch (e) {
        alert(`Saved, but payment status re-sync failed: ${e instanceof Error ? e.message : e}`)
      }
    }
    await load()
  }

  /** Half-hour steps: the unit a shop actually books time in. */
  function bumpHours(current: string, delta: number): string {
    const next = Math.max(0, (Number(current) || 0) + delta)
    return String(Number(next.toFixed(2)))
  }

  function openLaborEditor() {
    setLaborHoursInput(String(Number(job!.labor_hours)))
    setLaborRateInput(centsToInput(job!.labor_rate_cents))
    setEditingLabor(true)
  }

  async function saveLabor() {
    const hours = Number(laborHoursInput)
    const rate = parseMoney(laborRateInput)
    if (!Number.isFinite(hours) || hours < 0) {
      alert('Hours must be a number, like 1.5.')
      return
    }
    if (rate == null || rate < 0) {
      alert('Rate must be a dollar amount, like 90.')
      return
    }
    setSavingLabor(true)
    // Labor moves the amount owed, so the cached payment status has to follow.
    await updateJob({ labor_hours: hours, labor_rate_cents: rate }, { resyncPayments: true })
    setSavingLabor(false)
    setEditingLabor(false)
  }

  async function saveLine() {
    if (savingLine) return
    if (!draft.description.trim()) {
      setLineMsg('Description is required.')
      return
    }
    setLineMsg(null)
    setSavingLine(true)
    const payload = {
      job_id: id,
      purchase_date: draft.purchase_date || null,
      store: draft.store.trim() || null,
      part_number: draft.part_number.trim() || null,
      description: draft.description.trim(),
      qty: draft.qty ? Number(draft.qty) : 1,
      unit_cost_cents: parseMoney(draft.unit_cost) ?? 0,
      // On a NEW line a blank charge means "price it for me" and the matrix
      // fills it in. On an EDIT it means "sell this at cost": the box was
      // pre-populated from the row, so empty is the state that was loaded, not
      // a request to re-price. Without this split, correcting a store name on
      // an at-cost line silently multiplied what the customer owes.
      unit_charge_cents:
        draft.unit_charge.trim() !== ''
          ? parseMoney(draft.unit_charge)
          : editingLineId
            ? null
            : markedUpCharge(parseMoney(draft.unit_cost) ?? 0, markup, draft.description),
    }
    const result = editingLineId
      ? await supabase.from('part_lines').update(payload).eq('id', editingLineId)
      : await supabase.from('part_lines').insert(payload)
    if (result.error) {
      setLineMsg(result.error.message)
      setSavingLine(false)
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
    // Parts change the amount owed — keep cached payment status honest.
    try {
      await syncJobPayment(id)
    } catch {}
    await load()
    setSavingLine(false)
  }

  async function deleteLine(lineId: string) {
    if (busyLineId === lineId) return
    if (!confirm('Delete this part line?')) return
    setBusyLineId(lineId)
    const { error } = await supabase.from('part_lines').delete().eq('id', lineId)
    if (error) {
      alert(error.message)
      setBusyLineId(null)
      return
    }
    try {
      await syncJobPayment(id)
    } catch {}
    await load()
    setBusyLineId(null)
  }

  /** The scan screen writes tax once, on the receipt it just created — so
   *  without this a fat-fingered figure would be frozen into job cost and the
   *  P&L forever. Negative is allowed: a return refunds the tax too. */
  async function saveReceiptTax(r: Receipt) {
    if (taxBusy) return
    setTaxBusy(true)
    const { error } = await supabase
      .from('receipts')
      .update({ tax_cents: parseMoney(taxInput) ?? 0 })
      .eq('id', r.id)
    setTaxBusy(false)
    if (error) {
      setLineMsg(error.message)
      return
    }
    setTaxEditId(null)
    await load()
  }

  async function deleteReceipt(r: Receipt) {
    // Post-0027 a receipt row carries recorded cost, so the old reassurance
    // ("part lines from it stay") is no longer the whole truth.
    const taxWarning =
      r.tax_cents > 0
        ? ` The ${formatCents(r.tax_cents)} of sales tax recorded on it is removed from this job's cost.`
        : ''
    if (!confirm(`Delete this receipt photo? Part lines from it stay.${taxWarning}`)) return
    await supabase.storage.from('receipts').remove([r.storage_path])
    const { error } = await supabase.from('receipts').delete().eq('id', r.id)
    if (error) alert(error.message)
    else await load()
  }

  async function softDeleteJob() {
    // Deleting a job pulls its payments out of every tile and report. That is
    // fine for an empty job, but a job carrying a deposit or other payments
    // holds real money the customer already handed over — hide it and the
    // books quietly lose that cash. Say so before it happens.
    const onLedger = payments.reduce((s, p) => s + p.amount_cents, 0)
    const warn =
      onLedger > 0
        ? ` This job has ${formatCents(onLedger)} in recorded payments — deleting it removes that money from your totals and reports. Refund the customer in Stripe (or your own records) if the work isn't happening.`
        : ''
    if (!confirm(`Delete job ${job!.job_number}?${warn} You can restore it from Settings.`)) return
    const { error } = await supabase
      .from('jobs')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) alert(error.message)
    else router.push('/jobs')
  }

  async function createInvoice() {
    // With an invoice already open the button reads "Open INV-xxx" and just
    // navigates — no dialog whose Cancel secretly navigated anyway. Creating
    // a second open invoice for the same job was never a good idea; drafts
    // have "Update from job" instead.
    const openInvoice = invoices.find((i) => i.status === 'draft' || i.status === 'sent')
    if (openInvoice) {
      router.push(`/invoices/${openInvoice.id}`)
      return
    }
    setInvoicing(true)
    try {
      const [{ data: settings }, { data: sourceQuote }] = await Promise.all([
        supabase.from('settings').select('default_tax_rate_bp, default_invoice_terms_days').single(),
        supabase.from('quotes').select('tax_rate_bp').eq('job_id', id).limit(1).maybeSingle(),
      ])
      // Settings is the rate the shop actually charges, and it is the control
      // the owner turns — so it wins. A quote's rate used to override it here,
      // which made setting tax to 0% look broken on any quoted job. The rate
      // stays editable on the draft invoice for one-off cases.
      void sourceQuote
      const taxRateBp = settings?.default_tax_rate_bp ?? 0
      const snapshot = buildInvoiceSnapshot(job!, lines, taxRateBp)
      // Terms from Settings: 0 = due on receipt (due date = issue date).
      const termsDays = settings?.default_invoice_terms_days ?? 0
      const due = new Date()
      due.setDate(due.getDate() + termsDays)
      const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`
      const { data, error } = await supabase
        .from('invoices')
        .insert({
          job_id: id,
          customer_id: customer!.id,
          customer_name: customer!.name,
          vehicle_label: vehicleLabel(vehicle),
          job_title: job!.title,
          work_performed: job!.work_performed,
          due_date: dueDate,
          // What was flagged on the job travels to the customer's copy, then
          // freezes with the rest of the invoice.
          memo: toMemo(recs),
          ...snapshot,
        })
        .select('id')
        .single()
      if (error) throw error
      // A job already covered by a deposit means the new invoice is paid the
      // moment it exists — re-derive so it opens settled, not "unpaid".
      try {
        await syncJobPayment(id)
      } catch {}
      router.push(`/invoices/${data.id}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
      setInvoicing(false)
    }
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
      unit_charge: l.unit_charge_cents != null ? centsToInput(l.unit_charge_cents) : '',
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div className="card space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold" style={{ color: 'var(--accent2)' }}>{job.job_number}</span>
              <span className={`chip chip-${job.payment_status}`}>{job.payment_status}</span>
              {job.promised_date && job.payment_status !== 'paid' && (
                <span
                  className="chip"
                  style={{
                    background: 'var(--bg3)',
                    color: job.promised_date < todayLocalIso() ? 'var(--red)' : 'var(--accent2)',
                  }}
                >
                  promised {formatDate(job.promised_date)}
                </span>
              )}
              {(job.warranty_months != null || job.warranty_miles != null) && (
                <span className="chip" style={{ background: 'var(--bg3)', color: 'var(--green)' }}>
                  warranty{' '}
                  {[
                    job.warranty_months != null ? `${job.warranty_months}mo` : null,
                    job.warranty_miles != null ? `${formatMiles(job.warranty_miles)}mi` : null,
                  ]
                    .filter(Boolean)
                    .join('/')}
                </span>
              )}
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
          <Link href={`/jobs/${id}/scan`} className="btn btn-sm btn-primary"><span className="emoji-mobile">📷 </span>Scan receipt</Link>
          <button
            className="btn btn-sm"
            onClick={() => {
              setAddingPart(true)
              setEditingLineId(null)
              setDraft(emptyDraft)
              // The panel lives in the Parts card far below the fold — a tap
              // that visibly does nothing gets tapped twice.
              setTimeout(() => {
                descriptionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                descriptionRef.current?.focus({ preventScroll: true })
              }, 60)
            }}
          >
            + Add part manually
          </button>
          <button className="btn btn-sm" disabled={invoicing || !customer} onClick={createInvoice}>
            {invoicing ? (
              'Creating…'
            ) : (
              <>
                <span className="emoji-mobile">🧾 </span>
                {openInvoice ? `Open ${openInvoice.invoice_number}` : 'Create invoice'}
              </>
            )}
          </button>
          {job.payment_status !== 'paid' && balanceDue > 0 && (
            <button
              className="btn btn-sm"
              style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
              onClick={() => {
                setActionMsg(null)
                setPayQuickOpen(!payQuickOpen)
              }}
            >
              <span className="emoji-mobile">✓ </span>Mark paid
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen}>
            {moreOpen ? '⋯ Less' : '⋯ More'}
          </button>
        </div>

        {moreOpen && (
          <div className="panel-in flex flex-wrap gap-2 pt-2">
            <Link href={`/report?job=${id}`} className="btn btn-sm">
              <span className="emoji-mobile">🖨️ </span>Print this job
            </Link>
            {customer && (
              <Link href={`/report?customer=${customer.id}`} className="btn btn-sm">
                <span className="emoji-mobile">🖨️ </span>Print full history
              </Link>
            )}
            <button
              className="btn btn-sm"
              onClick={() => {
                setTemplateName(job!.title)
                setActionMsg(null)
                setTemplateOpen(!templateOpen)
              }}
            >
              <span className="emoji-mobile">♻️ </span>Save as template
            </button>
            <Link href={`/quotes/new?job=${id}`} className="btn btn-sm">
              + Quote extra work
            </Link>
          </div>
        )}

        {templateOpen && moreOpen && (
          <div className="panel-in space-y-2 pt-2">
            <label className="label !mb-0">Template name (what you’d call this job in a list)</label>
            <input
              className="input"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button
                className="btn btn-primary btn-sm"
                disabled={!templateName.trim() || savingTemplate}
                onClick={async () => {
                  setSavingTemplate(true)
                  setActionMsg(null)
                  try {
                    await saveJobAsTemplate(templateName, job!, lines)
                    setTemplateOpen(false)
                    setActionMsg({
                      text: `Saved — “${templateName.trim()}” is now a starting point on New Job.`,
                      ok: true,
                    })
                    setTimeout(() => setActionMsg(null), 4000)
                  } catch (e) {
                    setActionMsg({ text: e instanceof Error ? e.message : String(e), ok: false })
                  } finally {
                    setSavingTemplate(false)
                  }
                }}
              >
                {savingTemplate ? 'Saving…' : 'Save template'}
              </button>
              <button className="btn btn-sm" onClick={() => setTemplateOpen(false)}>Cancel</button>
            </div>
          </div>
        )}

        {payQuickOpen && job.payment_status !== 'paid' && (
          <div className="panel-in space-y-2 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label !mb-0">Settle {formatCents(balanceDue)} by</span>
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  className="btn btn-sm"
                  style={
                    payQuickMethod === m.value
                      ? { borderColor: 'var(--accent)', color: 'var(--accent2)' }
                      : undefined
                  }
                  onClick={() => setPayQuickMethod(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-primary btn-sm"
                disabled={payingBusy}
                onClick={async () => {
                  if (balanceDue <= 0) return
                  setPayingBusy(true)
                  try {
                    await ensureLegacyCredit()
                    await recordPayment({
                      jobId: id,
                      invoiceId: openInvoice?.id ?? null,
                      amountCents: balanceDue,
                      method: payQuickMethod,
                      date: todayIso(),
                    })
                    setPayQuickOpen(false)
                    await load()
                  } catch (e) {
                    setActionMsg({ text: e instanceof Error ? e.message : String(e), ok: false })
                  } finally {
                    setPayingBusy(false)
                  }
                }}
              >
                {payingBusy ? 'Recording…' : `Record ${formatCents(balanceDue)}`}
              </button>
              <button className="btn btn-sm" onClick={() => setPayQuickOpen(false)}>Cancel</button>
            </div>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              Partial payment or a different date? Use the Payments card below.
            </p>
          </div>
        )}

        {actionMsg && (
          <p
            className="flash-in pt-1 text-sm"
            style={{ color: actionMsg.ok ? 'var(--green)' : 'var(--red)' }}
          >
            {actionMsg.text}
          </p>
        )}
      </div>

      {/* Work performed */}
      {job.work_performed && (
        <div className="card">
          <div className="label">Work performed</div>
          <p className="whitespace-pre-wrap">{job.work_performed}</p>
        </div>
      )}

      <JobPhotos jobId={id} />

      {/* Quotes tied to this job — the originating quote and any add-on
          authorizations for extra work found mid-job. */}
      {linkedQuotes.length > 0 && (
        <div className="card space-y-2">
          <span className="label !mb-0">Quotes on this job</span>
          {linkedQuotes.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <Link href={`/quotes/${q.id}`} style={{ color: 'var(--blue)' }}>
                  {q.quote_number}
                </Link>{' '}
                <span className="truncate" style={{ color: 'var(--text2)' }}>{q.title}</span>
              </div>
              <div className="flex flex-none items-center gap-2">
                {q.total_cents != null && <span className="money">{formatCents(q.total_cents)}</span>}
                <span className={statusChipClass(q.status)}>{q.status}</span>
                <span className="text-xs" style={{ color: q.applied_at ? 'var(--green)' : 'var(--text3)' }}>
                  {q.applied_at ? '✓ on job' : 'not applied'}
                </span>
              </div>
            </div>
          ))}
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            {/* The quoted label tracks the real button, which drops its emoji
                on desktop — so this prose has to as well. */}
            Found more while you&apos;re in there? “<span className="emoji-mobile">➕ </span>Quote
            extra work” sends the customer the usual approval link, and approved lines land on
            this job.
          </p>
        </div>
      )}

      {/* Recommendations — trackable items that follow the vehicle and seed
          the invoice the customer receives. */}
      <div className="card space-y-2">
        <span className="label !mb-0">Recommendations</span>
        <RecommendationList
          jobId={id}
          vehicleId={job.vehicle_id}
          items={recs}
          onChanged={load}
        />
      </div>

      {/* Labor — adjusted right here, no trip through Edit job. */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <span className="label !mb-0">Labor</span>
          {!editingLabor && (
            <button className="btn btn-sm" onClick={openLaborEditor}>
              <span className="emoji-mobile">✎ </span>Adjust
            </button>
          )}
        </div>

        {editingLabor ? (
          <div className="panel-in space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="label">Hours</label>
                <div className="flex items-center gap-1">
                  <button
                    className="btn btn-sm !min-h-[44px] !px-3"
                    aria-label="Half an hour less"
                    onClick={() => setLaborHoursInput(bumpHours(laborHoursInput, -0.5))}
                  >
                    −
                  </button>
                  <input
                    className="input !min-h-[44px] text-center"
                    inputMode="decimal"
                    aria-label="Labor hours"
                    value={laborHoursInput}
                    onChange={(e) => setLaborHoursInput(e.target.value)}
                  />
                  <button
                    className="btn btn-sm !min-h-[44px] !px-3"
                    aria-label="Half an hour more"
                    onClick={() => setLaborHoursInput(bumpHours(laborHoursInput, 0.5))}
                  >
                    +
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Rate ($/hr)</label>
                <input
                  className="input !min-h-[44px]"
                  inputMode="decimal"
                  aria-label="Labor rate"
                  value={laborRateInput}
                  onChange={(e) => setLaborRateInput(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm" style={{ color: 'var(--text2)' }}>
                Labor charge{' '}
                <b className="money">
                  {formatCents(
                    Math.round((Number(laborHoursInput) || 0) * (parseMoney(laborRateInput) ?? 0)),
                  )}
                </b>
              </span>
              <div className="flex gap-2">
                <button className="btn btn-sm" onClick={() => setEditingLabor(false)}>
                  Cancel
                </button>
                <button className="btn btn-sm btn-primary" disabled={savingLabor} onClick={saveLabor}>
                  {savingLabor ? 'Saving…' : 'Save labor'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-lg px-1 py-1">
            <div className="min-w-0">
              <div className="font-semibold">Labor</div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>
                {Number(job.labor_hours) > 0
                  ? `${Number(job.labor_hours)} hr × ${formatCents(job.labor_rate_cents)}/hr`
                  : 'No labor booked yet'}
              </div>
            </div>
            <span className="money font-semibold">{formatCents(totals.labor_charge_cents)}</span>
          </div>
        )}
      </div>

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
                <div className="money font-medium">{formatCents(l.line_charge_total_cents)}</div>
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  {Number(l.qty)} × {formatCents(l.unit_charge_cents ?? l.unit_cost_cents)}
                </div>
                {l.unit_charge_cents != null && l.unit_charge_cents !== l.unit_cost_cents && (
                  <div className="text-xs" style={{ color: 'var(--accent2)' }}>
                    cost {formatCents(l.line_total_cents)}
                  </div>
                )}
              </div>
              <button className="btn btn-sm" aria-label="Edit part" onClick={() => startEditLine(l)}>✎</button>
              <button
                className="btn btn-sm btn-danger"
                aria-label="Delete part"
                disabled={busyLineId === l.id}
                onClick={() => deleteLine(l.id)}
              >
                {busyLineId === l.id ? '…' : '✕'}
              </button>
            </div>
          </div>
        ))}

        {addingPart && (
          <div className="panel-in space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border2)' }}>
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
                <label className="label">Charge customer ($ per unit)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="Blank = same as cost"
                  value={draft.unit_charge}
                  onChange={(e) => setDraft({ ...draft, unit_charge: e.target.value })}
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
            {lineMsg && (
              <p className="text-sm" style={{ color: 'var(--red)' }}>{lineMsg}</p>
            )}
            <div className="flex items-center gap-2">
              <button className="btn btn-primary btn-sm" disabled={savingLine} onClick={saveLine}>
                {savingLine ? 'Adding…' : editingLineId ? 'Save part' : '+ Add this part'}
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
                <span className="flash-in text-sm" style={{ color: 'var(--green)' }}>
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
                        {[
                          r.purchase_date,
                          formatCents(r.receipt_total_cents),
                          r.tax_cents ? `tax ${formatCents(r.tax_cents)}` : null,
                        ]
                          .filter((x) => x && x !== '—')
                          .join(' · ') || r.extraction_status}
                      </div>
                    </div>
                  </a>
                  {taxEditId === r.id ? (
                    <div className="mt-1 flex gap-1">
                      <input
                        className="input !min-h-[36px] !py-1 text-sm"
                        inputMode="decimal"
                        aria-label="Sales tax on this receipt"
                        value={taxInput}
                        onChange={(e) => setTaxInput(e.target.value)}
                      />
                      <button
                        className="btn btn-sm btn-primary !px-2"
                        disabled={taxBusy}
                        onClick={() => saveReceiptTax(r)}
                      >
                        ✓
                      </button>
                      <button className="btn btn-sm !px-2" onClick={() => setTaxEditId(null)}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-sm mt-1 w-full !py-1 !text-[0.7rem]"
                      onClick={() => {
                        setTaxEditId(r.id)
                        setTaxInput(r.tax_cents ? centsToInput(r.tax_cents) : '')
                      }}
                    >
                      {r.tax_cents ? 'Edit sales tax' : 'Add sales tax'}
                    </button>
                  )}
                  {/* 44px hit area kept clear of the open-receipt link's
                      corner — a ~22px ✕ overlapping the link was a coin flip
                      with gloves on. */}
                  <button
                    className="absolute -right-1 -top-1 flex min-h-[44px] min-w-[44px] items-center justify-center"
                    onClick={() => deleteReceipt(r)}
                    aria-label="Delete receipt"
                  >
                    <span
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{ background: 'rgba(0,0,0,0.7)', color: 'var(--red)' }}
                    >
                      ✕
                    </span>
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
        {receiptTaxCents > 0 && (
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text3)' }}>
            <span>— of which sales tax at the counter</span>
            <span className="money">{formatCents(receiptTaxCents)}</span>
          </div>
        )}
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
          <div className="panel-in flex items-center gap-2 py-1">
            <input
              className="input !min-h-[38px]"
              inputMode="decimal"
              placeholder="Blank = sum of the line charges"
              value={overrideInput}
              onChange={(e) => setOverrideInput(e.target.value)}
            />
            <button
              className="btn btn-sm btn-primary"
              onClick={async () => {
                await updateJob(
                  { parts_charged_override_cents: overrideInput.trim() === '' ? null : parseMoney(overrideInput) },
                  { resyncPayments: true },
                )
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
            <span className="emoji-mobile">🔒 </span>Profit (never shown to customers)
          </span>
          <span className="money font-bold" style={{ color: totals.profit_cents >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {formatCents(totals.profit_cents)}
          </span>
        </div>
      </div>

      {/* Invoices */}
      {invoices.length > 0 && (
        <div className="card space-y-1">
          <div className="label">Invoices</div>
          {invoices.map((inv) => (
            <Link
              key={inv.id}
              href={`/invoices/${inv.id}`}
              className="flex items-center justify-between rounded-lg px-3 py-2 hover:brightness-110"
              style={{ background: 'var(--bg2)' }}
            >
              <span className="font-semibold">{inv.invoice_number}</span>
              <span className="flex items-center gap-2">
                <span className="money">{formatCents(inv.total_cents)}</span>
                <span className={statusChipClass(inv.status)}>{inv.status}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Payments ledger */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <span className="label !mb-0">Payments</span>
          <span
            className="money text-sm font-bold"
            style={{ color: balanceDue > 0 ? 'var(--red)' : 'var(--green)' }}
          >
            {balanceDue > 0 ? `Balance due ${formatCents(balanceDue)}` : 'Paid in full ✓'}
          </span>
        </div>

        {payments.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
            style={{ background: 'var(--bg2)' }}
          >
            <span className="text-sm" style={{ color: 'var(--text2)' }}>
              {formatDate(p.date)} · {PAYMENT_METHODS.find((m) => m.value === p.method)?.label}
              {p.invoice_id && ' · 🧾'}
              {p.note && ` · ${p.note}`}
            </span>
            <span className="flex items-center gap-2">
              <span className="money font-semibold" style={{ color: 'var(--green)' }}>
                {formatCents(p.amount_cents)}
              </span>
              <button
                className="btn btn-sm btn-danger !px-1.5 text-xs"
                aria-label="Delete payment"
                onClick={async () => {
                  if (!confirm('Delete this payment record?')) return
                  try {
                    await deletePayment(p.id, id)
                    await load()
                  } catch (e) {
                    alert(e instanceof Error ? e.message : String(e))
                  }
                }}
              >
                ✕
              </button>
            </span>
          </div>
        ))}
        {payments.length === 0 && job.payment_status !== 'unpaid' && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Marked {job.payment_status} before payment tracking existed — new payments recorded
            here will take over the math.
          </p>
        )}

        {balanceDue > 0 && (
          <div className="grid grid-cols-2 gap-2 border-t pt-2 sm:grid-cols-4" style={{ borderColor: 'var(--border)' }}>
            <input
              className="input"
              inputMode="decimal"
              placeholder={`Amount (${centsToInput(balanceDue)})`}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
            <select
              className="select"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <input className="input" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            <button
              className="btn btn-primary"
              disabled={payingBusy}
              onClick={async () => {
                const amount = payAmount.trim() === '' ? balanceDue : parseMoney(payAmount)
                if (!amount || amount === 0) {
                  alert('Enter a payment amount.')
                  return
                }
                setPayingBusy(true)
                try {
                  await ensureLegacyCredit()
                  await recordPayment({
                    jobId: id,
                    invoiceId: openInvoice?.id ?? null,
                    amountCents: amount,
                    method: payMethod,
                    date: payDate,
                  })
                  setPayAmount('')
                  await load()
                } catch (e) {
                  alert(e instanceof Error ? e.message : String(e))
                }
                setPayingBusy(false)
              }}
            >
              {payingBusy ? 'Recording…' : <><span className="emoji-mobile">💵 </span>Record</>}
            </button>
          </div>
        )}
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
