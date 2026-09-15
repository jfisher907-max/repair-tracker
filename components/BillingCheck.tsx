'use client'

import { useEffect, useId, useMemo, useState } from 'react'
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

export type OkMethod = 'phone' | 'in_person' | 'text'

/**
 * One recorded OK (public.job_authorizations) as the OWNER sees it.
 *
 * corrected_at is optional on purpose: migration 0044 adds the column, and this
 * type is read with `select('*')` so the job page still lists its OKs on a
 * database where 0044 has not been applied yet.
 *
 * This type is deliberately NOT the customer-facing AuthorizationEntry. The
 * invoice prints the facts of the approval (who, when, how, the new total);
 * recorded_at and corrected_at are the app's own record of when the shop wrote
 * it down and went back over it, and they stay on this side of the counter.
 */
export interface JobOk {
  id: string
  job_id: string
  description: string
  method: OkMethod
  by_name: string
  phone_called: string | null
  /** When the customer actually said yes. This is what the invoice prints. */
  authorized_at: string
  /** When the shop wrote it down. Never moves, not even on a correction. */
  recorded_at: string
  /** Set by update_job_ok when the row is gone back over (0044). */
  corrected_at?: string | null
  previous_ceiling_cents: number
  new_total_cents: number
  delta_cents: number | null
}

function nowLocalInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** An ISO timestamp -> the local "YYYY-MM-DDTHH:mm" a datetime-local wants.
 *  Truncates to the minute, which only ever moves the value EARLIER — so a
 *  prefilled time can never drift past the limit it is checked against. */
