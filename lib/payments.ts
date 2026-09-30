import { supabase } from './supabase'
import type { Payment, PaymentMethod } from './types'

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
]

/**
 * Record a payment, then re-derive the cached job payment fields and settle
 * any linked invoice. The payments ledger is the source of truth; the job's
 * payment_status/amount_paid_cents are a cache kept in sync here.
 */
export async function recordPayment(input: {
  jobId: string
  invoiceId?: string | null
  /** Set when the money is a deposit put down against a quote. */
  quoteId?: string | null
  amountCents: number
  method: PaymentMethod
  date: string
  note?: string | null
}): Promise<void> {
  const { error } = await supabase.from('payments').insert({
    job_id: input.jobId,
    invoice_id: input.invoiceId ?? null,
    quote_id: input.quoteId ?? null,
    amount_cents: input.amountCents,
    method: input.method,
    date: input.date,
    note: input.note ?? null,
  })
  if (error) throw error
  await syncJobPayment(input.jobId)
}

export async function deletePayment(paymentId: string, jobId: string): Promise<void> {
  const { error } = await supabase.from('payments').delete().eq('id', paymentId)
  if (error) throw error
  // allowEmpty: deleting the last payment must reset the job to unpaid.
  await syncJobPayment(jobId, { allowEmpty: true })
}

/**
 * Record a tip (0048). A tip is income and cash, NOT a payment toward the job:
 * it settles nothing, so the job's payment cache is not touched — adding or
 * removing a tip can never make a job read paid, partial or unpaid. It is not
 * part of the sale either, so it never enters the sales-tax base.
 */
export async function recordTip(input: {
  jobId: string
  amountCents: number
  method: PaymentMethod
  date: string
  note?: string | null
}): Promise<void> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('A tip has to be more than $0.00.')
  }
  const { error } = await supabase.from('tips').insert({
    job_id: input.jobId,
    amount_cents: input.amountCents,
    method: input.method,
    date: input.date,
    note: input.note?.trim() || null,
  })
  if (error) throw error
}

export async function deleteTip(tipId: string): Promise<void> {
  const { error } = await supabase.from('tips').delete().eq('id', tipId)
  if (error) throw error
}

/**
 * THE paid-to-date rule, mirrored from SQL invoice_paid_cents (keep identical):
 * every payment on a job counts toward any of its invoices. Invoices are
 * whole-job snapshots — revisions of one debt, never installments — so a
 * deposit taken on the quote, a "Mark paid" tapped before the invoice
 * existed, or money taken against an invoice that was later voided and
 * reissued all belong to the live invoice. payments.invoice_id / quote_id
 * only record which document the customer had in hand.
 */
export function invoicePaidCents(jobPayments: Pick<Payment, 'amount_cents'>[]): number {
  return jobPayments.reduce((s, p) => s + p.amount_cents, 0)
}

/**
 * Re-derive job payment_status/amount_paid_cents and linked invoice statuses
 * from the ledger. Mirrors SQL refresh_job_payment_cache — keep identical.
 *
 * - Every read is error-checked: a transient failed read must throw, never be
 *   treated as "zero payments" (which would flip a paid job back to unpaid).
 * - An empty ledger is a no-op by default so jobs settled before payment
 *   tracking existed keep their cached status; pass allowEmpty when emptiness
 *   is meaningful (deleting the last payment).
 * - The amount owed is the greater of the job's charge math and its largest
 *   live invoice total — invoices can add sales tax on top of the job total.
 */
export async function syncJobPayment(
  jobId: string,
  opts: { allowEmpty?: boolean } = {},
): Promise<void> {
  const [paymentsRes, totalsRes, invoicesRes] = await Promise.all([
    supabase.from('payments').select('amount_cents, invoice_id, date').eq('job_id', jobId),
    supabase.from('job_totals').select('total_charged_cents').eq('job_id', jobId).single(),
    supabase.from('invoices').select('id, total_cents, status, sent_at').eq('job_id', jobId),
  ])
  if (paymentsRes.error) throw paymentsRes.error
  if (totalsRes.error) throw totalsRes.error
  if (invoicesRes.error) throw invoicesRes.error

  const payments = paymentsRes.data ?? []
  if (payments.length === 0 && !opts.allowEmpty) return

  const invoices = invoicesRes.data ?? []
  const paid = payments.reduce((s, p) => s + p.amount_cents, 0)
  // Every invoice snapshots the WHOLE job, so multiple live invoices are
  // revisions of the same debt, never installments — summing them counted a
  // duplicate draft as doubling what the customer owed and stranded fully
  // paid jobs at "partial". The largest one is the real ask.
  const invoicedTotal = invoices
    .filter((i) => i.status !== 'void')
    .reduce((s, i) => Math.max(s, i.total_cents), 0)
  const target = Math.max(totalsRes.data?.total_charged_cents ?? 0, invoicedTotal)

  const status = paid <= 0 ? 'unpaid' : paid >= target && target > 0 ? 'paid' : 'partial'
  const { error: jobErr } = await supabase
    .from('jobs')
    .update({ payment_status: status, amount_paid_cents: paid > 0 ? paid : null })
    .eq('id', jobId)
  if (jobErr) throw jobErr

  // Settle (or unsettle) invoices this job's ledger covers — all job money
  // counts toward every live invoice (see invoicePaidCents).
  const invPaid = invoicePaidCents(payments)
  const lastDate = payments.map((p) => p.date).sort().pop()
  for (const inv of invoices) {
    if (inv.status === 'void') continue
    const covered = invPaid >= inv.total_cents && inv.total_cents > 0
    if (covered && inv.status !== 'paid') {
      const { error } = await supabase
        .from('invoices')
        .update({ status: 'paid', paid_at: lastDate ? `${lastDate}T00:00:00Z` : new Date().toISOString() })
        .eq('id', inv.id)
      if (error) throw error
    } else if (!covered && inv.status === 'paid') {
      // Mirror SQL refresh_job_payment_cache: a never-sent invoice reverts to
      // 'draft', not 'sent' — otherwise it starts overdue math and reads as
      // issued on a document the customer never received.
      const { error } = await supabase
        .from('invoices')
        .update({ status: inv.sent_at ? 'sent' : 'draft', paid_at: null })
        .eq('id', inv.id)
      if (error) throw error
    }
  }
}
