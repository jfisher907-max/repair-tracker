import { supabase } from './supabase'
import type { Customer, Job, JobTotals, Settings, Vehicle } from './types'

export interface JobWithContext {
  job: Job
  vehicle: Vehicle | null
  customer: Customer | null
  totals: JobTotals | null
}

type JobJoinRow = Job & { vehicle: (Vehicle & { customer: Customer | null }) | null }

/** All live jobs with their vehicle, customer, and server-computed totals. */
export async function fetchJobsWithContext(): Promise<JobWithContext[]> {
  const [jobsRes, totalsRes] = await Promise.all([
    supabase
      .from('jobs')
      .select('*, vehicle:vehicles(*, customer:customers(*))')
      .is('deleted_at', null)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase.from('job_totals').select('*'),
  ])
  if (jobsRes.error) throw jobsRes.error
  if (totalsRes.error) throw totalsRes.error

  const totalsById = new Map<string, JobTotals>(
    (totalsRes.data as JobTotals[]).map((t) => [t.job_id, t]),
  )
  return (jobsRes.data as unknown as JobJoinRow[]).map((row) => {
    const { vehicle, ...job } = row
    return {
      job: job as Job,
      vehicle: vehicle ?? null,
      customer: vehicle?.customer ?? null,
      totals: totalsById.get(job.id) ?? null,
    }
  })
}

export async function fetchSettings(): Promise<Settings> {
  const { data, error } = await supabase.from('settings').select('*').single()
  if (error) throw error
  return data as Settings
}
