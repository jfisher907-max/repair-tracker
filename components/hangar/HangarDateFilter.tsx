'use client'

import type { HangarDateFilter as Filter, HangarPreset } from '@/lib/hangar-stats'

const ALL_PRESETS: { key: HangarPreset; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'last_30', label: 'Last 30 Days' },
  { key: 'last_90', label: 'Last 90 Days' },
  { key: 'custom', label: 'Custom' },
]

export default function HangarDateFilter({
  filter,
  onChange,
  presets,
}: {
  filter: Filter
  onChange: (f: Filter) => void
  presets?: HangarPreset[]
}) {
  const shown = presets ? ALL_PRESETS.filter((p) => presets.includes(p.key)) : ALL_PRESETS
  return (
    <div className="card mb-4">
      <div className="label mb-2">Date range</div>
      <div className="flex flex-wrap gap-2">
        {shown.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`btn btn-sm ${filter.preset === p.key ? 'btn-primary' : ''}`}
            onClick={() => onChange({ ...filter, preset: p.key })}
          >
            {p.label}
          </button>
        ))}
      </div>
      {filter.preset === 'custom' && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[150px] flex-1">
            <div className="label">From</div>
            <input
              type="date"
              className="input w-full"
              value={filter.start ?? ''}
              onChange={(e) => onChange({ ...filter, start: e.target.value || null })}
            />
          </div>
          <div className="min-w-[150px] flex-1">
            <div className="label">To</div>
            <input
              type="date"
              className="input w-full"
              value={filter.end ?? ''}
              onChange={(e) => onChange({ ...filter, end: e.target.value || null })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
