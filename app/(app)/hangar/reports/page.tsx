'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDocumentTitle } from '@/lib/title'
import {
  fetchHangarData,
  fetchHangarRates,
  rateForMonth,
  saveHangarRate,
  type HangarRate,
  type HangarSession,
  type HangarUnavail,
} from '@/lib/hangar'
import { formatCents, parseMoney } from '@/lib/money'
import { dbErrorWords } from '@/lib/db-errors'
import {
  HANGARS,
  clipSessionsToRange,
  clipUnavailToRange,
  completedHangarMs,
  getAcStats,
  getPresetLabel,
  getUnavailStats,
  monthlyUnavailBreakdown,
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
  const [showMoney, setShowMoney] = useState(false)
  const [rates, setRates] = useState<HangarRate[]>([])
  const [rateInput, setRateInput] = useState('')
  const [rateMsg, setRateMsg] = useState<string | null>(null)

  // Only the show/hide toggle is a per-browser preference. The rate itself is
  // shop data in integer cents and lives in the database (migration 0069), so
  // it is the same on every device and a month keeps the rate it was priced at.
  useEffect(() => {
    try {
      const on = localStorage.getItem('wnt_hangar_show_money')
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a persisted UI pref on mount
      if (on !== null) setShowMoney(on === '1')
    } catch {}
  }, [])

  function toggleMoney() {
    setShowMoney((v) => {
      try {
        localStorage.setItem('wnt_hangar_show_money', v ? '0' : '1')
      } catch {}
      return !v
    })
  }

  // A rate change takes effect from the first of the current month, so
  // finished months keep the rate they were reported at.
  async function saveRate() {
    const cents = parseMoney(rateInput)
    if (cents === null || cents <= 0) {
      setRateMsg('Enter the monthly rate, for example 1200.00')
      return
    }
    const d = new Date()
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    try {
      await saveHangarRate(from, cents)
      setRates(await fetchHangarRates())
      setRateInput('')
      setRateMsg(`Saved. ${formatCents(cents)}/month applies from ${from}.`)
    } catch (e) {
      setRateMsg(dbErrorWords(e, 'save the rate', 'the hangar rate table (migration 0069)'))
    }
  }

  const load = useCallback(async () => {
    try {
      const d = await fetchHangarData()
      setSessions(d.sessions)
      setUnavail(d.unavail)
      try {
        setRates(await fetchHangarRates())
      } catch {
        setRates([])
      }
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
  // Clip spans to the selected window (open ones counted up to now) so the
  // aggregates sum exactly the hours inside it — an open months-old ALNW
  // assignment still contributes its share of "Last 30 Days".
  const fSess = clipSessionsToRange(s, filter, new Date())
  const fUnavail = clipUnavailToRange(u, filter, new Date())
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
          {copied ? '✓ Copied' : 'Copy text'}
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
          CSV
        </button>
        <button type="button" className="btn btn-sm" onClick={() => printHTML(buildReportHTML(s, u, filter))}>
          Print / PDF
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

          <div className="card mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="section-title">ALNW proration</div>
              <button type="button" className={`btn btn-sm ${showMoney ? 'btn-primary' : ''}`} onClick={toggleMoney}>
                {showMoney ? 'Hide $' : 'Show $'}
              </button>
            </div>
            {showMoney && (
              <div className="panel-in mt-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-sm" style={{ color: 'var(--text2)' }}>
                    <span className="label">Monthly rate</span>
                    <input
                      className="input w-40"
                      inputMode="decimal"
                      placeholder="1200.00"
                      aria-label="Monthly hangar management rate"
                      value={rateInput}
                      onChange={(e) => setRateInput(e.target.value)}
                    />
                  </label>
                  <button type="button" className="btn btn-sm" onClick={() => void saveRate()}>
                    Set rate
                  </button>
                </div>
                {rates.length > 0 ? (
                  <div className="mt-1 text-sm" style={{ color: 'var(--text3)' }}>
                    Current: {formatCents(rates[0].monthly_rate_cents)}/month from {rates[0].effective_from}
                    {rates.length > 1 && ` · ${rates.length - 1} earlier rate${rates.length > 2 ? 's' : ''} kept`}
                  </div>
                ) : (
                  <div className="mt-1 text-sm" style={{ color: 'var(--text3)' }}>
                    No rate recorded yet. Set it once; each month below is then priced with the rate in
                    force during that month, so changing it later never re-prices a month already reported.
                  </div>
                )}
                {rateMsg && (
                  <div className="mt-1 text-sm" style={{ color: 'var(--text2)' }}>
                    {rateMsg}
                  </div>
                )}
                <div className="mt-3 grid gap-2">
                  {monthlyUnavailBreakdown(u, new Date()).map((m) => {
                    const rc = rateForMonth(rates, m.key)
                    // Round once, at the end, in cents.
                    const credit = rc === null ? null : Math.round((m.pct / 100) * rc)
                    const net = rc === null || credit === null ? null : rc - credit
                    return (
                      <div key={m.key} className="stat-tile">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold">
                            {m.label}
                            {m.current && (
                              <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--text3)' }}>
                                (so far)
                              </span>
                            )}
                          </span>
                          {credit === null ? (
                            <span className="text-sm" style={{ color: 'var(--text3)' }}>
                              no rate for this month
                            </span>
                          ) : (
                            <span className="text-lg font-semibold" style={{ color: 'var(--red)' }}>
                              −{formatCents(credit)}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-sm" style={{ color: 'var(--text3)' }}>
                          {m.unavailHours.toFixed(1)}h unavailable · {m.pct.toFixed(1)}% of the month
                          {net !== null && <> · net due {formatCents(net)}</>}
                        </div>
                      </div>
                    )
                  })}
                  {monthlyUnavailBreakdown(u, new Date()).length === 0 && (
                    <div className="text-sm" style={{ color: 'var(--text3)' }}>
                      No unavailable time logged yet.
                    </div>
                  )}
                </div>
                <div className="mt-2 text-sm" style={{ color: 'var(--text3)' }}>
                  Credit = share of that month’s rate for the time Wings was unavailable, split across
                  month boundaries. The current month counts hours up to now against the whole month, so
                  it only settles once the month ends. These figures are not an invoice.
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

