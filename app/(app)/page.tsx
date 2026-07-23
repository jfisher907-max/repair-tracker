'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import JobRow from '@/components/JobRow'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { unpaidBalanceCents } from '@/lib/calc'
import { formatCents } from '@/lib/money'

export default function Dashboard() {
  const [items, setItems] = useState<JobWithContext[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState<'all' | number>('all')

  useEffect(() => {
    fetchJobsWithContext().then(setItems).catch((e) => setError(String(e.message ?? e)))
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
  if (!items) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl">Dashboard</h1>
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
          <Link href="/jobs/new" className="btn btn-primary hidden sm:inline-flex">
            + New Job
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Jobs" value={String(stats.count)} />
        <StatTile label="Labor hours" value={stats.hours.toFixed(1)} />
        <StatTile label="Total charged" value={formatCents(stats.charged)} />
        <StatTile label="Parts spend" value={formatCents(stats.partsSpend)} />
        <StatTile label="Profit" value={formatCents(stats.profit)} accent="var(--green)" />
        <StatTile
          label="Unpaid balance"
          value={formatCents(stats.unpaid)}
          accent={stats.unpaid > 0 ? 'var(--red)' : undefined}
        />
      </div>

      <Link href="/jobs/new" className="btn btn-primary w-full sm:hidden">
        + New Job
      </Link>

      {unpaidJobs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg" style={{ color: 'var(--text2)' }}>Unpaid jobs</h2>
          {unpaidJobs.map((it) => (
            <JobRow key={it.job.id} item={it} />
          ))}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg" style={{ color: 'var(--text2)' }}>Recent jobs</h2>
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

function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value money" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
    </div>
  )
}
