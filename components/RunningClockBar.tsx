'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  CLOCK_CHANGED,
  clockStopPatch,
  formatClock,
  notifyClockChanged,
  runningHours,
} from '@/lib/labor-time'

/** Just the fields the bar needs — not the whole job. */
interface RunningJob {
  id: string
  job_number: string
  title: string
  actual_hours: number | string | null
  clock_started_at: string
}

/** The stack token the shell reads, in px, while the bar is up. 52px + 8px gap. */
const STACK_CONTRIBUTION = '60px'

/**
 * The clock that followed you off the job page.
 *
 * A clock left running all night is money — it inflates actual hours, which is
 * the number the whole book-vs-actual comparison rests on (0068). So once one
 * is running it rides above the tab bar on every owner screen, says which job
 * it is on, and can be stopped from there.
 *
 * It refreshes on three signals: the CLOCK_CHANGED event (instant, fired by
 * the two controls that start and stop a clock), a route change (covers a
 * write from anywhere else), and a slow poll (covers a clock started on
 * another device). The minute readout ticks on its own every 15s.
 */
export default function RunningClockBar() {
  const pathname = usePathname()
  const [job, setJob] = useState<RunningJob | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    // RLS pins this to the owner; deleted jobs never count.
    const { data } = await supabase
      .from('jobs')
      .select('id, job_number, title, actual_hours, clock_started_at')
      .not('clock_started_at', 'is', null)
      .is('deleted_at', null)
      .order('clock_started_at', { ascending: false })
      .limit(1)
    const row = (data as RunningJob[] | null)?.[0] ?? null
    setJob(row && row.clock_started_at ? row : null)
  }, [])

  useEffect(() => {
    let live = true
    const refresh = () => {
      if (live) void load()
    }
    refresh()
    window.addEventListener(CLOCK_CHANGED, refresh)
    // The backstop: a clock started on the other device, or a write this app
    // did not make. Slow on purpose — the event covers everything local.
    const poll = setInterval(refresh, 60_000)
    return () => {
      live = false
      window.removeEventListener(CLOCK_CHANGED, refresh)
      clearInterval(poll)
    }
    // pathname: re-read after any navigation, which covers a clock changed by
    // a page that does not fire the event.
  }, [load, pathname])

  // The readout only shows H:MM, so a 15s tick is finer than it can display.
  useEffect(() => {
    if (!job) return
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [job])

  /* The shell's floating stack has to grow by this bar's height, or the tab
     bar would sit under it and the content padding would be short by one bar.
     Set on the root so one token drives the padding, .save-bar and the stack
     (see --tabbar-stack in globals.css). */
  useEffect(() => {
    const root = document.documentElement
    if (job) root.style.setProperty('--clockbar-h', STACK_CONTRIBUTION)
    else root.style.removeProperty('--clockbar-h')
    return () => {
      root.style.removeProperty('--clockbar-h')
    }
  }, [job])

  async function stop() {
    if (!job || busy) return
    setBusy(true)
    const stopping = job
    try {
      const { error } = await supabase
        .from('jobs')
        .update(clockStopPatch(stopping))
        .eq('id', stopping.id)
      if (error) throw new Error(error.message)
      setJob(null)
      // Tell the job page, which may be the screen behind this bar.
      notifyClockChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!job) return null

  return (
    <div className="glass-float clock-bar" role="status" aria-live="off">
      <Link href={`/jobs/${job.id}`} className="clock-bar-link">
        <span className="clock-bar-dot" aria-hidden="true" />
        <span className="clock-bar-what">
          <span className="wnt-id">{job.job_number}</span> clock
        </span>
        <span className="clock-bar-time">
          {formatClock(runningHours(job.clock_started_at, now))}
        </span>
      </Link>
      <button
        type="button"
        className="btn btn-sm btn-primary !min-h-[40px]"
        onClick={stop}
        disabled={busy}
      >
        {busy ? 'Stopping…' : '■ Stop'}
      </button>
    </div>
  )
}
