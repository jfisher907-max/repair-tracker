'use client'

import { useState } from 'react'
import HangarModal from './HangarModal'
import { updateSession, type HangarSession } from '@/lib/hangar'
import { AIRCRAFT, HANGARS, fmtDur, toLocalInput } from '@/lib/hangar-stats'

export default function EditSessionModal({
  session,
  onClose,
  onSaved,
}: {
  session: HangarSession
  onClose: () => void
  onSaved: () => void
}) {
  const [aircraft, setAircraft] = useState(session.aircraft)
  const [hangar, setHangar] = useState(session.hangar)
  const [entry, setEntry] = useState(toLocalInput(new Date(session.entry)))
  const [exit, setExit] = useState(session.exit ? toLocalInput(new Date(session.exit)) : '')
  const [reason, setReason] = useState(session.exit_reason || session.reason || '')
  const [note, setNote] = useState(session.exit_note || session.note || '')
  const [error, setError] = useState('')

  let preview = 'Set an entry date and time'
  if (entry) {
    if (!exit) preview = `${aircraft} in ${hangar} · still in hangar`
    else if (new Date(exit) > new Date(entry))
      preview = `${aircraft} in ${hangar} · ${fmtDur(new Date(exit).getTime() - new Date(entry).getTime())}`
    else preview = 'Exit must be after the entry time'
  }

  async function save() {
    setError('')
    if (!entry) return setError('Entry time is required.')
    if (exit && new Date(exit) <= new Date(entry)) return setError('Exit must be after the entry time.')
    try {
      await updateSession(session.id, { aircraft, hangar, entry, exit, reason: reason.trim(), note: note.trim() })
      onSaved()
      onClose()
    } catch {
      setError('Save failed — check connection.')
    }
  }

  return (
    <HangarModal title="Edit session" onClose={onClose}>
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
          <div className="label">Hangar</div>
          <select className="select w-full" value={hangar} onChange={(e) => setHangar(e.target.value)}>
            {HANGARS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <div className="label">Entry</div>
          <input
            type="datetime-local"
            className="input w-full"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <div className="label">Exit (blank = still in hangar)</div>
          <input type="datetime-local" className="input w-full" value={exit} onChange={(e) => setExit(e.target.value)} />
        </div>
        <div>
          <div className="label">Reason (optional)</div>
          <input
            type="text"
            className="input w-full"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason…"
          />
        </div>
        <div>
          <div className="label">Note (optional)</div>
          <input
            type="text"
            className="input w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note…"
          />
        </div>
      </div>
      <div className="stat-tile mt-3 text-sm" style={{ color: 'var(--text2)' }}>
        {preview}
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-primary" onClick={save}>
          Save changes
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </HangarModal>
  )
}
