'use client'

import { use, useCallback, useEffect, useState } from 'react'
import DocView, { type DocData } from '@/components/DocView'
import { BRAND_NAME } from '@/lib/brand'
import { useDocumentTitle } from '@/lib/title'
import { supabase } from '@/lib/supabase'
import type { DocLine } from '@/lib/types'

interface PublicQuote {
  quote_number: string
  status: string
  title: string
  description: string | null
  quote_date: string
  valid_until: string | null
  customer_name: string
  vehicle_label: string
  labor_hours: number
  labor_rate_cents: number
  tax_rate_bp: number
  lines: DocLine[]
  business: { name: string; phone: string; address: string; email: string }
}

/**
 * PUBLIC page — no login. The unguessable token in the URL is the only key,
 * and the backing RPC returns customer-safe fields only. This is what the
 * customer opens when the owner texts them a quote, with one-tap
 * approve/decline that updates the shop app.
 */
export default function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [quote, setQuote] = useState<PublicQuote | null | 'missing'>(null)
  const [responding, setResponding] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_public_quote', { token })
    if (error || !data) setQuote('missing')
    else setQuote(data as PublicQuote)
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  const loaded = quote && quote !== 'missing' ? quote : null
  useDocumentTitle(
    loaded ? `Quote ${loaded.quote_number} — ${loaded.business.name || BRAND_NAME}` : null,
  )

  if (quote === null) {
    return <div className="p-8 text-center" style={{ color: 'var(--text3)' }}>Loading quote…</div>
  }
  if (quote === 'missing') {
    return (
      <div className="p-8 text-center" style={{ color: 'var(--text2)' }}>
        This quote link isn&apos;t valid anymore. Please contact the shop.
      </div>
    )
  }

  const labor = Math.round(Number(quote.labor_hours) * quote.labor_rate_cents)
  const linesSum = quote.lines.reduce((s, l) => s + l.line_total_cents, 0)
  const tax = Math.round(((labor + linesSum) * quote.tax_rate_bp) / 10000)

  const doc: DocData = {
    docType: 'Quote',
    number: quote.quote_number,
    status: quote.status,
    date: quote.quote_date,
    secondaryDate: quote.valid_until,
    customerName: quote.customer_name,
    vehicleLabel: quote.vehicle_label,
    title: quote.title,
    bodyText: quote.description,
    lines: quote.lines,
    laborHours: Number(quote.labor_hours),
    laborRateCents: quote.labor_rate_cents,
    laborCents: labor,
    linesCents: linesSum,
    taxRateBp: quote.tax_rate_bp,
    taxCents: tax,
    totalCents: labor + linesSum + tax,
    memo: null,
    paymentInstructions: null,
    paidDate: null,
    business: quote.business,
  }

  async function respond(response: 'approved' | 'declined') {
    const verb = response === 'approved' ? 'Approve' : 'Decline'
    if (!confirm(`${verb} this quote?`)) return
    setResponding(true)
    const { data, error } = await supabase.rpc('respond_public_quote', { token, response })
    setResponding(false)
    if (error || !data) alert('Something went wrong — please contact the shop directly.')
    else await load()
  }

  return (
    <div className="min-h-dvh" style={{ background: '#e5e7eb' }}>
      {quote.status === 'sent' && (
        <div
          className="no-print sticky top-0 z-10 flex items-center justify-center gap-3 px-4 py-3"
          style={{ background: '#111827' }}
        >
          <button
            className="btn btn-primary"
            disabled={responding}
            onClick={() => respond('approved')}
          >
            ✓ Approve quote
          </button>
          <button className="btn" disabled={responding} onClick={() => respond('declined')}>
            Decline
          </button>
        </div>
      )}
      {(quote.status === 'approved' || quote.status === 'declined') && (
        <div
          className="no-print px-4 py-3 text-center font-semibold"
          style={{
            background: quote.status === 'approved' ? '#dcfce7' : '#fee2e2',
            color: quote.status === 'approved' ? '#166534' : '#991b1b',
          }}
        >
          {quote.status === 'approved'
            ? '✓ You approved this quote — the shop has been notified.'
            : 'This quote was declined.'}
        </div>
      )}
      <DocView doc={doc} />
    </div>
  )
}
