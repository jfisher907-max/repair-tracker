'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { use, useCallback, useEffect, useState } from 'react'
import DocView, { type DocData } from '@/components/DocView'
import { useDocumentTitle } from '@/lib/title'
import { listForJob, toMemo } from '@/lib/recommendations'
import { supabase } from '@/lib/supabase'
import { buildInvoiceSnapshot, formatTaxRate, statusChipClass } from '@/lib/billing'
import { effectiveTaxRateBp } from '@/lib/calc'
import { buildAuthorizationTrail, isOverApproval, loadJobAuthorization } from '@/lib/authorization'
import { PAYMENT_METHODS, recordPayment, syncJobPayment } from '@/lib/payments'
import { formatDate } from '@/lib/date'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import {
  aircraftSnapshot,
  holdsToApproval,
  lineOf,
  marksOf,
  marksPayload,
  needsPartConditions,
  paperErrorWords,
} from '@/lib/service-line'
import type { Invoice, Job, PartLine, Payment, PaymentMethod, Settings, Vehicle } from '@/lib/types'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [shareMsg, setShareMsg] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [payDate, setPayDate] = useState(todayIso())
  const [payBusy, setPayBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')
  const [editingTax, setEditingTax] = useState(false)
  const [taxInput, setTaxInput] = useState('')
  const [editingMemo, setEditingMemo] = useState(false)
  const [memoInput, setMemoInput] = useState('')
  const [savingMemo, setSavingMemo] = useState(false)
  /** Recording the customer's sales-tax exemption on an untaxed draft (0047). */
  const [exemptOpen, setExemptOpen] = useState(false)
  const [exemptInput, setExemptInput] = useState('')
  const [savingExempt, setSavingExempt] = useState(false)

  const load = useCallback(async () => {
    const { data: inv } = await supabase.from('invoices').select('*').eq('id', id).single()
    const loaded = inv as Invoice | null
    // Every payment on the JOB counts toward this invoice — invoices are
    // whole-job snapshots, so a deposit or a payment on a prior (now void)
    // invoice belongs to this one too (mirrors SQL invoice_paid_cents).
    const [{ data: s }, paysRes] = await Promise.all([
      supabase.from('settings').select('*').single(),
      loaded
        ? supabase.from('payments').select('*').eq('job_id', loaded.job_id).order('date')
        : Promise.resolve({ data: [] as Payment[] }),
    ])
    setInvoice(loaded)
    setSettings(s as Settings)
    setPayments(((paysRes.data as Payment[]) ?? []))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  /**
   * Never sent and no payment booked against THIS invoice = nobody has seen it,
   * so there is nothing to keep and it can be deleted.
   *
   * The status guard protects invoices settled BEFORE the payments ledger
   * existed: those are 'paid' with no ledger rows anywhere on the job and no
   * sent_at, and the 'paid' flag is the only record the money was collected —
   * deleting one would erase it. But a quote deposit can auto-settle a freshly
   * created, never-sent draft to 'paid'; that draft holds no payment of its own
   * (the money is on the job) so it must stay deletable — hence the
   * payments.length > 0 escape.
   */
  const paidToThisInvoice = payments.filter((p) => p.invoice_id === invoice?.id).length
  const neverIssued =
    !!invoice &&
    !invoice.sent_at &&
    paidToThisInvoice === 0 &&
    (invoice.status !== 'paid' || payments.length > 0)

  /**
   * Re-snapshot the job into this same invoice. A draft has not been sent, so
   * there is nothing to preserve by voiding and reissuing — this keeps the
   * number and just brings the figures up to date after a parts change.
   *
   * The gates follow the paper this invoice was created on (AVN-3): an
   * aircraft invoice is held to the approved quote as a shop rule and asks for
   * no part conditions. Its aircraft block (tail, serial, airframe hours) is
   * re-frozen with the figures; its service_line never changes.
   */
  async function refreshFromJob(taxRateBpOverride?: number) {
    if (!invoice) return
    setRefreshing(true)
    const line = lineOf(invoice)
    try {
      const [{ data: jobRow }, { data: partLines }, auth] = await Promise.all([
        // vehicles(*): a car's refresh still reads before migration 0055.
        supabase.from('jobs').select('*, vehicle:vehicles(*)').eq('id', invoice.job_id).single(),
        supabase.from('part_lines').select('*').eq('job_id', invoice.job_id).order('created_at'),
        loadJobAuthorization(invoice.job_id),
      ])
      if (!jobRow) throw new Error('The job behind this invoice is gone.')
      const { vehicle, ...job } = jobRow as Job & { vehicle: Vehicle | null }
      // The same two checks Create invoice runs on the job page: never past
      // what the customer approved (AS 45.45.140/.170), and every part
      // identified new / used / rebuilt / reconditioned (AS 45.45.190).
      if (holdsToApproval(line) && isOverApproval(auth)) {
        alert(
          line === 'aviation'
            ? `The job now comes to ${formatCents(auth!.current_cents)} before tax, over the approved quote of ${formatCents(auth!.authorized_cents)} — a shop rule: no charge over it without the customer’s OK. Open the job to bill the approved amount or record their OK, then update this draft.`
            : `The job now comes to ${formatCents(auth!.current_cents)} before tax, over the ${formatCents(auth!.authorized_cents)} the customer approved. Open the job to bill the approved amount or record their OK, then update this draft.`,
        )
        setRefreshing(false)
        return
      }
      const unconfirmed = needsPartConditions(line)
        ? ((partLines as PartLine[]) ?? []).filter(
            (l) => l.on_invoice !== false && !l.is_adjustment && l.condition == null,
          )
        : []
      if (unconfirmed.length) {
        alert(
          `Confirm the condition of ${unconfirmed.length} part${unconfirmed.length === 1 ? '' : 's'} on the job page first (new, used, rebuilt or reconditioned) — Alaska law wants it on the invoice.`,
        )
        setRefreshing(false)
        return
      }
      // The invoice owns its tax rate once created — re-deriving it from the
      // source quote here would silently undo a rate set on this invoice.
      const taxRateBp = taxRateBpOverride ?? invoice.tax_rate_bp ?? 0
      const snapshot = buildInvoiceSnapshot(job as Job, (partLines as PartLine[]) ?? [], taxRateBp, line)
      const { error } = await supabase
        .from('invoices')
        .update({
          job_title: job.title,
          work_performed: job.work_performed,
          // Only seed notes that were never written here — a memo typed on
          // this invoice is the owner's, and a refresh must not eat it.
          // From the live recommendation items, not the superseded column.
          ...(invoice.memo ? {} : { memo: toMemo(await listForJob(invoice.job_id)) }),
          // Re-freeze the approvals behind the bill with the figures.
          authorizations: await buildAuthorizationTrail(invoice.job_id, line),
          // A draft only: the tail, serial and hours as they stand now.
          ...(line === 'aviation' ? { aircraft: aircraftSnapshot(vehicle, job) } : {}),
          // ...and AOG / Nights & weekends as the job is marked now (0065).
          ...marksPayload(line, job, invoice),
          ...snapshot,
        })
        .eq('id', invoice.id)
      if (error) throw error
      setRefreshMsg(taxRateBpOverride == null ? 'Updated from the job ✓' : 'Tax rate updated ✓')
      await load()
      setTimeout(() => setRefreshMsg(''), 3000)
    } catch (e) {
      alert(paperErrorWords(e) ?? (e instanceof Error ? e.message : String(e)))
    }
    setRefreshing(false)
  }

  async function deleteInvoice() {
    if (!invoice) return
    if (
      !confirm(
        `Delete ${invoice.invoice_number} for good? It was never sent, so nothing the customer has seen changes. The job and its parts are untouched.`,
      )
    ) {
      return
    }
    const { error } = await supabase.from('invoices').delete().eq('id', invoice.id)
    if (error) {
      alert(error.message)
      return
    }
    // The set of live invoices changed, which can change what the job's
    // payment status should be — a stale-cache bug (J006 stuck at "partial")
    // came from skipping this.
    try {
      await syncJobPayment(invoice.job_id)
    } catch {}
    router.push('/billing')
  }

  useDocumentTitle(
    invoice ? `${invoice.invoice_number} Invoice — ${invoice.customer_name}` : null,
  )

  if (!invoice) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  const publicUrl = `${window.location.origin}/i/${invoice.public_token}`
  /** The rate this invoice owes the city: the rate pinned when it was issued
   *  (0047; a paid invoice that fell back to draft keeps it), else Settings'
   *  default, else 5% — and what that comes to on this price. The same
   *  arithmetic the 0047 trigger books into included_tax_cents: the rate on
   *  the selling price (total − tax line), less the tax line. */
  const untaxedRateBp = invoice.included_tax_rate_bp ?? effectiveTaxRateBp(settings?.default_tax_rate_bp)
  const untaxedTaxOwed = Math.round((invoice.total_cents * untaxedRateBp) / 10000)
  /** A tax line charged below the city's rate: the rest is still owed. */
  const taxShortfall =
    invoice.tax_cents > 0
      ? Math.max(
          0,
          Math.round(((invoice.total_cents - invoice.tax_cents) * untaxedRateBp) / 10000) - invoice.tax_cents,
        )
      : 0
  const doc: DocData = {
    docType: 'Invoice',
    number: invoice.invoice_number,
    status: invoice.status,
    date: invoice.issue_date,
    secondaryDate: invoice.due_date,
    customerName: invoice.customer_name,
    vehicleLabel: invoice.vehicle_label,
    title: invoice.job_title,
    bodyText: invoice.work_performed,
    lines: invoice.lines,
    laborHours: Number(invoice.labor_hours),
    laborRateCents: invoice.labor_rate_cents,
    laborCents: invoice.labor_cents,
    linesCents: invoice.parts_cents,
    taxRateBp: invoice.tax_rate_bp,
    taxCents: invoice.tax_cents,
    totalCents: invoice.total_cents,
    memo: invoice.memo,
    // The owner's copy shows the full number called; the public link masks it.
    authorizations: invoice.authorizations ?? [],
    paymentInstructions: settings?.invoice_payment_instructions || null,
    paidDate: invoice.paid_at ? invoice.paid_at.slice(0, 10) : null,
    paidCents: payments.reduce((s, p) => s + p.amount_cents, 0),
    business: {
      name: settings?.business_name ?? '',
      phone: settings?.business_phone ?? '',
      address: settings?.business_address ?? '',
      email: settings?.business_email ?? '',
    },
    // The paper it was created on, and its frozen aircraft block (AVN-3).
    serviceLine: lineOf(invoice),
    aircraft: invoice.aircraft ?? null,
    // Its frozen AOG / Nights & weekends markers (0065).
    marks: marksOf(invoice),
  }

  async function patch(fields: Partial<Invoice>, alsoJob?: 'paid') {
    const { error } = await supabase.from('invoices').update(fields).eq('id', id)
    if (error) {
      alert(paperErrorWords(error) ?? error.message)
      return
    }
    if (alsoJob === 'paid') {
      // One-way sync: an invoice marked paid settles its job.
      await supabase.from('jobs').update({ payment_status: 'paid' }).eq('id', invoice!.job_id)
    }
    if (fields.status === 'void') {
      // Voiding shrinks the set of live invoices — what the job's payment
      // status should be may change with it.
      try {
        await syncJobPayment(invoice!.job_id)
      } catch {}
    }
    await load()
  }

  async function shareLink() {
    // The status flips to "sent" only AFTER the share actually happens —
    // cancelling the share sheet used to stamp sent_at anyway, starting
    // overdue math on a document the customer never received.
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Invoice ${invoice!.invoice_number}`,
          text: `Invoice for ${invoice!.job_title}`,
          url: publicUrl,
        })
        setShareMsg('Shared ✓')
      } else {
        await navigator.clipboard.writeText(publicUrl)
        setShareMsg('Link copied — text it to the customer ✓')
      }
      if (invoice!.status === 'draft') {
        await patch({ status: 'sent', sent_at: new Date().toISOString() })
      }
    } catch {
      setShareMsg('')
    }
    setTimeout(() => setShareMsg(''), 3000)
  }

  return (
    <div className="space-y-4">
      <div className="no-print space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/billing" className="btn btn-sm">← Billing</Link>
            <Link href={`/jobs/${invoice.job_id}`} className="btn btn-sm">Job →</Link>
          </div>
          <span className={statusChipClass(invoice.status)}>{invoice.status}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-primary" onClick={shareLink}>Send link</button>
          <button className="btn btn-sm" onClick={() => window.print()}>Print</button>
          {invoice.status === 'paid' && settings?.google_review_url && (
            <button
              className="btn btn-sm"
              style={{ borderColor: 'var(--accent-dim)', color: 'var(--accent2)' }}
              onClick={async () => {
                // A plain thank-you and the link — no incentives, no sentiment
                // routing; both are against Google's review policy.
                const text = `Thanks for your business! If you have a minute, a quick Google review helps a small shop a lot: ${settings.google_review_url}`
                try {
                  if (navigator.share) await navigator.share({ text })
                  else {
                    await navigator.clipboard.writeText(text)
                    setShareMsg('Review request copied — text it to the customer ✓')
                    setTimeout(() => setShareMsg(''), 3000)
                  }
                } catch {}
              }}
            >
              Ask for a review
            </button>
          )}
          {invoice.status !== 'void' && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setMemoInput(invoice.memo ?? '')
                setEditingMemo(!editingMemo)
              }}
            >
              {invoice.memo ? 'Edit notes' : 'Add notes'}
            </button>
          )}
          {invoice.status === 'draft' && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setTaxInput(String((invoice.tax_rate_bp ?? 0) / 100))
                setEditingTax(!editingTax)
              }}
            >
              % Tax ({(invoice.tax_rate_bp ?? 0) / 100}%)
            </button>
          )}
          {invoice.status === 'draft' && (
            <button className="btn btn-sm" disabled={refreshing} onClick={() => refreshFromJob()}>
              {refreshing ? 'Updating…' : '↻ Update from job'}
            </button>
          )}
          {/* Owner rules 2026-09-12 and 2026-09-27: every invoice defaults to
              sales tax, and an untaxed one still owes the city 5% of its price
              (CBJ Procedure 130) unless the customer is exempt. A draft with
              no tax says so out loud, with both fixes one tap away: charge the
              tax, or record the exemption. The 0047 trigger books the tax owed
              (or 0 for an exemption) on the invoice itself; an issued invoice
              is left alone. */}
          {invoice.status === 'draft' && invoice.tax_cents === 0 && invoice.total_cents > 0 && (
            <div
              className="flex basis-full flex-wrap items-center gap-2 rounded-lg p-2 text-sm"
              style={{ background: 'var(--status-wait-bg)', color: 'var(--status-wait-fg)' }}
              role="status"
            >
              {invoice.tax_exempt_note ? (
                <>
                  <span className="min-w-0 flex-1">
                    No sales tax: the customer is exempt — <b>{invoice.tax_exempt_note}</b>. Nothing is
                    owed to the city on this invoice.
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setExemptInput(invoice.tax_exempt_note ?? '')
                      setExemptOpen(!exemptOpen)
                    }}
                  >
                    Edit exemption
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    No sales tax on this invoice. Unless the customer is exempt, you still owe the city{' '}
                    {formatTaxRate(untaxedRateBp)} of the price ({formatCents(untaxedTaxOwed)}), and it
                    comes out of your profit.
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={refreshing}
                    onClick={async () => {
                      const { data } = await supabase.from('settings').select('default_tax_rate_bp').single()
                      await refreshFromJob(
                        invoice.included_tax_rate_bp ?? effectiveTaxRateBp(data?.default_tax_rate_bp),
                      )
                    }}
                  >
                    Apply {formatTaxRate(untaxedRateBp)}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setExemptInput('')
                      setExemptOpen(!exemptOpen)
                    }}
                    aria-expanded={exemptOpen}
                  >
                    Customer is exempt
                  </button>
                </>
              )}
            </div>
          )}
          {/* A tax line BELOW the city's rate (the "% Tax" editor takes any
              value): the rest is still owed, and 0047 books it. */}
          {invoice.status === 'draft' && taxShortfall > 0 && !invoice.tax_exempt_note && (
            <div
              className="flex basis-full flex-wrap items-center gap-2 rounded-lg p-2 text-sm"
              style={{ background: 'var(--status-wait-bg)', color: 'var(--status-wait-fg)' }}
              role="status"
            >
              <span className="min-w-0 flex-1">
                This invoice charges {formatTaxRate(invoice.tax_rate_bp ?? 0)} sales tax; the city&apos;s rate
                is {formatTaxRate(untaxedRateBp)}. You still owe the other {formatCents(taxShortfall)}, and it
                comes out of your profit.
              </span>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={refreshing}
                onClick={() => refreshFromJob(untaxedRateBp)}
              >
                Apply {formatTaxRate(untaxedRateBp)}
              </button>
            </div>
          )}
          {invoice.status !== 'paid' && invoice.status !== 'void' && (
            <button
              className="btn btn-sm"
              style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
              onClick={() => {
                setPayAmount(centsToInput(Math.max(0, invoice.total_cents - payments.reduce((s, p) => s + p.amount_cents, 0))))
                setPayOpen(!payOpen)
              }}
            >
              Record payment
            </button>
          )}
          {invoice.status !== 'void' && invoice.status !== 'paid' && (
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                if (confirm('Void this invoice? The link stops working; the job is untouched. You can issue a new invoice from the job.')) {
                  patch({ status: 'void' })
                }
              }}
            >
              Void
            </button>
          )}
          {neverIssued && (
            <button className="btn btn-sm btn-danger" onClick={deleteInvoice}>
              Delete
            </button>
          )}
        </div>
        {editingMemo && invoice.status !== 'void' && (
          <div className="panel-in space-y-2">
            <label className="label !mb-0">Notes for the customer</label>
            <textarea
              className="textarea !min-h-[80px]"
              placeholder="Rear pads at 4mm — plan to replace within about 6 months. Brake fluid flush due at 80k."
              value={memoInput}
              onChange={(e) => setMemoInput(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-sm btn-primary"
                disabled={savingMemo}
                onClick={async () => {
                  setSavingMemo(true)
                  await patch({ memo: memoInput.trim() || null })
                  setSavingMemo(false)
                  setEditingMemo(false)
                }}
              >
                {savingMemo ? 'Saving…' : 'Save notes'}
              </button>
              <button className="btn btn-sm" onClick={() => setEditingMemo(false)}>Cancel</button>
              <span className="text-xs" style={{ color: 'var(--text3)' }}>
                Prints on the invoice and shows on the customer&apos;s link — money is untouched.
              </span>
            </div>
          </div>
        )}
        {editingTax && invoice.status === 'draft' && (
          <div className="panel-in flex flex-wrap items-center gap-2">
            <label className="text-sm" style={{ color: 'var(--text2)' }}>Sales tax %</label>
            <input
              className="input !min-h-[38px] !w-24"
              inputMode="decimal"
              value={taxInput}
              onChange={(e) => setTaxInput(e.target.value)}
            />
            <button
              className="btn btn-sm btn-primary"
              disabled={refreshing}
              onClick={async () => {
                const pct = Number(taxInput)
                if (!Number.isFinite(pct) || pct < 0) {
                  alert('Enter a percentage, like 5 — or 0 for no tax.')
                  return
                }
                await refreshFromJob(Math.round(pct * 100))
                setEditingTax(false)
              }}
            >
              Apply
            </button>
            <span className="text-xs" style={{ color: 'var(--text3)' }}>
              0 removes the tax line entirely.
            </span>
          </div>
        )}
        {exemptOpen && invoice.status === 'draft' && invoice.tax_cents === 0 && (
          <div className="panel-in space-y-2">
            <label className="label !mb-0" htmlFor="tax-exempt-note">
              Why is this sale exempt?
            </label>
            <input
              id="tax-exempt-note"
              className="input"
              placeholder="CBJ senior card #1234 · non-profit card · work done outside the borough"
              value={exemptInput}
              onChange={(e) => setExemptInput(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-sm btn-primary"
                disabled={savingExempt || exemptInput.trim() === ''}
                onClick={async () => {
                  setSavingExempt(true)
                  await patch({ tax_exempt_note: exemptInput.trim() })
                  setSavingExempt(false)
                  setExemptOpen(false)
                }}
              >
                {savingExempt ? 'Saving…' : 'Save exemption'}
              </button>
              {invoice.tax_exempt_note && (
                <button
                  className="btn btn-sm"
                  disabled={savingExempt}
                  onClick={async () => {
                    setSavingExempt(true)
                    await patch({ tax_exempt_note: null })
                    setSavingExempt(false)
                    setExemptOpen(false)
                  }}
                >
                  Not exempt after all
                </button>
              )}
              <button className="btn btn-sm" onClick={() => setExemptOpen(false)}>Cancel</button>
              <span className="text-xs" style={{ color: 'var(--text3)' }}>
                Kept with your books for the city&apos;s records; the customer&apos;s link does not show it.
              </span>
            </div>
          </div>
        )}
        {refreshMsg && (
          <p className="flash-in text-sm" style={{ color: 'var(--green)' }}>{refreshMsg}</p>
        )}
        {payOpen && invoice.status !== 'paid' && invoice.status !== 'void' && (
          <div className="panel-in card grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input
              className="input"
              inputMode="decimal"
              placeholder="Amount ($)"
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
              disabled={payBusy}
              onClick={async () => {
                const amount = parseMoney(payAmount)
                if (!amount || amount === 0) {
                  alert('Enter a payment amount.')
                  return
                }
                setPayBusy(true)
                try {
                  await recordPayment({
                    jobId: invoice!.job_id,
                    invoiceId: id,
                    amountCents: amount,
                    method: payMethod,
                    date: payDate,
                  })
                  setPayOpen(false)
                  await load()
                } catch (e) {
                  alert(e instanceof Error ? e.message : String(e))
                }
                setPayBusy(false)
              }}
            >
              {payBusy ? 'Recording…' : 'Record'}
            </button>
          </div>
        )}
        {payments.length > 0 && (
          <div className="text-sm" style={{ color: 'var(--text2)' }}>
            <span>Payments on this job:</span>
            <ul className="mt-1 space-y-0.5">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span>
                    {formatDate(p.date)}
                    {' · '}
                    {p.quote_id
                      ? 'deposit'
                      : p.invoice_id === invoice.id
                        ? 'on this invoice'
                        : p.invoice_id
                          ? 'on another invoice'
                          : 'on the job'}
                    {p.method ? ` · ${p.method}` : ''}
                  </span>
                  <span className="money flex-none" style={{ color: 'var(--green)' }}>
                    {formatCents(p.amount_cents)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1">
              Total paid:{' '}
              <b className="money" style={{ color: 'var(--green)' }}>
                {formatCents(payments.reduce((s, p) => s + p.amount_cents, 0))}
              </b>
            </p>
          </div>
        )}
        {shareMsg && <p className="text-sm" style={{ color: 'var(--green)' }}>{shareMsg}</p>}
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          {invoice.status === 'draft' ? (
            <>
              This draft hasn&apos;t been sent — <b>↻ Update from job</b> pulls the latest parts
              and labor into it, keeping the same number. It freezes once you send it.
            </>
          ) : (
            <>
              Invoices freeze once sent — editing the job won&apos;t change this document. If the
              job changed, void this and create a fresh invoice.
            </>
          )}
        </p>
      </div>

      <DocView doc={doc} />
      {/* Books only (0041/0045/0047): the document above is exactly what the
          customer was billed; this tells the owner the sales tax they still
          owe on it, or the exemption that means they owe none. Never passed
          into DocView, never on the public link (get_public_invoice does not
          return either column), and off the print. A draft says this in the
          banner at the top instead. */}
      {invoice.status !== 'draft' && invoice.tax_cents === 0 && invoice.tax_exempt_note && (
        <p className="no-print text-xs" style={{ color: 'var(--text3)' }}>
          Sales tax exempt: {invoice.tax_exempt_note}. Nothing is owed to the city on this invoice.
        </p>
      )}
      {invoice.status !== 'draft' && (invoice.included_tax_cents ?? 0) > 0 && (
        <p className="no-print text-xs" style={{ color: 'var(--text3)' }}>
          {invoice.tax_cents > 0 ? (
            <>
              The tax line charged {formatCents(invoice.tax_cents)}, below the city&apos;s rate on this price.
              You still owe the city the other {formatCents(invoice.included_tax_cents)}, out of your own
              money.
            </>
          ) : (
            <>
              No tax line was charged, so the customer paid the price only. You still owe the city{' '}
              {formatCents(invoice.included_tax_cents)} sales tax on this price, out of your own money.
            </>
          )}
        </p>
      )}
    </div>
  )
}
