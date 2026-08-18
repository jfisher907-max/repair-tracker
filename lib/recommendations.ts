import { supabase } from './supabase'

export type RecommendationStatus = 'open' | 'booked' | 'done' | 'declined'

export interface Recommendation {
  id: string
  job_id: string
  vehicle_id: string
  description: string
  status: RecommendationStatus
  target_date: string | null
  estimate_cents: number | null
  resolved_job_id: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export const RECOMMENDATION_STATUSES: { value: RecommendationStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'booked', label: 'Booked' },
  { value: 'done', label: 'Done' },
  { value: 'declined', label: 'Declined' },
]

export const statusColors: Record<RecommendationStatus, string> = {
  open: 'var(--accent2)',
  booked: 'var(--blue)',
  done: 'var(--green)',
  declined: 'var(--text3)',
}

/** Only open items are chased, shown to customers, or seeded onto an invoice. */
export function isLive(r: Pick<Recommendation, 'status'>): boolean {
  return r.status === 'open'
}

export async function listForJob(jobId: string): Promise<Recommendation[]> {
  const { data } = await supabase
    .from('recommendations')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at')
  return (data as Recommendation[]) ?? []
}

export async function listForVehicle(vehicleId: string): Promise<Recommendation[]> {
  const { data } = await supabase
    .from('recommendations')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('created_at', { ascending: false })
  return (data as Recommendation[]) ?? []
}

/** The text that goes onto an invoice: the open items for that job, one per line. */
export function toMemo(items: Recommendation[]): string | null {
  const open = items.filter(isLive).map((r) => r.description.trim()).filter(Boolean)
  if (!open.length) return null
  return open.length === 1 ? open[0] : open.map((d) => `• ${d}`).join('\n')
}

/** How long an open item has been waiting — the worklist sorts on this. */
export function ageInDays(r: Recommendation): number {
  const then = new Date(r.created_at).getTime()
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}
