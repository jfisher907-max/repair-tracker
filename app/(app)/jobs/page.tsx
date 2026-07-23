'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import JobRow from '@/components/JobRow'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { vehicleLabel } from '@/lib/types'

export default function JobsPage() {
  const [items, setItems] = useState<JobWithContext[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'unpaid' | 'partial' | 'paid'>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    fetchJobsWithContext().then(setItems).catch((e) => setError(String(e.message ?? e)))
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

  if (error) return <p style={{ color: 'var(--red)' }}>Couldn&apos;t load: {error}</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">Jobs</h1>
        <Link href="/jobs/new" className="btn btn-primary">+ New Job</Link>
      </div>

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
        <p style={{ color: 'var(--text3)' }}>Loading…</p>
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
          {filtered.map((it) => (
            <JobRow key={it.job.id} item={it} />
          ))}
        </div>
      )}
    </div>
  )
}
