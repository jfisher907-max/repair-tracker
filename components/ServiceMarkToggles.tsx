'use client'

import { SERVICE_MARKS, SERVICE_MARK_LABEL, type ServiceMarks } from '@/lib/service-line'

/**
 * AOG and Nights & weekends (0065): two independent 44px toggles on aircraft
 * work — either, both or neither. The job and quote forms show them only when
 * the line is aviation. Words on the customer's paper, never a price: the
 * labor rate beside them stays whatever the owner sets ("keep the rate
 * flexible", 2026-09-30).
 */
export default function ServiceMarkToggles({
  id,
  value,
  onChange,
}: {
  /** Prefix for the group's label id (one group per form). */
  id: string
  value: ServiceMarks
  onChange: (next: ServiceMarks) => void
}) {
  return (
    <div>
      <span className="label" id={`${id}-label`}>{SERVICE_MARK_LABEL}</span>
      <div role="group" aria-labelledby={`${id}-label`} className="grid grid-cols-2 gap-2">
        {SERVICE_MARKS.map((m) => {
          const on = value[m.key]
          return (
            <button
              key={m.key}
              type="button"
              className="btn btn-sm !min-h-[44px]"
              aria-pressed={on}
              style={on ? { borderColor: 'var(--accent)', color: 'var(--accent2)' } : undefined}
              onClick={() => onChange({ ...value, [m.key]: !on })}
            >
              {/* Two can be on at once, so on says so in more than colour. */}
              {on && '✓ '}
              {m.label}
            </button>
          )
        })}
      </div>
      <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
        Either, both or neither. Printed on the customer’s quote and invoice; the labor rate
        stays what you set.
      </p>
    </div>
  )
}
