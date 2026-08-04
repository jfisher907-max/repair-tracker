'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/date'
import { quoteStatusColors } from '@/lib/billing'
import { SkeletonList } from '@/components/Skeleton'
import type { Customer, Invoice, Quote } from '@/lib/types'

interface QuoteRow extends Quote {
  customer: Customer | null
  totals: { total_cents: number } | null
}

export default function BillingPage() {
  const [tab, setTab] = useState<'quotes' | 'invoices'>('quotes')
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
              <Link
                key={q.id}
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
                  <span className="chip" style={{ background: 'var(--bg3)', color: quoteStatusColors[q.status] }}>
                    {q.status}
                  </span>
                </div>
              </Link>
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
            <Link
              key={inv.id}
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
                <span className="chip" style={{ background: 'var(--bg3)', color: quoteStatusColors[inv.status] ?? 'var(--text3)' }}>
                  {inv.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
