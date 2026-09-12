'use client'

import Link from 'next/link'
import type { JobWithContext } from '@/lib/data'
import { isBookedJob } from '@/lib/finances'
import { formatCents } from '@/lib/money'
import { formatDateShort } from '@/lib/date'
import { vehicleLabel } from '@/lib/types'

/* The signature pattern: a status-colored 3px left edge on a neutral card.
   Status vocabulary: paid=ok (mint) · partial=wait (gold) · unpaid=stop (ember)
   · scheduled=info (sky) · in progress=wait (gold). */
const stripeColors: Record<string, string> = {
  unpaid: 'var(--status-stop-solid)',
  partial: 'var(--status-wait-solid)',
  paid: 'var(--status-ok-solid)',
  scheduled: 'var(--status-info-solid)',
  in_progress: 'var(--status-wait-solid)',
}

/**
 * One job in a list. A job that is not done yet (0043) is not owed money: its
 * edge and chip say where it is in the shop — "scheduled" (sky) or "in
 * progress" (gold) — instead of "unpaid", and its money is the booked total in
 * the neutral colour. A done job keeps the payment status edge and chip.
 */
export default function JobRow({ item }: { item: JobWithContext }) {
  const { job, vehicle, customer, totals } = item
  const booked = isBookedJob(job)
  const edgeKey = booked ? job.stage : job.payment_status
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="card flex items-center gap-3 !py-3"
      style={{ borderLeft: `var(--edge-width) solid ${stripeColors[edgeKey] ?? 'var(--border)'}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {/* Ids are gold, mono, always visible. */}
          <span className="wnt-id text-xs">{job.job_number}</span>
          <span className="text-xs" style={{ color: 'var(--text3)' }}>
            {/* On a scheduled job the date is the booked drop-off day, and says so. */}
            {job.stage === 'scheduled' ? 'booked ' : ''}
            {formatDateShort(job.date)}
          </span>
        </div>
        <div className="truncate font-semibold">{job.title}</div>
        <div className="truncate text-sm" style={{ color: 'var(--text2)' }}>
          {customer?.name ?? 'Unknown customer'} · {vehicleLabel(vehicle)}
        </div>
      </div>
      <div className="text-right">
        <div className="money font-semibold">{formatCents(totals?.total_charged_cents)}</div>
        {booked ? (
          job.stage === 'scheduled' ? (
            <span className="chip chip-booked">scheduled</span>
          ) : (
            <span className="chip chip-open">in progress</span>
          )
        ) : (
          <span className={`chip chip-${job.payment_status}`}>{job.payment_status}</span>
        )}
      </div>
    </Link>
  )
}
