'use client'

import { useState } from 'react'
import HangarModal from './HangarModal'
import { updateUnavail, type HangarUnavail } from '@/lib/hangar'
import { fmtDur, toLocalInput } from '@/lib/hangar-stats'

export default function EditUnavailModal({
  period,
  onClose,
  onSaved,
}: {
  period: HangarUnavail
  onClose: () => void
  onSaved: () => void
}) {
  const [start, setStart] = useState(toLocalInput(new Date(period.start_time)))
  const [end, setEnd] = useState(period.end_time ? toLocalInput(new Date(period.end_time)) : '')
  const [note, setNote] = useState(period.note || '')
  const [error, setError] = useState('')

  let preview = 'Set a start date and time'
  if (start) {
    if (!end) preview = 'Wings unavailable · still unavailable'
    else if (new Date(end) > new Date(start))
      preview = `Wings unavailable · ${fmtDur(new Date(end).getTime() - new Date(start).getTime())}`
    else preview = 'Until must be after the start time'
  }

  async function save() {
    setError('')
    if (!start) return setError('Start time is required.')
    if (end && new Date(end) <= new Date(start)) return setError('Until must be after the start time.')
    try {
      await updateUnavail(period.id, { start, end, note: note.trim() })
      onSaved()
      onClose()
    } catch {
      setError('Save failed — check connection.')
    }
  }

  return (
    <HangarModal title="Edit unavailability" onClose={onClose}>
      {error && (
        <div className="mb-3 text-sm font-semibold" style={{ color: 'var(--red)' }}>
          ⚠ {error}
        </div>
      )}
      <div className="grid gap-3">
        <div>
          <div className="label">Unavailable from</div>
          <input
            type="datetime-local"
            className="input w-full"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <div className="label">Until (blank = still unavailable)</div>
          <input type="datetime-local" className="input w-full" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div>
          <div className="label">Reason (optional)</div>
          <input
            type="text"
            className="input w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. owner needs the space"
          />
        </div>
      </div>
      <div className="stat-tile mt-3 text-sm" style={{ color: 'var(--text2)' }}>
        {preview}
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-danger" onClick={save}>
          Save changes
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </HangarModal>
  )
}
