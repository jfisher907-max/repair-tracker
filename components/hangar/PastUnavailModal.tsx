'use client'

import { useState } from 'react'
import HangarModal from './HangarModal'
import { logUnavail, type HangarUnavail } from '@/lib/hangar'
import { fmtDT, fmtDur, toLocalInput } from '@/lib/hangar-stats'

export default function PastUnavailModal({
  unavail,
  onClose,
  onSaved,
}: {
  unavail: HangarUnavail[]
  onClose: () => void
  onSaved: () => void
}) {
  const [start, setStart] = useState<string>(() => toLocalInput(new Date()))
  const [end, setEnd] = useState<string>('')
  const [reason, setReason] = useState<string>('')
  const [error, setError] = useState<string>('')

  let preview = 'Choose when it became unavailable'
  if (start) {
    if (!end) preview = `Wings unavailable · since ${fmtDT(start)} · still unavailable`
    else if (new Date(end) > new Date(start))
      preview = `Wings unavailable · ${fmtDT(start)} → ${fmtDT(end)} · ${fmtDur(new Date(end).getTime() - new Date(start).getTime())}`
    else preview = 'Until must be after the start time'
  }

  async function save() {
    setError('')
    if (!start) return setError('Choose when Wings became unavailable.')
    if (end && new Date(end) <= new Date(start)) return setError('Until must be after the start time.')
    if (!end && unavail.find((u) => !u.end_time))
      return setError('An open unavailability period already exists. Add an until time, or end the current one first.')
    try {
      await logUnavail({ start, end, note: reason.trim() })
      onSaved()
      onClose()
    } catch {
      setError('Save failed — check connection.')
    }
  }

  return (
    <HangarModal title="Log past unavailability" onClose={onClose}>
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
          <div className="label">Until (optional — leave blank if still unavailable)</div>
          <input type="datetime-local" className="input w-full" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div>
          <div className="label">Reason (optional)</div>
          <input
            type="text"
            className="input w-full"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. owner needs the space"
          />
        </div>
      </div>
      <div className="stat-tile mt-3 text-sm" style={{ color: 'var(--text2)' }}>
        {preview}
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-danger" onClick={save}>
          Save unavailability
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </HangarModal>
  )
}
