'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import { statusChipClass } from '@/lib/billing'
import { formatDate } from '@/lib/date'
import {
  RECOMMENDATION_STATUSES,
  statusColors,
  type Recommendation,
  type RecommendationStatus,
} from '@/lib/recommendations'

/**
 * The recommendations on one job: what was flagged for next time, each with a
 * status so it can actually be chased. Used on the job page; the same rows
 * feed the cross-vehicle worklist.
 */
export default function RecommendationList({
  jobId,
  vehicleId,
  items,
  onChanged,
}: {
  jobId: string
  vehicleId: string
  items: Recommendation[]
  onChanged: () => void | Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ description: '', target_date: '', estimate: '' })

  function resetDraft() {
    setDraft({ description: '', target_date: '', estimate: '' })
    setEditingId(null)
    setAdding(false)
  }

  async function save() {
    if (!draft.description.trim()) {
      alert('Say what needs doing.')
      return
    }
    setBusy(true)
    const payload = {
      job_id: jobId,
      vehicle_id: vehicleId,
      description: draft.description.trim(),
      target_date: draft.target_date || null,
      estimate_cents: parseMoney(draft.estimate),
    }
    const res = editingId
      ? await supabase.from('recommendations').update(payload).eq('id', editingId)
      : await supabase.from('recommendations').insert(payload)
    setBusy(false)
    if (res.error) {
      alert(res.error.message)
      return
    }
    resetDraft()
    await onChanged()
  }

  async function setStatus(r: Recommendation, status: RecommendationStatus) {
    const { error } = await supabase
      .from('recommendations')
      .update({
        status,
        // "Done" is the only status that closes the item out.
        resolved_at: status === 'done' ? new Date().toISOString() : null,
      })
      .eq('id', r.id)
    if (error) alert(error.message)
    else await onChanged()
  }

  async function remove(r: Recommendation) {
    if (!confirm('Delete this recommendation?')) return
    const { error } = await supabase.from('recommendations').delete().eq('id', r.id)
    if (error) alert(error.message)
    else await onChanged()
  }

  return (
    <div className="space-y-2">
      {items.length === 0 && !adding && (
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          Nothing flagged. Note anything the customer should plan for — it follows the vehicle
          and lands on their invoice.
        </p>
      )}

      {items.map((r) => (
        <div
          key={r.id}
          className="rounded-lg border p-2"
          style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap text-sm">{r.description}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--text3)' }}>
                <span className={statusChipClass(r.status)}>{r.status}</span>
                {r.target_date && <span>by {formatDate(r.target_date)}</span>}
                {r.estimate_cents != null && (
                  <span className="money">~{formatCents(r.estimate_cents)}</span>
                )}
              </div>
            </div>
            <div className="flex flex-none items-center gap-1">
              <button
                className="btn btn-sm !px-2"
                aria-label="Edit recommendation"
                onClick={() => {
                  setEditingId(r.id)
                  setAdding(true)
                  setDraft({
                    description: r.description,
                    target_date: r.target_date ?? '',
                    estimate: r.estimate_cents != null ? centsToInput(r.estimate_cents) : '',
                  })
                }}
              >
                ✎
              </button>
              <button className="btn btn-sm btn-danger !px-2" aria-label="Delete recommendation" onClick={() => remove(r)}>
                ✕
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {RECOMMENDATION_STATUSES.map((s) => (
              <button
                key={s.value}
                className="btn btn-sm !px-2 !text-xs"
                style={r.status === s.value ? { borderColor: statusColors[s.value], color: statusColors[s.value] } : undefined}
                onClick={() => setStatus(r, s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {adding ? (
        <div className="panel-in space-y-2 rounded-lg border p-2" style={{ borderColor: 'var(--border2)' }}>
          <textarea
            className="textarea !min-h-[64px]"
            placeholder="Rear pads at 4mm — plan replacement within about 6 months."
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Do it by (optional)</label>
              <input
                className="input !min-h-[40px]"
                type="date"
                value={draft.target_date}
                onChange={(e) => setDraft({ ...draft, target_date: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Rough price (optional)</label>
              <input
                className="input !min-h-[40px]"
                inputMode="decimal"
                placeholder="450"
                value={draft.estimate}
                onChange={(e) => setDraft({ ...draft, estimate: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : editingId ? 'Save' : 'Add'}
            </button>
            <button className="btn btn-sm" onClick={resetDraft}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn btn-sm w-full" onClick={() => setAdding(true)}>
          + Flag something for next time
        </button>
      )}
    </div>
  )
}
