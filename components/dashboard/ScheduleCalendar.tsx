'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import JobRow from '@/components/JobRow'
import type { JobWithContext } from '@/lib/data'
import { isBookedJob, monthLabel } from '@/lib/finances'
import { plural, shortDate } from './format'

/* Every date here is a YYYY-MM-DD string read as LOCAL time, the same as
   job.date (lib/date.ts). Nothing goes through toISOString. */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** How far "Coming up" looks. */
const AHEAD_DAYS = 14
/** Chips a desktop cell shows before "+n". */
const DESKTOP_CHIPS = 2

const pad = (n: number) => String(n).padStart(2, '0')
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromIso = (iso: string) => new Date(`${iso}T00:00:00`)
function addDays(iso: string, n: number): string {
  const d = fromIso(iso)
  d.setDate(d.getDate() + n)
  return toIso(d)
}
/** "Saturday, September 12, 2026" — for the cell's accessible name. */
function longDate(iso: string): string {
  return fromIso(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}
/** "Sat, Sep 12" — the selected day's heading. */
function dayHeading(iso: string): string {
  return fromIso(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
const byDateThenNumber = (a: JobWithContext, b: JobWithContext) =>
  a.job.date < b.job.date
    ? -1
    : a.job.date > b.job.date
      ? 1
      : a.job.job_number < b.job.job_number
        ? -1
        : a.job.job_number > b.job.job_number
          ? 1
          : 0

type BookedStage = 'scheduled' | 'in_progress'
const stageOf = (it: JobWithContext): BookedStage => (it.job.stage === 'in_progress' ? 'in_progress' : 'scheduled')

/** The customer's last name, or the job title when there is no customer. */
function chipName(it: JobWithContext): string {
  const name = it.customer?.name?.trim()
  if (name) return name.split(/\s+/).pop() ?? name
  return it.job.title
}

interface Cell {
  iso: string
  day: number
  outside: boolean
}

/**
 * A month of booked drop-offs, built from the board's own rows (no fetch).
 * A scheduled or in-progress job sits on its job.date — the day the car is
 * dropped off (0043). A done job that is not paid marks its promised_date
 * with an ember dot: the pick-up the customer was told about. Tapping a day
 * lists it below; with nothing selected the list is the next two weeks.
 */
// Whether the calendar is open sticks per device (owner, 2026-09-12: "have the
// calendar collapsable"). Same shape as the ledger's switch: the browser's
// storage is the external system, read through useSyncExternalStore so the
// server renders it closed and the client picks up the saved choice. With no
// saved choice it opens on the phone and stays closed on a desk, where the
// one-screen board is worth more than a grid that is one tap away.
const CAL_KEY = 'dash-cal-open'
let calMemory: boolean | null = null
const calListeners = new Set<() => void>()
function readCalOpen(): boolean {
  if (calMemory !== null) return calMemory
  try {
    const saved = localStorage.getItem(CAL_KEY)
    if (saved === '1') return true
    if (saved === '0') return false
  } catch {}
  try {
    return !window.matchMedia('(min-width: 900px)').matches
  } catch {
    return true
  }
}
function subscribeCal(listener: () => void) {
  calListeners.add(listener)
  return () => {
    calListeners.delete(listener)
  }
}
function setCalOpen(open: boolean) {
  calMemory = open
  try {
    localStorage.setItem(CAL_KEY, open ? '1' : '0')
  } catch {}
  for (const l of calListeners) l()
}

export default function ScheduleCalendar({ jobs, now }: { jobs: JobWithContext[]; now: Date }) {
  const open = useSyncExternalStore(subscribeCal, readCalOpen, () => false)
  const today = toIso(now)
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [selected, setSelected] = useState<string | null>(null)
  // The roving tab stop of the grid: one cell is in the tab order at a time.
  const [focusIso, setFocusIso] = useState(today)
  const cellRefs = useRef(new Map<string, HTMLDivElement>())
  // Only keyboard movement pulls focus; a render never steals it.
  const wantFocus = useRef(false)

  useEffect(() => {
    if (!wantFocus.current) return
    wantFocus.current = false
    cellRefs.current.get(focusIso)?.focus()
  }, [focusIso, view])

  const { bookedByDate, promisedByDate } = useMemo(() => {
    const booked = new Map<string, JobWithContext[]>()
    const promised = new Map<string, JobWithContext[]>()
    for (const it of jobs) {
      if (isBookedJob(it.job)) {
        const list = booked.get(it.job.date) ?? []
        list.push(it)
        booked.set(it.job.date, list)
      } else if (it.job.promised_date && it.job.payment_status !== 'paid') {
        const list = promised.get(it.job.promised_date) ?? []
        list.push(it)
        promised.set(it.job.promised_date, list)
      }
    }
    for (const list of booked.values()) list.sort(byDateThenNumber)
    for (const list of promised.values()) list.sort(byDateThenNumber)
    return { bookedByDate: booked, promisedByDate: promised }
  }, [jobs])

  // The visible weeks: from the Sunday on or before the 1st to the Saturday
  // on or after the last day, so the grid is 4 to 6 rows and never more.
  const cells = useMemo<Cell[]>(() => {
    const first = new Date(view.year, view.month, 1)
    const lead = first.getDay()
    const days = new Date(view.year, view.month + 1, 0).getDate()
    const rows = Math.ceil((lead + days) / 7)
    return Array.from({ length: rows * 7 }, (_, i) => {
      const d = new Date(view.year, view.month, 1 - lead + i)
      return { iso: toIso(d), day: d.getDate(), outside: d.getMonth() !== view.month }
    })
  }, [view])
  const weeks = useMemo(() => {
    const out: Cell[][] = []
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
    return out
  }, [cells])
  // The tab stop must be a rendered cell; fall back to the 1st of the month.
  const tabIso = cells.some((c) => c.iso === focusIso)
    ? focusIso
    : (cells.find((c) => !c.outside)?.iso ?? focusIso)

  const horizon = addDays(today, AHEAD_DAYS)
  const bookedAll = useMemo(() => jobs.filter((it) => isBookedJob(it.job)).sort(byDateThenNumber), [jobs])
  const comingUp = bookedAll.filter((it) => it.job.date >= today && it.job.date < horizon)
  // Booked past the two weeks, so an empty "coming up" can still say when the next car is.
  const afterHorizon = bookedAll.find((it) => it.job.date >= horizon) ?? null
  // Scheduled with a past date: the car never came. In-progress with a past
  // date is normal (it came, it is on the lift), so it is not "waiting".
  const waiting = bookedAll.filter((it) => it.job.stage === 'scheduled' && it.job.date < today)

  const monthName = `${monthLabel(view.month, true)} ${view.year}`
  const inView = (iso: string) => {
    const d = fromIso(iso)
    return d.getFullYear() === view.year && d.getMonth() === view.month
  }

  function showMonth(year: number, month: number, focus?: string) {
    const d = new Date(year, month, 1)
    const next = { year: d.getFullYear(), month: d.getMonth() }
    setView(next)
    const todayHere = fromIso(today).getFullYear() === next.year && fromIso(today).getMonth() === next.month
    setFocusIso(focus ?? (todayHere ? today : toIso(d)))
  }
  function goToday() {
    showMonth(now.getFullYear(), now.getMonth(), today)
    setSelected(null)
  }
  function toggleSelect(iso: string) {
    setSelected((prev) => (prev === iso ? null : iso))
    setFocusIso(iso)
  }
  function moveFocus(iso: string) {
    wantFocus.current = true
    if (!inView(iso)) {
      const d = fromIso(iso)
      setView({ year: d.getFullYear(), month: d.getMonth() })
    }
    setFocusIso(iso)
  }

  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const cur = tabIso
    const dow = fromIso(cur).getDay()
    let next: string | null = null
    switch (e.key) {
      case 'ArrowLeft':
        next = addDays(cur, -1)
        break
      case 'ArrowRight':
        next = addDays(cur, 1)
        break
      case 'ArrowUp':
        next = addDays(cur, -7)
        break
      case 'ArrowDown':
        next = addDays(cur, 7)
        break
      case 'Home':
        next = addDays(cur, -dow)
        break
      case 'End':
        next = addDays(cur, 6 - dow)
        break
      case 'PageUp':
      case 'PageDown': {
        const d = fromIso(cur)
        const target = new Date(d.getFullYear(), d.getMonth() + (e.key === 'PageUp' ? -1 : 1), 1)
        const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
        target.setDate(Math.min(d.getDate(), last))
        next = toIso(target)
        break
      }
      case 'Enter':
      case ' ':
        e.preventDefault()
        toggleSelect(cur)
        return
      default:
        return
    }
    e.preventDefault()
    moveFocus(next)
  }

  const dayBooked = selected ? (bookedByDate.get(selected) ?? []) : []
  const dayPromised = selected ? (promisedByDate.get(selected) ?? []) : []

  // What the closed header still says: the count, and the next car or the wait.
  const summary =
    bookedAll.length === 0
      ? 'nothing booked'
      : `${plural(bookedAll.length, 'car')} booked` +
        (comingUp.length > 0
          ? ` · next ${comingUp[0].job.job_number} ${shortDate(comingUp[0].job.date)}`
          : waiting.length > 0
            ? ` · ${waiting.length} waiting from earlier`
            : afterHorizon
              ? ` · next ${afterHorizon.job.job_number} ${shortDate(afterHorizon.job.date)}`
              : '')

  return (
    <section className={`card cal${open ? '' : ' is-collapsed'}`} aria-labelledby="cal-title">
      <div className="cal-head">
        <h2 id="cal-title" className="cal-label">
          Drop-offs · {monthName}
        </h2>
        {!open && <span className="cal-summary">{summary}</span>}
        <button
          type="button"
          className="btn btn-sm cal-btn cal-toggle"
          aria-expanded={open}
          aria-controls="cal-body"
          onClick={() => setCalOpen(!open)}
        >
          {open ? 'Hide' : 'Show'}
        </button>
        {open && (
        <div className="cal-nav">
          <button
            type="button"
            className="btn btn-sm cal-btn"
            aria-label={`Previous month, ${monthLabel(view.month - 1, true)}`}
            onClick={() => showMonth(view.year, view.month - 1)}
          >
            ‹
          </button>
          <button type="button" className="btn btn-sm cal-btn" onClick={goToday}>
            Today
          </button>
          <button
            type="button"
            className="btn btn-sm cal-btn"
            aria-label={`Next month, ${monthLabel(view.month + 1, true)}`}
            onClick={() => showMonth(view.year, view.month + 1)}
          >
            ›
          </button>
        </div>
        )}
      </div>

      <div id="cal-body" hidden={!open}>
      <div role="grid" aria-label={`Drop-offs, ${monthName}. Weeks start on Sunday.`} className="cal-grid" onKeyDown={onGridKeyDown}>
        <div role="row" className="cal-row">
          {DOW.map((d, i) => (
            <div key={d} role="columnheader" className="cal-dow" aria-label={DOW_LONG[i]}>
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0].iso} role="row" className="cal-row">
            {week.map((c) => {
              const booked = bookedByDate.get(c.iso) ?? []
              const promised = promisedByDate.get(c.iso) ?? []
              const isToday = c.iso === today
              const isSelected = c.iso === selected
              const label = [
                longDate(c.iso),
                booked.length === 0 ? 'nothing booked' : plural(booked.length, 'drop-off'),
                promised.length > 0 ? `${plural(promised.length, 'pick-up')} promised` : '',
                isToday ? 'today' : '',
              ]
                .filter(Boolean)
                .join(', ')
              const cls = [
                'cal-day',
                c.outside ? 'is-outside' : '',
                isToday ? 'is-today' : '',
                isSelected ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <div
                  key={c.iso}
                  role="gridcell"
                  ref={(el) => {
                    if (el) cellRefs.current.set(c.iso, el)
                    else cellRefs.current.delete(c.iso)
                  }}
                  tabIndex={c.iso === tabIso ? 0 : -1}
                  aria-selected={isSelected}
                  aria-label={label}
                  className={cls}
                  onClick={() => toggleSelect(c.iso)}
                >
                  <span className="cal-num-row" aria-hidden="true">
                    <span className="cal-num">{c.day}</span>
                    {promised.length > 0 && <i className="cal-promised" title="pick-up promised" />}
                  </span>
                  {booked.length > 0 && (
                    <>
                      {/* Desktop: up to two named chips, then "+n". */}
                      <span className="cal-chips" aria-hidden="true">
                        {booked.slice(0, DESKTOP_CHIPS).map((it) => (
                          <span key={it.job.id} className={`cal-chip cal-chip-${stageOf(it)}`}>
                            <span className="wnt-id">{it.job.job_number}</span>
                            <span className="cal-chip-name">{chipName(it)}</span>
                          </span>
                        ))}
                        {booked.length > DESKTOP_CHIPS && <span className="cal-more">+{booked.length - DESKTOP_CHIPS}</span>}
                      </span>
                      {/* Phone: one job is its number; more are dots and a count. */}
                      <span className="cal-compact" aria-hidden="true">
                        {booked.length === 1 ? (
                          <span className={`cal-chip cal-chip-${stageOf(booked[0])}`}>
                            <span className="wnt-id">{booked[0].job.job_number}</span>
                          </span>
                        ) : (
                          <>
                            {booked.slice(0, 3).map((it) => (
                              <i key={it.job.id} className={`cal-dot cal-dot-${stageOf(it)}`} />
                            ))}
                            <b className="cal-count">{booked.length}</b>
                          </>
                        )}
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="cal-list">
        {selected ? (
          <>
            <div className="cal-list-head">
              <h3 className="cal-label">{dayHeading(selected)}</h3>
              <button type="button" className="btn btn-sm cal-btn" onClick={() => setSelected(null)}>
                Coming up
              </button>
            </div>
            {dayBooked.map((it) => (
              <JobRow key={it.job.id} item={it} />
            ))}
            {dayPromised.length > 0 && (
              <>
                <p className="cal-sub">Pick-up promised</p>
                {dayPromised.map((it) => (
                  <JobRow key={it.job.id} item={it} />
                ))}
              </>
            )}
            {dayBooked.length === 0 && dayPromised.length === 0 && (
              <p className="cal-empty">Nothing booked for {shortDate(selected)}.</p>
            )}
          </>
        ) : (
          <>
            <div className="cal-list-head">
              <h3 className="cal-label">Coming up</h3>
              <span className="cal-sub">next {AHEAD_DAYS} days</span>
            </div>
            {comingUp.map((it) => (
              <JobRow key={it.job.id} item={it} />
            ))}
            {comingUp.length === 0 && (
              <p className="cal-empty">
                Nothing booked in the next two weeks
                {afterHorizon ? (
                  <>
                    ; next is <span className="wnt-id">{afterHorizon.job.job_number}</span> · {shortDate(afterHorizon.job.date)}.
                  </>
                ) : (
                  '.'
                )}
              </p>
            )}
          </>
        )}
        {waiting.length > 0 && (
          <p className="cal-waiting">
            {waiting.length} waiting on a drop-off from earlier:{' '}
            {waiting.map((it, i) => (
              <span key={it.job.id} className="cal-waiting-item">
                <Link href={`/jobs/${it.job.id}`} className="wnt-id">
                  {it.job.job_number}
                </Link>{' '}
                · {shortDate(it.job.date)}
                {i < waiting.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
        )}
      </div>
      </div>
    </section>
  )
}
