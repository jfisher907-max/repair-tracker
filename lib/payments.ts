import { supabase } from './supabase'
import type { PaymentMethod } from './types'

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
]

/** Schedule-C-friendly buckets; free text is still allowed in the form. */
export const EXPENSE_CATEGORIES = [
  'Parts & materials',
  'Tools & equipment',
  'Shop supplies',
  'Insurance',
  'Rent',
  'Utilities',
  'Advertising',
  'Software & fees',
  'Fuel & travel',
  'Other',
]

/**
 * Record a payment, then re-derive the cached job payment fields and settle
 * any linked invoice. The payments ledger is the source of truth; the job's
 * payment_status/amount_paid_cents are a cache kept in sync here.
 */
export async function recordPayment(input: {
  jobId: string
  invoiceId?: string | null
  amountCents: number
  method: PaymentMethod
  date: string
  note?: string | null
}): Promise<void> {
  const { error } = await supabase.from('payments').insert({
    job_id: input.jobId,
    invoice_id: input.invoiceId ?? null,
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
  await syncJobPayment(jobId)
}

/** Re-derive job payment_status/amount_paid_cents and linked invoice statuses from the ledger. */
export async function syncJobPayment(jobId: string): Promise<void> {
  const [{ data: payments }, { data: totals }, { data: invoices }] = await Promise.all([
    supabase.from('payments').select('amount_cents, invoice_id, date').eq('job_id', jobId),
    supabase.from('job_totals').select('total_charged_cents').eq('job_id', jobId).single(),
    supabase.from('invoices').select('id, total_cents, status').eq('job_id', jobId),
  ])
  const paid = (payments ?? []).reduce((s, p) => s + p.amount_cents, 0)
  const total = totals?.total_charged_cents ?? 0

  const status = paid <= 0 ? 'unpaid' : paid >= total && total > 0 ? 'paid' : 'partial'
  await supabase
    .from('jobs')
    .update({ payment_status: status, amount_paid_cents: paid > 0 ? paid : null })
    .eq('id', jobId)

  // Settle (or unsettle) invoices this job's ledger covers.
  for (const inv of invoices ?? []) {
    if (inv.status === 'void') continue
    const invPaid = (payments ?? [])
      .filter((p) => p.invoice_id === inv.id)
      .reduce((s, p) => s + p.amount_cents, 0)
    const covered = invPaid >= inv.total_cents && inv.total_cents > 0
    if (covered && inv.status !== 'paid') {
      const lastDate = (payments ?? [])
        .filter((p) => p.invoice_id === inv.id)
        .map((p) => p.date)
        .sort()
        .pop()
      await supabase
        .from('invoices')
        .update({ status: 'paid', paid_at: lastDate ? `${lastDate}T00:00:00Z` : new Date().toISOString() })
        .eq('id', inv.id)
    } else if (!covered && inv.status === 'paid') {
      await supabase.from('invoices').update({ status: 'sent', paid_at: null }).eq('id', inv.id)
    }
  }
}
