'use client'

import Link from 'next/link'
import { use, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/date'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import { TEMPLATES } from '@/lib/inspection-templates'
import {
  addItem,
  batteryRating,
  inspectionErrorWords,
  loadInspection,
  RATINGS,
  removeItem,
  snapshotLabel,
  suggestVerdict,
  treadRating,
  updateInspection,
  updateItem,
  vehicleSnapshot,
  VERDICTS,
  type BatteryMeasure,
  type Inspection,
  type InspectionItem,
  type Rating,
  type TreadMeasure,
} from '@/lib/inspections'
import type { Vehicle } from '@/lib/types'

const RATING_STYLE: Record<Rating, { bg: string; fg: string }> = {
  ok: { bg: 'var(--status-ok-bg)', fg: 'var(--status-ok-fg)' },
  watch: { bg: 'var(--status-wait-bg)', fg: 'var(--status-wait-fg)' },
  attention: { bg: 'var(--status-stop-bg)', fg: 'var(--status-stop-fg)' },
  not_checked: { bg: 'var(--status-idle-bg)', fg: 'var(--status-idle-fg)' },
  na: { bg: 'var(--status-idle-bg)', fg: 'var(--status-idle-fg)' },
}
const TIRES: (keyof TreadMeasure)[] = ['lf', 'rf', 'lr', 'rr', 'spare']
const TIRE_LABEL: Record<keyof TreadMeasure, string> = { lf: 'LF', rf: 'RF', lr: 'LR', rr: 'RR', spare: 'Spare' }

function toInt(s: string): number | null {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Fill in a pre-buy inspection (0067) — phone-first: one tap per rating, a
 * note and a cost range where it matters, tire and battery numbers in quick
 * fields that suggest the rating. Items can be added or skipped while it is a
 * draft ("options to adjust things as necessary", owner 2026-10-05). Finalize
 * freezes it; then it is shared by its own link.
 */
export default function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [ins, setIns] = useState<Inspection | null>(null)
  const [items, setItems] = useState<InspectionItem[]>([])
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState<Record<string, string>>({})
  const [confirmVoid, setConfirmVoid] = useState(false)

  async function reload() {
    try {
      const r = await loadInspection(id)
      setIns(r.inspection)
      setItems(r.items)
      const { data } = await supabase.from('jobs').select('vehicle:vehicles(*)').eq('id', r.inspection.job_id).single()
      setVehicle(((data as unknown as { vehicle: Vehicle | null }) ?? { vehicle: null }).vehicle)
    } catch (e) {
      setError(inspectionErrorWords(e, 'open this inspection'))
    }
  }

  useEffect(() => {
    let alive = true
    loadInspection(id)
      .then(async (r) => {
        if (!alive) return
        setIns(r.inspection)
        setItems(r.items)
        const { data } = await supabase.from('jobs').select('vehicle:vehicles(*)').eq('id', r.inspection.job_id).single()
        if (alive) setVehicle(((data as unknown as { vehicle: Vehicle | null }) ?? { vehicle: null }).vehicle)
      })
      .catch((e) => alive && setError(inspectionErrorWords(e, 'open this inspection')))
    return () => {
      alive = false
    }
  }, [id])

  const sections = useMemo(() => {
    const out: { section: string; items: InspectionItem[] }[] = []
    for (const it of items) {
      const last = out[out.length - 1]
      if (last && last.section === it.section) last.items.push(it)
      else out.push({ section: it.section, items: [it] })
    }
    return out
  }, [items])

  if (error) return <p style={{ color: 'var(--red)' }}>{error}</p>
  if (!ins) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  const draft = ins.status === 'draft'
  const unrated = items.filter((i) => !i.rating)
  const counts = {
    attention: items.filter((i) => i.rating === 'attention').length,
    watch: items.filter((i) => i.rating === 'watch').length,
    notChecked: items.filter((i) => i.rating === 'not_checked').length,
  }
  const suggested = suggestVerdict(items)
  const reportUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/r/${ins.public_token}`

  function patchLocal(itemId: string, patch: Partial<InspectionItem>) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)))
  }

  async function saveItem(itemId: string, patch: Partial<InspectionItem>) {
    patchLocal(itemId, patch)
    try {
      await updateItem(itemId, patch)
    } catch (e) {
      setMsg(inspectionErrorWords(e, 'save that item'))
      await reload()
    }
  }

  async function saveIns(patch: Partial<Inspection>) {
    setIns((prev) => (prev ? { ...prev, ...patch } : prev))
    try {
      await updateInspection(id, patch)
    } catch (e) {
      setMsg(inspectionErrorWords(e, 'save the report'))
      await reload()
    }
  }

  async function saveMeasure(it: InspectionItem, measure: TreadMeasure & BatteryMeasure) {
    const auto = it.measure_kind === 'tread' ? treadRating(measure) : batteryRating(measure)
    // The numbers set the rating until the owner picks one by hand.
    const patch: Partial<InspectionItem> = { measure }
    if (auto && (!it.rating || it.rating === 'ok' || it.rating === 'watch' || it.rating === 'attention')) patch.rating = auto
    await saveItem(it.id, patch)
  }

  async function add(section: string) {
    const label = (adding[section] ?? '').trim()
    if (!label) return
    const inSection = items.filter((i) => i.section === section)
    const position = (inSection[inSection.length - 1]?.position ?? 0) + 1
    try {
      const row = await addItem(id, section, position, label)
      setItems((prev) => [...prev, row].sort((a, b) => a.position - b.position))
      setAdding((a) => ({ ...a, [section]: '' }))
    } catch (e) {
      setMsg(inspectionErrorWords(e, 'add that item'))
    }
  }

  async function remove(itemId: string) {
    try {
      await removeItem(itemId)
      setItems((prev) => prev.filter((i) => i.id !== itemId))
    } catch (e) {
      setMsg(inspectionErrorWords(e, 'remove that item'))
    }
  }

  async function restNotChecked() {
    setBusy(true)
    for (const it of unrated) await saveItem(it.id, { rating: 'not_checked', note: it.note || 'Not checked this visit' })
    setBusy(false)
  }

  async function finalize() {
    setMsg(null)
    if (unrated.length > 0) {
      setMsg(`Rate every item first — ${unrated.length} left. Use “Mark the rest Not checked” for anything you skipped.`)
      return
    }
    setBusy(true)
    try {
      await updateInspection(id, {
        status: 'final',
        verdict: ins!.verdict ?? suggested,
        finalized_at: new Date().toISOString(),
        vehicle_snapshot: vehicleSnapshot(vehicle),
      })
      await reload()
      setMsg('Report finalized ✓ — share it from here or the job page.')
    } catch (e) {
      setMsg(inspectionErrorWords(e, 'finalize the report'))
    }
    setBusy(false)
  }

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: `Pre-purchase inspection ${ins!.report_number}`, url: reportUrl })
      else {
        await navigator.clipboard.writeText(reportUrl)
        setMsg('Link copied — text it to the customer ✓')
      }
    } catch {
      /* share sheet closed */
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-24">
      <div className="card space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl">
            Pre-buy {ins.report_number}{' '}
            <span className="text-base" style={{ color: 'var(--text3)' }}>
              {TEMPLATES[ins.package].name}
            </span>
          </h1>
          <span className="chip">{draft ? 'In progress' : ins.status === 'final' ? 'Final' : 'Void'}</span>
        </div>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          {snapshotLabel(ins.vehicle_snapshot ?? vehicleSnapshot(vehicle)) || 'Vehicle'} ·{' '}
          <Link href={`/jobs/${ins.job_id}`} style={{ color: 'var(--blue)' }}>
            back to the job
          </Link>
        </p>
      </div>

      {msg && (
        <p className="text-sm" style={{ color: msg.includes('✓') ? 'var(--green)' : 'var(--red)' }} role="status">
          {msg}
        </p>
      )}

      {/* The report, once final: share it, turn its link off, or void it. */}
      {!draft && (
        <div className="card space-y-2">
          {ins.status === 'final' && (
            <>
              <div className="flex flex-wrap gap-2">
                <a className="btn btn-primary" href={`/r/${ins.public_token}`} target="_blank" rel="noopener">
                  Open the report
                </a>
                {!ins.link_revoked_at && (
                  <button className="btn" onClick={share}>
                    Share the link
                  </button>
                )}
                <button
                  className="btn"
                  onClick={() => saveIns({ link_revoked_at: ins.link_revoked_at ? null : new Date().toISOString() })}
                >
                  {ins.link_revoked_at ? 'Turn the link back on' : 'Turn the link off'}
                </button>
              </div>
              <p className="text-xs" style={{ color: 'var(--text3)' }}>
                {ins.link_revoked_at
                  ? 'The link is off: anyone who has it sees “not available”, and the invoice no longer shows it.'
                  : 'Anyone with the link can read the report. It also shows on this job’s invoice.'}
              </p>
              {!confirmVoid ? (
                <button className="btn btn-sm btn-danger" onClick={() => setConfirmVoid(true)}>
                  Void this report
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>Void {ins.report_number}? Its link stops working; start a new one to change anything.</span>
                  <button className="btn btn-sm btn-danger" onClick={() => saveIns({ status: 'void' })}>
                    Void
                  </button>
                  <button className="btn btn-sm" onClick={() => setConfirmVoid(false)}>
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
          {ins.status === 'void' && <p className="text-sm">This report is void. Start a new one from the job.</p>}
        </div>
      )}

      {/* The report's details. */}
      <div className="card grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">Prepared for</span>
          <input
            className="input"
            disabled={!draft}
            defaultValue={ins.prepared_for ?? ''}
            onBlur={(e) => saveIns({ prepared_for: e.target.value.trim() || null })}
          />
        </label>
        <label className="space-y-1">
          <span className="label">Seller (name only)</span>
          <input
            className="input"
            disabled={!draft}
            defaultValue={ins.seller_name ?? ''}
            onBlur={(e) => saveIns({ seller_name: e.target.value.trim() || null })}
          />
        </label>
        <label className="space-y-1">
          <span className="label">Odometer (miles)</span>
          <input
            className="input"
            inputMode="numeric"
            disabled={!draft}
            defaultValue={ins.odometer_miles ?? ''}
            onBlur={(e) => saveIns({ odometer_miles: toInt(e.target.value) })}
          />
        </label>
        <label className="space-y-1">
          <span className="label">Open recalls (NHTSA, by VIN)</span>
          <input
            className="input"
            disabled={!draft}
            placeholder="e.g. None found as of today"
            defaultValue={ins.recalls_note ?? ''}
            onBlur={(e) => saveIns({ recalls_note: e.target.value.trim() || null })}
          />
        </label>
        <div className="space-y-1 sm:col-span-2">
          <span className="label">Road test</span>
          <div className="flex flex-wrap gap-2">
            {[
              { v: true, l: 'Driven' },
              { v: false, l: 'Not driven' },
            ].map((o) => (
              <button
                key={o.l}
                className={`btn min-h-11 ${ins.road_test_done === o.v ? 'btn-primary' : ''}`}
                disabled={!draft}
                onClick={() => saveIns({ road_test_done: o.v })}
              >
                {o.l}
              </button>
            ))}
          </div>
          {ins.road_test_done === false && (
            <input
              className="input"
              disabled={!draft}
              placeholder="Why not (no plates, unsafe, owner said no)"
              defaultValue={ins.road_test_reason ?? ''}
              onBlur={(e) => saveIns({ road_test_reason: e.target.value.trim() || null })}
            />
          )}
        </div>
      </div>

      {sections.map((s) => (
        <div key={s.section} className="card space-y-3">
          <span className="label !mb-0">{s.section}</span>
          {s.items.map((it) => (
            <div key={it.id} className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm">
                  {it.label}
                  {it.needs && (
                    <span className="ml-2 text-xs" style={{ color: 'var(--text3)' }}>
                      {it.needs}
                    </span>
                  )}
                </span>
                {draft && it.custom && (
                  <button className="btn btn-sm btn-danger !px-1.5 text-xs" aria-label="Remove item" onClick={() => remove(it.id)}>
                    ✕
                  </button>
                )}
              </div>

              {it.measure_kind === 'tread' && (
                <div className="grid grid-cols-5 gap-2">
                  {TIRES.map((t) => (
                    <label key={t} className="space-y-1 text-center">
                      <span className="text-xs" style={{ color: 'var(--text3)' }}>
                        {TIRE_LABEL[t]}
                      </span>
                      <input
                        className="input text-center"
                        inputMode="numeric"
                        disabled={!draft}
                        aria-label={`${TIRE_LABEL[t]} tread in 32nds`}
                        defaultValue={it.measure?.[t] ?? ''}
                        onBlur={(e) => saveMeasure(it, { ...(it.measure ?? {}), [t]: toInt(e.target.value) })}
                      />
                    </label>
                  ))}
                  <span className="col-span-5 text-xs" style={{ color: 'var(--text3)' }}>
                    In 32nds. 6+ OK · 4–5 Watch · 3 or less Needs attention (worst tire, spare not counted).
                  </span>
                </div>
              )}
              {it.measure_kind === 'battery' && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-xs" style={{ color: 'var(--text3)' }}>Rated CCA</span>
                    <input
                      className="input"
                      inputMode="numeric"
                      disabled={!draft}
                      defaultValue={it.measure?.rated_cca ?? ''}
                      onBlur={(e) => saveMeasure(it, { ...(it.measure ?? {}), rated_cca: toInt(e.target.value) })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs" style={{ color: 'var(--text3)' }}>Measured CCA</span>
                    <input
                      className="input"
                      inputMode="numeric"
                      disabled={!draft}
                      defaultValue={it.measure?.measured_cca ?? ''}
                      onBlur={(e) => saveMeasure(it, { ...(it.measure ?? {}), measured_cca: toInt(e.target.value) })}
                    />
                  </label>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Rating for ${it.label}`}>
                {RATINGS.map((r) => {
                  const on = it.rating === r.value
                  return (
                    <button
                      key={r.value}
                      className="btn btn-sm min-h-11"
                      disabled={!draft}
                      aria-pressed={on}
                      title={r.meaning}
                      style={on ? { background: RATING_STYLE[r.value].bg, color: RATING_STYLE[r.value].fg, borderColor: 'transparent' } : undefined}
                      onClick={() => saveItem(it.id, { rating: on ? null : r.value })}
                    >
                      {r.label}
                    </button>
                  )
                })}
              </div>

              {(it.rating === 'watch' || it.rating === 'attention' || it.rating === 'not_checked' || it.note) && (
                <input
                  className="input"
                  disabled={!draft}
                  placeholder={it.rating === 'not_checked' ? 'Why it wasn’t checked' : 'What you found (prints on the report)'}
                  defaultValue={it.note ?? ''}
                  onBlur={(e) => saveItem(it.id, { note: e.target.value.trim() || null })}
                />
              )}
              {ins.show_costs && (it.rating === 'watch' || it.rating === 'attention') && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input"
                    inputMode="decimal"
                    disabled={!draft}
                    placeholder="Rough cost, low ($)"
                    defaultValue={it.cost_low_cents != null ? centsToInput(it.cost_low_cents) : ''}
                    onBlur={(e) => saveItem(it.id, { cost_low_cents: parseMoney(e.target.value) ?? null })}
                  />
                  <input
                    className="input"
                    inputMode="decimal"
                    disabled={!draft}
                    placeholder="Rough cost, high ($)"
                    defaultValue={it.cost_high_cents != null ? centsToInput(it.cost_high_cents) : ''}
                    onBlur={(e) => saveItem(it.id, { cost_high_cents: parseMoney(e.target.value) ?? null })}
                  />
                </div>
              )}
            </div>
          ))}
          {draft && (
            <div className="flex gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <input
                className="input flex-1"
                placeholder="Add an item to this section"
                value={adding[s.section] ?? ''}
                onChange={(e) => setAdding((a) => ({ ...a, [s.section]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && add(s.section)}
              />
              <button className="btn" onClick={() => add(s.section)}>
                Add
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Summary and finalize. */}
      <div className="card space-y-3">
        <span className="label !mb-0">Summary</span>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          {counts.attention} need attention · {counts.watch} to watch · {counts.notChecked} not checked
          {unrated.length > 0 && ` · ${unrated.length} not rated yet`}
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Overall">
          {VERDICTS.map((v) => {
            const on = (ins.verdict ?? suggested) === v.value
            return (
              <button
                key={v.value}
                className={`btn min-h-11 ${on ? 'btn-primary' : ''}`}
                disabled={!draft}
                onClick={() => saveIns({ verdict: v.value })}
              >
                {v.label}
              </button>
            )
          })}
        </div>
        {!ins.verdict && draft && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Suggested from the ratings. It describes what you found, never “buy” or “don’t buy”.
          </p>
        )}
        <textarea
          className="input"
          rows={3}
          disabled={!draft}
          placeholder="A few words for the buyer (optional, prints at the top)"
          defaultValue={ins.summary_note ?? ''}
          onBlur={(e) => saveIns({ summary_note: e.target.value.trim() || null })}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!draft}
            checked={ins.show_costs}
            onChange={(e) => saveIns({ show_costs: e.target.checked })}
          />
          Show rough cost ranges on the report (turn off before it goes to a seller or bank)
        </label>
        <label className="space-y-1">
          <span className="label">Inspected by</span>
          <input
            className="input"
            disabled={!draft}
            placeholder="Your name, as it prints on the report"
            defaultValue={ins.signed_by_name ?? ''}
            onBlur={(e) => saveIns({ signed_by_name: e.target.value.trim() || null })}
          />
        </label>
        {draft && (
          <div className="flex flex-wrap gap-2">
            {unrated.length > 0 && (
              <button className="btn" disabled={busy} onClick={restNotChecked}>
                Mark the rest Not checked
              </button>
            )}
            <button className="btn btn-primary" disabled={busy} onClick={finalize}>
              {busy ? 'Saving…' : 'Finalize the report'}
            </button>
          </div>
        )}
        {draft && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Finalizing locks the report and gives it a link to share. To change it after that, void it and start a new
            one. {formatDate(ins.inspected_on)}
            {items.some((i) => i.cost_low_cents) && ins.show_costs
              ? ` · rough costs so far ${formatCents(items.reduce((s, i) => s + (i.cost_low_cents ?? 0), 0))}+`
              : ''}
          </p>
        )}
      </div>
    </div>
  )
}
