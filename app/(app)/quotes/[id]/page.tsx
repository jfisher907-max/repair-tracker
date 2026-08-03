'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import QuoteForm from '@/components/QuoteForm'
import DocView, { type DocData } from '@/components/DocView'
import { supabase } from '@/lib/supabase'
import { computeQuoteTotals, quoteStatusColors } from '@/lib/billing'
import {
  vehicleLabel,
  type Customer,
  type Quote,
  type QuoteLine,
  type QuoteStatus,
  type Settings,
  type Vehicle,
} from '@/lib/types'

export default function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [lines, setLines] = useState<QuoteLine[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [editing, setEditing] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const [converting, setConverting] = useState(false)

  const load = useCallback(async () => {
    const [{ data: q }, { data: l }, { data: s }] = await Promise.all([
      supabase
        .from('quotes')
        .select('*, customer:customers(*), vehicle:vehicles(*)')
        .eq('id', id)
        .single(),
      supabase.from('quote_lines').select('*').eq('quote_id', id).order('created_at'),
      supabase.from('settings').select('*').single(),
    ])
    if (q) {
      const { customer: c, vehicle: v, ...row } = q as Quote & {
        customer: Customer | null
        vehicle: Vehicle | null
      }
      setQuote(row as Quote)
      setCustomer(c)
      setVehicle(v)
    }
    setLines((l as QuoteLine[]) ?? [])
    setSettings(s as Settings)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (!quote) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  if (editing) {
    return (
      <div>
        <button className="btn btn-sm no-print mb-3" onClick={() => { setEditing(false); load() }}>
          ← Back to quote
        </button>
        <QuoteForm
          quote={quote}
          existingLines={lines}
          onSaved={() => {
            setEditing(false)
            load()
          }}
        />
      </div>
    )
  }

  const totals = computeQuoteTotals(quote, lines)
  const publicUrl = `${window.location.origin}/q/${quote.public_token}`

  const doc: DocData = {
    docType: 'Quote',
    number: quote.quote_number,
    status: quote.status,
    date: quote.created_at.slice(0, 10),
    secondaryDate: quote.valid_until,
    customerName: customer?.name ?? '—',
    vehicleLabel: vehicle ? vehicleLabel(vehicle) : '',
    title: quote.title,
    bodyText: quote.description,
    lines: lines.map((l) => ({
      description: l.description,
      qty: Number(l.qty),
      unit_charge_cents: l.unit_charge_cents,
      line_total_cents: l.line_total_cents,
    })),
    laborHours: Number(quote.labor_hours),
    laborRateCents: quote.labor_rate_cents,
    laborCents: totals.labor_cents,
    linesCents: totals.lines_cents,
    taxRateBp: quote.tax_rate_bp,
    taxCents: totals.tax_cents,
    totalCents: totals.total_cents,
    memo: null,
    paymentInstructions: null,
    paidDate: null,
    business: {
      name: settings?.business_name ?? '',
      phone: settings?.business_phone ?? '',
      address: settings?.business_address ?? '',
      email: settings?.business_email ?? '',
    },
  }

  async function setStatus(status: QuoteStatus) {
    const patch: Partial<Quote> = { status }
    if (status === 'sent' && !quote!.sent_at) patch.sent_at = new Date().toISOString()
    if (status === 'approved' || status === 'declined') patch.decided_at = new Date().toISOString()
    const { error } = await supabase.from('quotes').update(patch).eq('id', id)
    if (error) alert(error.message)
    else await load()
  }

  async function shareLink() {
    // Sharing implies sending — auto-advance a draft.
    if (quote!.status === 'draft') await setStatus('sent')
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${doc.business.name || 'Quote'} ${quote!.quote_number}`,
          text: `Quote for ${quote!.title}`,
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

  async function convertToJob() {
    if (!quote!.vehicle_id) {
      alert('Set a vehicle on this quote first (Edit) — jobs are always tied to a vehicle.')
      return
    }
    if (quote!.job_id) {
      router.push(`/jobs/${quote!.job_id}`)
      return
    }
    if (!confirm(`Create a job from ${quote!.quote_number}? Quoted lines become the job's customer pricing; you'll add actual parts costs as you buy them.`)) return
    setConverting(true)
    try {
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          vehicle_id: quote!.vehicle_id,
          title: quote!.title,
          work_performed: quote!.description,
          labor_hours: Number(quote!.labor_hours),
          labor_rate_cents: quote!.labor_rate_cents,
          notes: `From quote ${quote!.quote_number}`,
        })
        .select('id')
        .single()
      if (error) throw error
      if (lines.length) {
        const { error: lineErr } = await supabase.from('part_lines').insert(
          lines.map((l) => ({
            job_id: job.id,
            description: l.description,
            qty: Number(l.qty),
            unit_cost_cents: 0,
            unit_charge_cents: l.unit_charge_cents,
          })),
        )
        if (lineErr) throw lineErr
      }
      await supabase.from('quotes').update({ job_id: job.id }).eq('id', id)
      router.push(`/jobs/${job.id}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
      setConverting(false)
    }
  }

  async function softDelete() {
    if (!confirm(`Delete quote ${quote!.quote_number}?`)) return
    const { error } = await supabase
      .from('quotes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) alert(error.message)
    else router.push('/billing')
  }

  return (
    <div className="space-y-4">
      <div className="no-print space-y-3">
        <div className="flex items-center justify-between">
          <Link href="/billing" className="btn btn-sm">← Billing</Link>
          <span className="chip" style={{ background: 'var(--bg3)', color: quoteStatusColors[quote.status] }}>
            {quote.status}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-primary" onClick={shareLink}>📤 Send link</button>
          <button className="btn btn-sm" onClick={() => window.print()}>🖨️ Print</button>
          <button className="btn btn-sm" onClick={() => setEditing(true)}>✎ Edit</button>
          {quote.status === 'sent' && (
            <>
              <button className="btn btn-sm" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} onClick={() => setStatus('approved')}>
                ✓ Mark approved
              </button>
              <button className="btn btn-sm" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => setStatus('declined')}>
                ✗ Mark declined
              </button>
            </>
          )}
          <button className="btn btn-sm" disabled={converting} onClick={convertToJob}>
            {quote.job_id ? '→ Open job' : converting ? 'Converting…' : '🔧 Convert to job'}
          </button>
          <button className="btn btn-sm btn-danger" onClick={softDelete}>Delete</button>
        </div>
        {shareMsg && <p className="text-sm" style={{ color: 'var(--green)' }}>{shareMsg}</p>}
        {quote.notes && (
          <div className="card !py-2 text-sm" style={{ color: 'var(--text2)' }}>
            🔒 Private notes: {quote.notes}
          </div>
        )}
      </div>

      <DocView doc={doc} />
    </div>
  )
}
