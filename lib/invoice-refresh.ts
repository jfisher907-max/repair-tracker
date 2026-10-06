import { supabase } from './supabase'
import { buildInvoiceSnapshot } from './billing'
import { buildAuthorizationTrail, isOverApproval, loadJobAuthorization } from './authorization'
import { syncJobPayment } from './payments'
import { formatCents } from './money'
import { aircraftSnapshot, holdsToApproval, lineOf, marksPayload, needsPartConditions } from './service-line'
import type { Invoice, Job, PartLine, Vehicle } from './types'

export interface DraftRefresh {
  /** The draft invoice brought back in step, if there was one. */
  invoiceNumber: string | null
  /** Why it was NOT refreshed. The caller must tell the owner. */
  blocked: string | null
}

/**
 * Bring a job's DRAFT invoice back in step with the job.
 *
 * An invoice is a frozen snapshot, so anything that changes a job's money after
 * a draft exists leaves that draft stale — and because what's owed is the
 * LARGEST live invoice, a stale draft goes on billing the customer the old
 * figure on their statement, and the job can never reach "paid".
 *
 * It runs the SAME gates as Create invoice and the invoice page's "Update from
 * job", because it writes the same customer-facing figures: never past what the
 * customer approved (AS 45.45.140/.170), and every billed part identified
 * (AS 45.45.190). Without them this was a back door that re-snapshotted a draft
 * to an un-approved total with no warning anywhere.
 *
 * Sent and paid invoices are never touched — those are corrected by voiding and
 * reissuing. A blocked refresh is reported, never swallowed.
 *
 * Aircraft paper (AVN-3) runs the gates its line keeps (lib/service-line: the
 * approval limit as a shop rule; no part conditions), and its frozen aircraft
 * block is re-frozen here — airframe hours often arrive after the draft. The
 * draft's service_line itself never changes.
 */
export async function refreshDraftInvoice(jobId: string): Promise<DraftRefresh> {
  const { data: drafts, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
  if (error) throw error
  const draft = ((drafts ?? []) as Invoice[])[0]
  if (!draft) return { invoiceNumber: null, blocked: null }

  const [{ data: job }, { data: partLines }, auth] = await Promise.all([
    supabase
      .from('jobs')
      // vehicles(*), not the 0055 columns by name: a car's refresh still reads
      // before that migration (a missing service_line is automotive).
      .select('*, vehicle:vehicles(*)')
      .eq('id', jobId)
      .single(),
    supabase.from('part_lines').select('*').eq('job_id', jobId).order('created_at'),
    loadJobAuthorization(jobId),
  ])
  if (!job) throw new Error('The job behind the draft invoice is gone.')
  const { vehicle, ...jobRow } = job as Job & {
    vehicle: Pick<Vehicle, 'service_line' | 'registration' | 'serial_number'> | null
  }
  /** The paper this draft was created on — the gates follow it. */
  const line = lineOf(draft)

  if (holdsToApproval(line) && isOverApproval(auth)) {
    return {
      invoiceNumber: null,
      blocked: `${draft.invoice_number} still shows the old total: the job now comes to ${formatCents(
        auth!.current_cents,
      )} before tax, over the ${formatCents(
        auth!.authorized_cents,
      )} the customer approved. Bill the approved amount or record their OK on the job, then update the invoice.`,
    }
  }

  const lines = (partLines as PartLine[]) ?? []
  const unconfirmed = needsPartConditions(line)
    ? lines.filter((l) => l.on_invoice !== false && !l.is_adjustment && l.condition == null)
    : []
  if (unconfirmed.length) {
    return {
      invoiceNumber: null,
      blocked: `${draft.invoice_number} still shows the old total: ${unconfirmed.length} part${
        unconfirmed.length === 1 ? '' : 's'
      } on the job still need${unconfirmed.length === 1 ? 's' : ''} a condition (new, used, rebuilt or reconditioned) before it can be re-issued.`,
    }
  }

  // The invoice owns its tax rate once created — same rule as "Update from job".
  const snapshot = buildInvoiceSnapshot(jobRow as Job, lines, draft.tax_rate_bp ?? 0, line)
  const { error: upErr } = await supabase
    .from('invoices')
    .update({
      job_title: jobRow.title,
      work_performed: jobRow.work_performed,
      authorizations: await buildAuthorizationTrail(jobId, line),
      // A draft only (sent ones never reach here): the tail, serial and hours as they stand now.
      ...(line === 'aviation' ? { aircraft: aircraftSnapshot(vehicle, jobRow) } : {}),
      // ...and AOG / Nights & weekends as the job is marked now (0065).
      ...marksPayload(line, jobRow, draft),
      ...snapshot,
    })
    .eq('id', draft.id)
  if (upErr) throw upErr

  // The owed target moved, so the cached payment status has to be redone.
  await syncJobPayment(jobId)
  return { invoiceNumber: draft.invoice_number, blocked: null }
}
