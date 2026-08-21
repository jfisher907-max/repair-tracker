'use client'

import { use, useCallback, useEffect, useState } from 'react'
import DocView, { type DocData } from '@/components/DocView'
import { BRAND_NAME } from '@/lib/brand'
import { useDocumentTitle } from '@/lib/title'
import { formatCents } from '@/lib/money'
import { supabase } from '@/lib/supabase'
import type { DocLine } from '@/lib/types'

type PublicQuoteLine = DocLine & { id: string; declined: boolean }

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
  lines: PublicQuoteLine[]
  /** Customer-visible photos of the job this quote belongs to (add-on quotes). */
  photos: { path: string; caption: string | null }[]
  business: { name: string; phone: string; address: string; email: string }
}

/**
 * PUBLIC page — no login. The unguessable token in the URL is the only key,
 * and the backing RPC returns customer-safe fields only. This is what the
 * customer opens when the owner texts them a quote. With several line items
 * they can untick the ones they don't want — "do the brakes, skip the flush"
 * in one visit instead of a rebuild-and-resend.
 */
export default function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [quote, setQuote] = useState<PublicQuote | null | 'missing'>(null)
  const [responding, setResponding] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [consented, setConsented] = useState(false)
  const [respondError, setRespondError] = useState<string | null>(null)
  /** Line ids the customer has unticked while deciding. */
  const [unchecked, setUnchecked] = useState<Record<string, boolean>>({})
  /** Signed URLs for the job's customer-visible photos, keyed by path. */
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    // Fire-and-forget: stamps first-view time so the shop can tell "never
    // opened it" from "opened it and went quiet". Must never block the page.
    supabase.rpc('mark_quote_viewed', { token }).then(
      () => {},
      () => {},
    )
    const { data, error } = await supabase.rpc('get_public_quote', { token })
    if (error || !data) {
      setQuote('missing')
      return
    }
    const q = data as PublicQuote
    setQuote(q)
    if (q.photos?.length) {
      // Signing is allowed for customer-visible photos only (storage policy).
      // If the policy isn't in place or signing fails, the section just
      // doesn't render — photos are evidence, never a blocker.
      const { data: signed } = await supabase.storage
        .from('receipts')
        .createSignedUrls(q.photos.map((p) => p.path), 3600)
      const map: Record<string, string> = {}
      for (const s of signed ?? []) if (s.signedUrl && s.path) map[s.path] = s.signedUrl
      setPhotoUrls(map)
    }
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

  const isSent = quote.status === 'sent'
  const labor = Math.round(Number(quote.labor_hours) * quote.labor_rate_cents)

  // While deciding, the DOCUMENT shows the full proposal and the chooser shows
  // the live selection. Once decided, the document is what was agreed to —
  // declined lines drop out of it and out of the totals.
  const docLines = isSent ? quote.lines : quote.lines.filter((l) => !l.declined)
  const docLineSum = docLines.reduce((s, l) => s + l.line_total_cents, 0)
  const docTax = Math.round(((labor + docLineSum) * quote.tax_rate_bp) / 10000)

  const keptSum = quote.lines
    .filter((l) => !unchecked[l.id])
    .reduce((s, l) => s + l.line_total_cents, 0)
  const keptTax = Math.round(((labor + keptSum) * quote.tax_rate_bp) / 10000)
  const keptTotal = labor + keptSum + keptTax
  const skippedCount = quote.lines.filter((l) => unchecked[l.id]).length
  const nothingKept = labor === 0 && keptSum === 0 && quote.lines.length > 0
  const declinedAfterDecision = quote.lines.filter((l) => l.declined)

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
    lines: docLines,
    laborHours: Number(quote.labor_hours),
    laborRateCents: quote.labor_rate_cents,
    laborCents: labor,
    linesCents: docLineSum,
    taxRateBp: quote.tax_rate_bp,
    taxCents: docTax,
    totalCents: labor + docLineSum + docTax,
    memo: null,
    paymentInstructions: null,
    paidDate: null,
    business: quote.business,
  }

  async function respond(response: 'approved' | 'declined') {
    const verb = response === 'approved' ? 'Approve' : 'Decline'
    const detail =
      response === 'approved' && skippedCount > 0
        ? ` (leaving out ${skippedCount} item${skippedCount === 1 ? '' : 's'})`
        : ''
    if (!confirm(`${verb} this quote${detail}?`)) return
    setResponding(true)
    // Through the server, so the IP and browser are observed rather than
    // self-reported by the page making the claim.
    try {
      const declinedIds = loaded ? loaded.lines.filter((l) => unchecked[l.id]).map((l) => l.id) : []
      const res = await fetch('/api/quote/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          response,
          name: signerName,
          consent: consented,
          declinedIds: response === 'approved' ? declinedIds : [],
        }),
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
      {isSent && (
        <div
          className="no-print sticky top-0 z-10 flex flex-col items-center gap-2 px-4 py-3"
          style={{ background: '#111827' }}
        >
          {quote.lines.length >= 2 && (
            <div className="w-full max-w-sm space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>
                Untick anything you&apos;d like to skip for now
              </p>
              {quote.lines.map((l) => (
                <label
                  key={l.id}
                  className="flex min-h-[44px] items-center justify-between gap-2 rounded-md px-2 py-2 text-sm"
                  style={{
                    background: unchecked[l.id] ? 'transparent' : '#1f2937',
                    color: unchecked[l.id] ? '#6b7280' : '#e5e7eb',
                    textDecoration: unchecked[l.id] ? 'line-through' : 'none',
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!unchecked[l.id]}
                      onChange={(e) =>
                        setUnchecked((prev) => ({ ...prev, [l.id]: !e.target.checked }))
                      }
                    />
                    <span className="truncate">{l.description}</span>
                  </span>
                  <span className="money flex-none">{formatCents(l.line_total_cents)}</span>
                </label>
              ))}
              <p className="text-right text-sm" style={{ color: '#e5e7eb' }}>
                Your total:{' '}
                <b className="money">{formatCents(keptTotal)}</b>
                {skippedCount > 0 && (
                  <span className="text-xs" style={{ color: '#9ca3af' }}>
                    {' '}
                    ({skippedCount} item{skippedCount === 1 ? '' : 's'} skipped)
                  </span>
                )}
              </p>
            </div>
          )}
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
              I authorize {quote.business.name || 'the shop'} to perform the selected work at the
              price shown, and I agree to approve it electronically.
            </span>
          </label>
          <div className="flex items-center gap-3">
            <button
              className="btn btn-primary"
              disabled={responding || signerName.trim().length < 2 || !consented || nothingKept}
              onClick={() => respond('approved')}
            >
              {responding
                ? 'Sending…'
                : skippedCount > 0
                  ? `✓ Approve ${formatCents(keptTotal)}`
                  : '✓ Approve quote'}
            </button>
            <button className="btn" disabled={responding} onClick={() => respond('declined')}>
              Decline all
            </button>
          </div>
          {nothingKept && (
            <span className="text-xs" style={{ color: '#fca5a5' }}>
              Everything is unticked — there&apos;s nothing left to approve.
            </span>
          )}
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
          {quote.status === 'approved' && declinedAfterDecision.length > 0 && (
            <div className="mt-1 text-sm font-normal">
              Left out for now: {declinedAfterDecision.map((l) => l.description).join(', ')}
            </div>
          )}
        </div>
      )}
      {quote.photos?.length > 0 && Object.keys(photoUrls).length > 0 && (
        // no-print: the frozen document below is the record; "tap a photo"
        // means nothing on paper.
        <div className="no-print mx-auto max-w-2xl px-4 pb-2">
          <div className="card space-y-2">
            <span className="label !mb-0">What we found</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {quote.photos
                .filter((p) => photoUrls[p.path])
                .map((p) => (
                  <a
                    key={p.path}
                    href={photoUrls[p.path]}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-lg border"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoUrls[p.path]}
                      alt={p.caption || 'Photo from the shop'}
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                    {p.caption && (
                      <span className="block px-2 py-1 text-xs" style={{ color: 'var(--text2)' }}>
                        {p.caption}
                      </span>
                    )}
                  </a>
                ))}
            </div>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              Tap a photo to see it full size.
            </p>
          </div>
        </div>
      )}
      <DocView doc={doc} />
    </div>
  )
}
