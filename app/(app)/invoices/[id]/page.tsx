'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import DocView, { type DocData } from '@/components/DocView'
import { supabase } from '@/lib/supabase'
import { quoteStatusColors } from '@/lib/billing'
import type { Invoice, Settings } from '@/lib/types'

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shareMsg, setShareMsg] = useState('')

  const load = useCallback(async () => {
    const [{ data: inv }, { data: s }] = await Promise.all([
      supabase.from('invoices').select('*').eq('id', id).single(),
      supabase.from('settings').select('*').single(),
    ])
    setInvoice(inv as Invoice)
    setSettings(s as Settings)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

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
              onClick={() => patch({ status: 'paid', paid_at: new Date().toISOString() }, 'paid')}
            >
              ✓ Mark paid (updates job too)
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
