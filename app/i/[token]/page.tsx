'use client'

import { use, useCallback, useEffect, useState } from 'react'
import DocView, { type DocData } from '@/components/DocView'
import { formatCents } from '@/lib/money'
import { BRAND_NAME } from '@/lib/brand'
import { useDocumentTitle } from '@/lib/title'
import { supabase } from '@/lib/supabase'
import { useCheckoutReturn } from '@/lib/checkout-return'
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

  // Back from Checkout: confirm with Stripe directly (the webhook can land
  // a beat after the customer does), then let the balance catch up. While
  // that is in flight the pay button stays hidden — never offer a second
  // charge over money that already moved.
  const checkoutReturn = useCheckoutReturn({ token, kind: 'invoice', flag: 'paid', reload })
  // Anything other than idle (never came back) or none (backed out / not
  // confirmed) means money is moving or has moved — 'recorded' included, which
  // is the normal instant-card outcome. Keep the pay button hidden throughout.
  const paymentInFlight = checkoutReturn !== 'idle' && checkoutReturn !== 'none'

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
    <div className="min-h-dvh" style={{ background: '#e9ebef' }}>
      {invoice.status === 'paid' && (
        <div
          className="no-print px-4 py-3 text-center font-semibold"
          style={{ background: 'rgba(76,217,123,0.16)', color: '#0f3d24' }}
        >
          ✓ This invoice has been paid — thank you!
        </div>
      )}
      {paymentInFlight && invoice.status !== 'paid' && (
        <div
          className="no-print px-4 py-3 text-center font-semibold"
          style={{ background: 'rgba(92,168,222,0.14)', color: '#1f4f73' }}
        >
          {checkoutReturn === 'processing'
            ? 'Your payment is processing — this page will update once it clears.'
            : '✓ Payment received — thank you. This page will update in a moment.'}
        </div>
      )}
      {checkoutReturn === 'none' && invoice.status !== 'paid' && (
        <div
          className="no-print px-4 py-2 text-center text-sm"
          style={{ background: '#f4f5f8', color: '#2a3040' }}
        >
          No charge was made.
        </div>
      )}
      {cardEnabled && !paymentInFlight && invoice.status !== 'paid' && invoice.status !== 'void' && balanceCents > 0 && (
        <div className="no-print flex flex-col items-center gap-2 px-4 py-4" style={{ background: '#0b0e13' }}>
          <button
            className="btn btn-primary w-full max-w-sm !min-h-[48px] text-base"
            disabled={paying}
            onClick={payByCard}
          >
            {paying ? 'Opening secure checkout…' : `Pay ${formatCents(balanceCents)} by card`}
          </button>
          <span className="text-xs" style={{ color: '#8b94a7' }}>
            Secure payment by card — processed by Stripe.
          </span>
          {payError && (
            <span className="text-xs" style={{ color: '#f58e8b' }}>{payError}</span>
          )}
        </div>
      )}
      <DocView doc={doc} />
    </div>
  )
}
