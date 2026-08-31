'use client'

import type { HangarUnavail } from '@/lib/hangar'
import { filterByDate, fmtDT, fmtDur, getUnavailStats, type HangarDateFilter } from '@/lib/hangar-stats'

const THIS_MONTH: HangarDateFilter = { preset: 'this_month', start: null, end: null }

export default function WingsBlock({
  unavail,
  now,
  onToggle,
  busy,
}: {
  unavail: HangarUnavail[]
  now: number
  onToggle: (makeUnavailable: boolean) => void
  busy: boolean
}) {
  const open = unavail.find((u) => !u.end_time)
  const monthHrs = getUnavailStats(filterByDate(unavail, 'start_time', THIS_MONTH)).totalHours

  return (
    <div className={`card ${open ? 'card-line-stop' : 'card-line-ok'}`}>
      <div className="mb-0.5 flex items-center justify-between">
        <div className="display text-lg font-semibold">Wings Hangar</div>
        <span className={`chip ${open ? 'chip-unpaid' : 'chip-paid'}`}>
          {open ? 'Unavailable' : 'Available'}
        </span>
      </div>
      <div className="mb-3 text-sm" style={{ color: 'var(--text3)' }}>
        {open
          ? `Unavailable since ${fmtDT(open.start_time)} · ${fmtDur(now - new Date(open.start_time).getTime())}`
          : 'Usable now — not accruing unavailable time'}
      </div>
      <button
        type="button"
        disabled={busy}
        className={`btn w-full justify-center ${open ? 'btn-primary' : 'btn-danger'}`}
        onClick={() => onToggle(!open)}
      >
        {open ? 'Mark available' : '🚫 Mark unavailable'}
      </button>
      <div className="stat-tile mt-3 flex items-baseline justify-between">
        <span className="text-sm" style={{ color: 'var(--text3)' }}>
          Unavailable this month
        </span>
        <span className="text-xl font-semibold">{monthHrs} hrs</span>
      </div>
    </div>
  )
}
