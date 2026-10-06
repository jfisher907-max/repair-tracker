import { supabase } from './supabase'
import { dbErrorWords } from './db-errors'
import { TEMPLATES, type InspectionPackage, type MeasureKind } from './inspection-templates'
import type { Vehicle } from './types'

/**
 * Pre-purchase inspections (0067). The owner's side: start one from a job,
 * fill it in, finalize it, share it. The customer's side reads
 * get_public_inspection by the report's own link.
 */

export type Rating = 'ok' | 'watch' | 'attention' | 'not_checked' | 'na'
export type Verdict = 'no_major' | 'repairs' | 'major'
export type InspectionStatus = 'draft' | 'final' | 'void'

/** Tread in 32nds per tire; battery in cold-cranking amps. */
export interface TreadMeasure { lf?: number | null; rf?: number | null; lr?: number | null; rr?: number | null; spare?: number | null }
export interface BatteryMeasure { rated_cca?: number | null; measured_cca?: number | null }

export interface Inspection {
  id: string
  report_number: string
  job_id: string
  package: InspectionPackage
  status: InspectionStatus
  prepared_for: string | null
  seller_name: string | null
  odometer_miles: number | null
  inspected_on: string
  road_test_done: boolean | null
  road_test_reason: string | null
  recalls_note: string | null
  verdict: Verdict | null
  summary_note: string | null
  show_costs: boolean
  vehicle_snapshot: VehicleSnapshot | null
  signed_by_name: string | null
  finalized_at: string | null
  public_token: string
  link_revoked_at: string | null
  created_at: string
  updated_at: string
}

export interface InspectionItem {
  id: string
  inspection_id: string
  section: string
  position: number
  label: string
  needs: string | null
  measure_kind: MeasureKind | null
  rating: Rating | null
  note: string | null
  measure: (TreadMeasure & BatteryMeasure) | null
  cost_low_cents: number | null
  cost_high_cents: number | null
  custom: boolean
}

export interface VehicleSnapshot {
  year: number | null
  make: string | null
  model: string | null
  trim: string | null
  engine: string | null
  vin: string | null
  plate: string | null
}

/** The four words the customer sees, plus N/A (left off the report). */
export const RATINGS: { value: Rating; label: string; meaning: string }[] = [
  { value: 'ok', label: 'OK', meaning: 'Works as it should for its age and miles.' },
  { value: 'watch', label: 'Watch', meaning: 'Works today but worn or close to a limit. Plan for it.' },
  { value: 'attention', label: 'Needs attention', meaning: 'Not working, past a limit, leaking, or a safety item.' },
  { value: 'not_checked', label: 'Not checked', meaning: 'Could not be checked this visit (reason given).' },
  { value: 'na', label: 'N/A', meaning: 'The car doesn’t have it. Left off the report.' },
]
export const RATING_LABEL: Record<Rating, string> = Object.fromEntries(RATINGS.map((r) => [r.value, r.label])) as Record<Rating, string>

/** Describes what was found — never "buy" or "don't buy". */
export const VERDICTS: { value: Verdict; label: string }[] = [
  { value: 'no_major', label: 'No major concerns found' },
  { value: 'repairs', label: 'Repairs to price in' },
  { value: 'major', label: 'Major concerns found' },
]
export const VERDICT_LABEL: Record<Verdict, string> = Object.fromEntries(VERDICTS.map((v) => [v.value, v.label])) as Record<Verdict, string>

/** Plain words printed on every report. Not a warranty; not advice to buy. */
export const INSPECTION_DISCLAIMER =
  'This is our honest look at this vehicle on the date and at the mileage shown, using the checks listed in this report. It is not a warranty or a guarantee, and it is not advice to buy or not to buy. Cars can develop problems at any time, and some problems can only be found by taking parts apart, which we did not do. Anything marked Not checked was not inspected. Recall results come from an outside database that can be incomplete. Cost ranges are rough numbers for planning and negotiating; they are not a repair estimate, and we will give a written estimate and get the owner’s OK before doing any work. This report was prepared for the person named above. If someone forwarded it to you, you are welcome to call us, and we recommend getting your own inspection.'

/**
 * Tread limits (32nds): 6+ OK, 4–5 Watch, 3 or less Needs attention. Alaska's
 * legal minimum is 2/32. The worst tire decides; the spare is not counted.
 */
