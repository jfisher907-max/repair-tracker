'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import DocView, { type DocData } from '@/components/DocView'
import { useDocumentTitle } from '@/lib/title'
import { supabase } from '@/lib/supabase'
import { quoteStatusColors } from '@/lib/billing'
import { PAYMENT_METHODS, recordPayment } from '@/lib/payments'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import type { Invoice, Payment, PaymentMethod, Settings } from '@/lib/types'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [shareMsg, setShareMsg] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [payDate, setPayDate] = useState(todayIso())
  const [payBusy, setPayBusy] = useState(false)

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
        </div>
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
