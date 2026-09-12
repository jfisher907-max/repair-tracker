'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/date'
import { quoteStatusColors, statusChipClass } from '@/lib/billing'
import { syncJobPayment } from '@/lib/payments'
import { computeFinances, financeYears, jobsToInvoice, loadFinanceRows, type FinanceRows } from '@/lib/finances'
import JobRow from '@/components/JobRow'
import MoneyLedger from '@/components/dashboard/MoneyLedger'
import { SkeletonList } from '@/components/Skeleton'
import SwipeableRow from '@/components/SwipeableRow'
import type { Invoice } from '@/lib/types'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isOverdue(inv: Invoice): boolean {
  return inv.status === 'sent' && !!inv.due_date && inv.due_date < todayIso()
}

function overdueDays(inv: Invoice): number {
  return Math.floor(
    (new Date(`${todayIso()}T00:00:00`).getTime() - new Date(`${inv.due_date}T00:00:00`).getTime()) / 86400000,
  )
}

/**
 * Billing is invoices plus the finances — quotes moved to /jobs?tab=quotes,
 * where the work they describe lives. An old ?tab=invoices link still lands
 * here; the param is simply ignored.
 */
export default function BillingPage() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [rows, setRows] = useState<FinanceRows | null>(null)
  const [year, setYear] = useState<'all' | number>('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setInvoices((data as Invoice[]) ?? []))
    // The same rows and the same arithmetic as the dashboard — never a
    // second version of the money math.
    loadFinanceRows()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const years = useMemo(() => (rows ? financeYears(rows) : []), [rows])
  const f = useMemo(() => (rows ? computeFinances(rows, year) : null), [rows, year])
  const toInvoice = useMemo(() => (rows ? jobsToInvoice(rows) : null), [rows])

  async function deleteInvoice(inv: Invoice) {
    // The swipe affordance already excludes sent/paid invoices; this re-check
    // catches a payment recorded since the page loaded. Money against the JOB
    // counts, not just money tagged with this invoice id — a payment recorded
    // from the job page carries no invoice_id when no invoice was open yet.
    const { data: pays, error: pErr } = await supabase
      .from('payments')
      .select('id')
      .eq('job_id', inv.job_id)
      .limit(1)
    if (pErr) throw new Error(pErr.message)
    if (pays?.length)
      throw new Error('This job has payments recorded against it — the invoice stays.')
    const { error } = await supabase.from('invoices').delete().eq('id', inv.id)
    if (error) throw new Error(error.message)
    // The set of live invoices changed — re-derive the job's payment status.
    try {
      await syncJobPayment(inv.job_id)
    } catch {}
    setInvoices((prev) => (prev ?? []).filter((x) => x.id !== inv.id))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">Billing</h1>
        {/* Invoices are created from a job, never from here. */}
        <Link href="/reports" className="btn btn-primary">Reports</Link>
      </div>

      <section className="space-y-2" aria-labelledby="finances-heading">
        <div className="flex items-center justify-between gap-2">
          <h2 id="finances-heading" className="label !mb-0">Finances</h2>
          <label className="sr-only" htmlFor="billing-year">
            Year
          </label>
          <select
            id="billing-year"
            className="select !w-auto"
            value={String(year)}
            onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All time</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <p style={{ color: 'var(--red)' }}>Couldn&apos;t load the finances: {error}</p>
        ) : !f ? (
          <SkeletonList rows={3} />
        ) : (
          <section className="card" aria-label="The money ledger">
            <MoneyLedger f={f} year={year} card={false} />
          </section>
        )}
      </section>

      {/* Work done, nothing sent: the first thing billing has to do. Same
          definition as the dashboard's Billing door (lib/finances jobsToInvoice). */}
      {toInvoice && toInvoice.length > 0 && (
        <section className="space-y-2" aria-labelledby="to-invoice-heading">
          <h2 id="to-invoice-heading" className="label !mb-0">
            To invoice ({toInvoice.length})
          </h2>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            Finished jobs with no invoice yet. Open one and tap Create invoice.
          </p>
          <div className="space-y-2">
            {toInvoice.map((it) => (
              <JobRow key={it.job.id} item={it} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2" aria-labelledby="invoices-heading">
        <h2 id="invoices-heading" className="label !mb-0">
          Invoices{invoices ? ` (${invoices.length})` : ''}
        </h2>
        {!invoices ? (
          <SkeletonList rows={3} />
        ) : invoices.length === 0 ? (
          <div className="card text-center" style={{ color: 'var(--text2)' }}>
            No invoices yet — open a job and tap “Create invoice”.
          </div>
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => (
              <SwipeableRow
                key={inv.id}
                enabled={!inv.sent_at && inv.status !== 'paid'}
                confirmText={`Delete ${inv.invoice_number} for good? It was never sent, so nothing the customer has seen changes. The job and its parts are untouched.`}
                onDelete={() => deleteInvoice(inv)}
              >
                <Link
                  href={`/invoices/${inv.id}`}
                  className="card flex items-center gap-3 !py-3"
                  style={{ borderLeft: `3px solid ${quoteStatusColors[inv.status] ?? 'var(--border)'}` }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="wnt-id text-xs">{inv.invoice_number}</span>
                      <span className="text-xs" style={{ color: 'var(--text3)' }}>{formatDate(inv.issue_date)}</span>
                    </div>
                    <div className="truncate font-semibold">{inv.job_title}</div>
                    <div className="truncate text-sm" style={{ color: 'var(--text2)' }}>{inv.customer_name}</div>
                  </div>
                  <div className="text-right">
                    <div className="money font-semibold">{formatCents(inv.total_cents)}</div>
                    {isOverdue(inv) ? (
                      <span className="chip chip-overdue">overdue {overdueDays(inv)}d</span>
                    ) : (
                      <span className={statusChipClass(inv.status)}>{inv.status}</span>
                    )}
                  </div>
                </Link>
              </SwipeableRow>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
