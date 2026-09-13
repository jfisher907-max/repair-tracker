'use client'

import type { CSSProperties, ReactNode } from 'react'
import { monthLabel, type MonthFigures } from '@/lib/finances'
import { figure, type FigureKind } from './format'
import { useCountUp } from './useCountUp'

/** Which months the tile's trend row reads, and which one is "now". */
export interface TrendScope {
  months: MonthFigures[]
  /** Index of the month the small figure belongs to. */
  now: number
  /** "so far" when that month is still running; a finished month just names itself. */
  running: boolean
}

export interface TrendTileProps {
  label: string
  kind: FigureKind
  /** The year figure. */
  total: number
  /** Colour of the year figure by meaning; a series colour never touches text. */
  valueTone?: 'in' | 'owed'
  /** Coloured 1px outline on the neutral tile. */
  tone?: 'ok' | 'stop'
  /** Full width on the phone. */
  wide?: boolean
  /** Phone order group: lead = first, second = right after the ledger. */
  lead?: 'lead' | 'second'
  /** Arrival stagger slot. */
  t: number
  /**
   * The months behind the figure. It no longer draws anything (owner,
   * 2026-09-12: the three-month mini-bars came out) — it feeds the two lines
   * of words underneath: "Sep so far $323.81" and "down from 6 in Aug".
   */
  trend?: { scope: TrendScope; pick: (m: MonthFigures) => number; subExtra?: (m: MonthFigures) => ReactNode }
  /** Replaces the "this month so far" line. */
  sub?: ReactNode
  hint: ReactNode
  /** A graph. Passing one is what gives this tile its band — see below. */
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
  const style = { '--t': t } as CSSProperties
  const classes = [
    'stat-tile',
    'tile',
    wide ? 'tile--wide' : '',
    tone ? `stat-tile--${tone}` : '',
    lead ? `tile--${lead}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  let deltaRow: ReactNode = null
  let subLine: ReactNode = sub
  if (trend) {
    const { scope, pick, subExtra } = trend
    const { months, now, running } = scope
    const cur = months[now]
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
    deltaRow = <div className="tile-delta">{changeWords(kind, scope, pick)}</div>
  }

  // THE RULE (owner, 2026-09-12): a graph lives in the band; a tile with no
  // graph has no band. The six number tiles are one clean column of words —
  // label, figure, this month so far, the change in words, the caption — and
  // nothing else. Only a tile handed a graph as `children` (Cash profit's
  // earned split; the strip's paired bars, in MonthVsStrip) gets the sunken
  // band, flush to the card's bottom edge and taking its 13px inner radius.
  // Do not reintroduce a band to hold words: .tile's own bottom padding
  // closes a bandless tile.
  const hasGraph = Boolean(children)

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
        {deltaRow}
        <div className="tile-hint">{hint}</div>
      </div>
      {hasGraph && <div className="tile-band">{children}</div>}
    </div>
  )
}
