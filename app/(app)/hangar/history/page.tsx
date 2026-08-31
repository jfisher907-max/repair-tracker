'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDocumentTitle } from '@/lib/title'
import {
  deleteSession,
  deleteUnavail,
  endUnavailNow,
  fetchHangarData,
  type HangarSession,
  type HangarUnavail,
} from '@/lib/hangar'
import {
  AIRCRAFT,
  HANGARS,
  filterByDate,
  fmtDT,
  fmtDur,
  type HangarDateFilter as Filter,
} from '@/lib/hangar-stats'
import HangarDateFilter from '@/components/hangar/HangarDateFilter'
import HangarSubNav from '@/components/hangar/HangarSubNav'
import ExitModal from '@/components/hangar/ExitModal'
import EditSessionModal from '@/components/hangar/EditSessionModal'
import EditUnavailModal from '@/components/hangar/EditUnavailModal'

export default function HangarHistoryPage() {
  useDocumentTitle('Hangar History — Wings N Things')
  const [sessions, setSessions] = useState<HangarSession[] | null>(null)
  const [unavail, setUnavail] = useState<HangarUnavail[] | null>(null)
  const [tab, setTab] = useState<'sessions' | 'unavail'>('sessions')
  const [filterAc, setFilterAc] = useState('All')
  const [filterHangar, setFilterHangar] = useState('All')
  const [dateFilter, setDateFilter] = useState<Filter>({ preset: 'all', start: null, end: null })
  const [exitTarget, setExitTarget] = useState<HangarSession | null>(null)
  const [editSession, setEditSession] = useState<HangarSession | null>(null)
  const [editUnavail, setEditUnavail] = useState<HangarUnavail | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await fetchHangarData()
      setSessions(d.sessions)
      setUnavail(d.unavail)
    } catch {
      setSessions([])
      setUnavail([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  let filtered = filterByDate(sessions ?? [], 'entry', dateFilter)
  if (filterAc !== 'All') filtered = filtered.filter((s) => s.aircraft === filterAc)
  if (filterHangar !== 'All') filtered = filtered.filter((s) => s.hangar === filterHangar)
  filtered.sort((a, b) => new Date(b.entry).getTime() - new Date(a.entry).getTime())

  const sortedU = filterByDate(unavail ?? [], 'start_time', dateFilter).sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
  )

  async function handleDeleteSession(id: string) {
    if (!confirm('Delete this session?')) return
    try {
      await deleteSession(id)
      await load()
    } catch {
      alert('Delete failed.')
    }
  }

  async function handleDeleteUnavail(id: string) {
    if (!confirm('Delete this record?')) return
    try {
      await deleteUnavail(id)
      await load()
    } catch {
      alert('Delete failed.')
    }
  }

  async function handleEndUnavail(id: string) {
    try {
      await endUnavailNow(id)
      await load()
    } catch {
      alert('Save failed.')
    }
  }

  return (
    <div>
      <HangarSubNav />
      <h1 className="display mb-4 text-2xl font-semibold">Hangar History</h1>

      <HangarDateFilter filter={dateFilter} onChange={setDateFilter} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="select" value={filterAc} onChange={(e) => setFilterAc(e.target.value)}>
          <option value="All">All Aircraft</option>
          {AIRCRAFT.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select className="select" value={filterHangar} onChange={(e) => setFilterHangar(e.target.value)}>
          <option value="All">All Hangars</option>
          {HANGARS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={`btn btn-sm ${tab === 'sessions' ? 'btn-primary' : ''}`}
            onClick={() => setTab('sessions')}
          >
            Sessions
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'unavail' ? 'btn-primary' : ''}`}
            onClick={() => setTab('unavail')}
          >
            Unavailability
          </button>
        </div>
      </div>

      {sessions === null ? (
        <div className="skeleton h-40 w-full" />
      ) : tab === 'sessions' ? (
        filtered.length ? (
          <div className="grid gap-2">
            {filtered.map((s) => {
              const dur = s.exit ? fmtDur(new Date(s.exit).getTime() - new Date(s.entry).getTime()) : null
              const isW = s.hangar === 'Wings Hangar'
              const reason = s.exit_reason || s.reason || ''
              const note = s.exit_note || s.note || ''
              return (
                <div key={s.id} className={`card ${isW ? 'card-line-ok' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="wnt-id text-xs">{s.aircraft}</span>
                    <span className={`chip ${isW ? 'chip-paid' : 'chip-partial'}`}>{s.hangar}</span>
                    {!s.exit && <span className="chip chip-open">Active</span>}
                    <div className="ml-auto flex gap-1.5">
                      {!s.exit && (
                        <button type="button" className="btn btn-sm" onClick={() => setExitTarget(s)}>
                          Exit
                        </button>
                      )}
                      <button type="button" className="btn btn-sm" title="Edit" onClick={() => setEditSession(s)}>
                        ✎
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        title="Delete"
                        onClick={() => void handleDeleteSession(s.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <div className="label">Entry</div>
                      <div>{fmtDT(s.entry)}</div>
                    </div>
                    <div>
                      <div className="label">Exit</div>
                      <div>{s.exit ? fmtDT(s.exit) : '—'}</div>
                    </div>
                    <div>
                      <div className="label">Duration</div>
                      <div style={{ color: dur ? 'var(--green)' : 'var(--accent)' }}>{dur || 'Ongoing'}</div>
                    </div>
                  </div>
                  {(reason || note) && (
                    <div className="mt-2 text-sm" style={{ color: 'var(--text3)' }}>
                      {reason && <span className="italic">{reason}</span>}
                      {reason && note && ' · '}
                      {note}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="card py-10 text-center" style={{ color: 'var(--text3)' }}>
            No sessions found.
          </div>
        )
      ) : sortedU.length ? (
        <div className="grid gap-2">
          {sortedU.map((u) => {
            const dur = u.end_time
              ? fmtDur(new Date(u.end_time).getTime() - new Date(u.start_time).getTime())
              : null
            return (
              <div key={u.id} className="card card-line-stop">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip chip-unpaid">Wings unavailable</span>
                  {!u.end_time && <span className="chip chip-open">Active</span>}
                  <div className="ml-auto flex gap-1.5">
                    {!u.end_time && (
                      <button type="button" className="btn btn-sm" onClick={() => void handleEndUnavail(u.id)}>
                        End
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" title="Edit" onClick={() => setEditUnavail(u)}>
                      ✎
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Delete"
                      onClick={() => void handleDeleteUnavail(u.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <div className="label">Start</div>
                    <div>{fmtDT(u.start_time)}</div>
                  </div>
                  <div>
                    <div className="label">End</div>
                    <div>{u.end_time ? fmtDT(u.end_time) : '—'}</div>
                  </div>
                  <div>
                    <div className="label">Duration</div>
                    <div style={{ color: dur ? 'var(--red)' : 'var(--accent)' }}>{dur || 'Ongoing'}</div>
                  </div>
                </div>
                {u.note && (
                  <div className="mt-2 text-sm" style={{ color: 'var(--text3)' }}>
                    {u.note}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="card py-10 text-center" style={{ color: 'var(--text3)' }}>
          No unavailability periods logged.
        </div>
      )}

      {exitTarget && (
        <ExitModal
          key={exitTarget.id}
          session={exitTarget}
          onClose={() => setExitTarget(null)}
          onSaved={() => void load()}
        />
      )}
      {editSession && (
        <EditSessionModal
          key={editSession.id}
          session={editSession}
          onClose={() => setEditSession(null)}
          onSaved={() => void load()}
        />
      )}
      {editUnavail && (
        <EditUnavailModal
          key={editUnavail.id}
          period={editUnavail}
          onClose={() => setEditUnavail(null)}
          onSaved={() => void load()}
        />
      )}
    </div>
  )
}
