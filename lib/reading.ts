import { formatDateShort } from './date'
import { formatMiles } from './money'
import { READING, formatAirframeHours, parseAirframeHours, type ServiceLine } from './service-line'
import { supabase } from './supabase'
import type { Job } from './types'

/**
 * The reading a job takes off the vehicle while it is in the shop: odometer
 * miles on a car, airframe hours on an aircraft.
 *
 * Owner, 2026-11-23: "I need a reminder when I start a job to record the
 * vehicle mileage before the job gets completed." A job made from a quote is
 * created before the car arrives, so it has no reading, and nothing asked for
 * one afterwards: the field lived only on the Edit page. Once the car has left
 * the number is gone, and the service reminders (lib/reminders) and the
 * warranty-by-miles check both run on it.
 *
 * So: a job that is IN PROGRESS with no reading asks for one, on its own page
 * and on its Home bench card, until it has it; and marking it done asks once
 * more. Never a block: some jobs have no odometer to read.
 *
 * The words that differ between a car and an aircraft are in lib/service-line
 * (READING), with every other word that does.
 */

type ReadingFields = Pick<Job, 'odometer_miles' | 'airframe_hours'>

/** The reading on a job for its line; null when none is recorded. */
export function jobReading(job: ReadingFields, line: ServiceLine): number | null {
  const raw = line === 'aviation' ? job.airframe_hours : job.odometer_miles
  // numeric(9,1) can arrive as a string.
  if (raw == null || Number.isNaN(Number(raw))) return null
  return Number(raw)
}

/** On the lift with nothing recorded: the state the reminder is for. */
export function needsReading(job: ReadingFields & Pick<Job, 'stage'>, line: ServiceLine): boolean {
  return job.stage === 'in_progress' && jobReading(job, line) == null
}

/** Past these the columns themselves refuse (integer; numeric(9,1)), so the form does first. */
export const MAX_MILES = 9_999_999
export const MAX_AIRFRAME_HOURS = 999_999.9

/**
 * A reading as typed ("84,210", "1234.5") -> the number; null when blank; NaN
 * when it is not a plain number in range (the caller says so; it never saves a
 * blank in its place).
 */
export function parseReading(line: ServiceLine, input: string): number | null {
  if (line === 'aviation') {
    const hours = parseAirframeHours(input)
    return hours != null && hours > MAX_AIRFRAME_HOURS ? Number.NaN : hours
  }
  const cleaned = input.replace(/[,\s]/g, '')
  if (cleaned === '') return null
  if (!/^\d+$/.test(cleaned)) return Number.NaN
  const miles = Number(cleaned)
  return miles > MAX_MILES ? Number.NaN : miles
}

/** "84,210 mi" / "1,234.5 hrs". */
export function formatReading(line: ServiceLine, value: number): string {
  return `${line === 'aviation' ? formatAirframeHours(value) : formatMiles(value)} ${READING[line].unit}`
}

/** The jobs columns a reading is saved to. */
export function readingPatch(line: ServiceLine, value: number): Partial<Job> {
  return line === 'aviation' ? { airframe_hours: value } : { odometer_miles: value }
}

/** The newest reading on record before this job. */
export interface PriorReading {
  value: number
  date: string
  job_number: string
}

/** A reading already typed on this job's inspection report. */
export interface InspectionReading {
  value: number
  report_number: string
}

export interface ReadingContext {
  prior: PriorReading | null
  inspection: InspectionReading | null
}

/**
 * What is already known about this vehicle's reading: the newest one on its
 * other jobs dated on or before this job, and (cars) a number typed on this
 * job's inspection report. Each half answers null when it has nothing OR could
 * not be read; the prompt then simply says less. Neither is ever shown as
 * "no earlier reading", so a failed read makes no claim.
 */
export async function loadReadingContext(
  job: Pick<Job, 'id' | 'vehicle_id' | 'date'>,
  line: ServiceLine,
): Promise<ReadingContext> {
  const column = READING[line].column
  const priorRead = supabase
    .from('jobs')
    .select('job_number, date, odometer_miles, airframe_hours')
    .eq('vehicle_id', job.vehicle_id)
    .neq('id', job.id)
    .is('deleted_at', null)
    .not(column, 'is', null)
    .lte('date', job.date)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
  const inspectionRead =
    line === 'automotive'
      ? supabase
          .from('inspections')
          .select('report_number, odometer_miles')
          .eq('job_id', job.id)
          .neq('status', 'void')
          .not('odometer_miles', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
      : null

  const [priorRes, inspectionRes] = await Promise.all([priorRead, inspectionRead])

  let prior: PriorReading | null = null
  const priorRow = (priorRes.data as (ReadingFields & { job_number: string; date: string })[] | null)?.[0]
  if (!priorRes.error && priorRow) {
    const value = jobReading(priorRow, line)
    if (value != null) prior = { value, date: priorRow.date, job_number: priorRow.job_number }
  }

  let inspection: InspectionReading | null = null
  const inspectionRow = (inspectionRes?.data as { report_number: string; odometer_miles: number | null }[] | null)?.[0]
  if (inspectionRes && !inspectionRes.error && inspectionRow?.odometer_miles != null) {
    inspection = { value: Number(inspectionRow.odometer_miles), report_number: inspectionRow.report_number }
  }

  return { prior, inspection }
}

/**
 * A reason to look at the number again before it is saved, or null. Never a
 * refusal: a swapped cluster really does read lower, and the owner can save
 * what he typed with one more tap. The two slips this catches are a dropped
 * digit (8,421 after 84,210) and an extra one (842,100).
 */
export function readingDoubt(line: ServiceLine, value: number, prior: PriorReading | null): string | null {
  const earlier = prior
    ? `the ${formatReading(line, prior.value)} recorded on ${prior.job_number} (${formatDateShort(prior.date)})`
    : ''
  if (prior && value < prior.value) return `That is lower than ${earlier}.`
  if (line === 'automotive') {
    if (prior && value - prior.value > 100_000)
      return `That is ${formatMiles(value - prior.value)} miles more than ${earlier}.`
    if (value > 999_999) return 'That is over a million miles.'
  }
  return null
}