export function treadRating(m: TreadMeasure | null | undefined): Rating | null {
  const vals = [m?.lf, m?.rf, m?.lr, m?.rr].filter((v): v is number => typeof v === 'number')
  if (vals.length === 0) return null
  const worst = Math.min(...vals)
  return worst >= 6 ? 'ok' : worst >= 4 ? 'watch' : 'attention'
}

/** Battery: 75%+ of rated CCA OK, 60–74% Watch, under 60% Needs attention. */
export function batteryRating(m: BatteryMeasure | null | undefined): Rating | null {
  if (!m?.rated_cca || m.measured_cca == null) return null
  const pct = m.measured_cca / m.rated_cca
  return pct >= 0.75 ? 'ok' : pct >= 0.6 ? 'watch' : 'attention'
}

/** The verdict the app suggests from the ratings; the owner picks. */
export function suggestVerdict(items: Pick<InspectionItem, 'rating'>[]): Verdict {
  const attention = items.filter((i) => i.rating === 'attention').length
  const watch = items.filter((i) => i.rating === 'watch').length
  if (attention >= 3) return 'major'
  if (attention > 0 || watch > 0) return 'repairs'
  return 'no_major'
}

export function vehicleSnapshot(v: Vehicle | null): VehicleSnapshot {
  return {
    year: v?.year ?? null,
    make: v?.make ?? null,
    model: v?.model ?? null,
    trim: v?.trim ?? null,
    engine: v?.engine ?? null,
    vin: v?.vin ?? null,
    plate: v?.license_plate ?? null,
  }
}

export function snapshotLabel(s: VehicleSnapshot | null): string {
  if (!s) return ''
  return [s.year, s.make, s.model, s.trim].filter(Boolean).join(' ')
}

const WHAT = 'pre-buy inspection (migration 0067)'

/** Plain words for anything the database refuses here. */
export function inspectionErrorWords(e: unknown, what: string): string {
  const message = (e as { message?: string } | null)?.message ?? ''
  if (message.includes('inspection_frozen')) return `Couldn’t ${what}: this report is final. Void it and start a new one.`
  return dbErrorWords(e, what, WHAT)
}

/** Start a pre-buy on a job: the report row plus a copy of the package's checklist. */
export async function startInspection(jobId: string, pkg: InspectionPackage, preparedFor: string | null): Promise<string> {
  const { data, error } = await supabase
    .from('inspections')
    .insert({ job_id: jobId, package: pkg, prepared_for: preparedFor })
    .select('id')
    .single()
  if (error) throw error
  const id = (data as { id: string }).id
  let position = 0
  const rows = TEMPLATES[pkg].sections.flatMap((s) =>
    s.items.map((it) => ({
      inspection_id: id,
      section: s.section,
      position: (position += 10),
      label: it.label,
      needs: it.needs ?? null,
      measure_kind: it.measure ?? null,
    })),
  )
  const { error: itemsErr } = await supabase.from('inspection_items').insert(rows)
  if (itemsErr) {
    // Never leave a report with no checklist behind.
    await supabase.from('inspections').delete().eq('id', id)
    throw itemsErr
  }
  return id
}

export async function loadInspection(id: string): Promise<{ inspection: Inspection; items: InspectionItem[] }> {
  const [ins, items] = await Promise.all([
    supabase.from('inspections').select('*').eq('id', id).single(),
    supabase.from('inspection_items').select('*').eq('inspection_id', id).order('position'),
  ])
  if (ins.error) throw ins.error
  if (items.error) throw items.error
  return { inspection: ins.data as Inspection, items: (items.data as InspectionItem[]) ?? [] }
}

export async function updateInspection(id: string, patch: Partial<Inspection>): Promise<void> {
  const { error } = await supabase.from('inspections').update(patch).eq('id', id)
  if (error) throw error
}

export async function updateItem(id: string, patch: Partial<InspectionItem>): Promise<void> {
  const { error } = await supabase.from('inspection_items').update(patch).eq('id', id)
  if (error) throw error
}

export async function addItem(inspectionId: string, section: string, position: number, label: string): Promise<InspectionItem> {
  const { data, error } = await supabase
    .from('inspection_items')
    .insert({ inspection_id: inspectionId, section, position, label, custom: true })
    .select('*')
    .single()
  if (error) throw error
  return data as InspectionItem
}

export async function removeItem(id: string): Promise<void> {
  const { error } = await supabase.from('inspection_items').delete().eq('id', id)
  if (error) throw error
}
