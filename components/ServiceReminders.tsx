'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate, todayLocalIso } from '@/lib/date'
import { formatMiles } from '@/lib/money'
import {
  FALLBACK_MILES_PER_DAY,
  addDays,
  listForVehicle,
  milesPerDay,
  projectDue,
  type OdometerReading,
  type VehicleReminder,
} from '@/lib/reminders'

const QUICK_NAMES = ['Oil change', 'Tire rotation', 'Brake check', 'Coolant flush']

interface Draft {
  name: string
  interval_miles: string
  interval_months: string
  last_done_date: string
  last_done_miles: string
}

/**
 * Interval work the shop tracks per vehicle — oil, rotation, coolant — with a
 * due date projected from this vehicle's own odometer history. Lives on the
 * vehicle page; anything coming due also surfaces on Follow-ups.
 */
export default function ServiceReminders({
  vehicleId,
  readings,
}: {
  vehicleId: string
  readings: OdometerReading[]
}) {
  const [reminders, setReminders] = useState<VehicleReminder[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const latestMiles = readings.length
    ? readings.reduce((a, b) => (b.date > a.date ? b : a)).miles
    : null
  const rate = milesPerDay(readings)

  const load = useCallback(async () => {
    try {
      setReminders(await listForVehicle(vehicleId))
    } catch (e) {
      alert(`Couldn't load service reminders: ${e instanceof Error ? e.message : e}`)
      setReminders([])
    }
  }, [vehicleId])

  useEffect(() => {
    load()
  }, [load])

  function startAdd() {
    setDraft({
      name: '',
      interval_miles: '',
      interval_months: '',
      last_done_date: todayLocalIso(),
      last_done_miles: latestMiles != null ? String(latestMiles) : '',
    })
    setAdding(true)
  }

  async function save() {
    if (!draft || saving) return
    const name = draft.name.trim()
    const miles = draft.interval_miles.trim() ? Number(draft.interval_miles) : null
    const months = draft.interval_months.trim() ? Number(draft.interval_months) : null
    const lastMiles = draft.last_done_miles.trim() ? Number(draft.last_done_miles) : null
    if (!name) return alert('Give the reminder a name.')
    if (miles == null && months == null)
      return alert('Set a mileage interval, a month interval, or both.')
    if ((miles != null && !(miles > 0)) || (months != null && !(months > 0)))
      return alert('Intervals must be positive numbers.')
    if (!draft.last_done_date) return alert('When was it last done?')
    if (lastMiles != null && !(lastMiles >= 0)) return alert('That isn’t an odometer reading.')
    // A mileage-only reminder with no baseline can never project a date — it
    // would save fine and then silently never come due anywhere.
    if (miles != null && months == null && lastMiles == null)
      return alert(
        'A mileage reminder needs the odometer reading when it was last done — without it there’s nothing to count from.',
      )
    setSaving(true)
    try {
      const { error } = await supabase.from('vehicle_reminders').insert({
        vehicle_id: vehicleId,
        name,
        interval_miles: miles,
        interval_months: months,
        last_done_date: draft.last_done_date,
        last_done_miles: lastMiles,
      })
      if (error) return alert(error.message)
      setAdding(false)
      setDraft(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function markDone(r: VehicleReminder) {
    // Months-only reminders leave last_done_miles alone; only mileage-based
    // ones collect a reading, and a blank answer keeps the previous one
    // rather than wiping the baseline the projection depends on.
    const patch: { last_done_date: string; last_done_miles?: number } = {
      last_done_date: todayLocalIso(),
    }
    if (r.interval_miles != null) {
      const suggestion =
        latestMiles != null
          ? String(latestMiles)
          : r.last_done_miles != null
            ? String(r.last_done_miles)
            : ''
      const answer = prompt(`Odometer today for “${r.name}”?`, suggestion)
      if (answer == null) return
      const miles = answer.trim() ? Number(answer.replace(/[,\s]/g, '')) : r.last_done_miles
      if (miles == null)
        return alert('Need the odometer reading — a mileage reminder can’t count without it.')
      if (!(miles >= 0)) return alert('That isn’t a mileage.')
      patch.last_done_miles = miles
    }
    const { error } = await supabase.from('vehicle_reminders').update(patch).eq('id', r.id)
    if (error) return alert(error.message)
    await load()
  }

  async function remove(r: VehicleReminder) {
    if (!confirm(`Stop tracking “${r.name}” for this vehicle?`)) return
    const { error } = await supabase.from('vehicle_reminders').delete().eq('id', r.id)
    if (error) return alert(error.message)
    await load()
  }

  const today = todayLocalIso()
  const soon = addDays(today, 30)

  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <span className="label !mb-0">Service reminders</span>
        {!adding && (
          <button className="btn btn-sm" onClick={startAdd}>
            + Add
          </button>
        )}
      </div>

      {reminders == null ? (
        <p className="text-sm" style={{ color: 'var(--text3)' }}>Loading…</p>
      ) : reminders.length === 0 && !adding ? (
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          Track interval work — oil, rotation, coolant — and this vehicle&apos;s own driving
          pace turns “in 5,000 miles” into a date worth a text.
        </p>
      ) : (
        reminders.map((r) => {
          const p = projectDue(r, readings)
          const overdue = p != null && p.due_date < today
          const dueSoon = p != null && !overdue && p.due_date <= soon
          const interval = [
            r.interval_miles != null ? `${formatMiles(r.interval_miles)} mi` : null,
            r.interval_months != null ? `${r.interval_months} mo` : null,
          ]
            .filter(Boolean)
            .join(' / ')
          return (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="min-w-0">
                <span className="font-semibold">{r.name}</span>{' '}
                <span style={{ color: 'var(--text3)' }}>every {interval}</span>
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  last done {formatDate(r.last_done_date)}
                  {r.last_done_miles != null && ` at ${formatMiles(r.last_done_miles)} mi`}
                  {p && (
                    <>
                      {' · '}
                      <span
                        style={
                          overdue
                            ? { color: 'var(--red)', fontWeight: 600 }
                            : dueSoon
                              ? { color: 'var(--orange)', fontWeight: 600 }
                              : undefined
                        }
                      >
                        {overdue ? 'was due ' : 'due '}
                        {formatDate(p.due_date)}
                        {p.due_miles != null && ` (~${formatMiles(p.due_miles)} mi)`}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-none items-center gap-2">
                <button className="btn btn-sm" onClick={() => markDone(r)}>
                  ✓ Done today
                </button>
                <button className="btn btn-sm" onClick={() => remove(r)} aria-label={`Delete ${r.name}`}>
                  🗑
                </button>
              </div>
            </div>
          )
        })
      )}

      {adding && draft && (
        <form
          className="space-y-2 border-t pt-2"
          style={{ borderColor: 'var(--border)' }}
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="flex flex-wrap gap-1">
            {QUICK_NAMES.map((n) => (
              <button
                key={n}
                type="button"
                className="chip"
                style={{ background: 'var(--bg3)', cursor: 'pointer' }}
                onClick={() => setDraft({ ...draft, name: n })}
              >
                {n}
              </button>
            ))}
          </div>
          <input
            className="input"
            placeholder="What gets done — e.g. Oil change"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="label">Every (miles)</span>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                placeholder="5000"
                value={draft.interval_miles}
                onChange={(e) => setDraft({ ...draft, interval_miles: e.target.value })}
              />
            </div>
            <div>
              <span className="label">Every (months)</span>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                placeholder="6"
                value={draft.interval_months}
                onChange={(e) => setDraft({ ...draft, interval_months: e.target.value })}
              />
            </div>
            <div>
              <span className="label">Last done</span>
              <input
                className="input"
                type="date"
                value={draft.last_done_date}
                onChange={(e) => setDraft({ ...draft, last_done_date: e.target.value })}
              />
            </div>
            <div>
              <span className="label">Odometer then</span>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                placeholder={latestMiles != null ? String(latestMiles) : 'miles'}
                value={draft.last_done_miles}
                onChange={(e) => setDraft({ ...draft, last_done_miles: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Set miles, months, or both — it comes due at whichever lands first.{' '}
            {rate != null
              ? `This vehicle runs ~${Math.round(rate)} mi/day by its own history.`
              : `Until there are two odometer readings, dates assume ${FALLBACK_MILES_PER_DAY} mi/day.`}
          </p>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save reminder'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setAdding(false)
                setDraft(null)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
