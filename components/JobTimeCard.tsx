'use client'

import { useEffect, useState } from 'react'
import type { Job } from '@/lib/types'
import {
  actualHours,
  clockStartPatch,
  clockStopPatch,
  efficiencyColor,
  efficiencyPct,
  formatClock,
  formatHours,
  formatPct,
  roundHours,
  runningHours,
} from '@/lib/labor-time'

/**
 * Actual time vs book time on one job (0068). Owner only — the job page is
 * the owner's; nothing here reaches an invoice, quote or the customer report.
 *
 * Book = labor_hours (what the job bills). Actual = what Jake logs: a job
 * clock (Start / Stop) or hours typed in, nudged in quarter hours.
 */
export default function JobTimeCard({
  job,
  onUpdate,
}: {
  job: Job
  onUpdate: (patch: Partial<Job>) => Promise<void>
}) {
  const running = !!job.clock_started_at
  const [now, setNow] = useState(() => Date.now())
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  // The running clock ticks on screen; nothing is written until Stop.
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [running])

  const book = Number(job.labor_hours) || 0
  const actual = actualHours(job, now)
  const pct = efficiencyPct(book, actual)

  async function run(patch: Partial<Job>) {
    setBusy(true)
    try {
      await onUpdate(patch)
    } finally {
      setBusy(false)
    }
  }

  function start() {
    if (busy || running) return
    run(clockStartPatch(job))
  }

  function stop() {
    if (busy || !running) return
    run(clockStopPatch(job))
  }

  function openEditor() {
    setInput(actual != null ? String(roundHours(actual)) : '')
    setEditing(true)
  }

  function bump(delta: number) {
    const next = Math.max(0, (Number(input) || 0) + delta)
    setInput(String(roundHours(next)))
  }

  async function save() {
    const raw = input.trim()
    const hours = raw === '' ? null : Number(raw)
    if (hours != null && (!Number.isFinite(hours) || hours < 0)) {
      alert('Hours must be a number, like 1.75.')
      return
    }
    // Typing a total sets the hours outright, so a running clock stops with it.
    await run({ actual_hours: hours == null ? null : roundHours(hours), clock_started_at: null })
    setEditing(false)
  }

  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <span className="label !mb-0">Your time vs book</span>
        {!editing && (
          <button className="btn btn-sm" onClick={openEditor}>
            Adjust
          </button>
        )}
      </div>

      {editing ? (
        <div className="panel-in space-y-2">
          <label className="label" htmlFor="job-actual-hours">Actual hours</label>
          <div className="flex items-center gap-1">
            <button
              className="btn btn-sm !min-h-[44px] !px-3"
              aria-label="A quarter hour less"
              onClick={() => bump(-0.25)}
            >
              −
            </button>
            <input
              id="job-actual-hours"
              className="input !min-h-[44px] text-center"
              inputMode="decimal"
              placeholder="Not tracked"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              className="btn btn-sm !min-h-[44px] !px-3"
              aria-label="A quarter hour more"
              onClick={() => bump(0.25)}
            >
              +
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            The total time you spent. Leave it blank if you didn’t track this job — it stays out of
            your efficiency numbers.{running && ' Saving stops the running clock.'}
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save time'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>Book</div>
              <div className="font-semibold">{book > 0 ? formatHours(book) : '—'}</div>
            </div>
            <div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>Actual</div>
              <div className="font-semibold">{actual != null ? formatHours(actual) : '—'}</div>
            </div>
            <div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>Efficiency</div>
              <div className="font-semibold" style={{ color: efficiencyColor(pct) }}>{formatPct(pct)}</div>
            </div>
          </div>
          {pct != null && actual != null && (
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              {Math.abs(book - actual) < 0.01
                ? 'Right on book.'
                : pct >= 100
                ? `${formatHours(book - actual)} under book.`
                : `${formatHours(actual - book)} over book.`}
            </p>
          )}
          {book <= 0 && (
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              Set the labor hours above to the book time to see efficiency.
            </p>
          )}
          <div className="flex items-center gap-2">
            {running ? (
              <button className="btn btn-primary flex-1 !min-h-[44px]" disabled={busy} onClick={stop}>
                Stop clock · {formatClock(runningHours(job.clock_started_at, now))}
              </button>
            ) : (
              <button className="btn flex-1 !min-h-[44px]" disabled={busy} onClick={start}>
                Start clock
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
