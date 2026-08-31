'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDocumentTitle } from '@/lib/title'
import { fetchHangarData, type HangarSession, type HangarUnavail } from '@/lib/hangar'
import {
  HANGARS,
  completedHangarMs,
  filterByDate,
  getAcStats,
  getPresetLabel,
  getUnavailStats,
  type AcStats,
  type HangarDateFilter as Filter,
} from '@/lib/hangar-stats'
import { buildCSV, buildEmailText, buildReportHTML, downloadText, printHTML, todayStamp } from '@/lib/hangar-report'
import HangarDateFilter from '@/components/hangar/HangarDateFilter'
import HangarSubNav from '@/components/hangar/HangarSubNav'

function AcCard({ name, st }: { name: string; st: AcStats }) {
  return (
    <div className="card">
      <div className="display mb-2 text-lg font-semibold">{name}</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="stat-tile">
          <div className="label">Sessions</div>
          <div className="text-lg font-semibold">{st.count}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Days active</div>
          <div className="text-lg font-semibold">{st.uniqueDays}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Total hours</div>
          <div className="text-lg font-semibold">{st.totalHours}h</div>
        </div>
        <div className="stat-tile">
          <div className="label">Total days (24h)</div>
          <div className="text-lg font-semibold">{st.totalDays}d</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="label mb-1.5">By hangar</div>
        {HANGARS.map((h) => (
          <div key={h} className="flex items-center justify-between py-1 text-sm">
            <span style={{ color: h === 'Wings Hangar' ? 'var(--green)' : 'var(--accent)' }}>{h}</span>
            <span>
              {st.byHangar[h].hours}h{' '}
              <span style={{ color: 'var(--text3)' }}>
                ({st.byHangar[h].count} session{st.byHangar[h].count !== 1 ? 's' : ''})
              </span>
            </span>
          </div>
        ))}
      </div>
      {Object.keys(st.reasons).length > 0 && (
        <div className="mt-3">
          <div className="label mb-1.5">By reason</div>
          {Object.entries(st.reasons).map(([r, d]) => (
            <div key={r} className="flex items-center justify-between py-1 text-sm">
              <span style={{ color: 'var(--text2)' }}>{r}</span>
              <span style={{ color: 'var(--text2)' }}>
                {(d.ms / 3600000).toFixed(1)}h ({d.count})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function HangarReportsPage() {
  useDocumentTitle('Hangar Report — Wings N Things')
  const [sessions, setSessions] = useState<HangarSession[] | null>(null)
  const [unavail, setUnavail] = useState<HangarUnavail[] | null>(null)
  const [filter, setFilter] = useState<Filter>({ preset: 'all', start: null, end: null })
  const [copied, setCopied] = useState(false)

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

  const s = sessions ?? []
  const u = unavail ?? []
  const fSess = filterByDate(s, 'entry', filter)
  const fUnavail = filterByDate(u, 'start_time', filter)
  const s1 = getAcStats('N254AL', fSess)
  const s2 = getAcStats('N253AL', fSess)
  const us = getUnavailStats(fUnavail)
  const label = getPresetLabel(filter.preset)
  const cwMs = completedHangarMs(fSess, 'Wings Hangar')
  const caMs = completedHangarMs(fSess, 'ALNW')

  function copyText() {
    navigator.clipboard
      .writeText(buildEmailText(s, u, filter))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => alert('Copy failed.'))
  }

  return (
    <div>
      <HangarSubNav />
      <h1 className="display mb-4 text-2xl font-semibold">Hangar Report</h1>

      <HangarDateFilter filter={filter} onChange={setFilter} presets={['all', 'last_30', 'custom']} />

      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm btn-primary" onClick={copyText}>
          {copied ? '✓ Copied' : '📋 Copy text'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => downloadText(buildEmailText(s, u, filter), `hangar-usage-report-${todayStamp()}.txt`, 'text/plain')}
        >
          ⬇ .txt
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => downloadText(buildCSV(s, filter), `hangar-sessions-${todayStamp()}.csv`, 'text/csv')}
        >
          📊 CSV
        </button>
        <button type="button" className="btn btn-sm" onClick={() => printHTML(buildReportHTML(s, u, filter))}>
          🖨 Print / PDF
        </button>
      </div>

      {sessions === null ? (
        <div className="skeleton h-40 w-full" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <AcCard name="N254AL" st={s1} />
            <AcCard name="N253AL" st={s2} />
          </div>

          <div className="card mt-4">
            <div className="section-title mb-2">Combined totals — {label}</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="stat-tile">
                <div className="label">Wings hours</div>
                <div className="text-lg font-semibold" style={{ color: 'var(--green)' }}>
                  {(cwMs / 3600000).toFixed(1)}h
                </div>
              </div>
              <div className="stat-tile">
                <div className="label">ALNW hours</div>
                <div className="text-lg font-semibold" style={{ color: 'var(--accent)' }}>
                  {(caMs / 3600000).toFixed(1)}h
                </div>
              </div>
              <div className="stat-tile">
                <div className="label">Sessions</div>
                <div className="text-lg font-semibold">{s1.count + s2.count}</div>
              </div>
            </div>
          </div>

          <div className="card card-line-stop mt-4">
            <div className="section-title mb-2">Wings Hangar unavailability — {label}</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="stat-tile">
                <div className="label">Periods</div>
                <div className="text-lg font-semibold">{us.count}</div>
              </div>
              <div className="stat-tile">
                <div className="label">Total hours</div>
                <div className="text-lg font-semibold" style={{ color: 'var(--red)' }}>
                  {us.totalHours}h
                </div>
              </div>
              <div className="stat-tile">
                <div className="label">Total days (24h)</div>
                <div className="text-lg font-semibold" style={{ color: 'var(--red)' }}>
                  {us.totalDays}d
                </div>
              </div>
            </div>
            <div className="mt-2 text-sm" style={{ color: 'var(--text3)' }}>
              These hours are the usage evidence behind ALNW hangar-management billing.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
