'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { getAccessToken } from '@/lib/supabase'

export interface VehicleDraft {
  year: string
  make: string
  model: string
  trim: string
  engine: string
  vin: string
  license_plate: string
}

export const emptyVehicleDraft: VehicleDraft = {
  year: '', make: '', model: '', trim: '', engine: '', vin: '', license_plate: '',
}

async function fetchData(params: Record<string, string>): Promise<Record<string, unknown>> {
  const token = await getAccessToken()
  if (!token) throw new Error('not signed in')
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`/api/vehicle-data?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error ?? `HTTP ${res.status}`)
  return res.json()
}

const YEARS = Array.from({ length: new Date().getFullYear() + 2 - 1950 }, (_, i) =>
  String(new Date().getFullYear() + 1 - i),
)

/**
 * Shared vehicle entry fields with live autofill:
 * - suggestions for year/make (NHTSA), model (NHTSA, per make+year), and
 *   engine (EPA, per year/make/model) — all still free text, never a locked list
 * - "Decode VIN" fills year/make/model/trim/engine from the official NHTSA
 *   decoder (the accurate path — it reads the exact vehicle's build data)
 * Suggestion fetches degrade silently; only the explicit VIN decode reports errors.
 */
export default function VehicleFields({
  value,
  onChange,
}: {
  value: VehicleDraft
  onChange: (v: VehicleDraft) => void
}) {
  const uid = useId()
  const [makes, setMakes] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [engines, setEngines] = useState<string[]>([])
  const [decoding, setDecoding] = useState(false)
  const [vinStatus, setVinStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  })

  useEffect(() => {
    let cancelled = false
    fetchData({ op: 'makes' })
      .then((d) => {
        if (!cancelled) setMakes((d.makes as string[]) ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const { year, make, model } = value
  useEffect(() => {
    setModels([])
    if (!/^\d{4}$/.test(year) || make.trim().length < 2) return
    let cancelled = false
    const t = setTimeout(() => {
      fetchData({ op: 'models', year, make: make.trim() })
        .then((d) => {
          // Staleness guard: a slow response for an old make/year must not
          // overwrite the list for what's currently typed.
          if (!cancelled) setModels((d.models as string[]) ?? [])
        })
        .catch(() => {})
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [year, make])

  useEffect(() => {
    setEngines([])
    if (!/^\d{4}$/.test(year) || make.trim().length < 2 || model.trim().length < 2) return
    let cancelled = false
    const t = setTimeout(() => {
      fetchData({ op: 'engines', year, make: make.trim(), model: model.trim() })
        .then((d) => {
          if (!cancelled) setEngines((d.engines as string[]) ?? [])
        })
        .catch(() => {})
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [year, make, model])

  async function decodeVin() {
    const vin = latest.current.vin.trim().toUpperCase()
    if (vin.length < 11) {
      setVinStatus({ ok: false, msg: 'Enter the full VIN first — 17 characters on modern vehicles.' })
      return
    }
    setDecoding(true)
    setVinStatus(null)
    try {
      const d = (await fetchData({ op: 'vin', vin })) as {
        year: string | null; make: string | null; model: string | null
        trim: string | null; engine: string | null; note: string | null
      }
      const decodedAnything = !!(d.year || d.make || d.model || d.trim || d.engine)
      if (!decodedAnything) {
        setVinStatus({ ok: false, msg: d.note ?? 'VIN could not be decoded — fill fields in manually.' })
        setDecoding(false)
        return
      }
      // Fill from the freshest draft; decoded blanks never wipe typed values,
      // and the VIN field itself is left exactly as the user has it.
      const cur = latest.current
      onChange({
        ...cur,
        year: d.year ?? cur.year,
        make: d.make ?? cur.make,
        model: d.model ?? cur.model,
        trim: d.trim ?? cur.trim,
        engine: d.engine ?? cur.engine,
      })
      const summary = [d.year, d.make, d.model, d.trim].filter(Boolean).join(' ')
      setVinStatus({
        ok: true,
        msg: d.note ? `${summary} — ${d.note}` : `Decoded: ${summary} ✓ (NHTSA)`,
      })
    } catch (e) {
      setVinStatus({
        ok: false,
        msg: `Couldn't decode that VIN (${e instanceof Error ? e.message : 'error'}) — fill fields in manually.`,
      })
    }
    setDecoding(false)
  }

  function set(patch: Partial<VehicleDraft>) {
    onChange({ ...value, ...patch })
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="input flex-1 uppercase"
          placeholder="VIN — fastest way: type it and decode"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={value.vin}
          onChange={(e) => {
            setVinStatus(null)
            set({ vin: e.target.value })
          }}
          onKeyDown={(e) => {
            // Enter here should decode, not submit an enclosing form (which
            // in the job flow would create the job prematurely).
            if (e.key === 'Enter') {
              e.preventDefault()
              decodeVin()
            }
          }}
        />
        <button type="button" className="btn" onClick={decodeVin} disabled={decoding}>
          {decoding ? 'Decoding…' : '⚡ Decode VIN'}
        </button>
      </div>
      {vinStatus && (
        <p className="text-sm" style={{ color: vinStatus.ok ? 'var(--green)' : 'var(--red)' }}>
          {vinStatus.msg}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <input
          className="input"
          inputMode="numeric"
          placeholder="Year"
          list={`${uid}-years`}
          value={value.year}
          onChange={(e) => set({ year: e.target.value })}
        />
        <input
          className="input"
          placeholder="Make"
          list={`${uid}-makes`}
          value={value.make}
          onChange={(e) => set({ make: e.target.value })}
        />
        <input
          className="input"
          placeholder="Model"
          list={`${uid}-models`}
          value={value.model}
          onChange={(e) => set({ model: e.target.value })}
        />
        <input
          className="input"
          placeholder="Trim (LX, TRD, 2.5i…)"
          value={value.trim}
          onChange={(e) => set({ trim: e.target.value })}
        />
        <input
          className="input"
          placeholder="Engine"
          list={`${uid}-engines`}
          value={value.engine}
          onChange={(e) => set({ engine: e.target.value })}
        />
        <input
          className="input"
          placeholder="Plate"
          value={value.license_plate}
          onChange={(e) => set({ license_plate: e.target.value })}
        />
      </div>
      <datalist id={`${uid}-years`}>
        {YEARS.map((y) => <option key={y} value={y} />)}
      </datalist>
      <datalist id={`${uid}-makes`}>
        {makes.map((m) => <option key={m} value={m} />)}
      </datalist>
      <datalist id={`${uid}-models`}>
        {models.map((m) => <option key={m} value={m} />)}
      </datalist>
      <datalist id={`${uid}-engines`}>
        {engines.map((e) => <option key={e} value={e} />)}
      </datalist>
    </div>
  )
}

/** Shared insert/update payload builder so every call site persists identically. */
export function vehiclePayload(draft: VehicleDraft) {
  return {
    year: draft.year.trim() ? Number(draft.year.trim()) : null,
    make: draft.make.trim() || null,
    model: draft.model.trim() || null,
    trim: draft.trim.trim() || null,
    engine: draft.engine.trim() || null,
    vin: draft.vin.trim().toUpperCase() || null,
    license_plate: draft.license_plate.trim() || null,
  }
}
