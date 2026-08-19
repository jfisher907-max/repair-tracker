'use client'

import { use, useEffect, useState } from 'react'
import QuoteForm, { type AddOnJobContext } from '@/components/QuoteForm'
import { supabase } from '@/lib/supabase'
import { vehicleLabel, type Customer, type Job, type Vehicle } from '@/lib/types'

/**
 * Plain visit: a blank quote. With ?job=<id> (the job page's "Quote extra
 * work" button): an add-on quote — customer, vehicle, and labor rate come
 * from that job, and approval will apply lines to it rather than create a
 * new job.
 */
export default function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>
}) {
  const { job: jobId } = use(searchParams)
  const [addOnJob, setAddOnJob] = useState<AddOnJobContext | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!jobId) return
    supabase
      .from('jobs')
      .select('*, vehicle:vehicles(*, customer:customers(*))')
      .eq('id', jobId)
      .single()
      .then(({ data, error }) => {
        const job = data as (Job & { vehicle: (Vehicle & { customer: Customer | null }) | null }) | null
        if (error || !job?.vehicle?.customer) {
          setFailed(true)
          return
        }
        setAddOnJob({
          id: job.id,
          job_number: job.job_number,
          labor_rate_cents: job.labor_rate_cents,
          customer_id: job.vehicle.customer.id,
          customer_name: job.vehicle.customer.name,
          vehicle_id: job.vehicle.id,
          vehicle_label: vehicleLabel(job.vehicle),
        })
      })
  }, [jobId])

  if (jobId && failed) {
    return (
      <p className="text-sm" style={{ color: 'var(--red)' }}>
        Couldn&apos;t load that job — open it from the Jobs list and try again.
      </p>
    )
  }
  if (jobId && !addOnJob) return <p style={{ color: 'var(--text3)' }}>Loading…</p>
  return <QuoteForm addOnJob={addOnJob ?? undefined} />
}
