'use client'

import { useEffect, useState } from 'react'
import type { Job } from '@/lib/types'
import {
  clockStartPatch,
  clockStopPatch,
  formatClock,
  notifyClockChanged,
  runningHours,
} from '@/lib/labor-time'

/**
 * Start / Stop the job clock from the job's top buttons (2026-11 phone sweep):
 * pressed twice a job, it sat three and a half phone screens down in "Your
 * time vs book". Same writes as that card (lib/labor-time), so either one
 * stops what the other started.
 */
export default function JobClockButton({
  job,
  onUpdate,
}: {
  job: Job
  onUpdate: (patch: Partial<Job>) => Promise<void>
}) {
  const running = !!job.clock_started_at
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [running])

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      await onUpdate(running ? clockStopPatch(job) : clockStartPatch(job))
      notifyClockChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className={running ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
      disabled={busy}
      onClick={toggle}
      aria-pressed={running}
    >
      {running ? `■ Stop clock · ${formatClock(runningHours(job.clock_started_at, now))}` : '▶ Start clock'}
    </button>
  )
}
