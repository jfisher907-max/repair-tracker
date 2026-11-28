import { supabase } from './supabase'
import { dbErrorWords } from './db-errors'
import { TEMPLATES, type InspectionPackage, type MeasureKind } from './inspection-templates'
import type { DamageMark } from './damage-chart'
import type { Vehicle } from './types'

/**
 * Inspections (0067; the Vehicle Inspection package, 0073). The owner's side:
 * start one from a job, fill it in, finalize it, share it. The customer's side
 * reads get_public_inspection by the report's own link.
 */

export type Rating = 'ok' | 'watch' | 'attention' | 'not_checked' | 'na'
export type Verdict = 'no_major' | 'repairs' | 'major'
export type InspectionStatus = 'draft' | 'final' | 'void'

/** One number per wheel: tread in 32nds per tire ('tread'), or the thinner
 *  brake pad at that wheel in mm ('pads', which has no spare). */
export interface TreadMeasure { lf?: number | null; rf?: number | null; lr?: number | null; rr?: number | null; spare?: number | null }
/** Battery in cold-cranking amps. */
export interface BatteryMeasure { rated_cca?: number | null; measured_cca?: number | null }
/**
 * The body damage chart ('damage'). `none` is the owner saying he looked and
 * found nothing, which an empty chart alone never says. `ack_name` is the
 * customer's person who was shown the chart and agreed it is right, with when;
 * it prints on the report. `chart` names the drawing the marks were placed on.
 */
export interface DamageMeasure {
  chart?: string
  marks?: DamageMark[]
  none?: boolean
  ack_name?: string | null
  ack_at?: string | null
}
export type ItemMeasure = TreadMeasure & BatteryMeasure & DamageMeasure

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
  measure: ItemMeasure | null
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

/**
 * The Vehicle Inspection says the same three things in a fleet's words: there
 * is no purchase to price repairs into. Same three stored values (0067's
 * check), so nothing in the database changes.
 */
const FLEET_VERDICT_LABEL: Record<Verdict, string> = {
  no_major: 'No concerns found',
  repairs: 'Items to plan for',
  major: 'Needs attention now',
}

/** The overall line's words for a package. */
export function verdictLabel(pkg: InspectionPackage | string | null | undefined, verdict: Verdict): string {
  return pkg === 'fleet' ? FLEET_VERDICT_LABEL[verdict] : VERDICT_LABEL[verdict]
}

/** The three choices, in order, worded for a package. */
export function verdictsFor(pkg: InspectionPackage | string | null | undefined): { value: Verdict; label: string }[] {
  return VERDICTS.map((v) => ({ value: v.value, label: verdictLabel(pkg, v.value) }))
}

/** Plain words printed on every report. Not a warranty; not advice to buy. */
export const INSPECTION_DISCLAIMER =
  'This is our honest look at this vehicle on the date and at the mileage shown, using the checks listed in this report. It is not a warranty or a guarantee, and it is not advice to buy or not to buy. Cars can develop problems at any time, and some problems can only be found by taking parts apart, which we did not do. Anything marked Not checked was not inspected. Recall results come from an outside database that can be incomplete. Cost ranges are rough numbers for planning and negotiating; they are not a repair estimate, and we will give a written estimate and get the owner’s OK before doing any work. This report was prepared for the person named above. If someone forwarded it to you, you are welcome to call us, and we recommend getting your own inspection.'

/**
 * The Vehicle Inspection's own words (0073). No purchase is being weighed, so
 * nothing about buying; it adds what the two measurements and the damage chart
 * are and are not.
 */
export const VEHICLE_INSPECTION_DISCLAIMER =
  'This is our honest look at this vehicle on the date and at the mileage shown, using the checks listed in this report. It is not a warranty or a guarantee. Vehicles can develop problems at any time, and some problems can only be found by taking parts apart, which we did not do. Anything marked Not checked was not inspected. Brake pad and tire figures are what we measured that day; how long they last depends on how the vehicle is driven. The body damage chart records what could be seen on the vehicle when we looked it over; it is not a repair estimate. Cost ranges are rough numbers for planning; they are not a repair estimate, and we will give a written estimate and get your OK before doing any work.'

