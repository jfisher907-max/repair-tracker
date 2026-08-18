import { supabase } from './supabase'
import { todayLocalIso } from './date'
import type { Customer, Vehicle } from './types'

export interface VehicleReminder {
  id: string
  vehicle_id: string
  name: string
  interval_miles: number | null
  interval_months: number | null
  last_done_date: string
  last_done_miles: number | null
  created_at: string
  updated_at: string
}

/** A dated odometer point — every job with a reading contributes one. */
export interface OdometerReading {
  date: string
  miles: number
}

/**
 * What the big CRMs assume when they know nothing about a vehicle. Used only
 * until a vehicle has two odometer readings far enough apart to trust.
 */
export const FALLBACK_MILES_PER_DAY = 33

/** Below this many days between first and last reading, the rate is noise. */
const MIN_SPAN_DAYS = 14

const DAY_MS = 86_400_000

/** Parse a YYYY-MM-DD at local noon — immune to DST and timezone edges. */
function atNoon(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00`)
}

function toIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Whole days from a to b. Rounded because DST makes noon-to-noon ±1 hour. */
function dayDiff(aIso: string, bIso: string): number {
  return Math.round((atNoon(bIso).getTime() - atNoon(aIso).getTime()) / DAY_MS)
}

export function addDays(isoDate: string, days: number): string {
  const d = atNoon(isoDate)
  d.setDate(d.getDate() + Math.round(days))
  return toIsoDate(d)
}

/** Month arithmetic that clamps: Jan 31 + 1 month = Feb 28/29, not Mar 3. */
export function addMonths(isoDate: string, months: number): string {
  const d = atNoon(isoDate)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return toIsoDate(d)
}

/**
 * This vehicle's own daily mileage, from its first and last odometer reading.
 * Null when there isn't enough history to trust (fewer than two readings, a
 * span under two weeks, or miles that didn't increase) — callers fall back to
 * FALLBACK_MILES_PER_DAY.
 */
export function milesPerDay(readings: OdometerReading[]): number | null {
  const valid = readings.filter((r) => r.date && r.miles > 0)
  if (valid.length < 2) return null
  const sorted = [...valid].sort((a, b) => (a.date < b.date ? -1 : 1))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const days = dayDiff(first.date, last.date)
  const miles = last.miles - first.miles
  if (days < MIN_SPAN_DAYS || miles <= 0) return null
  return miles / days
}

export interface ReminderProjection {
  /** The projected calendar date this reminder comes due. */
  due_date: string
  /** Which interval fired first for this vehicle's usage. */
  basis: 'miles' | 'calendar'
  /** Odometer target when the miles interval participated, for the display. */
  due_miles: number | null
  /** Whether the rate came from this vehicle's history or the flat guess. */
  rate: 'history' | 'default'
}

/**
 * When a reminder comes due: the EARLIER of the mileage projection and the
 * calendar interval, using whichever of the two the reminder defines.
 *
 * The mileage projection anchors on the newest odometer fact we have (the
 * latest job reading, or the reminder's own last-done miles if newer), walks
 * forward at the vehicle's own miles/day, and asks when the odometer crosses
 * last_done_miles + interval_miles. A projection can land in the past — that
 * means overdue, and the date honestly says by how much.
 */
export function projectDue(
  reminder: Pick<
    VehicleReminder,
    'interval_miles' | 'interval_months' | 'last_done_date' | 'last_done_miles'
  >,
  readings: OdometerReading[],
  today = todayLocalIso(),
): ReminderProjection | null {
  const historyRate = milesPerDay(readings)
  const mpd = historyRate ?? FALLBACK_MILES_PER_DAY

  let milesDate: string | null = null
  let dueMiles: number | null = null
  if (reminder.interval_miles != null && reminder.last_done_miles != null) {
    dueMiles = reminder.last_done_miles + reminder.interval_miles
    // Newest odometer fact available: latest reading, or last-done if newer.
    const anchors: OdometerReading[] = [
      ...readings.filter((r) => r.date && r.miles > 0),
      { date: reminder.last_done_date, miles: reminder.last_done_miles },
    ]
    // >= so the reminder's own last-done entry (appended last) wins date ties —
    // it is the freshest odometer statement for this reminder.
    const anchor = anchors.reduce((a, b) => (b.date >= a.date ? b : a))
    const daysSinceAnchor = Math.max(0, dayDiff(anchor.date, today))
    const estimatedNow = anchor.miles + daysSinceAnchor * mpd
    const daysUntilDue = (dueMiles - estimatedNow) / mpd
    milesDate = addDays(today, daysUntilDue)
  }

  const calendarDate =
    reminder.interval_months != null
      ? addMonths(reminder.last_done_date, reminder.interval_months)
      : null

  if (milesDate == null && calendarDate == null) return null
  const useMiles = milesDate != null && (calendarDate == null || milesDate <= calendarDate)
  return {
    due_date: useMiles ? milesDate! : calendarDate!,
    basis: useMiles ? 'miles' : 'calendar',
    due_miles: useMiles ? dueMiles : null,
    rate: historyRate != null ? 'history' : 'default',
  }
}

export interface ReminderDue extends VehicleReminder {
  vehicle: (Vehicle & { customer: Customer | null }) | null
  projection: ReminderProjection
}

/**
 * Every reminder across the shop that is overdue or due within the window,
 * soonest first. Two flat queries and JS math — at one-mechanic scale that
 * beats a view, and it keeps the projection logic in exactly one place.
 */
export async function listDueSoon(withinDays = 30): Promise<ReminderDue[]> {
  const [{ data: reminders, error: re }, { data: jobs, error: je }] = await Promise.all([
    supabase
      .from('vehicle_reminders')
      .select('*, vehicle:vehicles!inner(*, customer:customers(*))')
      .is('vehicle.deleted_at', null),
    supabase
      .from('jobs')
      .select('vehicle_id, date, odometer_miles')
      .is('deleted_at', null)
      .not('odometer_miles', 'is', null),
  ])
  if (re) throw new Error(re.message)
  if (je) throw new Error(je.message)

  const readingsByVehicle = new Map<string, OdometerReading[]>()
  for (const j of (jobs ?? []) as { vehicle_id: string; date: string; odometer_miles: number }[]) {
    const list = readingsByVehicle.get(j.vehicle_id) ?? []
    list.push({ date: j.date, miles: j.odometer_miles })
    readingsByVehicle.set(j.vehicle_id, list)
  }

  const today = todayLocalIso()
  const horizon = addDays(today, withinDays)
  const due: ReminderDue[] = []
  for (const r of (reminders ?? []) as ReminderDue[]) {
    const projection = projectDue(r, readingsByVehicle.get(r.vehicle_id) ?? [])
    if (projection && projection.due_date <= horizon) due.push({ ...r, projection })
  }
  return due.sort((a, b) => (a.projection.due_date < b.projection.due_date ? -1 : 1))
}

export async function listForVehicle(vehicleId: string): Promise<VehicleReminder[]> {
  const { data, error } = await supabase
    .from('vehicle_reminders')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('name')
  if (error) throw new Error(error.message)
  return (data as VehicleReminder[]) ?? []
}
