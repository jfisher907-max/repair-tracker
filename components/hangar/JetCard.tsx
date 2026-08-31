'use client'

import type { HangarSession } from '@/lib/hangar'
import { OUT } from '@/lib/hangar'
import { fmtDT, fmtDurFull } from '@/lib/hangar-stats'

const SWITCH = [
  { label: 'Wings', val: 'Wings Hangar', cls: 'hangar-sw-wings' },
  { label: 'ALNW', val: 'ALNW', cls: 'hangar-sw-alnw' },
  { label: 'Out', val: OUT, cls: 'hangar-sw-out' },
]

export default function JetCard({
  aircraft,
  openSession,
  now,
  onSetLocation,
  busy,
}: {
  aircraft: string
  openSession: HangarSession | undefined
  now: number
  onSetLocation: (target: string) => void
  busy: boolean
}) {
  const loc = openSession ? openSession.hangar : OUT
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div className="display text-xl font-semibold">{aircraft}</div>
        {openSession && (
          <div className="hangar-timer text-sm" style={{ color: 'var(--accent2)' }}>
            {fmtDurFull(now - new Date(openSession.entry).getTime())}
          </div>
        )}
      </div>
      <div className="mb-3 mt-0.5 text-sm" style={{ color: 'var(--text3)' }}>
        {openSession ? `In ${openSession.hangar} · since ${fmtDT(openSession.entry)}` : 'Not in a hangar'}
      </div>
      <div className="hangar-switch">
        {SWITCH.map((opt) => (
          <button
            key={opt.val}
            type="button"
            disabled={busy}
            className={`${opt.cls} ${loc === opt.val ? 'on' : ''}`}
            onClick={() => onSetLocation(opt.val)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
