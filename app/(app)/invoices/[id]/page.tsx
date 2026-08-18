'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { use, useCallback, useEffect, useState } from 'react'
import DocView, { type DocData } from '@/components/DocView'
import { useDocumentTitle } from '@/lib/title'
import { supabase } from '@/lib/supabase'
import { buildInvoiceSnapshot, quoteStatusColors } from '@/lib/billing'
import { PAYMENT_METHODS, recordPayment } from '@/lib/payments'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import type { Invoice, Job, PartLine, Payment, PaymentMethod, Settings } from '@/lib/types'

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

  const load = useCallback(async () => {
    const [{ data: inv }, { data: s }, { data: pays }] = await Promise.all([
      supabase.from('invoices').select('*').eq('id', id).single(),
      supabase.from('settings').select('*').single(),
      supabase.from('payments').select('*').eq('invoice_id', id).order('date'),
    ])
    setInvoice(inv as Invoice)
    setSettings(s as Settings)
    setPayments((pays as Payment[]) ?? [])
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  /**
   * Never sent and never paid = nobody has seen it, so there is no record to
   * keep. The status check matters for invoices settled before the payments
   * ledger existed: they are 'paid' with no ledger rows and no sent_at, and
   * must never look disposable.
   */
  const neverIssued =
    !!invoice && !invoice.sent_at && payments.length === 0 && invoice.status !== 'paid'

  /**
   * Re-snapshot the job into this same invoice. A draft has not been sent, so
   * there is nothing to preserve by voiding and reissuing — this keeps the
   * number and just brings the figures up to date after a parts change.
   */
  async function refreshFromJob(taxRateBpOverride?: number) {
    if (!invoice) return
    setRefreshing(true)
    try {
      const [{ data: job }, { data: partLines }, { data: quote }] = await Promise.all([
        supabase.from('jobs').select('*').eq('id', invoice.job_id).single(),
        supabase.from('part_lines').select('*').eq('job_id', invoice.job_id).order('created_at'),
        supabase.from('quotes').select('tax_rate_bp').eq('job_id', invoice.job_id).limit(1).maybeSingle(),
      ])
      void quote
      if (!job) throw new Error('The job behind this invoice is gone.')
      // The invoice owns its tax rate once created — re-deriving it from the
      // source quote here would silently undo a rate set on this invoice.
      const taxRateBp = taxRateBpOverride ?? invoice.tax_rate_bp ?? 0
      const snapshot = buildInvoiceSnapshot(job as Job, (partLines as PartLine[]) ?? [], taxRateBp)
      const { error } = await supabase
        .from('invoices')
        .update({
          job_title: (job as Job).title,
          work_performed: (job as Job).work_performed,
          ...snapshot,
        })
        .eq('id', invoice.id)
      if (error) throw error
      setRefreshMsg(taxRateBpOverride == null ? 'Updated from the job ✓' : 'Tax rate updated ✓')
      await load()
      setTimeout(() => setRefreshMsg(''), 3000)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
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
    router.push('/billing')
  }

  useDocumentTitle(
    invoice ? `${invoice.invoice_number} Invoice — ${invoice.customer_name}` : null,
  )

  if (!invoice) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  const publicUrl = `${window.location.origin}/i/${invoice.public_token}`
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
    paymentInstructions: settings?.invoice_payment_instructions || null,
    paidDate: invoice.paid_at ? invoice.paid_at.slice(0, 10) : null,
    paidCents: payments.reduce((s, p) => s + p.amount_cents, 0),
    business: {
      name: settings?.business_name ?? '',
      phone: settings?.business_phone ?? '',
      address: settings?.business_address ?? '',
      email: settings?.business_email ?? '',
    },
  }

  async function patch(fields: Partial<Invoice>, alsoJob?: 'paid') {
    const { error } = await supabase.from('invoices').update(fields).eq('id', id)
    if (error) {
      alert(error.message)
      return
    }
    if (alsoJob === 'paid') {
      // One-way sync: an invoice marked paid settles its job.
      await supabase.from('jobs').update({ payment_status: 'paid' }).eq('id', invoice!.job_id)
    }
    await load()
  }

  async function shareLink() {
    if (invoice!.status === 'draft') {
      await patch({ status: 'sent', sent_at: new Date().toISOString() })
    }
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
          <span className="chip" style={{ background: 'var(--bg3)', color: quoteStatusColors[invoice.status] ?? 'var(--text3)' }}>
            {invoice.status}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-primary" onClick={shareLink}>📤 Send link</button>
          <button className="btn btn-sm" onClick={() => window.print()}>🖨️ Print</button>
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
          {invoice.status !== 'paid' && invoice.status !== 'void' && (
            <button
              className="btn btn-sm"
              style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
              onClick={() => {
                setPayAmount(centsToInput(Math.max(0, invoice.total_cents - payments.reduce((s, p) => s + p.amount_cents, 0))))
                setPayOpen(!payOpen)
              }}
            >
              💵 Record payment
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
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            Payments received: {payments.map((p) => formatCents(p.amount_cents)).join(' + ')} ={' '}
            <b className="money" style={{ color: 'var(--green)' }}>
              {formatCents(payments.reduce((s, p) => s + p.amount_cents, 0))}
            </b>
          </p>
        )}
        {shareMsg && <p className="text-sm" style={{ color: 'var(--green)' }}>{shareMsg}</p>}
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          Invoices are frozen when created — editing the job won&apos;t change this document.
          If the job changed, void this and create a fresh invoice.
        </p>
      </div>

      <DocView doc={doc} />
    </div>
  )
}
