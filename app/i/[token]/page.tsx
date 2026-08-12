'use client'

import { use, useEffect, useState } from 'react'
import DocView, { type DocData } from '@/components/DocView'
import { BRAND_NAME } from '@/lib/brand'
import { useDocumentTitle } from '@/lib/title'
import { supabase } from '@/lib/supabase'
import type { DocLine } from '@/lib/types'

interface PublicInvoice {
  invoice_number: string
  status: string
  issue_date: string
  due_date: string | null
  customer_name: string
  vehicle_label: string
  job_title: string
  work_performed: string | null
  lines: DocLine[]
  labor_hours: number
  labor_rate_cents: number
  labor_cents: number
  parts_cents: number
  tax_rate_bp: number
  tax_cents: number
  total_cents: number
  amount_paid_cents: number
  memo: string | null
  paid_at: string | null
  business: {
    name: string
    phone: string
    address: string
    email: string
    payment_instructions: string
  }
}

/** PUBLIC invoice page — token-keyed, customer-safe fields only (see get_public_invoice). */
export default function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [invoice, setInvoice] = useState<PublicInvoice | null | 'missing'>(null)

  useEffect(() => {
    supabase.rpc('get_public_invoice', { token }).then(({ data, error }) => {
      if (error || !data) setInvoice('missing')
      else setInvoice(data as PublicInvoice)
    })
  }, [token])

  const loaded = invoice && invoice !== 'missing' ? invoice : null
  useDocumentTitle(
    loaded ? `Invoice ${loaded.invoice_number} — ${loaded.business.name || BRAND_NAME}` : null,
  )

  if (invoice === null) {
    return <div className="p-8 text-center" style={{ color: 'var(--text3)' }}>Loading invoice…</div>
  }
  if (invoice === 'missing') {
    return (
      <div className="p-8 text-center" style={{ color: 'var(--text2)' }}>
        This invoice link isn&apos;t valid anymore. Please contact the shop.
      </div>
    )
  }

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
    paymentInstructions: invoice.business.payment_instructions || null,
    paidDate: invoice.paid_at,
    paidCents: invoice.amount_paid_cents,
    business: invoice.business,
  }

  return (
    <div className="min-h-dvh" style={{ background: '#e5e7eb' }}>
      {invoice.status === 'paid' && (
        <div
          className="no-print px-4 py-3 text-center font-semibold"
          style={{ background: '#dcfce7', color: '#166534' }}
        >
          ✓ This invoice has been paid — thank you!
        </div>
      )}
      <DocView doc={doc} />
    </div>
  )
}