/** The closing paragraph for a package's report. */
export function disclaimerFor(pkg: InspectionPackage | string | null | undefined): string {
  return pkg === 'fleet' ? VEHICLE_INSPECTION_DISCLAIMER : INSPECTION_DISCLAIMER
}

/** One tire's band: 6/32 and up OK, 4–5 Watch, under 4 Needs attention. */
export function treadBand(v: number): Rating {
  return v >= 6 ? 'ok' : v >= 4 ? 'watch' : 'attention'
}

/**
 * Tread limits (32nds): 6+ OK, 4–5 Watch, 3 or less Needs attention. Alaska's
 * legal minimum is 2/32. The worst tire decides; the spare is not counted.
 */
export function treadRating(m: TreadMeasure | null | undefined): Rating | null {
  const vals = [m?.lf, m?.rf, m?.lr, m?.rr].filter((v): v is number => typeof v === 'number')
  if (vals.length === 0) return null
  return treadBand(Math.min(...vals))
}

/**
 * One wheel's brake pad band, in mm of friction material left: 7 and up OK,
 * 4 to under 7 Watch, under 4 Needs attention. A shop convention (the green,
 * yellow and red a brake lining gauge is marked in), not a legal limit; the
 * owner has not ruled on these numbers yet, and this is the one place they
 * live (the gauge reads its limits from here too, components/WheelGauges).
 */
export function padBand(v: number): Rating {
  return v >= 7 ? 'ok' : v >= 4 ? 'watch' : 'attention'
}

/** Brake pads: the thinnest wheel decides. */
export function padRating(m: TreadMeasure | null | undefined): Rating | null {
  const vals = [m?.lf, m?.rf, m?.lr, m?.rr].filter((v): v is number => typeof v === 'number')
  if (vals.length === 0) return null
  return padBand(Math.min(...vals))
}

/**
 * The damage chart's rating, kept only so "every item is rated" holds: marks
 * read as Watch, "none found" as OK, an untouched chart as not rated yet. The
 * chart is never counted among the findings; it has its own part of the report.
 */
export function damageRating(m: DamageMeasure | null | undefined): Rating | null {
  if ((m?.marks?.length ?? 0) > 0) return 'watch'
  return m?.none ? 'ok' : null
}

/** Battery: 75%+ of rated CCA OK, 60–74% Watch, under 60% Needs attention. */
export function batteryRating(m: BatteryMeasure | null | undefined): Rating | null {
  if (!m?.rated_cca || m.measured_cca == null) return null
  const pct = m.measured_cca / m.rated_cca
  return pct >= 0.75 ? 'ok' : pct >= 0.6 ? 'watch' : 'attention'
}

/** The findings: every item but the damage chart, which is not one. */
export function findings<T extends { measure_kind?: MeasureKind | null }>(items: T[]): T[] {
  return items.filter((i) => i.measure_kind !== 'damage')
}

/**
 * The verdict the app suggests from the ratings; the owner picks. A pre-buy
 * calls three attention items "major". On a vehicle in service one is enough:
 * "Needs attention now" means exactly that.
 */
export function suggestVerdict(
  items: (Pick<InspectionItem, 'rating'> & { measure_kind?: MeasureKind | null })[],
  pkg: InspectionPackage | string | null = 'quick',
): Verdict {
  const rated = findings(items)
  const attention = rated.filter((i) => i.rating === 'attention').length
  const watch = rated.filter((i) => i.rating === 'watch').length
  if (pkg === 'fleet') return attention > 0 ? 'major' : watch > 0 ? 'repairs' : 'no_major'
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
  // 0067 allowed one package and two measures; a Vehicle Inspection started
  // before 0073 is refused by those two checks, and that is what to say.
  if (message.includes('inspections_package_check') || message.includes('inspection_items_measure_kind_check'))
    return `Couldn’t ${what}: the database update for vehicle inspections (migration 0073) isn’t applied yet.`
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