function localInputFromIso(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "8:41 PM on Sat, Sep 12", from a local input string. Takes the value rather
 *  than reading the clock, so it is safe to call while rendering. */
function whenWords(localInput: string): string {
  const d = new Date(localInput)
  if (Number.isNaN(d.getTime())) return 'now'
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return `${time} on ${day}`
}

/** "September 14, 2026" from a timestamp, in the shop's own timezone — not the
 *  UTC date, which is already tomorrow for most of an Alaska evening. */
function dayWords(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

const METHOD_WORDS: Record<OkMethod, string> = {
  phone: 'by phone',
  in_person: 'in person',
  text: 'by text',
}

/** How far ahead of now an OK may be recorded. The database allows five
 *  minutes for clock skew (0032); the form stops well inside that, so the
 *  owner gets a sentence instead of a constraint name. */
const OK_FUTURE_GRACE_MS = 2 * 60 * 1000

/**
 * A database constraint is the last line of defence, not a message. These are
 * the ones this form can reach; anything else is passed through rather than
 * guessed at.
 */
function plainDbError(message: string): string {
  if (message.includes('job_authorizations_not_in_future'))
    return `That time hasn’t happened yet — it is ${whenWords(nowLocalInput())} now. Record when they actually said yes.`
  if (message.includes('job_authorizations_never_lowers'))
    return 'An OK can’t lower the approved total — bill less instead.'
  if (message.includes('job_authorizations_phone_needs_number'))
    return 'For a phone OK, Alaska law wants the number you called on record.'
  if (message.includes('job_authorizations_description_check'))
    return 'What did they OK? Put it in words — it prints on the invoice.'
  // Correcting and deleting an OK (migration 0044). update_job_ok and
  // delete_job_ok raise these in plain English already; they are matched here,
  // rather than left to the passthrough, so that if the SQL wording ever
  // changes it shows up as a miss to fix instead of silently going raw.
  if (message.includes('already has a sent or paid invoice'))
    return 'This OK is already printed on a sent or paid invoice, so it can’t be changed from here. Void that invoice and reissue it if the record needs correcting.'
  if (message.includes('An OK can never lower the approved total')) return message
  // The estimate rose above an OK already on file, so that OK is stranded under
  // it. Nothing the owner can type clears that — the raise says "delete it" —
  // and delete_job_ok lets him, so both sentences pass through as written.
  if (message.includes('no longer belongs on the record')) return message
  if (message.includes('would leave another OK on this job')) return message
  if (message.includes('it can’t have been given after that')) return message
  if (message.includes("can't have been given after that")) return message
  if (message.includes('not on file any more'))
    return 'That OK isn’t on file any more — it may already have been deleted. Reload the job.'
  // The RPCs land with migration 0044. Until it is applied the call comes back
  // as a missing function, which must not reach the owner as a PostgREST code.
  if (message.includes('Could not find the function') || message.includes('PGRST202'))
    return 'This copy of the database can’t correct a recorded OK yet — the change that adds it hasn’t been applied.'
  return message
}

/** The latest moment an OK can have been given, and why that is the limit. */
interface OkLimit {
  /** Local "YYYY-MM-DDTHH:mm" — the input's max and the quick-set value. */
  at: string
  /** 'now' while recording a fresh OK; 'recorded' while correcting one that
   *  has already been written down (it cannot have been given after that). */
  kind: 'now' | 'recorded'
}

/** The AS 45.45.170(d) fields, as typed. */
interface OkDraft {
  name: string
  method: OkMethod
  phone: string
  /** Local "YYYY-MM-DDTHH:mm". */
  when: string
  /** Dollars-and-cents as typed. */
  total: string
  what: string
}

/**
 * The form's own rules, in the owner's words — the same ones the table's
 * constraints and the RPCs enforce. Saying them here is what keeps a
 * constraint name off the screen. Called from a save handler, never from
 * render, so reading the clock is safe.
 */
function okProblem(d: OkDraft, limit: OkLimit): string | null {
  if (!d.name.trim()) return 'Who OK’d it?'
  if (d.method === 'phone' && !d.phone.trim())
    return 'For a phone OK, Alaska law wants the number you called on record.'
  if (!d.what.trim()) return 'What did they OK? For example: “the extra hour freeing the seized bolts”.'
  const cents = parseMoney(d.total)
  // parseMoney('-5') is -500, not null, so a typed minus sign gets past the
  // shape check and comes back from the RPC as "enter the new total" — which
  // reads like a bug to someone who just typed one. Say what is actually wrong.
  if (cents == null || cents < 0)
    return 'Type the new total before tax, like 2075.03 — a total can’t be negative.'
  const when = new Date(d.when)
  if (Number.isNaN(when.getTime())) return 'When did they OK it?'
  // An OK cannot have happened yet. Correcting one is tighter still: the
  // moment it was written down is fixed, and nothing can have been said after
  // the note of it was made. The database refuses both (0032, 0044); catching
  // them here means a sentence the owner can act on instead of a constraint.
  if (limit.kind === 'now') {
    if (when.getTime() > Date.now() + OK_FUTURE_GRACE_MS)
      return `That time hasn’t happened yet — it is ${whenWords(nowLocalInput())} now. Record when they actually said yes; it prints on the invoice as given.`
    return null
  }
  const ceiling = new Date(limit.at)
  if (!Number.isNaN(ceiling.getTime()) && when.getTime() > ceiling.getTime() + OK_FUTURE_GRACE_MS)
    return `You wrote this OK down at ${whenWords(limit.at)}, so it can’t have been given after that. Pick a time at or before then.`
  return null
}

/** The latest day parts were bought — an OK after it came after the work. */
function latestPurchaseDate(lines: PartLine[]): string | undefined {
  return lines
    .map((l) => l.purchase_date)
    .filter((d): d is string => !!d)
    .sort()
    .pop()
}

/**
 * The AS 45.45.170(d) fields — who said yes, how, the number called, when, the
 * new total, and what they OK'd. One shape, used both to record an OK and to
 * correct one, so the two can never drift apart.
 */
function OkFields({
  draft,
  setDraft,
  limit,
  setLimit,
  latestPurchase,
  callPhone,
}: {
  draft: OkDraft
  setDraft: (d: OkDraft) => void
  limit: OkLimit
  /** Re-reading the clock keeps a sheet left open a while honest. Absent when
   *  the limit is fixed (the moment the OK was written down never moves). */
  setLimit?: (l: OkLimit) => void
  latestPurchase: string | undefined
  /** A one-tap call, while there is still a call to make. */
  callPhone: string | null
}) {
  // The record sheet and a correction sheet can be open at the same time, so a
  // fixed id would give two inputs the same one and point both labels at the
  // first of them.
  const whenId = `${useId()}-when`
  const lateNote =
    latestPurchase && draft.when && draft.when.slice(0, 10) > latestPurchase
      ? `This OK is after the parts were bought (${formatDate(latestPurchase)}). Alaska wants the call before the extra work — record the real time you got it; it prints as given.`
      : null
  // Said as it is typed, not after the save fails. Both sides are local
  // "YYYY-MM-DDTHH:mm" strings, so a plain comparison is the right one.
  const overLimit = draft.when && limit.at && draft.when > limit.at
  const futureNote = !overLimit
    ? null
    : limit.kind === 'now'
      ? `That is in the future — it is ${whenWords(limit.at)} now. An OK is recorded at the moment they said yes.`
      : `You wrote this OK down at ${whenWords(limit.at)}, so it can’t have been given after that.`

  return (
    <>
      {callPhone && (
        <a className="btn btn-sm" href={`tel:${callPhone}`}>
          Call {callPhone}
        </a>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label">Who said yes</label>
          <input
            className="input"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
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
                  background: draft.method === m ? 'var(--accent)' : 'var(--bg3)',
                  color: draft.method === m ? '#111' : undefined,
                  cursor: 'pointer',
                }}
                onClick={() => setDraft({ ...draft, method: m })}
              >
                {m === 'phone' ? 'Phone' : m === 'in_person' ? 'In person' : 'Text'}
              </button>
            ))}
          </div>
        </div>
        {draft.method !== 'in_person' && (
          <div>
            <label className="label">
              {draft.method === 'phone' ? 'Number you called' : 'Number texted'}
            </label>
            <input
              className="input"
              type="tel"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            />
          </div>
        )}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label className="label" htmlFor={whenId}>
              When they OK’d it
            </label>
            <button
              type="button"
              className="text-xs"
              style={{ color: 'var(--accent2)' }}
              onClick={() => {
                if (limit.kind === 'now' && setLimit) {
                  // Re-reading the clock keeps the field's max, and the future
                  // warning, in step with a sheet left open a while.
                  const n = nowLocalInput()
                  setLimit({ at: n, kind: 'now' })
                  setDraft({ ...draft, when: n })
                  return
                }
                // Correcting one: the latest it can have been given is the
                // moment it was written down, so that is what this fills in.
                setDraft({ ...draft, when: limit.at })
              }}
            >
              {limit.kind === 'now' ? 'Now' : 'When you wrote it down'}
            </button>
          </div>
          <input
            id={whenId}
            className="input"
            type="datetime-local"
            value={draft.when}
            max={limit.at || undefined}
            onChange={(e) => setDraft({ ...draft, when: e.target.value })}
          />
          {limit.kind === 'recorded' && (
            <p className="pt-1 text-xs" style={{ color: 'var(--text3)' }}>
              You wrote this one down at {whenWords(limit.at)}, so it can’t have been given after
              that. That time stays as it is — only what the customer said changes here.
            </p>
          )}
        </div>
        <div>
          <label className="label">New total before tax</label>
          <input
            className="input"
            inputMode="decimal"
            value={draft.total}
            onChange={(e) => setDraft({ ...draft, total: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">What they OK’d</label>
          <input
            className="input"
            placeholder="e.g. the extra hour freeing the seized bolts"
            value={draft.what}
            onChange={(e) => setDraft({ ...draft, what: e.target.value })}
          />
        </div>
      </div>
      {futureNote && <p className="text-xs" style={{ color: 'var(--status-stop-fg)' }}>{futureNote}</p>}
      {lateNote && <p className="text-xs" style={{ color: 'var(--status-wait-fg)' }}>{lateNote}</p>}
    </>
  )
}

/**
 * The OKs already on a job, for the OWNER — with a way to correct one.
 *
 * The owner recorded the wrong time on an OK (2026-09-14) and nothing could fix
 * it. Alaska wants the date and time of the customer's OK on the invoice
 * (AS 45.45.170(d)), so a wrong time left uncorrectable is worse than a
 * corrected one: the goal of an edit is an ACCURATE record. Nothing here
 * rewrites history quietly — recorded_at keeps the moment the shop wrote the OK
 * down, and a corrected row says so on its face.
 *
 * Correcting or deleting one re-derives the whole chain in the database
 * (rebuild_job_ok_chain, 0044): each OK's previous_ceiling is the one before
 * it, so a changed amount, or a changed time that reorders them, would
 * otherwise leave the approved CEILING wrong and the invoice guard with it.
 *
 * Nothing shows once an invoice is sent or paid: that invoice printed this
 * trail, and an issued invoice is corrected by voiding and reissuing.
 */
export function RecordedOks({
  jobId,
  oks,
  lines,
  locked,
  onChanged,
}: {
  jobId: string
  oks: JobOk[]
  lines: PartLine[]
  /** A sent or paid invoice froze the bill — and this trail with it. */
  locked: boolean
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState<JobOk | null>(null)
  const [draft, setDraft] = useState<OkDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  /** Something the owner must still go and do — not an error, not a success. */
  const [warn, setWarn] = useState<string | null>(null)

  const latestPurchase = useMemo(() => latestPurchaseDate(lines), [lines])
  const limit: OkLimit | null = editing
    ? { at: localInputFromIso(editing.recorded_at), kind: 'recorded' }
    : null

  function startEdit(ok: JobOk) {
    setMsg(null)
    setDone(null)
    setWarn(null)
    setEditing(ok)
    setDraft({
      name: ok.by_name,
      method: ok.method,
      phone: ok.phone_called ?? '',
      when: localInputFromIso(ok.authorized_at),
      total: centsToInput(ok.new_total_cents),
      what: ok.description,
    })
  }

  /**
   * The approved ceiling just moved, so a DRAFT invoice is stale — and a stale
   * draft goes on billing the customer the old figure on their statement. It
   * follows here, and a refusal is reported rather than swallowed.
   */
  async function settle(summary: string) {
    let draftNote = ''
    try {
      const { invoiceNumber, blocked } = await refreshDraftInvoice(jobId)
      if (invoiceNumber) draftNote = ` ${invoiceNumber} was updated to match.`
      if (blocked) setWarn(blocked)
    } catch (e) {
      setWarn(
        `The OK record is up to date, but its draft invoice still shows the old figures — open the invoice and tap “Update from job”. (${
          e instanceof Error ? e.message : String(e)
        })`,
      )
    }
    setEditing(null)
    setDraft(null)
    setBusy(false)
    await onChanged()
    setDone(`${summary}${draftNote}`)
  }

  async function saveEdit() {
    if (!editing || !draft || !limit || busy) return
    const problem = okProblem(draft, limit)
    if (problem) return setMsg(problem)
    const total = parseMoney(draft.total)
    if (total == null) return setMsg('Type the new total before tax, like 2075.03.')
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.rpc('update_job_ok', {
      p_id: editing.id,
      p_authorized_at: new Date(draft.when).toISOString(),
      p_by_name: draft.name.trim(),
      p_method: draft.method,
      p_phone: draft.method === 'in_person' ? null : draft.phone.trim() || null,
      p_description: draft.what.trim(),
      p_new_total_cents: total,
    })
    if (error) {
      setBusy(false)
      setMsg(plainDbError(error.message))
      return
    }
    const authorized = (data as { authorized_cents?: number } | null)?.authorized_cents
    await settle(
      authorized != null
        ? `Corrected — the approved total stands at ${formatCents(authorized)} before tax. The invoice prints it as corrected.`
        : 'Corrected — the invoice prints it as corrected.',
    )
  }

  async function removeOk(ok: JobOk) {
    if (busy) return
    const ok_ = window.confirm(
      `Delete the OK “${ok.description}” for ${formatCents(ok.new_total_cents)}, given ${whenWords(
        localInputFromIso(ok.authorized_at),
      )}? The approved total drops back to what was OK’d before it, and this can’t be undone.`,
    )
    if (!ok_) return
    setBusy(true)
    setMsg(null)
    setDone(null)
    setWarn(null)
    const { data, error } = await supabase.rpc('delete_job_ok', { p_id: ok.id })
    if (error) {
      setBusy(false)
      setMsg(plainDbError(error.message))
      return
    }
    const authorized = (data as { authorized_cents?: number } | null)?.authorized_cents
    await settle(
      authorized != null
        ? `Deleted — the approved total drops to ${formatCents(authorized)} before tax.`
        : 'Deleted.',
    )
  }

  if (!oks.length && !done && !warn && !msg) return null

  return (
    <div className="card space-y-2">
      <span className="label !mb-0">Extra work the customer OK’d</span>
      {oks.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          Alaska law (AS 45.45.170) wants each OK over the estimate on record with the new total,
          who said yes, when, and for a call the number you called. These print on the invoice.
        </p>
      )}

      {oks.map((ok, i) => {
        const delta = ok.delta_cents ?? ok.new_total_cents - ok.previous_ceiling_cents
        if (editing?.id === ok.id && draft && limit) {
          return (
            <div key={ok.id} className="panel-in space-y-2 rounded-lg p-2" style={{ background: 'var(--bg3)' }}>
              <div className="label !mb-0">Correct this OK</div>
              <OkFields
                draft={draft}
                setDraft={setDraft}
                limit={limit}
                latestPurchase={latestPurchase}
                callPhone={null}
              />
              {msg && <p className="text-sm" style={{ color: 'var(--status-stop-fg)' }}>{msg}</p>}
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={saveEdit}>
                  {busy ? 'Saving…' : 'Save the correction'}
                </button>
                <button
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => {
                    setEditing(null)
                    setDraft(null)
                    setMsg(null)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )
        }
        return (
          <div
            key={ok.id}
            // One OK reads as one block: without a rule between them three
            // short lines each ran into the next one's description.
            className={i > 0 ? 'space-y-1 border-t pt-2' : 'space-y-1'}
            style={i > 0 ? { borderColor: 'var(--border-default)' } : undefined}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <span className="min-w-0 break-words text-sm">{ok.description}</span>
              <span className="money flex-none text-sm">{formatCents(ok.new_total_cents)}</span>
            </div>
            <div className="text-xs" style={{ color: 'var(--text2)' }}>
              {whenWords(localInputFromIso(ok.authorized_at))} · {ok.by_name} ·{' '}
              {METHOD_WORDS[ok.method] ?? ok.method}
              {ok.phone_called ? `, called ${ok.phone_called}` : ''}
            </div>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>
              {formatCents(delta)} more than the {formatCents(ok.previous_ceiling_cents)} approved
              before it
              {/* The owner's record of going back over the row. It stays here:
                  the invoice prints the facts of the approval, not the app's
                  edit history. */}
              {ok.corrected_at ? ` · corrected ${dayWords(ok.corrected_at)}` : ''}
            </div>
            {!locked && !editing && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button className="btn btn-sm" disabled={busy} onClick={() => startEdit(ok)}>
                  Edit
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={busy}
                  onClick={() => removeOk(ok)}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        )
      })}

      {locked && oks.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--status-wait-fg)' }}>
          An invoice is already sent or paid, so it printed these as they stand and they can’t be
          changed from here. Void and reissue it if one of them is wrong.
        </p>
      )}

      {msg && !editing && <p className="text-sm" style={{ color: 'var(--status-stop-fg)' }}>{msg}</p>}
      {done && (
        <p className="flash-in text-sm" style={{ color: 'var(--green)' }} role="status">
          {done}
        </p>
      )}
      {warn && (
        <p className="flash-in text-sm" style={{ color: 'var(--status-wait-fg)' }} role="alert">
          {warn}
        </p>
      )}
    </div>
  )
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

  const [okDraft, setOkDraft] = useState<OkDraft>({
    name: '',
    method: 'phone',
    phone: '',
    when: '',
    total: '',
    what: '',
  })
  /** The clock when the sheet opened. Captured so nothing reads it during render. */
  const [okLimit, setOkLimit] = useState<OkLimit>({ at: '', kind: 'now' })

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
  const latestPurchase = latestPurchaseDate(lines)

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
    const openedAt = nowLocalInput()
    setOkDraft({
      name: customer?.name ?? '',
      method: 'phone',
      phone: customer?.phone ?? '',
      when: openedAt,
      total: auth ? centsToInput(auth.current_cents) : '',
      what: '',
    })
    setOkLimit({ at: openedAt, kind: 'now' })
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
    const problem = okProblem(okDraft, okLimit)
    if (problem) return setMsg(problem)
    const total = parseMoney(okDraft.total)
    if (total == null) return setMsg('Type the new total before tax, like 2075.03.')
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('record_job_ok', {
      p_job_id: jobId,
      p_new_total_cents: total,
      p_description: okDraft.what.trim(),
      p_method: okDraft.method,
      p_by_name: okDraft.name.trim(),
      p_phone: okDraft.method === 'in_person' ? null : okDraft.phone.trim() || null,
      p_authorized_at: new Date(okDraft.when).toISOString(),
    })
    setBusy(false)
    if (error) {
      setMsg(plainDbError(error.message))
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
      setMsg(plainDbError(failed.error.message))
      return
    }
    setSheet(null)
    await onChanged()
    if (proceed) await onProceed()
  }

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
          <OkFields
            draft={okDraft}
            setDraft={setOkDraft}
            limit={okLimit}
            setLimit={setOkLimit}
            latestPurchase={latestPurchase}
            callPhone={customer?.phone ?? null}
          />
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
