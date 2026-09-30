'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { getAccessToken } from '@/lib/supabase'
import { lineOf, normalizeRegistration, type ServiceLine } from '@/lib/service-line'
import type { Vehicle } from '@/lib/types'

export interface VehicleDraft {
  /** Vehicle or Aircraft (AVN-3): which fields show, and which paper its
   *  quotes and invoices get. */
  service_line: ServiceLine
  year: string
  make: string
  model: string
  trim: string
  engine: string
  vin: string
  license_plate: string
  /** Aircraft only: the tail number and the serial number. */
  registration: string
  serial_number: string
}

export const emptyVehicleDraft: VehicleDraft = {
  service_line: 'automotive',
  year: '', make: '', model: '', trim: '', engine: '', vin: '', license_plate: '',
  registration: '', serial_number: '',
}

/** A saved vehicle as an editable draft (the vehicle page's Edit). */
export function vehicleDraftFrom(v: Vehicle): VehicleDraft {
  return {
    service_line: lineOf(v),
    year: v.year != null ? String(v.year) : '',
    make: v.make ?? '',
    model: v.model ?? '',
    trim: v.trim ?? '',
    engine: v.engine ?? '',
    vin: v.vin ?? '',
    license_plate: v.license_plate ?? '',
    registration: v.registration ?? '',
    serial_number: v.serial_number ?? '',
  }
}

/**
 * Anything typed for the chosen kind — the Vehicle / Aircraft choice itself is
 * not an entry, and neither is a car field left behind after switching to
 * Aircraft (vehiclePayload drops those). The "only create one if something
 * was filled in" test every add form uses.
 */
