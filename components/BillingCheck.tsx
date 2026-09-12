'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import { formatDate } from '@/lib/date'
import { isPassThrough } from '@/lib/markup'
import {
  buildBillingPlan,
  isOverApproval,
  type JobAuthorization,
  type PlanStep,
} from '@/lib/authorization'
import { refreshDraftInvoice } from '@/lib/invoice-refresh'
import { CONDITION_CHOICES, suggestCondition, type ConditionChoice } from '@/lib/conditions'
import type { Customer, PartLine } from '@/lib/types'

/**
 * Which panel is open. 'over' = an invoice was held because the job is past
 * what the customer approved; 'conditions' confirms part conditions and then
 * creates the invoice, 'conditions-only' just saves them.
 */
export type BillingSheet = null | 'over' | 'plan' | 'ok' | 'conditions' | 'conditions-only'

type OkMethod = 'phone' | 'in_person' | 'text'

function nowLocalInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The job page's billing guard (Alaska Automobile Repair Act):
 *   - a banner whenever the job adds up to more than the customer approved;
 *   - "Bill the approved amount": a reviewed plan that only ever lowers
 *     charges (apply_billing_plan);
 *   - "Record the customer's OK": who, how, the number called, when, the new
 *     total (AS 45.45.170(d)) — it prints on the invoice;
 *   - the part-condition check before an invoice (AS 45.45.190).
 * Research, not legal advice — the Alaska Department of Law administers the Act.
 */
