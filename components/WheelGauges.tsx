'use client'

import type { CSSProperties } from 'react'
import { padBand, RATING_LABEL, treadBand, type Rating, type TreadMeasure } from '@/lib/inspections'

/**
 * Brake pad life and tire life, one bar per wheel (owner, 2026-11-27: "I
 * specifically want to make sure it has brake pad life, tire life").
 *
 * Each bar is the measurement on a 0 to 10 scale (mm of pad, 32nds of tread)
 * with the two limits ruled on it, coloured by the band it falls in. It shows
 * what was measured, never a percentage: a percentage needs the thickness the
 * part started at, and that differs by pad and by tire.
 *
 * Laid out as the vehicle is: left front beside right front, rears below.
 */

const WHEELS: { key: 'lf' | 'rf' | 'lr' | 'rr'; label: string }[] = [
  { key: 'lf', label: 'Left front' },
  { key: 'rf', label: 'Right front' },
  { key: 'lr', label: 'Left rear' },
  { key: 'rr', label: 'Right rear' },
]

const FULL = 10

const KIND = {
  // Watch starts at the first limit, OK at the second (lib/inspections).
  tread: { band: treadBand, unit: (v: number) => `${v}/32`, limits: [4, 6], scale: '32nds of tread' },
  pads: { band: padBand, unit: (v: number) => `${v} mm`, limits: [4, 7], scale: 'mm of pad' },
} as const

function Cell({ label, value, kind, counted }: { label: string; value: number | null | undefined; kind: 'tread' | 'pads'; counted: boolean }) {
  const k = KIND[kind]
  const has = typeof value === 'number' && Number.isFinite(value)
  const band: Rating | null = has ? k.band(value as number) : null
  const pct = has ? Math.max(0, Math.min(100, ((value as number) / FULL) * 100)) : 0
  return (
    <div className="wg-cell" data-band={band ?? 'none'}>
      <div className="wg-top">
        <span className="wg-wheel">{label}</span>
        <span className="wg-value">{has ? k.unit(value as number) : '—'}</span>
      </div>
      <div
        className="wg-bar"
        style={{ '--wg-a': `${(k.limits[0] / FULL) * 100}%`, '--wg-b': `${(k.limits[1] / FULL) * 100}%` } as CSSProperties}
        role="img"
        aria-label={has ? `${label}: ${k.unit(value as number)}, ${RATING_LABEL[band as Rating]}` : `${label}: not measured`}
      >
        <span className="wg-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="wg-word">{has ? `${RATING_LABEL[band as Rating]}${counted ? '' : ' · not counted'}` : 'Not measured'}</div>
    </div>
  )
}

export default function WheelGauges({
  kind,
  measure,
  paper = false,
}: {
  kind: 'tread' | 'pads'
  measure: TreadMeasure | null | undefined
  /** On the printed report: paper colours that survive a PDF. */
  paper?: boolean
}) {
  const k = KIND[kind]
  const spare = kind === 'tread' && typeof measure?.spare === 'number'
  return (
    <div className={`wg${paper ? ' is-paper' : ''}`}>
      <div className="wg-grid">
        {WHEELS.map((w) => (
          <Cell key={w.key} label={w.label} value={measure?.[w.key]} kind={kind} counted />
        ))}
        {spare && <Cell label="Spare" value={measure?.spare} kind={kind} counted={false} />}
      </div>
      <p className="wg-key">
        Bars show {k.scale} left, out of {FULL}. {k.limits[1]} and up is OK, {k.limits[0]} to under {k.limits[1]} is Watch,
        under {k.limits[0]} Needs attention.
      </p>
    </div>
  )
}
