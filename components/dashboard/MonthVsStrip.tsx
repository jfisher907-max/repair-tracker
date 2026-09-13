'use client'

import type { CSSProperties } from 'react'
import { monthLabel, type MonthFigures } from '@/lib/finances'
import { daysInMonth, figure, type FigureKind } from './format'

/**
 * This month against the previous calendar month, on the three things the
 * shop can actually control: jobs, hours, and what the work earned. Two flat
 * fills, one legend; values sit in text tokens, never in the series colour.
 *
 * This card keeps its .tile-band because it keeps its graph: the rule is that
 * a graph lives in the band and a bandless card has no band (the six number
 * tiles lost both on 2026-09-12). Cash profit is the only other one left.
 */
export default function MonthVsStrip({
  current,
  previous,
  now = new Date(),
  t,
}: {
  /** The running month (this year). */
  current: MonthFigures
  /** The month before it, from whichever year it fell in; null = none on the app. */
  previous: MonthFigures | null
  now?: Date
  t: number
}) {
  const day = now.getDate()
  const days = daysInMonth(now.getFullYear(), now.getMonth())
  const curName = monthLabel(current.index)
  const prevName = previous ? monthLabel(previous.index, true) : null
  // A quiet previous month with no jobs still compares ("4 vs 0"); only a
  // month before the shop was on the app, or none at all, is "first month".
  const hasPrev = previous !== null && previous.state === 'open'

  const rows: { label: string; kind: FigureKind; pick: (m: MonthFigures) => number }[] = [
    { label: 'Jobs', kind: 'int', pick: (m) => m.jobs },
    { label: 'Labor hours', kind: 'hours', pick: (m) => m.hours },
    { label: 'Earned', kind: 'money', pick: (m) => m.earned },
  ]

  return (
    <section
      className="stat-tile strip"
      aria-label={hasPrev ? `This month against ${prevName}` : 'This month'}
      style={{ '--t': t } as CSSProperties}
    >
      <div className="tile-words">
        <div className="strip-head">
          <span className="stat-label">{hasPrev ? `This month vs ${prevName}` : 'This month'}</span>
          <span className="strip-day">
            day {day} of {days}
          </span>
        </div>
        {hasPrev && (
          <div className="strip-legend">
            <span>
              <i className="legend-sw sw-now" />
              {curName} so far
            </span>
            <span>
              <i className="legend-sw sw-ref" />
              {prevName}
            </span>
          </div>
        )}
      </div>
      {hasPrev ? (
        <div className="tile-band">
          <div className="vs-list">
            {rows.map((r, i) => {
              const a = r.pick(current)
              const b = r.pick(previous)
              const max = Math.max(a, b, 0)
              const w = (v: number) => (max > 0 ? `${((Math.max(0, v) / max) * 100).toFixed(1)}%` : '0%')
              return (
                <div key={r.label}>
                  <div className="vs-lab">
                    <span>{r.label}</span>
                    <span className="vs-val">
                      <b>{figure(r.kind, a)}</b> vs {figure(r.kind, b)}
                    </span>
                  </div>
                  <div className="vs-bars" aria-hidden="true">
                    <i className="now" style={{ '--w': w(a), '--i': i } as CSSProperties} />
                    <i className="ref" style={{ '--w': w(b), '--i': i } as CSSProperties} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="tile-band">
          <div className="vs-list">
            {rows.map((r) => (
              <div key={r.label} className="vs-lab">
                <span>{r.label}</span>
                <span className="vs-val">
                  <b>{figure(r.kind, r.pick(current))}</b>
                </span>
              </div>
            ))}
          </div>
          <p className="strip-first">first month on the app</p>
        </div>
      )}
    </section>
  )
}
