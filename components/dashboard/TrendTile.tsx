'use client'

import type { CSSProperties, ReactNode } from 'react'
import { monthLabel, type MonthFigures } from '@/lib/finances'
import { figure, type FigureKind } from './format'
import { useCountUp } from './useCountUp'

export type Series = 'busy' | 'neutral' | 'profit' | 'loss'

/** Which months the tile's trend row reads, and which one is "now". */
export interface TrendScope {
  months: MonthFigures[]
  /** Index of the month the small figure and the bright bar belong to. */
  now: number
  /** "so far" when that month is still running; a finished month just names itself. */
  running: boolean
}

export interface TrendTileProps {
  label: string
  kind: FigureKind
  /** The year figure. */
  total: number
  /** Colour of the year figure by meaning; the series colour never touches text. */
  valueTone?: 'in' | 'owed'
  /** Coloured 1px outline on the neutral tile. */
  tone?: 'ok' | 'stop'
  series: Series
  /** Full width on the phone. */
  wide?: boolean
  /** Phone order group: lead = first, second = right after the ledger. */
  lead?: 'lead' | 'second'
  /** Arrival stagger slot. */
  t: number
  /** The trend row's data; omit it (Cash profit) and the children take its place. */
  trend?: { scope: TrendScope; pick: (m: MonthFigures) => number; subExtra?: (m: MonthFigures) => ReactNode }
  /** Replaces the "this month so far" line. */
  sub?: ReactNode
  hint: ReactNode
  children?: ReactNode
  /** The expand control for the ledger. */
  expandable?: { open: boolean; onToggle: () => void; controls: string; name: string }
}

/** The change in words: "down from 6 in Aug", "same as Aug", "first month with data". */
function changeWords(kind: FigureKind, scope: TrendScope, pick: (m: MonthFigures) => number): string {
  const { months, now } = scope
  const earlier = months.slice(0, now).filter((m) => m.state === 'open' && (m.jobs > 0 || pick(m) !== 0))
  if (earlier.length === 0) return 'first month with data'
  const prev = months[now - 1]
  const prevName = monthLabel(prev.index)
  if (prev.state !== 'open') return 'first month with data'
  const a = pick(months[now])
  const b = pick(prev)
  if (a === b) return `same as ${prevName}`
  return `${a > b ? 'up' : 'down'} from ${figure(kind, b)} in ${prevName}`
}

export default function TrendTile({
  label,
  kind,
  total,
  valueTone,
  tone,
  series,
  wide,
  lead,
  t,
  trend,
  sub,
  hint,
  children,
  expandable,
}: TrendTileProps) {
  const [valueRef, valueText] = useCountUp(kind, total)
  // Loss has no baseline step (a same-hue ramp under the 3:1 floor is worse
  // than none), so its bars are a flat fill; the other series ramp to the plot.
  const style = {
    '--t': t,
    '--bar': `var(--chart-${series})`,
    '--bar-base': series === 'loss' ? 'var(--chart-loss)' : `var(--chart-${series}-base)`,
  } as CSSProperties
  const classes = [
    'stat-tile',
    'tile',
    wide ? 'tile--wide' : '',
    tone ? `stat-tile--${tone}` : '',
    lead ? `tile--${lead}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  let trendRow: ReactNode = null
  let subLine: ReactNode = sub
  if (trend) {
    const { scope, pick, subExtra } = trend
    const { months, now, running } = scope
    const cur = months[now]
    const first = Math.max(0, now - 2)
    const span = months.slice(first, now + 1)
    const max = Math.max(0, ...span.map((m) => (m.state === 'open' ? pick(m) : 0)))
    if (subLine === undefined) {
      subLine = (
        <>
          {monthLabel(cur.index)}
          {running ? ' so far ' : ' '}
          <b>{figure(kind, pick(cur))}</b>
          {subExtra?.(cur)}
        </>
      )
    }
    trendRow = (
      <>
        <div className="mini" aria-hidden="true">
          {span.map((m, i) => {
            const v = m.state === 'open' ? pick(m) : 0
            const isNow = m.index === cur.index
            return (
              <span key={m.index}>
                <span className="mini-track">
                  {v > 0 && max > 0 && (
                    <i
                      className={isNow ? 'now' : undefined}
                      style={{ '--h': `${((v / max) * 100).toFixed(1)}%`, '--i': i } as CSSProperties}
                    />
                  )}
                </span>
                <span className={`mini-l${isNow ? ' now' : ''}`}>{monthLabel(m.index)}</span>
              </span>
            )
          })}
        </div>
        <div className="tile-delta">{changeWords(kind, scope, pick)}</div>
      </>
    )
  }

  // Two parts, every tile the same (owner, 2026-09-12: "synchronization and
  // similar layouts for similar information"): the words on the card, the
  // graph on a sunken band across the bottom with its own hairline. The band
  // holds whatever this tile's graph is: the three-month bars and the change
  // in words, or the earned split for Cash profit.
  return (
    <div className={classes} style={style}>
      <div className="tile-words">
        <div className="stat-label">{label}</div>
        {expandable && (
          <button
            type="button"
            className="tile-toggle"
            onClick={expandable.onToggle}
            aria-expanded={expandable.open}
            aria-controls={expandable.controls}
          >
            {expandable.name}
            <span aria-hidden="true">{expandable.open ? '▴' : '▾'}</span>
          </button>
        )}
        <div
          ref={valueRef}
          className={`stat-value${kind === 'money' ? ' money' : ''}${valueTone ? ` money-${valueTone}` : ''}`}
        >
          {valueText}
        </div>
        {subLine !== undefined && subLine !== null && <div className="tile-sub">{subLine}</div>}
        <div className="tile-hint">{hint}</div>
      </div>
      <div className="tile-band">
        {trendRow}
        {children}
      </div>
    </div>
  )
}
