'use client'

import { useState } from 'react'
import HangarModal from './HangarModal'
import { logPastSession, type HangarSession } from '@/lib/hangar'
import { AIRCRAFT, HANGARS, fmtDT, fmtDur, toLocalInput } from '@/lib/hangar-stats'

export default function PastMoveModal({
  sessions,
  onClose,
  onSaved,
}: {
  sessions: HangarSession[]
  onClose: () => void
  onSaved: () => void
}) {
  const [aircraft, setAircraft] = useState<string>('N254AL')
  const [hangar, setHangar] = useState<string>('Wings Hangar')
  const [arrived, setArrived] = useState<string>(() => toLocalInput(new Date()))
  const [left, setLeft] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [error, setError] = useState<string>('')

  let preview = 'Choose an arrival date and time'
  if (arrived) {
    if (!left) preview = `${aircraft} in ${hangar} · since ${fmtDT(arrived)} · still there`
    else if (new Date(left) > new Date(arrived))
      preview = `${aircraft} in ${hangar} · ${fmtDT(arrived)} → ${fmtDT(left)} · ${fmtDur(new Date(left).getTime() - new Date(arrived).getTime())}`
    else preview = 'Left time must be after the arrived time'
  }

  async function save() {
    setError('')
    if (!arrived) return setError('Choose an arrival date and time.')
    if (left && new Date(left) <= new Date(arrived)) return setError('Left time must be after the arrived time.')
    if (!left) {
      const already = sessions.find((s) => s.aircraft === aircraft && !s.exit)
      if (already)
        return setError(
          `${aircraft} already has an open session in ${already.hangar}. Add a left time, or close the current one first.`,
        )
    }
    try {
      await logPastSession({ aircraft, hangar, entry: arrived, exit: left, note: note.trim() })
      onSaved()
      onClose()
    } catch {
      setError('Save failed — check connection.')
    }
  }

  return (
    <HangarModal title="Log a past move" onClose={onClose}>
      {error && (
        <div className="mb-3 text-sm font-semibold" style={{ color: 'var(--red)' }}>
          ⚠ {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="label">Aircraft</div>
          <select className="select w-full" value={aircraft} onChange={(e) => setAircraft(e.target.value)}>
            {AIRCRAFT.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="label">Location</div>
          <select className="select w-full" value={hangar} onChange={(e) => setHangar(e.target.value)}>
            {HANGARS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <div className="label">Arrived</div>
          <input
            type="datetime-local"
            className="input w-full"
            value={arrived}
            onChange={(e) => setArrived(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <div className="label">Left (optional — leave blank if still there)</div>
          <input type="datetime-local" className="input w-full" value={left} onChange={(e) => setLeft(e.target.value)} />
        </div>
        <div className="col-span-2">
          <div className="label">Note (optional)</div>
          <input
            type="text"
            className="input w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Additional details…"
          />
        </div>
      </div>
      <div className="stat-tile mt-3 text-sm" style={{ color: 'var(--text2)' }}>
        {preview}
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-primary" onClick={save}>
          Save past move
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </HangarModal>
  )
}
