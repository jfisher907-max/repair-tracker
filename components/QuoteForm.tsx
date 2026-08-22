'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import { computeQuoteTotals, depositForRule, DEPOSIT_KINDS } from '@/lib/billing'
import VehicleFields, { emptyVehicleDraft, vehiclePayload } from '@/components/VehicleFields'
import {
  vehicleLabel,
  type Customer,
  type DepositKind,
  type Quote,
  type QuoteLine,
  type Vehicle,
} from '@/lib/types'

interface LineDraft {
  description: string
  qty: string
  unit_charge: string
}

function plusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** An open recommendation offered as a one-tap quote line. */
export interface QuoteSuggestion {
  description: string
  estimate_cents: number | null
}

/** The job an add-on quote authorizes extra work for. */
export interface AddOnJobContext {
  id: string
  job_number: string
  labor_rate_cents: number
  customer_id: string
  customer_name: string
  vehicle_id: string
  vehicle_label: string
}

/** New/edit quote editor. Quotes are estimates — everything here is charge-side. */
export default function QuoteForm({
  quote,
  existingLines,
  onSaved,
  addOnJob,
  suggestions,
}: {
  quote?: Quote
  existingLines?: QuoteLine[]
  /** Embedded-edit mode: called after save instead of navigating (pushing the
      current route is a no-op, which would leave the button stuck on "Saving…"). */
  onSaved?: (quoteId: string) => void
  /** Present = this quote authorizes EXTRA work on an existing job: customer,
      vehicle, and labor rate come from the job, and approval applies lines to
      that job instead of creating a new one. */
  addOnJob?: AddOnJobContext
  /** Open recommendations for the vehicle — tappable prefill lines. */
  suggestions?: QuoteSuggestion[]
}) {
  const router = useRouter()
  const editing = !!quote

  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [customerId, setCustomerId] = useState<string>(
    quote?.customer_id ?? addOnJob?.customer_id ?? '',
  )
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [newVehicle, setNewVehicle] = useState(emptyVehicleDraft)
  const [vehicleId, setVehicleId] = useState<string>(quote?.vehicle_id ?? addOnJob?.vehicle_id ?? '')

  const [title, setTitle] = useState(quote?.title ?? '')
  const [description, setDescription] = useState(quote?.description ?? '')
  const [laborHours, setLaborHours] = useState(quote ? String(quote.labor_hours) : '')
  const [laborRate, setLaborRate] = useState(
    quote
      ? centsToInput(quote.labor_rate_cents)
      : addOnJob
        ? centsToInput(addOnJob.labor_rate_cents)
        : '',
  )
  const [taxRate, setTaxRate] = useState(quote ? String(quote.tax_rate_bp / 100) : '')
  const [validUntil, setValidUntil] = useState(quote?.valid_until ?? plusDays(30))
  const [notes, setNotes] = useState(quote?.notes ?? '')
  // The deposit is a RULE (parts / 50% / fixed), resolved against whatever the
  // customer actually approves — so unticking a line can never leave a
  // deposit bigger than the job.
  const [depositKind, setDepositKind] = useState<DepositKind>(quote?.deposit_kind ?? 'none')
  const [depositFixed, setDepositFixed] = useState(
    quote?.deposit_kind === 'fixed' && quote.deposit_value != null ? centsToInput(quote.deposit_value) : '',
  )
  const [lines, setLines] = useState<LineDraft[]>(
    existingLines?.length
      ? existingLines.map((l) => ({
          description: l.description,
          qty: String(l.qty),
          unit_charge: centsToInput(l.unit_charge_cents),
        }))
      : [{ description: '', qty: '1', unit_charge: '' }],
  )

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Retry safety: if the save fails after the customer (or vehicle) landed,
  // resubmitting must reuse them instead of creating twins. Same pattern as
  // JobForm.
  const createdCustomerId = useRef<string | null>(null)
  const createdVehicleId = useRef<string | null>(null)

  useEffect(() => {
    supabase
      .from('customers')
      .select('*')
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => setCustomers((data as Customer[]) ?? []))
    supabase
      .from('vehicles')
      .select('*')
      .is('deleted_at', null)
      .then(({ data }) => setVehicles((data as Vehicle[]) ?? []))
    if (!editing) {
      supabase
        .from('settings')
        .select('default_labor_rate_cents, default_tax_rate_bp')
        .single()
        .then(({ data }) => {
          if (!data) return
          // An add-on bills at ITS JOB's rate, not the shop default — the
          // quoted total must match what lands on the job.
          if (!addOnJob) setLaborRate(centsToInput(data.default_labor_rate_cents))
          setTaxRate(String((data.default_tax_rate_bp ?? 0) / 100))
        })
    }
  }, [editing, addOnJob])

  const customerVehicles = vehicles.filter((v) => v.customer_id === customerId)

  const depositValue =
    depositKind === 'percent' ? 5000 : depositKind === 'fixed' ? (parseMoney(depositFixed) ?? 0) : null

  const taxRateBp = Math.round((Number(taxRate) || 0) * 100)
  const totals = useMemo(
    () =>
      computeQuoteTotals(
        {
          labor_hours: Number(laborHours) || 0,
          labor_rate_cents: parseMoney(laborRate) ?? 0,
          tax_rate_bp: taxRateBp,
        },
        lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            line_total_cents: Math.round((Number(l.qty) || 0) * (parseMoney(l.unit_charge) ?? 0)),
          })),
      ),
    [laborHours, laborRate, taxRateBp, lines],
  )

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  async function save() {
    setError(null)
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    if (!customerId && !newCustomerName.trim()) {
      setError('Pick a customer or enter a new one.')
      return
    }
    setBusy(true)
    try {
      let cid = customerId
      let vid = vehicleId || null
      if (!cid) {
        if (createdCustomerId.current) {
          cid = createdCustomerId.current
        } else {
          const { data, error } = await supabase
            .from('customers')
            .insert({
              name: newCustomerName.trim(),
              phone: newCustomerPhone.trim() || null,
            })
            .select('id')
            .single()
          if (error) throw error
          createdCustomerId.current = data.id
          cid = data.id
        }
        // A quote without a vehicle can never convert to a job, and editing
        // later to add one resets an approved quote to draft — so a new
        // customer's vehicle comes along right here, like the job form does.
        if (Object.values(newVehicle).some((v) => v.trim() !== '')) {
          if (createdVehicleId.current) {
            vid = createdVehicleId.current
          } else {
            const { data: veh, error: vehErr } = await supabase
              .from('vehicles')
              .insert({ customer_id: cid, ...vehiclePayload(newVehicle) })
              .select('id')
              .single()
            if (vehErr) throw vehErr
            createdVehicleId.current = veh.id
            vid = veh.id
          }
        }
      }

      const payload = {
        customer_id: cid,
        vehicle_id: vid,
        // Born linked: an add-on quote carries its job from creation, which is
        // what makes "convert" become "apply to that job" on approval.
        ...(addOnJob && !editing ? { job_id: addOnJob.id } : {}),
        title: title.trim(),
        description: description.trim() || null,
        labor_hours: Number(laborHours) || 0,
        labor_rate_cents: parseMoney(laborRate) ?? 0,
        tax_rate_bp: taxRateBp,
        valid_until: validUntil || null,
        notes: notes.trim() || null,
        deposit_kind: depositKind,
        deposit_value: depositValue,
      }

      let quoteId = quote?.id
      if (editing) {
        // Editing a sent/decided quote invalidates what the customer saw —
        // drop it back to draft so it must be re-sent.
        // The authorization details go with it: they describe a document that
        // no longer exists, and leaving them would let the record card caption
        // the new version — or relabel a decline as an approval. The permanent
        // copy lives in quote_approvals, which is append-only.
        const resetStatus =
          quote.status !== 'draft'
            ? {
                status: 'draft' as const,
                decided_at: null,
                approved_by_name: null,
                approval_consent: null,
                approval_ip: null,
                approval_user_agent: null,
                approved_snapshot: null,
                // A resolved deposit belongs to an approval that no longer
                // stands; it is re-resolved at the next approval.
                deposit_cents: null,
              }
            : {}
        const { error } = await supabase
          .from('quotes')
          .update({ ...payload, ...resetStatus })
          .eq('id', quote.id)
        if (error) throw error
        // Simplest reliable line sync: replace the set.
        const { error: delErr } = await supabase.from('quote_lines').delete().eq('quote_id', quote.id)
        if (delErr) throw delErr
      } else {
        const { data, error } = await supabase.from('quotes').insert(payload).select('id').single()
        if (error) throw error
        quoteId = data.id
      }

      const validLines = lines.filter((l) => l.description.trim())
      if (validLines.length) {
        const { error: lineErr } = await supabase.from('quote_lines').insert(
          validLines.map((l) => ({
            quote_id: quoteId,
            description: l.description.trim(),
            qty: Number(l.qty) || 1,
            unit_charge_cents: parseMoney(l.unit_charge) ?? 0,
          })),
        )
        if (lineErr) throw lineErr
      }
      if (onSaved) {
        setBusy(false)
        onSaved(quoteId!)
      } else {
        router.push(`/quotes/${quoteId}`)
        router.refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl">
        {editing
          ? `Edit ${quote.quote_number}`
          : addOnJob
            ? `Extra work on ${addOnJob.job_number}`
            : 'New Quote'}
      </h1>

      {addOnJob && !editing && (
        <div className="card !py-2 text-sm" style={{ color: 'var(--text2)' }}>
          <b>{addOnJob.customer_name}</b> · {addOnJob.vehicle_label} — when the customer
          approves, the approved lines and labor go onto <b>{addOnJob.job_number}</b>, not a
          new job. Labor bills at the job&apos;s rate.
        </div>
      )}
      {editing && quote.job_id && (
        <div className="card !py-2 text-sm" style={{ color: 'var(--text2)' }}>
          This quote is linked to a job, so the customer and vehicle are fixed.
        </div>
      )}

      {/* A job-linked quote must never be repointed at another customer or
          vehicle — the job it lands on wouldn't follow. */}
      {!(addOnJob || quote?.job_id) && (
      <div className="card space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Customer *</label>
            <select
              className="select"
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value)
                setVehicleId('')
              }}
            >
              <option value="">+ New customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Vehicle (optional)</label>
            <select
              className="select"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              disabled={!customerId}
            >
              <option value="">{customerId ? 'No specific vehicle' : 'Pick customer first'}</option>
              {customerVehicles.map((v) => (
                <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>
              ))}
            </select>
          </div>
          {!customerId && (
            <>
              <div>
                <label className="label">New customer name *</label>
                <input className="input" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" type="tel" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <div className="label">Vehicle (optional, but a quote needs one to become a job)</div>
                <VehicleFields value={newVehicle} onChange={setNewVehicle} />
              </div>
            </>
          )}
        </div>
      </div>
      )}

      <div className="card grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Title *</label>
          <input
            className="input"
            placeholder="Front brake job — pads & rotors"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Scope of work (customer sees this)</label>
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="label">Est. labor hours</label>
          <input className="input" inputMode="decimal" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} />
        </div>
        <div>
          <label className="label">Labor rate ($/hr)</label>
          <input className="input" inputMode="decimal" value={laborRate} onChange={(e) => setLaborRate(e.target.value)} />
        </div>
        <div>
          <label className="label">Sales tax (%)</label>
          <input className="input" inputMode="decimal" placeholder="0" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
        </div>
        <div>
          <label className="label">Valid until</label>
          <input className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
      </div>

      <div className="card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label !mb-0">Deposit on approval</span>
          {depositKind !== 'none' && (
            <span className="text-sm" style={{ color: 'var(--text2)' }}>
              ≈ {formatCents(depositForRule(depositKind, depositValue, totals) ?? 0)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {DEPOSIT_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              className="chip"
              style={{
                background: depositKind === k.value ? 'var(--accent)' : 'var(--bg3)',
                color: depositKind === k.value ? '#111' : undefined,
                cursor: 'pointer',
              }}
              onClick={() => setDepositKind(k.value)}
            >
              {k.label}
            </button>
          ))}
        </div>
        {depositKind === 'fixed' && (
          <input
            className="input"
            inputMode="decimal"
            placeholder="Amount, e.g. 200"
            value={depositFixed}
            onChange={(e) => setDepositFixed(e.target.value)}
          />
        )}
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          Figured on what the customer actually approves — if they skip a line, the deposit
          follows. Paying it books the job.
        </p>
      </div>

      <div className="card space-y-2">
        <div className="label">Parts & materials (estimated, customer prices)</div>
        {!editing && (suggestions?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1">
            {suggestions!.map((s, i) => (
              <button
                key={i}
                type="button"
                className="chip"
                style={{ background: 'var(--bg3)', cursor: 'pointer' }}
                title="From this vehicle's open recommendations — tap to add as a line"
                onClick={() => {
                  const newLine: LineDraft = {
                    description: s.description,
                    qty: '1',
                    unit_charge: s.estimate_cents != null ? centsToInput(s.estimate_cents) : '',
                  }
                  // Replace the single untouched starter line instead of
                  // stacking under it.
                  const isBlank = (l: LineDraft) => !l.description.trim() && !l.unit_charge.trim()
                  setLines(lines.length === 1 && isBlank(lines[0]) ? [newLine] : [...lines, newLine])
                }}
              >
                💡 {s.description.length > 42 ? `${s.description.slice(0, 42)}…` : s.description}
                {s.estimate_cents != null && ` · ${formatCents(s.estimate_cents)}`}
              </button>
            ))}
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_64px_96px_44px] items-center gap-1.5">
            <input
              className="input !min-h-[40px]"
              placeholder="Description"
              value={l.description}
              onChange={(e) => setLine(i, { description: e.target.value })}
            />
            <input
              className="input !min-h-[40px]"
              inputMode="decimal"
              aria-label="Qty"
              value={l.qty}
              onChange={(e) => setLine(i, { qty: e.target.value })}
            />
            <input
              className="input !min-h-[40px]"
              inputMode="decimal"
              aria-label="Price ($)"
              placeholder="$"
              value={l.unit_charge}
              onChange={(e) => setLine(i, { unit_charge: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-sm btn-danger !min-h-[40px] !px-2"
              onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
              aria-label="Remove line"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm w-full"
          onClick={() => setLines([...lines, { description: '', qty: '1', unit_charge: '' }])}
        >
          + Add line
        </button>
        <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: 'var(--bg2)' }}>
          <span className="text-sm" style={{ color: 'var(--text2)' }}>
            Parts {formatCents(totals.lines_cents)} · Labor {formatCents(totals.labor_cents)}
            {totals.tax_cents > 0 && <> · Tax {formatCents(totals.tax_cents)}</>}
          </span>
          <span className="money font-bold">{formatCents(totals.total_cents)}</span>
        </div>
      </div>

      <div className="card">
        <label className="label">Private notes (never shown to customer)</label>
        <textarea className="textarea !min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p style={{ color: 'var(--red)' }}>{error}</p>}
      <div className="flex gap-2 pb-4">
        <button className="btn btn-primary flex-1" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create quote'}
        </button>
        <button className="btn" onClick={() => router.back()}>Cancel</button>
      </div>
    </div>
  )
}
