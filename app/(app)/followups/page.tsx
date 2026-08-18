'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { SkeletonList } from '@/components/Skeleton'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/date'
import { ageInDays, statusColors, type Recommendation } from '@/lib/recommendations'
import { todayLocalIso } from '@/lib/date'
import { vehicleLabel, type Customer, type Vehicle } from '@/lib/types'

interface Row extends Recommendation {
  vehicle: (Vehicle & { customer: Customer | null }) | null
}

type Filter = 'open' | 'booked' | 'all'

/**
 * Every recommendation still waiting, oldest first — the work already found
 * and not yet sold. Nothing here is new data; it is what the job pages have
 * been collecting, finally in one place where it can be chased.
 */
export default function FollowUpsPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [sharedId, setSharedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Inner joins plus the deleted_at filters keep items from binned jobs and
    // vehicles out of the worklist — chasing a customer about a job that was
    // deleted is worse than not chasing at all.
    //
    // The jobs embed MUST name its foreign key: recommendations has two FKs to
    // jobs (job_id and resolved_job_id), and an unqualified jobs!inner makes
    // PostgREST error out — which an unchecked `data ?? []` silently rendered
    // as an empty worklist.
    const { data, error } = await supabase
      .from('recommendations')
      .select(
        '*, job:jobs!recommendations_job_id_fkey!inner(deleted_at), vehicle:vehicles!inner(*, customer:customers(*))',
      )
      .is('job.deleted_at', null)
      .is('vehicle.deleted_at', null)
      .order('created_at')
    if (error) {
      alert(`Couldn't load follow-ups: ${error.message}`)
      setRows([])
      return
    }
    setRows((data as Row[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const shown = useMemo(() => {
    const all = rows ?? []
    if (filter === 'all') return all
    return all.filter((r) => r.status === filter)
  }, [rows, filter])

  const openValue = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.status === 'open')
        .reduce((s, r) => s + (r.estimate_cents ?? 0), 0),
    [rows],
  )

  async function share(r: Row) {
    const who = r.vehicle?.customer?.name?.split(' ')[0] ?? 'there'
    const what = vehicleLabel(r.vehicle)
    const price = r.estimate_cents != null ? ` It runs about ${formatCents(r.estimate_cents)}.` : ''
    const text =
      `Hi ${who} — when I had your ${what} in, I noted: ${r.description}` +
      `${price} Want me to get it booked in?`
    try {
      if (navigator.share) await navigator.share({ text })
      else await navigator.clipboard.writeText(text)
      setSharedId(r.id)
      setTimeout(() => setSharedId(null), 2500)
    } catch {
      /* the customer cancelled the share sheet */
    }
  }

  const counts = {
    open: (rows ?? []).filter((r) => r.status === 'open').length,
    booked: (rows ?? []).filter((r) => r.status === 'booked').length,
    all: (rows ?? []).length,
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Follow-ups</h1>
        {openValue > 0 && (
          <span className="text-sm" style={{ color: 'var(--text2)' }}>
            <b className="money" style={{ color: 'var(--accent2)' }}>{formatCents(openValue)}</b>{' '}
            of work flagged and not yet sold
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(['open', 'booked', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            className={`btn btn-sm ${filter === f ? 'btn-primary' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'open' ? 'Open' : f === 'booked' ? 'Booked' : 'Everything'} ({counts[f]})
          </button>
        ))}
      </div>

      {!rows ? (
        <SkeletonList rows={4} height={72} />
      ) : shown.length === 0 ? (
        <div className="card text-center" style={{ color: 'var(--text2)' }}>
          {filter === 'open'
            ? 'Nothing outstanding. Anything you flag on a job shows up here until it’s booked or done.'
            : 'Nothing here yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => {
            const days = ageInDays(r)
            const overdue = r.target_date != null && r.target_date < todayLocalIso()
            return (
              <div key={r.id} className="card space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="whitespace-pre-wrap text-sm font-semibold">{r.description}</p>
                    <div className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
                      {r.vehicle?.customer ? (
                        <Link href={`/customers/${r.vehicle.customer.id}`} style={{ color: 'var(--blue)' }}>
                          {r.vehicle.customer.name}
                        </Link>
                      ) : (
                        'Unknown customer'
                      )}
                      {' · '}
                      {r.vehicle ? (
                        <Link href={`/vehicles/${r.vehicle.id}`} style={{ color: 'var(--blue)' }}>
                          {vehicleLabel(r.vehicle)}
                        </Link>
                      ) : (
                        'vehicle removed'
                      )}
                    </div>
                  </div>
                  <span className="chip flex-none" style={{ background: 'var(--bg3)', color: statusColors[r.status] }}>
                    {r.status}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--text3)' }}>
                  <span>flagged {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}</span>
                  {r.target_date && (
                    <span style={overdue ? { color: 'var(--red)', fontWeight: 600 } : undefined}>
                      {overdue ? 'was due ' : 'by '}
                      {formatDate(r.target_date)}
                    </span>
                  )}
                  {r.estimate_cents != null && (
                    <span className="money">~{formatCents(r.estimate_cents)}</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-sm btn-primary" onClick={() => share(r)}>
                    💬 Text the customer
                  </button>
                  <Link href={`/jobs/${r.job_id}`} className="btn btn-sm">Job it came from →</Link>
                  {sharedId === r.id && (
                    <span className="flash-in text-xs" style={{ color: 'var(--green)' }}>
                      Ready to send ✓
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
