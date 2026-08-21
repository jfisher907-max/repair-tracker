'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import QuoteForm from '@/components/QuoteForm'
import DocView, { type DocData } from '@/components/DocView'
import { useDocumentTitle } from '@/lib/title'
import { supabase } from '@/lib/supabase'
import { computeQuoteTotals, statusChipClass } from '@/lib/billing'
import { syncJobPayment } from '@/lib/payments'
import { formatCents } from '@/lib/money'
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
  /** Recording a customer decision that arrived off-line (phone, in person, text). */
  const [recording, setRecording] = useState<'approved' | 'declined' | null>(null)
  const [recordName, setRecordName] = useState('')
  const [recordMethod, setRecordMethod] = useState<'phone' | 'in_person' | 'text'>('phone')
  const [recordBusy, setRecordBusy] = useState(false)
  const [lastMethod, setLastMethod] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: q }, { data: l }, { data: s }, { data: a }] = await Promise.all([
      supabase
        .from('quotes')
        .select('*, customer:customers(*), vehicle:vehicles(*)')
        .eq('id', id)
        .single(),
      supabase.from('quote_lines').select('*').eq('quote_id', id).order('created_at'),
      supabase.from('settings').select('*').single(),
      supabase
        .from('quote_approvals')
        .select('method')
        .eq('quote_id', id)
        .order('created_at', { ascending: false })
        .limit(1),
    ])
    setLastMethod((a as { method: string }[] | null)?.[0]?.method ?? null)
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

  useDocumentTitle(
    quote ? `${quote.quote_number} Quote — ${customer?.name ?? ''}`.replace(/—\s*$/, '').trim() : null,
  )

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
    // The document shows what stands to be (or was) agreed — customer-declined
    // lines drop out of it, matching the approved-subset totals.
    lines: lines
      .filter((l) => !l.declined)
      .map((l) => ({
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

  /**
   * A decision that arrived outside the link — phone call, at the counter, a
   * text thread. State rules for verbal add-on authorization want who, when,
   * and how, plus the itemized cost; this writes all of it into the same
   * append-only log the online flow uses.
   */
  async function recordDecision() {
    if (!recording) return
    const name = recordName.trim()
    if (!name) return alert('Whose OK is this? Put a name on it.')
    setRecordBusy(true)
    try {
      const snapshot = {
        quote_number: quote!.quote_number,
        title: quote!.title,
        labor_hours: quote!.labor_hours,
        labor_rate_cents: quote!.labor_rate_cents,
        tax_rate_bp: quote!.tax_rate_bp,
        lines: lines.map((l) => ({
          description: l.description,
          qty: Number(l.qty),
          unit_charge_cents: l.unit_charge_cents,
          line_total_cents: l.line_total_cents,
          declined: l.declined,
        })),
        total_cents: totals.total_cents,
        response: recording,
        by_name: name,
        method: recordMethod,
        frozen_at: new Date().toISOString(),
      }
      const { error: aErr } = await supabase.from('quote_approvals').insert({
        quote_id: id,
        response: recording,
        by_name: name,
        consent: null,
        method: recordMethod,
        snapshot,
      })
      if (aErr) throw aErr
      const { error: qErr } = await supabase
        .from('quotes')
        .update({
          status: recording,
          decided_at: new Date().toISOString(),
          approved_by_name: name,
          approved_snapshot: snapshot,
        })
        .eq('id', id)
      if (qErr) throw qErr
      setRecording(null)
      setRecordName('')
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setRecordBusy(false)
    }
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
    // Sharing implies sending — but only a share that actually HAPPENED.
    // Cancelling the share sheet used to leave a draft marked "sent".
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
      if (quote!.status === 'draft') await setStatus('sent')
    } catch {
      setShareMsg('')
    }
    setTimeout(() => setShareMsg(''), 3000)
  }

  /** Add-on path: the job already exists — approved lines and labor go onto it. */
  async function applyToJob() {
    // Fresh reads for the confirm: the customer may have responded on their
    // phone since this page loaded, changing status and declined flags. (The
    // RPC reads its own fresh copy inside the transaction regardless.)
    const [{ data: freshQuote }, { data: freshLines }, { data: job, error: jobErr }] =
      await Promise.all([
        supabase.from('quotes').select('*').eq('id', id).single(),
        supabase.from('quote_lines').select('*').eq('quote_id', id).order('created_at'),
        supabase
          .from('jobs')
          .select('id, job_number, labor_hours, labor_rate_cents, work_performed')
          .eq('id', quote!.job_id!)
          .is('deleted_at', null)
          .single(),
      ])
    if (jobErr || !job) {
      alert(`Couldn't load the job this quote belongs to: ${jobErr?.message ?? 'not found'}`)
      return
    }
    const current = (freshQuote as Quote) ?? quote!
    const currentLines = (freshLines as QuoteLine[]) ?? lines
    if (current.applied_at) {
      alert('This quote was already applied.')
      await load()
      return
    }
    const approved = currentLines.filter((l) => !l.declined)
    const declined = currentLines.filter((l) => l.declined)
    const hours = Number(current.labor_hours) || 0
    const rateMismatch =
      hours > 0 && job.labor_rate_cents !== current.labor_rate_cents
        ? `\n\nHeads up: the job bills at ${formatCents(job.labor_rate_cents)}/hr but this quote used ${formatCents(current.labor_rate_cents)}/hr — added hours bill at the JOB's rate.`
        : ''
    const unapproved =
      current.status !== 'approved'
        ? `\n\nThis quote is ${current.status.toUpperCase()} — the customer hasn't approved it through their link. Apply only if you have their OK some other way.`
        : ''
    if (
      !confirm(
        `Add ${approved.length} approved line${approved.length === 1 ? '' : 's'}${
          hours ? ` and ${hours} hr labor` : ''
        } to ${job.job_number}?${declined.length ? ` ${declined.length} declined line${declined.length === 1 ? '' : 's'} go to Follow-ups.` : ''}${rateMismatch}${unapproved}`,
      )
    )
      return
    setConverting(true)
    try {
      // One transaction in the database: every write lands or none does, so a
      // failed or repeated tap can never duplicate lines or labor.
      const { error } = await supabase.rpc('apply_quote_to_job', { p_quote_id: id })
      if (error) throw error
      // Added work moves the amount owed — re-derive the cached payment
      // status from the ledger (no-op for jobs without ledger entries).
      try {
        await syncJobPayment(job.id)
      } catch {}
      router.push(`/jobs/${job.id}`)
    } catch (e) {
      alert(`Apply didn't finish: ${e instanceof Error ? e.message : String(e)} — nothing was added; try again.`)
      setConverting(false)
    }
  }

  async function convertToJob() {
    if (!quote!.vehicle_id) {
      alert('Set a vehicle on this quote first (Edit) — jobs are always tied to a vehicle.')
      return
    }
    if (quote!.job_id) {
      if (quote!.applied_at) router.push(`/jobs/${quote!.job_id}`)
      else await applyToJob()
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
      // Only what the customer agreed to becomes work on the job.
      const approved = lines.filter((l) => !l.declined)
      if (approved.length) {
        const { error: lineErr } = await supabase.from('part_lines').insert(
          approved.map((l) => ({
            job_id: job.id,
            description: l.description,
            qty: Number(l.qty),
            unit_cost_cents: 0,
            unit_charge_cents: l.unit_charge_cents,
          })),
        )
        if (lineErr) throw lineErr
      }
      // What they skipped isn't lost — it lands in Follow-ups as an open
      // recommendation with the quoted price attached.
      const declined = lines.filter((l) => l.declined)
      if (declined.length) {
        const { error: recErr } = await supabase.from('recommendations').insert(
          declined.map((l) => ({
            job_id: job.id,
            vehicle_id: quote!.vehicle_id,
            description: `${l.description} (declined on ${quote!.quote_number})`,
            estimate_cents: l.line_total_cents,
            status: 'open',
          })),
        )
        if (recErr) throw recErr
      }
      const { error: stampErr } = await supabase
        .from('quotes')
        .update({ job_id: job.id, applied_at: new Date().toISOString() })
        .eq('id', id)
      // The job exists either way — but if the link-back failed, converting
      // again would create a twin, so say so instead of failing silently.
      if (stampErr) {
        alert(
          `The job was created but the quote couldn't be marked converted (${stampErr.message}). Don't convert again — open the job from the Jobs list.`,
        )
      }
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
          <span className="flex items-center gap-2">
            {quote.sent_at && (
              <span
                className="text-xs"
                style={{ color: quote.viewed_at ? 'var(--green)' : 'var(--text3)' }}
                title="Whether the customer has opened the quote link"
              >
                {quote.viewed_at
                  ? `👁 viewed ${new Date(quote.viewed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                  : 'not viewed yet'}
              </span>
            )}
            <span className={statusChipClass(quote.status)}>{quote.status}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-primary" onClick={shareLink}>📤 Send link</button>
          <button className="btn btn-sm" onClick={() => window.print()}>🖨️ Print</button>
          <button
            className="btn btn-sm"
            onClick={() => {
              // Once a quote's lines have landed on a job, the quote is a
              // record, not a working document — editing it would let the
              // paper diverge from the work. New work gets a new quote.
              if (quote!.applied_at && quote!.job_id) {
                alert(
                  'This quote was already applied to its job. Edit the lines on the job itself, or use “Quote extra work” on the job for anything new.',
                )
                return
              }
              // An already-sent/decided quote is evidence of what the customer
              // saw — editing resets it to draft and requires a re-send.
              if (
                quote!.status !== 'draft' &&
                !confirm(
                  `This quote is ${quote!.status}. Editing resets it to DRAFT — the customer's copy changes and any approval no longer applies. You'll need to send it again. Continue?`,
                )
              ) {
                return
              }
              setEditing(true)
            }}
          >
            ✎ Edit
          </button>
          {quote.status === 'sent' && (
            <>
              <button
                className="btn btn-sm"
                style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
                onClick={() => {
                  setRecording('approved')
                  setRecordName(customer?.name ?? '')
                }}
              >
                ✓ Record approval
              </button>
              <button
                className="btn btn-sm"
                style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                onClick={() => {
                  setRecording('declined')
                  setRecordName(customer?.name ?? '')
                }}
              >
                ✗ Record decline
              </button>
            </>
          )}
          <button className="btn btn-sm" disabled={converting} onClick={convertToJob}>
            {quote.job_id && quote.applied_at
              ? '→ Open job'
              : converting
                ? 'Working…'
                : quote.job_id
                  ? '➕ Apply to job'
                  : '🔧 Convert to job'}
          </button>
          <button className="btn btn-sm btn-danger" onClick={softDelete}>Delete</button>
        </div>
        {shareMsg && <p className="text-sm" style={{ color: 'var(--green)' }}>{shareMsg}</p>}
        {recording && (
          <div className="card space-y-2">
            <span className="label !mb-0">
              {recording === 'approved' ? 'Record the customer’s OK' : 'Record the decline'}
            </span>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              For an OK that came by phone or in person: who said yes, and how. The date, time,
              and itemized cost are written down with it — that’s the record that settles
              arguments later.
            </p>
            <input
              className="input"
              placeholder="Who gave the OK — e.g. Diana Paul"
              value={recordName}
              onChange={(e) => setRecordName(e.target.value)}
            />
            <select
              className="select"
              value={recordMethod}
              onChange={(e) => setRecordMethod(e.target.value as 'phone' | 'in_person' | 'text')}
            >
              <option value="phone">By phone call</option>
              <option value="in_person">In person</option>
              <option value="text">By text message</option>
            </select>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" disabled={recordBusy} onClick={recordDecision}>
                {recordBusy ? 'Saving…' : recording === 'approved' ? 'Save the OK' : 'Save the decline'}
              </button>
              <button className="btn btn-sm" onClick={() => setRecording(null)}>Cancel</button>
            </div>
          </div>
        )}
        {quote.notes && (
          <div className="card !py-2 text-sm" style={{ color: 'var(--text2)' }}>
            🔒 Private notes: {quote.notes}
          </div>
        )}
      </div>

      {quote.approved_by_name && (
        <div className="no-print card space-y-1">
          <div className="label !mb-0">Authorization record</div>
          <p className="text-sm">
            <b>{quote.approved_by_name}</b>{' '}
            {quote.status === 'declined' ? 'declined' : 'approved'} this quote
            {lastMethod === 'phone' && <> by phone</>}
            {lastMethod === 'in_person' && <> in person</>}
            {lastMethod === 'text' && <> by text message</>}
            {quote.decided_at && <> on {new Date(quote.decided_at).toLocaleString()}</>}
            {quote.approval_consent && <> and ticked the authorization box</>}.
          </p>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            {quote.approval_ip && <>From {quote.approval_ip}. </>}
            The exact document they saw is frozen with this record, so later edits to the
            quote can&apos;t change what was agreed.
          </p>
        </div>
      )}
      {lines.some((l) => l.declined) && (
        <div className="no-print card space-y-1">
          <div className="label !mb-0">Declined by the customer</div>
          {lines
            .filter((l) => l.declined)
            .map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate" style={{ color: 'var(--text2)' }}>
                  {l.description}
                </span>
                <span className="money flex-none" style={{ color: 'var(--text3)' }}>
                  {formatCents(l.line_total_cents)}
                </span>
              </div>
            ))}
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Out of the total above. When you convert to a job, these land in Follow-ups with
            their quoted price, so they can be chased later.
          </p>
        </div>
      )}
      <DocView doc={doc} />
    </div>
  )
}
