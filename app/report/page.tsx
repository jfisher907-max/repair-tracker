'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AuthGate from '@/components/AuthGate'
import { supabase } from '@/lib/supabase'
import { computeTotals } from '@/lib/calc'
import { formatCents, formatMiles } from '@/lib/money'
import {
  vehicleLabel,
  type Customer,
  type Job,
  type PartLine,
  type Vehicle,
} from '@/lib/types'

/**
 * Customer-facing repair history — the flagship output. Letter-size, prints
 * from iPhone Safari and desktop; "PDF" is the browser's print-to-PDF.
 * HARD RULE: never show Jake's parts cost, markup, or profit. All money on
 * this page is the customer-facing charge (labor_charge / parts_charged /
 * total_charged).
 */
export default function ReportPage() {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <Report />
      </Suspense>
    </AuthGate>
  )
}

interface ReportJob {
  job: Job
  vehicle: Vehicle
  lines: PartLine[]
}

function Report() {
  const params = useSearchParams()
  const customerId = params.get('customer')
  const vehicleId = params.get('vehicle')
  const jobId = params.get('job')

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [scopeVehicle, setScopeVehicle] = useState<Vehicle | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [jobs, setJobs] = useState<ReportJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [showPrices, setShowPrices] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const { data: settings } = await supabase.from('settings').select('business_name').single()
        setBusinessName(settings?.business_name ?? '')

        // Single-job scope loads directly and skips the vehicle fan-out.
        if (jobId) {
          const { data: j, error: jErr } = await supabase
            .from('jobs')
            .select('*, vehicle:vehicles(*, customer:customers(*))')
            .eq('id', jobId)
            .single()
          if (jErr) throw jErr
          const { vehicle: v, ...jobRow } =
            j as Job & { vehicle: Vehicle & { customer: Customer | null } }
          setScopeVehicle(v)
          setCustomer(v?.customer ?? null)
          const { data: lineRows } = await supabase
            .from('part_lines')
            .select('*')
            .eq('job_id', jobId)
          setJobs([{ job: jobRow as Job, vehicle: v, lines: (lineRows as PartLine[]) ?? [] }])
          return
        }

        let vehicles: Vehicle[] = []
        if (vehicleId) {
          const { data: v, error: vErr } = await supabase
            .from('vehicles')
            .select('*')
            .eq('id', vehicleId)
            .single()
          if (vErr) throw vErr
          vehicles = [v as Vehicle]
          setScopeVehicle(v as Vehicle)
          const { data: c } = await supabase
            .from('customers')
            .select('*')
            .eq('id', (v as Vehicle).customer_id)
            .single()
          setCustomer(c as Customer)
        } else if (customerId) {
          const { data: c, error: cErr } = await supabase
            .from('customers')
            .select('*')
            .eq('id', customerId)
            .single()
          if (cErr) throw cErr
          setCustomer(c as Customer)
          const { data: vs } = await supabase
            .from('vehicles')
            .select('*')
            .eq('customer_id', customerId)
          vehicles = (vs as Vehicle[]) ?? []
        } else {
          throw new Error('Missing ?customer=, ?vehicle=, or ?job= parameter')
        }

        const vehicleIds = vehicles.map((v) => v.id)
        if (vehicleIds.length === 0) {
          setJobs([])
          return
        }
        const { data: jobRows, error: jErr } = await supabase
          .from('jobs')
          .select('*')
          .in('vehicle_id', vehicleIds)
          .is('deleted_at', null)
          .order('date', { ascending: true })
        if (jErr) throw jErr

        const jobIds = (jobRows as Job[]).map((j) => j.id)
        const { data: lineRows } = jobIds.length
          ? await supabase.from('part_lines').select('*').in('job_id', jobIds)
          : { data: [] }

        const linesByJob = new Map<string, PartLine[]>()
        for (const l of (lineRows as PartLine[]) ?? []) {
          const list = linesByJob.get(l.job_id) ?? []
          list.push(l)
          linesByJob.set(l.job_id, list)
        }
        const vehById = new Map(vehicles.map((v) => [v.id, v]))
        setJobs(
          (jobRows as Job[]).map((j) => ({
            job: j,
            vehicle: vehById.get(j.vehicle_id)!,
            lines: linesByJob.get(j.id) ?? [],
          })),
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
  }, [customerId, vehicleId, jobId])

  const filtered = useMemo(() => {
    if (!jobs) return []
    return jobs.filter((j) => {
      if (from && j.job.date < from) return false
      if (to && j.job.date > to) return false
      return true
    })
  }, [jobs, from, to])

  if (error) return <div className="p-8">Couldn&apos;t build report: {error}</div>
  if (!jobs) return <div className="p-8" style={{ color: 'var(--text3)' }}>Building report…</div>

  const totalHours = filtered.reduce((s, j) => s + Number(j.job.labor_hours), 0)
  const grandTotal = filtered.reduce(
    (s, j) => s + computeTotals(j.job, j.lines).total_charged_cents,
    0,
  )
  const period =
    filtered.length > 0
      ? `${filtered[0].job.date} – ${filtered[filtered.length - 1].job.date}`
      : '—'
  const generated = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  // The document title matches what's actually being printed: one job is a
  // service record, one vehicle is that vehicle's history, a whole customer
  // (possibly several vehicles) is their repair history.
  const docTitle = jobId ? 'Service Record' : vehicleId ? 'Vehicle Repair History' : 'Repair History'
  const singleJob = filtered.length === 1 ? filtered[0] : null
  const backHref = jobId
    ? `/jobs/${jobId}`
    : customerId
      ? `/customers/${customerId}`
      : `/vehicles/${vehicleId}`

  return (
    <div>
      {/* Controls — hidden when printing */}
      <div
        className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b px-4 py-3"
        style={{ background: 'var(--bg1)', borderColor: 'var(--border)' }}
      >
        <Link href={backHref} className="btn btn-sm">
          ← Back
        </Link>
        <span className="text-sm" style={{ color: 'var(--text2)' }}>
          {jobId
            ? `${singleJob?.job.job_number ?? 'Job'} — ${customer?.name ?? ''}`
            : scopeVehicle
              ? vehicleLabel(scopeVehicle)
              : customer?.name ?? ''}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!jobId && (
            <>
              <input className="input !min-h-[38px] !w-auto" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
              <input className="input !min-h-[38px] !w-auto" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
            </>
          )}
          <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text2)' }}>
            <input
              type="checkbox"
              checked={showPrices}
              onChange={(e) => setShowPrices(e.target.checked)}
            />
            Prices
          </label>
          <button className="btn btn-sm btn-primary" onClick={() => window.print()}>
            🖨️ Print / Save PDF
          </button>
        </div>
      </div>

      {/* The document */}
      <div className="report-root mx-auto max-w-[8.5in] px-8 py-10">
        <header>
          {/* No business name yet: the document title carries the header alone. */}
          {businessName ? (
            <>
              <h1 className="text-3xl font-bold">{businessName}</h1>
              <div className="mt-1 text-lg" style={{ color: '#374151' }}>{docTitle}</div>
            </>
          ) : (
            <h1 className="text-3xl font-bold">{docTitle}</h1>
          )}
          <hr className="report-rule" />
          <div className="report-meta grid grid-cols-2 gap-x-8 gap-y-0.5 sm:grid-cols-4">
            <div><b>Customer:</b> {customer?.name ?? '—'}</div>
            {jobId ? (
              <>
                <div><b>Vehicle:</b> {vehicleLabel(scopeVehicle)}</div>
                <div><b>Job:</b> {singleJob?.job.job_number ?? '—'} · {singleJob?.job.date ?? ''}</div>
              </>
            ) : (
              <>
                {vehicleId && <div><b>Vehicle:</b> {vehicleLabel(scopeVehicle)}</div>}
                <div><b>Period:</b> {period}</div>
                <div><b>Jobs on record:</b> {filtered.length}</div>
              </>
            )}
            <div><b>Generated:</b> {generated}</div>
          </div>
        </header>

        <main className="mt-6">
          {filtered.length === 0 && <p>No jobs in the selected range.</p>}
          {filtered.map(({ job, vehicle, lines }) => {
            const totals = computeTotals(job, lines)
            // With a parts-charged override in place, per-line receipt prices
            // would expose actual cost vs. markup — so lines print without
            // prices and only the charged totals show.
            const showLinePrices = showPrices && job.parts_charged_override_cents == null
            return (
              <section key={job.id} className="report-job">
                <h2 className="text-lg font-bold">
                  {job.date} — {job.title}
                </h2>
                <div className="report-meta">
                  {vehicleLabel(vehicle)}
                  {job.odometer_miles != null && <> · {formatMiles(job.odometer_miles)} miles</>}
                  {Number(job.labor_hours) > 0 && <> · {Number(job.labor_hours)} labor hours</>}
                  {' · '}{job.job_number}
                </div>
                {job.work_performed && (
                  <p className="mt-1.5 whitespace-pre-wrap text-[0.92rem]">{job.work_performed}</p>
                )}

                {lines.length > 0 && (
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th style={{ width: '18%' }}>Part #</th>
                        <th>Description</th>
                        <th className="num" style={{ width: '8%' }}>Qty</th>
                        {showLinePrices && (
                          <>
                            <th className="num" style={{ width: '13%' }}>Unit</th>
                            <th className="num" style={{ width: '13%' }}>Amount</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.id}>
                          <td>{l.part_number ?? ''}</td>
                          <td>{l.description}</td>
                          <td className="num">{Number(l.qty)}</td>
                          {showLinePrices && (
                            <>
                              {/* Customer-facing prices are the CHARGE basis —
                                  Jake's cost never prints, even per line. */}
                              <td className="num">{formatCents(l.unit_charge_cents ?? l.unit_cost_cents)}</td>
                              <td className="num">{formatCents(l.line_charge_total_cents)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {showPrices && (
                  <table className="report-table report-totals" style={{ maxWidth: '20rem', marginLeft: 'auto' }}>
                    <tbody>
                      <tr>
                        <td>Parts</td>
                        <td className="num">{formatCents(totals.parts_charged_cents)}</td>
                      </tr>
                      <tr>
                        <td>Labor</td>
                        <td className="num">{formatCents(totals.labor_charge_cents)}</td>
                      </tr>
                      <tr className="total-row">
                        <td>Total</td>
                        <td className="num">{formatCents(totals.total_charged_cents)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </section>
            )
          })}
        </main>

        <footer className="mt-8 border-t pt-3 text-sm" style={{ borderColor: '#9ca3af' }}>
          <p>
            {jobId ? (
              <>
                <b>{singleJob?.job.job_number}</b> · <b>{totalHours.toFixed(1)}</b> labor hours
                {showPrices && (
                  <> · total <b>{formatCents(grandTotal)}</b></>
                )}
              </>
            ) : (
              <>
                <b>{filtered.length}</b> job{filtered.length === 1 ? '' : 's'} on record ·{' '}
                <b>{totalHours.toFixed(1)}</b> labor hours
                {showPrices && (
                  <> · grand total <b>{formatCents(grandTotal)}</b></>
                )}
              </>
            )}
          </p>
          <p
            className="mt-5 text-center italic"
            style={{ color: '#111827', fontSize: '1.15rem' }}
          >
            Thank you for trusting us with your vehicle.
          </p>
        </footer>
      </div>
    </div>
  )
}
