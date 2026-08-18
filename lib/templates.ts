import { supabase } from './supabase'
import type { Job, PartLine } from './types'

/**
 * Canned jobs, built from the shop's own history rather than a bought labor
 * guide: your own completed jobs already know how long the work takes YOU,
 * with your tools and no helper — a national flat-rate book doesn't.
 */
export interface JobTemplateLine {
  description: string
  qty: number
  /** The customer price per unit. Costs come from the real receipt later. */
  unit_charge_cents: number | null
}

export interface JobTemplate {
  id: string
  name: string
  title: string
  work_performed: string | null
  labor_hours: number
  lines: JobTemplateLine[]
  created_at: string
  updated_at: string
}

export async function listTemplates(): Promise<JobTemplate[]> {
  const { data } = await supabase.from('job_templates').select('*').order('name')
  return (data as JobTemplate[]) ?? []
}

/** Freeze a finished job into a reusable starting point. */
export async function saveJobAsTemplate(
  name: string,
  job: Pick<Job, 'title' | 'work_performed' | 'labor_hours'>,
  lines: PartLine[],
): Promise<void> {
  const { error } = await supabase.from('job_templates').insert({
    name: name.trim(),
    title: job.title,
    work_performed: job.work_performed,
    labor_hours: Number(job.labor_hours),
    lines: lines.map((l) => ({
      description: l.description,
      qty: Number(l.qty),
      // The template carries what the customer pays; at-cost lines carry
      // their cost as the price, which is what they were actually sold at.
      unit_charge_cents: l.unit_charge_cents ?? l.unit_cost_cents,
    })),
  })
  if (error) throw error
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('job_templates').delete().eq('id', id)
  if (error) throw error
}