export default function BillingCheck({
  jobId,
  customer,
  lines,
  auth,
  locked,
  hasDraftInvoice,
  partsOverrideCents,
  sheet,
  setSheet,
  onChanged,
  onProceed,
}: {
  jobId: string
  customer: Customer | null
  lines: PartLine[]
  auth: JobAuthorization | null
  /** A sent or paid invoice froze the bill. */
  locked: boolean
  /** jobs.parts_charged_override_cents — a parts total the owner set by hand. */
  partsOverrideCents: number | null
  /** An unsent draft exists — its "Update from job" needs conditions confirmed. */
  hasDraftInvoice: boolean
  sheet: BillingSheet
  setSheet: (s: BillingSheet) => void
  onChanged: () => Promise<void>
  /** Run once the checks pass: create the invoice. */
  onProceed: () => Promise<void>
}) {
  const over = isOverApproval(auth)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  /** Something the owner must still go and do — not an error, not a success. */
  const [warn, setWarn] = useState<string | null>(null)

  const [plan, setPlan] = useState<PlanStep[] | null>(null)
  const [passDiscount, setPassDiscount] = useState(false)

  const [okName, setOkName] = useState('')
  const [okMethod, setOkMethod] = useState<OkMethod>('phone')
  const [okPhone, setOkPhone] = useState('')
  const [okWhen, setOkWhen] = useState('')
  const [okTotal, setOkTotal] = useState('')
  const [okWhat, setOkWhat] = useState('')

  const [choices, setChoices] = useState<Record<string, ConditionChoice>>({})

  const unconfirmed = useMemo(
    () => lines.filter((l) => l.on_invoice !== false && !l.is_adjustment && l.condition == null),
    [lines],
  )
  // What the plan itself takes off, and what the database would then have to
  // take off as one adjustment. On a job whose parts total was set by hand, the
  // RPC subtracts that remainder from the override instead of writing a visible
  // adjustment line — and drives it negative when the remainder is bigger,
  // printing "Parts & materials −$140.00" on the customer's invoice.
  const planReduction = (plan ?? []).reduce((s, p) => s + (p.from_cents - p.to_cents), 0)
  const remainingOver = Math.max(0, (auth?.over_cents ?? 0) - planReduction)
  const overrideBlocks = partsOverrideCents != null && remainingOver > partsOverrideCents

  const hasDiscount = lines.some(
    (l) => l.on_invoice !== false && !l.quote_line_id && l.unit_cost_cents < 0 && isPassThrough(l.description),
  )
  /** The latest day parts were bought — an OK after it came after the work. */
  const latestPurchase = lines
    .map((l) => l.purchase_date)
    .filter((d): d is string => !!d)
    .sort()
    .pop()

  useEffect(() => {
    if (sheet !== 'plan') return
    let cancelled = false
    buildBillingPlan(jobId, lines, { passDiscount }).then((p) => {
      if (!cancelled) setPlan(p)
    })
    return () => {
      cancelled = true
    }
  }, [sheet, jobId, lines, passDiscount])

  function openPlan() {
    setMsg(null)
    setDone(null)
    setWarn(null)
    setPlan(null)
    setSheet('plan')
  }

  function openOk() {
    setMsg(null)
    setDone(null)
    setWarn(null)
    setOkName(customer?.name ?? '')
    setOkMethod('phone')
    setOkPhone(customer?.phone ?? '')
    setOkWhen(nowLocalInput())
    setOkTotal(auth ? centsToInput(auth.current_cents) : '')
    setOkWhat('')
    setSheet('ok')
  }

  async function applyPlan() {
    if (!plan || busy) return
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.rpc('apply_billing_plan', {
      p_job_id: jobId,
      p_ops: plan.map(({ op, line_id, unit_charge_cents, quote_line_id }) => ({
        op,
        line_id,
        unit_charge_cents,
        quote_line_id,
      })),
    })
    setBusy(false)
    if (error) {
      setMsg(error.message)
      return
    }
    const res = data as { after_cents?: number; authorized_cents: number }
    // The RPC can't re-freeze a draft invoice, and a stale draft keeps billing
    // the old total on the customer's statement — so the draft follows now.
    let draftNote = ''
    try {
      const { invoiceNumber, blocked } = await refreshDraftInvoice(jobId)
      if (invoiceNumber) draftNote = ` ${invoiceNumber} was updated to match.`
      if (blocked) setWarn(blocked)
    } catch (e) {
      setWarn(
        `The job is billed at the approved amount, but its draft invoice still shows the old total — open the invoice and tap “Update from job”. (${e instanceof Error ? e.message : String(e)})`,
      )
    }
    setSheet(null)
    await onChanged()
    // What it actually bills, not the ceiling: the two differ whenever the
    // steps land under the approval, and reporting the ceiling read as though
    // the customer were being charged every cent of it.
    setDone(
      res.after_cents != null && res.after_cents !== res.authorized_cents
        ? `Billed at ${formatCents(res.after_cents)} before tax, within the approved ${formatCents(res.authorized_cents)} — noted on the job.${draftNote}`
        : `Billed at the approved ${formatCents(res.authorized_cents)} before tax — noted on the job.${draftNote}`,
    )
  }

  async function saveOk() {
    if (busy) return
    const total = parseMoney(okTotal)
    if (!okName.trim()) return setMsg('Who OK’d it?')
    if (okMethod === 'phone' && !okPhone.trim())
      return setMsg('For a phone OK, Alaska law wants the number you called on record.')
    if (!okWhat.trim()) return setMsg('What did they OK? For example: “the extra hour freeing the seized bolts”.')
    if (total == null) return setMsg('Type the new total before tax, like 2075.03.')
    const when = new Date(okWhen)
    if (Number.isNaN(when.getTime())) return setMsg('When did they OK it?')
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('record_job_ok', {
      p_job_id: jobId,
      p_new_total_cents: total,
      p_description: okWhat.trim(),
      p_method: okMethod,
      p_by_name: okName.trim(),
      p_phone: okMethod === 'in_person' ? null : okPhone.trim() || null,
      p_authorized_at: when.toISOString(),
    })
    setBusy(false)
    if (error) {
      setMsg(error.message)
      return
    }
    setSheet(null)
    await onChanged()
    setDone(`Recorded — the approved total is now ${formatCents(total)} before tax. It prints on the invoice.`)
  }

  async function saveConditions(proceed: boolean) {
    if (busy) return
    const picks = unconfirmed.map((l) => ({
      id: l.id,
      value: choices[l.id] ?? suggestCondition(l).value,
    }))
    if (picks.some((p) => !p.value)) return setMsg('Pick a condition for each highlighted part.')
    setBusy(true)
    setMsg(null)
    const results = await Promise.all(
      picks.map((p) => supabase.from('part_lines').update({ condition: p.value }).eq('id', p.id)),
    )
    setBusy(false)
    const failed = results.find((r) => r.error)
    if (failed?.error) {
      setMsg(failed.error.message)
      return
    }
    setSheet(null)
    await onChanged()
    if (proceed) await onProceed()
  }

  const lateNote =
    sheet === 'ok' && latestPurchase && okWhen && okWhen.slice(0, 10) > latestPurchase
      ? `This OK is after the parts were bought (${formatDate(latestPurchase)}). Alaska wants the call before the extra work — record the real time you got it; it prints as given.`
      : null

  const showBanner = over && auth && (sheet === null || sheet === 'over')
  const showConditionsNudge =
    sheet === null && !over && hasDraftInvoice && !locked && unconfirmed.length > 0

  if (!showBanner && !sheet && !done && !warn && !showConditionsNudge) return null

  return (
    <div className="space-y-2">
      {done && (
        <div className="card flash-in !py-2 text-sm" style={{ color: 'var(--green)' }} role="status">
          {done}
        </div>
      )}
      {warn && (
        <div
          className="card flash-in !py-2 text-sm"
          style={{ color: 'var(--status-wait-fg)', borderLeft: '3px solid var(--status-wait-solid)' }}
          role="alert"
        >
          {warn}
        </div>
      )}

      {showBanner && (
        <div
          className="card space-y-2"
          style={{ borderLeft: '3px solid var(--status-stop-fg)' }}
          role={sheet === 'over' ? 'alert' : undefined}
        >
          <div className="label !mb-0" style={{ color: 'var(--status-stop-fg)' }}>
            {sheet === 'over' ? 'Invoice held — over what the customer approved' : 'Over what the customer approved'}
          </div>
          <div className="text-sm" style={{ color: 'var(--text2)' }}>
            Approved <b className="money">{formatCents(auth.authorized_cents)}</b> before tax · the job
            now comes to <b className="money">{formatCents(auth.current_cents)}</b> · over by{' '}
            <b className="money" style={{ color: 'var(--status-stop-fg)' }}>
              {formatCents(auth.over_cents)}
            </b>
          </div>
          {auth.reconstructed && (
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              No approval record on file for this quote, so the approved total is rebuilt from its lines.
            </p>
          )}
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Alaska law allows no charge over an approved estimate without the customer’s OK, given
            before the extra work and written down. Without one, the job bills at the approved price.
          </p>
          {locked && (
            <p className="text-xs" style={{ color: 'var(--status-wait-fg)' }}>
              An invoice is already sent or paid, so its bill can’t change from here. If the customer
              OK’d more, record it, then void and reissue.
            </p>
          )}
          {/* The buttons stay even when the bill is frozen: recording the OK is
              exactly what a locked, over-approval job needs, and without a way
              out of this panel "Mark paid" had nowhere to go. */}
          <div className="flex flex-wrap gap-2">
            {!locked && (
              <button className="btn btn-sm btn-primary" onClick={openPlan}>
                Bill the approved amount
              </button>
            )}
            <button className="btn btn-sm" onClick={openOk}>
              Record the customer’s OK
            </button>
            {sheet === 'over' && (
              <button className="btn btn-sm" onClick={() => setSheet(null)}>
                Not now
              </button>
            )}
          </div>
        </div>
      )}

      {sheet === 'plan' && auth && (
        <div className="card panel-in space-y-2">
          <div className="label !mb-0">Bill the approved amount</div>
          {plan == null ? (
            <p className="text-sm" style={{ color: 'var(--text3)' }}>Working it out…</p>
          ) : (
            <>
              {plan.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--text2)' }}>
                  No part prices to bring down. The difference (extra labor, say) comes off as one
                  “Adjustment to approved estimate” line on the invoice.
                </p>
              )}
              {plan.map((s) => (
                <div key={s.line_id} className="flex items-start justify-between gap-2 text-sm">
                  <span className="min-w-0" style={{ color: 'var(--text2)' }}>{s.label}</span>
                  <span className="money flex-none">
                    {formatCents(s.from_cents)} → {formatCents(s.to_cents)}
                  </span>
                </div>
              ))}
              {hasDiscount && (
                <label className="flex min-h-[44px] items-center gap-2 text-sm" style={{ color: 'var(--text2)' }}>
                  <input
                    type="checkbox"
                    checked={passDiscount}
                    onChange={(e) => setPassDiscount(e.target.checked)}
                  />
                  Pass the store discount on to the customer
                </label>
              )}
              <p className="text-xs" style={{ color: 'var(--text3)' }}>
                Charges only come down. The bill lands at the approved {formatCents(auth.authorized_cents)}{' '}
                before tax{passDiscount ? ' or less' : ''}; anything still over after these steps comes
                off as one adjustment line. Your costs don’t change, and it’s noted on the job.
              </p>
              {overrideBlocks && (
                <p className="text-sm" style={{ color: 'var(--status-stop-fg)' }}>
                  This job&apos;s parts total is set by hand ({formatCents(partsOverrideCents ?? 0)} in
                  the Money card). Taking the remaining {formatCents(remainingOver)} off it would push
                  that figure below zero, and the invoice would print a negative parts charge instead
                  of a visible adjustment. Clear the parts override on the job first, then bill at the
                  approved amount.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy || overrideBlocks}
                  onClick={applyPlan}
                >
                  {busy ? 'Applying…' : 'Apply'}
                </button>
                <button className="btn btn-sm" onClick={() => setSheet(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
          {msg && <p className="text-sm" style={{ color: 'var(--status-stop-fg)' }}>{msg}</p>}
        </div>
      )}

      {sheet === 'ok' && (
        <div className="card panel-in space-y-2">
          <div className="label !mb-0">Record the customer’s OK</div>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Alaska law (AS 45.45.170) wants the new total, who said yes, when, and for a call the number
            you called. It prints on the invoice.
          </p>
          {customer?.phone && (
            <a className="btn btn-sm" href={`tel:${customer.phone}`}>
              Call {customer.phone}
            </a>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Who said yes</label>
              <input className="input" value={okName} onChange={(e) => setOkName(e.target.value)} />
            </div>
            <div>
              <label className="label">How</label>
              <div className="flex flex-wrap gap-1">
                {(['phone', 'in_person', 'text'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="chip min-h-[36px]"
                    style={{
                      background: okMethod === m ? 'var(--accent)' : 'var(--bg3)',
                      color: okMethod === m ? '#111' : undefined,
                      cursor: 'pointer',
                    }}
                    onClick={() => setOkMethod(m)}
                  >
                    {m === 'phone' ? 'Phone' : m === 'in_person' ? 'In person' : 'Text'}
                  </button>
                ))}
              </div>
            </div>
            {okMethod !== 'in_person' && (
              <div>
                <label className="label">{okMethod === 'phone' ? 'Number you called' : 'Number texted'}</label>
                <input
                  className="input"
                  type="tel"
                  value={okPhone}
                  onChange={(e) => setOkPhone(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="label">When they OK’d it</label>
              <input
                className="input"
                type="datetime-local"
                value={okWhen}
                onChange={(e) => setOkWhen(e.target.value)}
              />
            </div>
            <div>
              <label className="label">New total before tax</label>
              <input
                className="input"
                inputMode="decimal"
                value={okTotal}
                onChange={(e) => setOkTotal(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">What they OK’d</label>
              <input
                className="input"
                placeholder="e.g. the extra hour freeing the seized bolts"
                value={okWhat}
                onChange={(e) => setOkWhat(e.target.value)}
              />
            </div>
          </div>
          {lateNote && <p className="text-xs" style={{ color: 'var(--status-wait-fg)' }}>{lateNote}</p>}
          {msg && <p className="text-sm" style={{ color: 'var(--status-stop-fg)' }}>{msg}</p>}
          <div className="flex gap-2">
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={saveOk}>
              {busy ? 'Saving…' : 'Save the OK'}
            </button>
            <button className="btn btn-sm" onClick={() => setSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(sheet === 'conditions' || sheet === 'conditions-only') && (
        <div className="card panel-in space-y-2">
          <div className="label !mb-0">
            {sheet === 'conditions' ? 'Before invoicing: ' : ''}what condition is each part?
          </div>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Alaska law (AS 45.45.190) wants every replaced part on the invoice marked new, used, rebuilt
            or reconditioned. Highlighted parts are often sold remanufactured — check the box or the
            receipt.
          </p>
          {unconfirmed.map((l) => {
            const s = suggestCondition(l)
            const value = choices[l.id] ?? s.value ?? ''
            const needsLook = s.check && !choices[l.id]
            return (
              <div
                key={l.id}
                className="grid grid-cols-[1fr_150px] items-center gap-2 rounded-lg p-1.5"
                style={needsLook ? { background: 'var(--status-wait-bg)' } : undefined}
              >
                <span className="min-w-0 text-sm">
                  <span className="block truncate">{l.description}</span>
                  {needsLook && (
                    <span className="block text-xs" style={{ color: 'var(--status-wait-fg)' }}>
                      often rebuilt — check
                    </span>
                  )}
                </span>
                <select
                  className="select !min-h-[40px]"
                  aria-label={`Condition of ${l.description}`}
                  value={value}
                  onChange={(e) => setChoices({ ...choices, [l.id]: e.target.value as ConditionChoice })}
                >
                  <option value="" disabled>
                    Pick…
                  </option>
                  {CONDITION_CHOICES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
          {msg && <p className="text-sm" style={{ color: 'var(--status-stop-fg)' }}>{msg}</p>}
          <div className="flex gap-2">
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() => saveConditions(sheet === 'conditions')}
            >
              {busy ? 'Saving…' : sheet === 'conditions' ? 'Confirm and create invoice' : 'Save'}
            </button>
            <button className="btn btn-sm" onClick={() => setSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {showConditionsNudge && (
        <div className="card !py-2 text-sm" style={{ color: 'var(--text2)' }}>
          {unconfirmed.length} part{unconfirmed.length === 1 ? ' needs its' : 's need their'} condition
          confirmed before the draft invoice can update.{' '}
          <button className="underline" style={{ color: 'var(--blue)' }} onClick={() => setSheet('conditions-only')}>
            Confirm now
          </button>
        </div>
      )}
    </div>
  )
}
