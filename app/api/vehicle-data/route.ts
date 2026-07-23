import { clientForRequest, unauthorized } from '@/lib/server'

/**
 * Vehicle autofill data, proxied server-side so the browser has one authed,
 * CORS-free endpoint. Sources are official/free — no API keys:
 *  - NHTSA vPIC: makes, models per make+year, and full VIN decode
 *  - EPA fueleconomy.gov: engine options per year/make/model
 * Everything here powers *suggestions* — fields stay free text (spec rule:
 * no fixed dropdowns), so a data gap never blocks entry.
 */

const NHTSA = 'https://vpic.nhtsa.dot.gov/api/vehicles'
const EPA = 'https://www.fueleconomy.gov/ws/rest/vehicle/menu'

// Warm-instance caches (serverless-friendly; makes list barely changes).
// Suggestion caches are capped and only store non-empty results, so a
// transient upstream hiccup is never pinned for the instance lifetime.
let makesCache: string[] | null = null
const modelsCache = new Map<string, string[]>()
const enginesCache = new Map<string, string[]>()
const CACHE_MAX_ENTRIES = 500

function cacheSet(map: Map<string, string[]>, key: string, value: string[]) {
  if (value.length === 0) return
  if (map.size >= CACHE_MAX_ENTRIES) map.clear()
  map.set(key, value)
}

async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`${res.status} from upstream`)
  return res.json()
}

// Short names are usually acronyms (BMW, GMC, RAM) — except the known few.
const SHORT_MAKE_CASING: Record<string, string> = { KIA: 'Kia', GEO: 'Geo' }

/** "MERCEDES-BENZ" -> "Mercedes-Benz", "BMW" -> "BMW", "KIA" -> "Kia" */
function titleCaseMake(raw: string): string {
  return raw
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) => {
          const upper = part.toUpperCase()
          if (part.length <= 3) return SHORT_MAKE_CASING[upper] ?? upper
          return part[0].toUpperCase() + part.slice(1).toLowerCase()
        })
        .join('-'),
    )
    .join(' ')
}

async function fetchMakes(): Promise<string[]> {
  if (makesCache) return makesCache
  // Cars alone would miss truck-only makes (RAM, etc.) — union the passenger types.
  const types = ['car', 'truck', 'mpv']
  const results = await Promise.allSettled(
    types.map(
      (t) =>
        getJson(`${NHTSA}/GetMakesForVehicleType/${t}?format=json`) as Promise<{
          Results?: { MakeName?: string | null }[]
        }>,
    ),
  )
  const set = new Set<string>()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const row of r.value.Results ?? []) {
      const name = (row.MakeName ?? '').trim()
      if (name) set.add(titleCaseMake(name))
    }
  }
  const makes = [...set].sort()
  // Only pin the cache when every vehicle type answered — a partial union
  // (e.g. the truck request timing out) must not stick for the instance.
  if (makes.length && results.every((r) => r.status === 'fulfilled')) makesCache = makes
  return makes
}

async function fetchModels(year: string, make: string): Promise<string[]> {
  const key = `${year}|${make.toLowerCase()}`
  const hit = modelsCache.get(key)
  if (hit) return hit
  const data = (await getJson(
    `${NHTSA}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${encodeURIComponent(year)}?format=json`,
  )) as { Results?: { Model_Name?: string | null }[] }
  const models = [
    ...new Set(
      (data.Results ?? [])
        .map((r) => (r.Model_Name ?? '').trim())
        .filter(Boolean),
    ),
  ].sort()
  cacheSet(modelsCache, key, models)
  return models
}

/** "Auto (S5), 4 cyl, 2.5 L, Turbo" -> "2.5L 4-cyl Turbo" (null when there's no engine info to parse). */
function parseEpaEngine(text: string): string | null {
  const m = text.match(/(\d+)\s*cyl,\s*([\d.]+)\s*L(.*)$/i)
  if (!m) return null
  const extras = m[3]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/^(auto|man|automatic|manual)/i.test(s))
  return `${m[2]}L ${m[1]}-cyl${extras.length ? ' ' + extras.join(' ') : ''}`
}

/**
 * Match the user's model against EPA's own model strings without dragging in
 * sibling models (typing "M3" must not pull "M340i" engines; "Corolla Cross"
 * must not merge plain "Corolla"). Exact matches win outright; otherwise only
 * word-boundary prefix matches count.
 */
function matchEpaModels(epaModels: string[], userModel: string): string[] {
  const needle = userModel.toLowerCase().trim()
  if (!needle) return []
  const lower = epaModels.map((v) => [v, v.toLowerCase().trim()] as const)
  const exact = lower.filter(([, l]) => l === needle).map(([v]) => v)
  if (exact.length) return exact.slice(0, 5)
  return lower
    .filter(([, l]) => l.startsWith(`${needle} `) || needle.startsWith(`${l} `))
    .map(([v]) => v)
    .slice(0, 5)
}

