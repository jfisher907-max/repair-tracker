'use client'

import Link from 'next/link'
import type { JobWithContext } from '@/lib/data'
import { formatCents } from '@/lib/money'
import { vehicleLabel } from '@/lib/types'

const stripeColors: Record<string, string> = {
  unpaid: 'var(--red)',
  partial: 'var(--accent2)',
  paid: 'var(--green)',
}

export default function JobRow({ item }: { item: JobWithContext }) {
  const { job, vehicle, customer, totals } = item
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="card flex items-center gap-3 !py-3"
      style={{ borderLeft: `3px solid ${stripeColors[job.payment_status] ?? 'var(--border)'}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold" style={{ color: 'var(--accent2)' }}>
            {job.job_number}
          </span>
          <span className="text-xs" style={{ color: 'var(--text3)' }}>
            {job.date}
          </span>
        </div>
        <div className="truncate font-semibold">{job.title}</div>
        <div className="truncate text-sm" style={{ color: 'var(--text2)' }}>
          {customer?.name ?? 'Unknown customer'} · {vehicleLabel(vehicle)}
        </div>
      </div>
      <div className="text-right">
        <div className="money font-semibold">{formatCents(totals?.total_charged_cents)}</div>
        <span className={`chip chip-${job.payment_status}`}>{job.payment_status}</span>
      </div>
    </Link>
  )
}