export function vehicleDraftHasAnything(d: VehicleDraft): boolean {
  const fields =
    d.service_line === 'aviation'
      ? [d.registration, d.year, d.make, d.model, d.serial_number]
      : [d.year, d.make, d.model, d.trim, d.engine, d.vin, d.license_plate]
  return fields.some((v) => v.trim() !== '')
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
 *
 * Aircraft (AVN-3): a Vehicle / Aircraft pair at the top. Aircraft asks for
 * tail number, year, make, model and serial number — no VIN, no plate, and no
 * NHTSA lookups (they are road-vehicle data). The placeholders name no
 * aircraft type (AVN-2). Once the vehicle has a job or quote the kind is fixed
 * (kindLocked; migration 0055 refuses the change too).
 */
export default function VehicleFields({
  value,
  onChange,
  kindLocked = false,
}: {
  value: VehicleDraft
  onChange: (v: VehicleDraft) => void
  /** The vehicle already has work on it: the choice shows, read-only. */
  kindLocked?: boolean
}) {
  const uid = useId()
  const isAircraft = value.service_line === 'aviation'
  const [makes, setMakes] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [engines, setEngines] = useState<string[]>([])
  const [decoding, setDecoding] = useState(false)
  const [vinStatus, setVinStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  })

  // Road-vehicle makes: fetched when the form shows a vehicle, never for an
  // aircraft (and once only — a list already here is kept).
  const haveMakes = makes.length > 0
  useEffect(() => {
    if (isAircraft || haveMakes) return
    let cancelled = false
    fetchData({ op: 'makes' })
      .then((d) => {
        if (!cancelled) setMakes((d.makes as string[]) ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isAircraft, haveMakes])

  const { year, make, model } = value
  useEffect(() => {
    setModels([])
    if (isAircraft || !/^\d{4}$/.test(year) || make.trim().length < 2) return
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
  }, [isAircraft, year, make])

  useEffect(() => {
    setEngines([])
    if (isAircraft || !/^\d{4}$/.test(year) || make.trim().length < 2 || model.trim().length < 2) return
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
  }, [isAircraft, year, make, model])

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

  /** Vehicle | Aircraft — two 44px buttons. Read-only once the vehicle has work. */
  const kindPicker = (
    <div role="group" aria-label="Vehicle or aircraft" className="grid grid-cols-2 gap-2">
      {(['automotive', 'aviation'] as const).map((k) => {
        const on = value.service_line === k
        return (
          <button
            key={k}
            type="button"
            className="btn btn-sm !min-h-[44px]"
            aria-pressed={on}
            disabled={kindLocked && !on}
            style={on ? { borderColor: 'var(--accent)', color: 'var(--accent2)' } : undefined}
            onClick={() => {
              if (kindLocked || on) return
              setVinStatus(null)
              set({ service_line: k })
            }}
          >
            {k === 'aviation' ? 'Aircraft' : 'Vehicle'}
          </button>
        )
      })}
    </div>
  )

  if (isAircraft) {
    return (
      <div className="space-y-2">
        {kindPicker}
        {kindLocked && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            It already has work on it, so it stays an aircraft. Entered as the wrong kind? Add it
            again as a vehicle.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <input
            className="input col-span-2 uppercase sm:col-span-1"
            placeholder="Tail number"
            aria-label="Tail number"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={value.registration}
            // Stored uppercase, no spaces (normalizeRegistration) — shown that way as typed.
            onChange={(e) => set({ registration: normalizeRegistration(e.target.value) })}
          />
          <input
            className="input"
            inputMode="numeric"
            placeholder="Year"
            aria-label="Year"
            list={`${uid}-years`}
            value={value.year}
            onChange={(e) => set({ year: e.target.value })}
          />
          <input
            className="input"
            placeholder="Make"
            aria-label="Make"
            value={value.make}
            onChange={(e) => set({ make: e.target.value })}
          />
          <input
            className="input"
            placeholder="Model"
            aria-label="Model"
            value={value.model}
            onChange={(e) => set({ model: e.target.value })}
          />
          <input
            className="input"
            placeholder="Serial number"
            aria-label="Serial number"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={value.serial_number}
            onChange={(e) => set({ serial_number: e.target.value })}
          />
        </div>
        <datalist id={`${uid}-years`}>
          {YEARS.map((y) => <option key={y} value={y} />)}
        </datalist>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {kindPicker}
      {kindLocked && (
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          It already has work on it, so it stays a vehicle. Entered as the wrong kind? Add it again
          as an aircraft.
        </p>
      )}
      <div className="flex gap-2">
        <input
          className="input flex-1 uppercase"
          placeholder="VIN — scan it with the camera or type it"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          enterKeyHint="go"
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
          {decoding ? 'Decoding…' : <>Decode VIN</>}
        </button>
      </div>
      {vinStatus ? (
        <p className="text-sm" style={{ color: vinStatus.ok ? 'var(--green)' : 'var(--red)' }}>
          {vinStatus.msg}
        </p>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          On iPhone: tap the field, then the scan-text button on the keyboard, and point the
          camera at the door-jamb sticker or windshield plate. Decode fills the rest.
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

/**
 * Shared insert/update payload builder so every call site persists identically.
 * The other kind's fields go as null — a car field left in the draft after
 * switching to Aircraft (or the reverse) never reaches the database, so its
 * CHECK (vehicles_line_fields_check, 0055) never fires from a form.
 */
export function vehiclePayload(draft: VehicleDraft) {
  const aircraft = draft.service_line === 'aviation'
  return {
    service_line: draft.service_line,
    year: draft.year.trim() ? Number(draft.year.trim()) : null,
    make: draft.make.trim() || null,
    model: draft.model.trim() || null,
    trim: aircraft ? null : draft.trim.trim() || null,
    engine: aircraft ? null : draft.engine.trim() || null,
    vin: aircraft ? null : draft.vin.trim().toUpperCase() || null,
    license_plate: aircraft ? null : draft.license_plate.trim() || null,
    registration: aircraft ? normalizeRegistration(draft.registration) || null : null,
    serial_number: aircraft ? draft.serial_number.trim() || null : null,
  }
}