async function fetchEngines(year: string, make: string, model: string): Promise<string[]> {
  const key = `${year}|${make.toLowerCase()}|${model.toLowerCase()}`
  const hit = enginesCache.get(key)
  if (hit) return hit

  // Tighter budgets here: this op is two sequential upstream stages, and the
  // whole handler should stay inside a ~10s serverless window.
  const menu = (await getJson(
    `${EPA}/model?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}`,
    4500,
  )) as { menuItem?: { value: string } | { value: string }[] } | null
  const items = [menu?.menuItem ?? []].flat() as { value: string }[]
  const matches = matchEpaModels(items.map((i) => i.value).filter(Boolean), model)

  const engines = new Set<string>()
  await Promise.all(
    matches.map(async (epaModel) => {
      try {
        const opts = (await getJson(
          `${EPA}/options?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(epaModel)}`,
          4500,
        )) as { menuItem?: { text: string } | { text: string }[] } | null
        for (const item of [opts?.menuItem ?? []].flat() as { text: string }[]) {
          const parsed = parseEpaEngine(item.text ?? '')
          if (parsed) engines.add(parsed)
        }
      } catch {
        // One EPA variant failing shouldn't sink the rest.
      }
    }),
  )
  const sorted = [...engines].sort()
  cacheSet(enginesCache, key, sorted)
  return sorted
}

interface VinDecode {
  year: string | null
  make: string | null
  model: string | null
  trim: string | null
  engine: string | null
  note: string | null
}

function buildVinEngine(r: Record<string, string>): string | null {
  const parts: string[] = []
  if (r.DisplacementL) {
    const liters = Number(r.DisplacementL)
    parts.push(`${Number.isFinite(liters) ? liters.toFixed(1) : r.DisplacementL}L`)
  }
  const cyl = r.EngineCylinders
  if (cyl) {
    const cfg = (r.EngineConfiguration || '').toLowerCase()
    if (cfg.includes('v-shaped')) parts.push(`V${cyl}`)
    else if (cfg.includes('in-line')) parts.push(`I${cyl}`)
    else if (cfg.includes('horizontal')) parts.push(`H${cyl}`)
    else parts.push(`${cyl}-cyl`)
  }
  if (r.OtherEngineInfo?.toLowerCase().includes('turbo') || r.Turbo === 'Yes') parts.push('Turbo')
  const fuel = r.FuelTypePrimary
  if (fuel && !/gasoline/i.test(fuel)) parts.push(fuel)
  if (r.EngineModel) parts.push(`(${r.EngineModel})`)
  return parts.length ? parts.join(' ') : null
}

async function decodeVin(vin: string): Promise<VinDecode> {
  const data = (await getJson(`${NHTSA}/DecodeVinValues/${encodeURIComponent(vin)}?format=json`)) as {
    Results?: Record<string, string>[]
  }
  const r = data.Results?.[0]
  if (!r) throw new Error('no decode result')
  // Undecodable VINs come back with empty fields + a descriptive ErrorText —
  // surface that as a friendly 200 note rather than a generic failure.
  if (!r.ModelYear && !r.Model) {
    return {
      year: null, make: null, model: null, trim: null, engine: null,
      note: r.ErrorText?.split(';')[0]?.trim() || 'VIN could not be decoded',
    }
  }
  return {
    year: r.ModelYear || null,
    make: r.Make ? titleCaseMake(r.Make) : null,
    model: r.Model || null,
    trim: r.Trim || r.Series || null,
    engine: buildVinEngine(r),
    note: r.ErrorCode && r.ErrorCode !== '0' ? 'Decoded with warnings — double-check the fields' : null,
  }
}

export async function GET(request: Request) {
  const auth = await clientForRequest(request)
  if (!auth) return unauthorized()

  const url = new URL(request.url)
  const op = url.searchParams.get('op')
  const year = url.searchParams.get('year')?.trim() ?? ''
  const make = url.searchParams.get('make')?.trim() ?? ''
  const model = url.searchParams.get('model')?.trim() ?? ''
  const vin = url.searchParams.get('vin')?.trim() ?? ''

  try {
    switch (op) {
      case 'makes':
        return Response.json({ makes: await fetchMakes() })
      case 'models':
        if (!/^\d{4}$/.test(year) || !make) return Response.json({ models: [] })
        return Response.json({ models: await fetchModels(year, make) })
      case 'engines':
        if (!/^\d{4}$/.test(year) || !make || !model) return Response.json({ engines: [] })
        return Response.json({ engines: await fetchEngines(year, make, model) })
      case 'vin':
        if (vin.length < 11) return Response.json({ error: 'VIN looks too short' }, { status: 400 })
        return Response.json(await decodeVin(vin))
      default:
        return Response.json({ error: 'unknown op' }, { status: 400 })
    }
  } catch (e) {
    // Suggestions are best-effort: upstream hiccups return empty rather than erroring the UI.
    if (op === 'vin') {
      return Response.json(
        { error: e instanceof Error ? e.message : 'decode failed' },
        { status: 502 },
      )
    }
    return Response.json({ makes: [], models: [], engines: [] })
  }
}
