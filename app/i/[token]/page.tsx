'use client'

import { use, useCallback, useEffect, useState } from 'react'
import DocView, { type DocData } from '@/components/DocView'
import { formatCents } from '@/lib/money'
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

  const [cardEnabled, setCardEnabled] = useState(false)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [justPaid, setJustPaid] = useState(false)

  const reload = useCallback(() => {
    supabase.rpc('get_public_invoice', { token }).then(({ data, error }) => {
      if (error || !data) setInvoice('missing')
      else setInvoice(data as PublicInvoice)
    })
  }, [token])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    fetch('/api/pay/status')
      .then((r) => r.json())
      .then((b) => setCardEnabled(!!b.enabled))
      .catch(() => {})
  }, [])

  // Coming back from Checkout, the payment is confirmed by Stripe's webhook,
  // which can land a moment after the customer does — so re-check for a few
  // seconds rather than claiming anything the ledger hasn't recorded yet.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('paid')) return
    setJustPaid(true)
    window.history.replaceState({}, '', window.location.pathname)
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      reload()
      if (tries >= 5) clearInterval(timer)
    }, 2000)
    return () => clearInterval(timer)
  }, [reload])

  async function payByCard() {
    setPaying(true)
    setPayError(null)
    try {
      const res = await fetch('/api/pay/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const body = await res.json()
      if (!res.ok || !body.url) throw new Error(body.error || 'Could not start checkout')
      window.location.href = body.url
    } catch (e) {
      setPayError(e instanceof Error ? e.message : String(e))
      setPaying(false)
    }
  }


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

  const balanceCents = Math.max(0, invoice.total_cents - (invoice.amount_paid_cents ?? 0))

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
      {justPaid && invoice.status !== 'paid' && (
        <div
          className="no-print px-4 py-3 text-center font-semibold"
          style={{ background: '#dbeafe', color: '#1e40af' }}
        >
          Thanks — your payment is going through. This page will update in a moment.
        </div>
      )}
      {cardEnabled && invoice.status !== 'paid' && invoice.status !== 'void' && balanceCents > 0 && (
        <div className="no-print flex flex-col items-center gap-2 px-4 py-4" style={{ background: '#111827' }}>
          <button
            className="btn btn-primary w-full max-w-sm !min-h-[48px] text-base"
            disabled={paying}
            onClick={payByCard}
          >
            {paying ? 'Opening secure checkout…' : `Pay ${formatCents(balanceCents)} by card`}
          </button>
          <span className="text-xs" style={{ color: '#9ca3af' }}>
            Secure payment by card — processed by Stripe.
          </span>
          {payError && (
            <span className="text-xs" style={{ color: '#fca5a5' }}>{payError}</span>
          )}
        </div>
      )}
      <DocView doc={doc} />
    </div>
  )
}
