'use client'

import { useState } from 'react'
import DamageChart from '@/components/DamageChart'
import {
  DAMAGE_KINDS,
  chartId,
  cleanMarks,
  markWords,
  styleOf,
  type BodyStyle,
  type DamageKind,
  type DamageMark,
} from '@/lib/damage-chart'
import type { DamageMeasure } from '@/lib/inspections'

/**
 * Highlighting body damage on the chart (owner, 2026-11-27: "a chart to locate
 * and acknowledge body damage ... a visual representation of the type of car
 * that's being inspected"). Phone-first: one tap on the picture highlights a
 * place, one tap says what it is. A note is optional.
 *
 * The picture is the vehicle's type. It starts on the type its model suggests
 * and one tap changes it, until the first place is highlighted: after that the
 * highlights belong to that drawing.
 *
 * Three things an empty chart cannot say by itself, each with its own control:
 *  - "No body damage found" (he looked; there was none),
 *  - what each highlight is, in words, listed under the picture,
 *  - who on the customer's side was shown the chart and agreed it is right.
 *
 * The acknowledgement is taken while the report is still a draft, which is
 * when the vehicle is dropped off; a final report is frozen, name included.
 */

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  }
}

export default function DamageEditor({
  measure,
  suggested,
  options,
  disabled,
  onChange,
}: {
  measure: DamageMeasure | null
  /** The type the vehicle's model suggests: what a new chart starts on. */
  suggested: BodyStyle
  /** The drawings offered for this vehicle: its model’s own first, then the general types. */
  options: { value: BodyStyle; label: string }[]
  /** The report is final or void: read only. */
  disabled: boolean
  onChange: (next: DamageMeasure) => void
}) {
  const marks = cleanMarks(measure?.marks)
  const body = styleOf(measure?.chart) ?? suggested
  const [pending, setPending] = useState<{ x: number; y: number; where: string } | null>(null)

  function save(patch: Partial<DamageMeasure>) {
    onChange({
      // Always the drawing on screen, so a report never finalizes without it.
      chart: chartId(body),
      marks,
      none: measure?.none ?? false,
      ack_name: measure?.ack_name ?? null,
      ack_at: measure?.ack_at ?? null,
      ...patch,
    })
  }

  function name(kind: DamageKind) {
    if (!pending) return
    const mark: DamageMark = { id: newId(), x: pending.x, y: pending.y, kind, where: pending.where, note: null }
    setPending(null)
    // A highlight on the chart and "none found" cannot both be true.
    save({ marks: [...marks, mark], none: false })
  }

  return (
    <div className="dmg-edit">
      {!disabled && (
        <div className="space-y-1">
          <span className="label !mb-0" id="dmg-type-label">
            Vehicle type
          </span>
          <div className="seg-track seg-wrap" role="group" aria-labelledby="dmg-type-label">
            {options.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`seg-item ${body === s.value ? 'on' : ''}`}
                aria-pressed={body === s.value}
                // The highlights were placed on this drawing; another type's
                // doors and panels are in other places.
                disabled={marks.length > 0 && body !== s.value}
                onClick={() => {
                  setPending(null)
                  save({ chart: chartId(s.value) })
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            {marks.length > 0
              ? 'To change the type, remove the highlights first.'
              : 'Tap the picture where the damage is, then say what it is.'}
          </p>
        </div>
      )}
      <DamageChart
        body={body}
        marks={marks}
        pending={pending}
        onPlace={disabled ? undefined : (x, y, where) => setPending({ x, y, where })}
      />

      {pending && (
        <div className="dmg-ask" role="group" aria-label={`What is the damage at ${pending.where}?`}>
          <div className="text-sm font-semibold">
            {marks.length + 1}. {pending.where}: what is it?
          </div>
          <div className="dmg-kinds">
            {DAMAGE_KINDS.map((k) => (
              <button key={k.value} type="button" className="btn btn-sm" onClick={() => name(k.value)}>
                {k.label}
              </button>
            ))}
            <button type="button" className="btn btn-sm dmg-cancel" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {marks.length > 0 && (
        <ol className="dmg-list">
          {marks.map((m, i) => (
            <li key={m.id} className="dmg-row">
              <span className="dmg-num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm">{markWords(m)}</div>
                <input
                  className="input"
                  disabled={disabled}
                  placeholder="Note (prints on the report)"
                  aria-label={`Note for ${i + 1}, ${markWords(m)}`}
                  defaultValue={m.note ?? ''}
                  onBlur={(e) => {
                    const note = e.target.value.trim() || null
                    if (note !== (m.note ?? null)) save({ marks: marks.map((x) => (x.id === m.id ? { ...x, note } : x)) })
                  }}
                />
              </div>
              {!disabled && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger min-w-[44px] !px-2"
                  aria-label={`Remove ${i + 1}, ${markWords(m)}`}
                  onClick={() => save({ marks: marks.filter((x) => x.id !== m.id) })}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {marks.length === 0 && (
        <label className="flex min-h-[44px] items-center gap-2 text-sm">
          <input type="checkbox" disabled={disabled} checked={!!measure?.none} onChange={(e) => save({ none: e.target.checked })} />
          No body damage found
        </label>
      )}

      <label className="block space-y-1">
        <span className="label">Shown to and acknowledged by</span>
        <input
          className="input"
          disabled={disabled}
          placeholder="Customer’s name, once they have seen the chart"
          defaultValue={measure?.ack_name ?? ''}
          onBlur={(e) => {
            const ack = e.target.value.trim() || null
            if (ack === (measure?.ack_name ?? null)) return
            // The time is when the name went in: that is the moment they agreed.
            save({ ack_name: ack, ack_at: ack ? new Date().toISOString() : null })
          }}
        />
        <span className="block text-xs" style={{ color: 'var(--text3)' }}>
          {measure?.ack_name && measure.ack_at
            ? `Recorded ${new Date(measure.ack_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}. Prints on the report.`
            : 'Leave it blank to print a line for them to sign instead.'}
        </span>
      </label>
    </div>
  )
}
