'use client'

import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/date'
import { quoteStatusColors, statusChipClass } from '@/lib/billing'
import { syncJobPayment } from '@/lib/payments'
import { SkeletonList } from '@/components/Skeleton'
import SwipeableRow from '@/components/SwipeableRow'
import type { Customer, Invoice, Quote } from '@/lib/types'

interface QuoteRow extends Quote {
  customer: Customer | null
  totals: { total_cents: number } | null
}

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

export default function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  // ?tab=invoices lets the dashboard's "unpaid invoices" banner and every
  // "← Billing" back-link land on the list the user came to see.
  const { tab: tabParam } = use(searchParams)
  const [tab, setTab] = useState<'quotes' | 'invoices'>(
    tabParam === 'invoices' ? 'invoices' : 'quotes',
  )
  const [quotes, setQuotes] = useState<QuoteRow[] | null>(null)
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)

  useEffect(() => {
    async function load() {
      const [qRes, tRes, iRes] = await Promise.all([
        supabase
          .from('quotes')
          .select('*, customer:customers(*)')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabase.from('quote_totals').select('*'),
        supabase.from('invoices').select('*').order('created_at', { ascending: false }),
      ])
      const totalsById = new Map(
        ((tRes.data ?? []) as { quote_id: string; total_cents: number }[]).map((t) => [t.quote_id, t]),
      )
      setQuotes(
        ((qRes.data ?? []) as unknown as QuoteRow[]).map((q) => ({
          ...q,
          totals: totalsById.get(q.id) ?? null,
        })),
      )
      setInvoices((iRes.data as Invoice[]) ?? [])
    }
    load()
  }, [])

  async function deleteQuote(q: QuoteRow) {
    const { error } = await supabase
      .from('quotes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', q.id)
    if (error) throw new Error(error.message)
    setQuotes((prev) => (prev ?? []).filter((x) => x.id !== q.id))
  }

  async function deleteInvoice(inv: Invoice) {
    // The swipe affordance already excludes sent/paid invoices; this re-check
    // catches a payment recorded since the page loaded.
    const { data: pays, error: pErr } = await supabase
      .from('payments')
      .select('id')
      .eq('invoice_id', inv.id)
      .limit(1)
    if (pErr) throw new Error(pErr.message)
    if (pays?.length) throw new Error('A payment was recorded against this invoice — it stays.')
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
        <Link href="/quotes/new" className="btn btn-primary">+ New Quote</Link>
      </div>

      <div className="flex gap-2">
        <button
          className="btn btn-sm flex-1"
          style={tab === 'quotes' ? { borderColor: 'var(--accent)', color: 'var(--accent2)' } : undefined}
          onClick={() => setTab('quotes')}
        >
          Quotes{quotes ? ` (${quotes.length})` : ''}
        </button>
        <button
          className="btn btn-sm flex-1"
          style={tab === 'invoices' ? { borderColor: 'var(--accent)', color: 'var(--accent2)' } : undefined}
          onClick={() => setTab('invoices')}
        >
          Invoices{invoices ? ` (${invoices.length})` : ''}
        </button>
      </div>

      {tab === 'quotes' ? (
        !quotes ? (
          <SkeletonList rows={3} />
        ) : quotes.length === 0 ? (
          <div className="card text-center" style={{ color: 'var(--text2)' }}>
            No quotes yet. Write one up and text the customer a link they can approve
            with one tap.
          </div>
        ) : (
          <div className="space-y-2">
            {quotes.map((q) => (
              <SwipeableRow
                key={q.id}
                confirmText={`Delete quote ${q.quote_number}? It disappears from lists but the record isn't destroyed.`}
                onDelete={() => deleteQuote(q)}
              >
              <Link
                href={`/quotes/${q.id}`}
                className="card flex items-center gap-3 !py-3"
                style={{ borderLeft: `3px solid ${quoteStatusColors[q.status] ?? 'var(--border)'}` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-bold" style={{ color: 'var(--accent2)' }}>{q.quote_number}</span>
                    <span className="text-xs" style={{ color: 'var(--text3)' }}>{formatDate(q.created_at.slice(0, 10))}</span>
                  </div>
                  <div className="truncate font-semibold">{q.title}</div>
                  <div className="truncate text-sm" style={{ color: 'var(--text2)' }}>{q.customer?.name}</div>
                </div>
                <div className="text-right">
                  <div className="money font-semibold">{formatCents(q.totals?.total_cents)}</div>
                  <span className={statusChipClass(q.status)}>{q.status}</span>
                </div>
              </Link>
              </SwipeableRow>
            ))}
          </div>
        )
      ) : !invoices ? (
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
                  <span className="text-xs font-bold" style={{ color: 'var(--accent2)' }}>{inv.invoice_number}</span>
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
    </div>
  )
}
