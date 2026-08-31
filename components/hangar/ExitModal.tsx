'use client'

import { useState } from 'react'
import HangarModal from './HangarModal'
import { confirmExit, type HangarSession } from '@/lib/hangar'
import { toLocalInput } from '@/lib/hangar-stats'

// Rendered with a key tied to the session id so each open remounts fresh.
export default function ExitModal({
  session,
  onClose,
  onSaved,
}: {
  session: HangarSession
  onClose: () => void
  onSaved: () => void
}) {
  const [time, setTime] = useState(() => toLocalInput(new Date()))
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function save() {
    setError('')
    if (!time) return setError('Please enter an exit time.')
    if (new Date(time) <= new Date(session.entry)) return setError('Exit must be after the entry time.')
    try {
      await confirmExit(session, time, reason.trim(), note.trim())
      onSaved()
      onClose()
    } catch {
      setError('Save failed — check connection.')
    }
  }

  return (
    <HangarModal title={`Log exit — ${session.aircraft}`} onClose={onClose}>
      {error && (
        <div className="mb-3 text-sm font-semibold" style={{ color: 'var(--red)' }}>
          ⚠ {error}
        </div>
      )}
      <div className="grid gap-3">
        <div>
          <div className="label">Exit time</div>
          <input
            type="datetime-local"
            className="input w-full"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
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
            placeholder="Additional details…"
          />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-primary" onClick={save}>
          Confirm exit
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </HangarModal>
  )
}
