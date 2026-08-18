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
  const [signerName, setSignerName] = useState('')
  const [consented, setConsented] = useState(false)
  const [respondError, setRespondError] = useState<string | null>(null)

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
    // Through the server, so the IP and browser are observed rather than
    // self-reported by the page making the claim.
    try {
      const res = await fetch('/api/quote/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, response, name: signerName, consent: consented }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Something went wrong')
      await load()
    } catch (e) {
      setRespondError(e instanceof Error ? e.message : 'Please contact the shop directly.')
    }
    setResponding(false)
  }

  return (
    <div className="min-h-dvh" style={{ background: '#e5e7eb' }}>
      {quote.status === 'sent' && (
        <div
          className="no-print sticky top-0 z-10 flex flex-col items-center gap-2 px-4 py-3"
          style={{ background: '#111827' }}
        >
          <input
            className="input w-full max-w-sm"
            placeholder="Type your name to approve"
            aria-label="Your name"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
          />
          <label
            className="flex w-full max-w-sm items-start gap-2 text-xs"
            style={{ color: '#d1d5db' }}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
            />
            <span>
              I authorize {quote.business.name || 'the shop'} to perform the work above at the
              price shown, and I agree to approve it electronically.
            </span>
          </label>
          <div className="flex items-center gap-3">
            <button
              className="btn btn-primary"
              disabled={responding || signerName.trim().length < 2 || !consented}
              onClick={() => respond('approved')}
            >
              {responding ? 'Sending…' : '✓ Approve quote'}
            </button>
            <button className="btn" disabled={responding} onClick={() => respond('declined')}>
              Decline
            </button>
          </div>
          {respondError && (
            <span className="text-xs" style={{ color: '#fca5a5' }}>{respondError}</span>
          )}
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
