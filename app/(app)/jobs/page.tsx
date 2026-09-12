'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import JobRow from '@/components/JobRow'
import { SkeletonList } from '@/components/Skeleton'
import SwipeableRow from '@/components/SwipeableRow'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { formatDate, todayLocalIso } from '@/lib/date'
import { formatCents } from '@/lib/money'
import { quoteStatusColors, statusChipClass } from '@/lib/billing'
import { supabase } from '@/lib/supabase'
import { vehicleLabel, type Customer, type Quote, type QuoteStatus } from '@/lib/types'

interface QuoteRow extends Quote {
  customer: Customer | null
  totals: { total_cents: number } | null
}

const QUOTE_STATUSES: QuoteStatus[] = ['draft', 'sent', 'approved', 'declined', 'expired']

/**
 * The page is prerendered as static, so the `searchParams` prop a client page
 * receives is the empty prerender-time value — reading it with use() showed the
 * Jobs tab on /jobs?tab=quotes even on a hard load. useSearchParams reads the
 * live URL; it needs a Suspense boundary so the static shell can still be built.
 */
export default function JobsPage() {
  return (
    <Suspense fallback={<SkeletonList rows={4} />}>
      <JobsInner />
    </Suspense>
  )
}

function JobsInner() {
  // Quotes live here, beside the jobs they turn into: ?tab=quotes is the
  // quotes list (the sidebar's "Quotes" item and every "← Quotes" link).
  // ?status=unpaid is the dashboard's "Owed to you" door: it seeds the
  // payment filter so the link keeps its promise.
  const params = useSearchParams()
  const tabParam = params.get('tab')
  const statusParam = params.get('status')
  const tab: 'jobs' | 'quotes' = tabParam === 'quotes' ? 'quotes' : 'jobs'

  const [items, setItems] = useState<JobWithContext[] | null>(null)
  const [quotes, setQuotes] = useState<QuoteRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'unpaid' | 'partial' | 'paid'>(
    statusParam === 'unpaid' || statusParam === 'partial' || statusParam === 'paid' ? statusParam : 'all',
  )
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [quoteStatus, setQuoteStatus] = useState<'all' | QuoteStatus>('all')

  useEffect(() => {
    fetchJobsWithContext().then(setItems).catch((e) => setError(String(e.message ?? e)))
    async function loadQuotes() {
      const [qRes, tRes] = await Promise.all([
        supabase
          .from('quotes')
          .select('*, customer:customers(*)')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabase.from('quote_totals').select('*'),
      ])
      const totalsById = new Map(
        ((tRes.data ?? []) as { quote_id: string; total_cents: number }[]).map((t) => [t.quote_id, t]),
      )
      setQuotes(
        ((qRes.data ?? []) as unknown as QuoteRow[]).map((x) => ({
          ...x,
          totals: totalsById.get(x.id) ?? null,
        })),
      )
    }
    loadQuotes().catch((e) => setError(String(e.message ?? e)))
  }, [])

  const filtered = useMemo(() => {
    if (!items) return []
    const needle = q.trim().toLowerCase()
    return items.filter((it) => {
      if (status !== 'all' && it.job.payment_status !== status) return false
      if (from && it.job.date < from) return false
      if (to && it.job.date > to) return false
      if (!needle) return true
      const hay = [
        it.job.job_number,
        it.job.title,
        it.job.work_performed ?? '',
        it.customer?.name ?? '',
        vehicleLabel(it.vehicle),
        it.vehicle?.license_plate ?? '',
        it.vehicle?.vin ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [items, q, status, from, to])

  const filteredQuotes = useMemo(
    () => (quotes ?? []).filter((x) => quoteStatus === 'all' || x.status === quoteStatus),
    [quotes, quoteStatus],
  )

  async function deleteQuote(x: QuoteRow) {
    const { error } = await supabase
      .from('quotes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', x.id)
    if (error) throw new Error(error.message)
    setQuotes((prev) => (prev ?? []).filter((y) => y.id !== x.id))
  }

  if (error) return <p style={{ color: 'var(--red)' }}>Couldn&apos;t load: {error}</p>

  const segStyle = (active: boolean) =>
    active ? { borderColor: 'var(--accent)', color: 'var(--accent2)' } : undefined

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">Jobs &amp; Quotes</h1>
        {tab === 'quotes' ? (
          <Link href="/quotes/new" className="btn btn-primary">+ New Quote</Link>
        ) : (
          <Link href="/jobs/new" className="btn btn-primary">+ New Job</Link>
        )}
      </div>

      {/* Links, not buttons: the URL is the tab, so the sidebar's "Quotes"
          item and a shared link both land on the right list. Plain navigation
          (aria-current), not a tablist — there is no tabpanel or arrow-key
          switching to promise. */}
      <nav className="flex gap-2" aria-label="Jobs or quotes">
        <Link
          href="/jobs?tab=jobs"
          aria-current={tab === 'jobs' ? 'page' : undefined}
          className="btn btn-sm flex-1"
          style={segStyle(tab === 'jobs')}
        >
          Jobs{items ? ` (${items.length})` : ''}
        </Link>
        <Link
          href="/jobs?tab=quotes"
          aria-current={tab === 'quotes' ? 'page' : undefined}
          className="btn btn-sm flex-1"
          style={segStyle(tab === 'quotes')}
        >
          Quotes{quotes ? ` (${quotes.length})` : ''}
        </Link>
      </nav>

      {tab === 'quotes' ? (
        <>
          <div className="card">
            <select
              className="select"
              value={quoteStatus}
              onChange={(e) => setQuoteStatus(e.target.value as typeof quoteStatus)}
              aria-label="Quote status"
            >
              <option value="all">All statuses</option>
              {QUOTE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {!quotes ? (
            <SkeletonList rows={3} />
          ) : quotes.length === 0 ? (
            <div className="card text-center" style={{ color: 'var(--text2)' }}>
              No quotes yet. Write one up and text the customer a link they can approve
              with one tap.
            </div>
          ) : filteredQuotes.length === 0 ? (
            <div className="card text-center" style={{ color: 'var(--text2)' }}>
              No {quoteStatus} quotes.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredQuotes.map((x) => (
                <SwipeableRow
                  key={x.id}
                  confirmText={`Delete quote ${x.quote_number}? It disappears from lists but the record isn't destroyed.`}
                  onDelete={() => deleteQuote(x)}
                >
                  <Link
                    href={`/quotes/${x.id}`}
                    className="card flex items-center gap-3 !py-3"
                    style={{ borderLeft: `3px solid ${quoteStatusColors[x.status] ?? 'var(--border)'}` }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="wnt-id text-xs">{x.quote_number}</span>
                        <span className="text-xs" style={{ color: 'var(--text3)' }}>{formatDate(x.created_at.slice(0, 10))}</span>
                      </div>
                      <div className="truncate font-semibold">{x.title}</div>
                      <div className="truncate text-sm" style={{ color: 'var(--text2)' }}>{x.customer?.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="money font-semibold">{formatCents(x.totals?.total_cents)}</div>
                      <span className={statusChipClass(x.status)}>{x.status}</span>
                    </div>
                  </Link>
                </SwipeableRow>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="card space-y-3">
            <input
              className="input"
              placeholder="Search jobs, customers, vehicles…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="grid grid-cols-3 gap-2">
              <select
                className="select"
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="all">All statuses</option>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
              </select>
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            </div>
          </div>

          {!items ? (
            <SkeletonList rows={4} />
          ) : filtered.length === 0 ? (
            <div className="card text-center" style={{ color: 'var(--text2)' }}>
              {items.length === 0 ? (
                <>
                  No jobs yet.{' '}
                  <Link href="/jobs/new" style={{ color: 'var(--accent2)' }}>
                    Start your first job →
                  </Link>
                </>
              ) : (
                'Nothing matches those filters.'
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {/* What was promised and not yet paid off floats to the top, because
                  "what did I commit to this week" is the question this list answers. */}
              {(() => {
                const today = todayLocalIso()
                const weekOut = new Date()
                weekOut.setDate(weekOut.getDate() + 7)
                const week = `${weekOut.getFullYear()}-${String(weekOut.getMonth() + 1).padStart(2, '0')}-${String(weekOut.getDate()).padStart(2, '0')}`
                const promised = filtered.filter(
                  (it) =>
                    it.job.promised_date != null &&
                    it.job.promised_date <= week &&
                    it.job.payment_status !== 'paid',
                )
                const rest = filtered.filter((it) => !promised.includes(it))
                return (
                  <>
                    {promised.length > 0 && (
                      <>
                        <div className="label">Promised this week</div>
                        {promised.map((it) => (
                          <div key={it.job.id} className="space-y-1">
                            <JobRow item={it} />
                            <p
                              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                              style={{
                                background: 'var(--bg2)',
                                color: it.job.promised_date! < today ? 'var(--red)' : 'var(--accent2)',
                                borderLeft: `3px solid ${it.job.promised_date! < today ? 'var(--red)' : 'var(--accent)'}`,
                              }}
                            >
                              {it.job.promised_date! < today ? 'Promised ' : 'Promised back '}
                              {formatDate(it.job.promised_date)}
                              {it.job.promised_date! < today && ' — overdue'}
                            </p>
                          </div>
                        ))}
                        {rest.length > 0 && <div className="label !mt-4">Everything else</div>}
                      </>
                    )}
                    {rest.map((it) => (
                      <JobRow key={it.job.id} item={it} />
                    ))}
                  </>
                )
              })()}
            </div>
          )}
        </>
      )}
    </div>
  )
}
