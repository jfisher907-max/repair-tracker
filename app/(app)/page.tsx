'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import JobRow from '@/components/JobRow'
import { SkeletonDashboard } from '@/components/Skeleton'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { unpaidBalanceCents } from '@/lib/calc'
import { formatCents } from '@/lib/money'
import { supabase } from '@/lib/supabase'

export default function Dashboard() {
  const [items, setItems] = useState<JobWithContext[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState<'all' | number>('all')
  const [billing, setBilling] = useState<{ openQuotes: number; unpaidInvoices: number } | null>(null)
  const [businessName, setBusinessName] = useState('')

  useEffect(() => {
    fetchJobsWithContext().then(setItems).catch((e) => setError(String(e.message ?? e)))
    supabase
      .from('settings')
      .select('business_name')
      .single()
      .then(({ data }) => setBusinessName(data?.business_name ?? ''))
    Promise.all([
      supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .in('status', ['draft', 'sent'])
        .is('deleted_at', null),
      supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .in('status', ['draft', 'sent']),
    ]).then(([q, i]) => setBilling({ openQuotes: q.count ?? 0, unpaidInvoices: i.count ?? 0 }))
  }, [])

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const it of items ?? []) set.add(new Date(it.job.date + 'T00:00:00').getFullYear())
    return [...set].sort((a, b) => b - a)
  }, [items])

  const scoped = useMemo(() => {
    if (!items) return []
    if (year === 'all') return items
    return items.filter((it) => new Date(it.job.date + 'T00:00:00').getFullYear() === year)
  }, [items, year])

  const stats = useMemo(() => {
    let hours = 0
    let charged = 0
    let partsSpend = 0
    let profit = 0
    let unpaid = 0
    for (const it of scoped) {
      hours += Number(it.job.labor_hours)
      const t = it.totals
      if (!t) continue
      charged += t.total_charged_cents
      partsSpend += t.parts_cost_cents
      profit += t.profit_cents
      unpaid += unpaidBalanceCents(it.job, t.total_charged_cents)
    }
    return { count: scoped.length, hours, charged, partsSpend, profit, unpaid }
  }, [scoped])

  const unpaidJobs = scoped.filter((it) => it.job.payment_status !== 'paid')
  const recent = scoped.slice(0, 6)

  if (error) return <p style={{ color: 'var(--red)' }}>Couldn&apos;t load: {error}</p>
  if (!items) return <SkeletonDashboard />

  if (items.length === 0) {
    return (
      <div className="card mx-auto max-w-md space-y-4 text-center">
        <div className="text-4xl">🚗</div>
        <h1 className="text-2xl">Welcome to your shop</h1>
        <p style={{ color: 'var(--text2)' }}>
          Start your first job — you can add the customer and their vehicle right in the same
          form. Parts and receipts come after.
        </p>
        <Link href="/jobs/new" className="btn btn-primary w-full">
          + Start your first job
        </Link>
      </div>
    )
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm" style={{ color: 'var(--text3)' }}>{today}</div>
          <h1 className="text-3xl leading-tight">{businessName || 'Dashboard'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="select !w-auto !min-h-[38px]"
            value={String(year)}
            onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All time</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <Link href="/quotes/new" className="btn hidden sm:inline-flex">
            + New Quote
          </Link>
          <Link href="/jobs/new" className="btn btn-primary hidden sm:inline-flex">
            + New Job
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile icon="🔧" label="Jobs" value={String(stats.count)} />
        <StatTile icon="⏱️" label="Labor hours" value={stats.hours.toFixed(1)} />
        <StatTile icon="💵" label="Total charged" value={formatCents(stats.charged)} />
        <StatTile icon="🛒" label="Parts spend" value={formatCents(stats.partsSpend)} />
        <StatTile icon="📈" label="Profit" value={formatCents(stats.profit)} accent="var(--green)" />
        <StatTile
          icon="⚠️"
          label="Unpaid balance"
          value={formatCents(stats.unpaid)}
          accent={stats.unpaid > 0 ? 'var(--red)' : 'var(--green)'}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:hidden">
        <Link href="/jobs/new" className="btn btn-primary">
          + New Job
        </Link>
        <Link href="/quotes/new" className="btn">
          + New Quote
        </Link>
        <Link href="/reports" className="btn">
          📊 Reports
        </Link>
        <Link href="/expenses" className="btn">
          🧰 Expenses
        </Link>
      </div>

      {billing && (billing.openQuotes > 0 || billing.unpaidInvoices > 0) && (
        <Link href="/billing" className="card flex items-center justify-between !py-3 hover:brightness-110">
          <span className="font-semibold">🧾 Billing</span>
          <span className="text-sm" style={{ color: 'var(--text2)' }}>
            {billing.openQuotes > 0 && (
              <>{billing.openQuotes} open quote{billing.openQuotes === 1 ? '' : 's'}</>
            )}
            {billing.openQuotes > 0 && billing.unpaidInvoices > 0 && ' · '}
            {billing.unpaidInvoices > 0 && (
              <span style={{ color: 'var(--red)' }}>
                {billing.unpaidInvoices} unpaid invoice{billing.unpaidInvoices === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </Link>
      )}

      {unpaidJobs.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">Unpaid jobs</h2>
          {unpaidJobs.map((it) => (
            <JobRow key={it.job.id} item={it} />
          ))}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="section-title flex-1">Recent jobs</h2>
          <Link href="/jobs" className="text-sm" style={{ color: 'var(--accent2)' }}>
            View all →
          </Link>
        </div>
        {recent.map((it) => (
          <JobRow key={it.job.id} item={it} />
        ))}
      </section>
    </div>
  )
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: string
  label: string
  value: string
  accent?: string
}) {
  return (
    <div className="stat-tile" style={accent ? { borderTop: `2px solid ${accent}` } : undefined}>
      <div className="flex items-start justify-between">
        <div className="stat-label">{label}</div>
        <span className="text-sm" style={{ opacity: 0.45 }}>{icon}</span>
      </div>
      <div className="stat-value money" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
    </div>
  )
}
