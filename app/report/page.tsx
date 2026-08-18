'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AuthGate from '@/components/AuthGate'
import DocBrand from '@/components/DocBrand'
import { BRAND_NAME } from '@/lib/brand'
import { supabase } from '@/lib/supabase'
import { computeTotals } from '@/lib/calc'
import { formatCents, formatMiles } from '@/lib/money'
import { formatDate } from '@/lib/date'
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
  const [business, setBusiness] = useState({ name: '', phone: '', address: '', email: '' })
  const [jobs, setJobs] = useState<ReportJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [showPrices, setShowPrices] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const { data: settings } = await supabase.from('settings').select('*').single()
        setBusiness({
          name: settings?.business_name ?? '',
          phone: settings?.business_phone ?? '',
          address: settings?.business_address ?? '',
          email: settings?.business_email ?? '',
        })

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

  // Print-to-PDF names the file after document.title — make every saved PDF
  // self-identifying ("J001 Service Record — Sam Steensland.pdf").
  useEffect(() => {
    if (!jobs) return
    let title = ''
    if (jobId && jobs[0]) {
      title = `${jobs[0].job.job_number} Service Record — ${customer?.name ?? ''}`
    } else if (vehicleId && scopeVehicle) {
      title = `${vehicleLabel(scopeVehicle)} Repair History — ${customer?.name ?? ''}`
    } else if (customer) {
      title = `${customer.name} Repair History`
    }
    if (title.trim()) document.title = title.trim().replace(/—\s*$/, '').trim()
    return () => {
      document.title = BRAND_NAME
    }
  }, [jobs, customer, scopeVehicle, jobId, vehicleId])

  if (error) return <div className="p-8">Couldn&apos;t build report: {error}</div>
  if (!jobs) return <div className="p-8" style={{ color: 'var(--text3)' }}>Building report…</div>

  const totalHours = filtered.reduce((s, j) => s + Number(j.job.labor_hours), 0)
  const grandTotal = filtered.reduce(
    (s, j) => s + computeTotals(j.job, j.lines).total_charged_cents,
    0,
  )
  const period =
    filtered.length > 0
      ? `${formatDate(filtered[0].job.date)} – ${formatDate(filtered[filtered.length - 1].job.date)}`
      : '—'
  const lastMiles = filtered.reduce<number | null>(
    (max, j) =>
      j.job.odometer_miles != null && (max == null || j.job.odometer_miles > max)
        ? j.job.odometer_miles
        : max,
    null,
  )
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
      <div className="doc-wrap mx-auto max-w-[8.5in] px-0 py-0 sm:px-4 sm:py-8">
        <div className="doc-root">
          <DocBrand
            business={business}
            docType={docTitle}
            docRef={jobId ? singleJob?.job.job_number ?? null : null}
          />

          <div className="doc-body">
            <dl className="doc-meta">
              <div>
                <dt>Prepared for</dt>
                <dd>{customer?.name ?? '—'}</dd>
              </div>
              {jobId ? (
                <>
                  <div>
                    <dt>Vehicle</dt>
                    <dd>{vehicleLabel(scopeVehicle)}</dd>
                  </div>
                  <div>
                    <dt>Job date</dt>
                    <dd>{formatDate(singleJob?.job.date)}</dd>
                  </div>
                </>
              ) : (
                <>
                  {vehicleId && (
                    <div>
                      <dt>Vehicle</dt>
                      <dd>{vehicleLabel(scopeVehicle)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Period</dt>
                    <dd>{period}</dd>
                  </div>
                  <div>
                    <dt>Jobs on record</dt>
                    <dd>{filtered.length}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Generated</dt>
                <dd>{generated}</dd>
              </div>
              {/* Vehicle identity matters most at resale — print it when scoped to one vehicle. */}
              {(jobId || vehicleId) && scopeVehicle?.vin && (
                <div>
                  <dt>VIN</dt>
                  <dd>{scopeVehicle.vin}</dd>
                </div>
              )}
              {(jobId || vehicleId) && scopeVehicle?.license_plate && (
                <div>
                  <dt>Plate</dt>
                  <dd>{scopeVehicle.license_plate}</dd>
                </div>
              )}
              {vehicleId && lastMiles != null && (
                <div>
                  <dt>Last recorded mileage</dt>
                  <dd>{formatMiles(lastMiles)} mi</dd>
                </div>
              )}
            </dl>

            {filtered.length === 0 && (
              <p className="doc-section-sub" style={{ marginTop: 24 }}>No jobs in the selected range.</p>
            )}
            {filtered.map(({ job, vehicle, lines }) => {
              const totals = computeTotals(job, lines)
              // With a parts-charged override in place, per-line receipt prices
              // would expose actual cost vs. markup — so lines print without
              // prices and only the charged totals show.
              const showLinePrices = showPrices && job.parts_charged_override_cents == null
              return (
                <section key={job.id} className="doc-section">
                  <h2>
                    {formatDate(job.date)} — {job.title}
                  </h2>
                  <div className="doc-section-sub">
                    {vehicleLabel(vehicle)}
                    {job.odometer_miles != null && <> · {formatMiles(job.odometer_miles)} miles</>}
                    {Number(job.labor_hours) > 0 && <> · {Number(job.labor_hours)} labor hours</>}
                    {' · '}{job.job_number}
                  </div>
                  {job.work_performed && (
                    <p className="doc-section-body">{job.work_performed}</p>
                  )}
                  {job.recommendations && (
                    <p className="doc-section-body">
                      <b>Recommended:</b> {job.recommendations}
                    </p>
                  )}

                  {lines.length > 0 && (
                    <table className="doc-table doc-table--tight">
                      <thead>
                        <tr>
                          <th style={{ width: '18%' }}>Part #</th>
                          <th>Description</th>
                          <th className="doc-n" style={{ width: '8%' }}>Qty</th>
                          {showLinePrices && (
                            <>
                              <th className="doc-n" style={{ width: '13%' }}>Unit</th>
                              <th className="doc-n" style={{ width: '13%' }}>Amount</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => (
                          <tr key={l.id}>
                            <td className="doc-dim">{l.part_number ?? ''}</td>
                            <td className="doc-desc">{l.description}</td>
                            <td className="doc-n doc-dim">{Number(l.qty)}</td>
                            {showLinePrices && (
                              <>
                                {/* Customer-facing prices are the CHARGE basis —
                                    Jake's cost never prints, even per line. */}
                                <td className="doc-n doc-dim">{formatCents(l.unit_charge_cents ?? l.unit_cost_cents)}</td>
                                <td className="doc-n">{formatCents(l.line_charge_total_cents)}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {showPrices && (
                    <div className="doc-totals-solo" style={{ marginTop: 10 }}>
                      <div className="doc-trow">
                        <span className="doc-tl">Parts</span>
                        <span className="doc-tv">{formatCents(totals.parts_charged_cents)}</span>
                      </div>
                      <div className="doc-trow">
                        <span className="doc-tl">
                          Labor
                          {Number(job.labor_hours) > 0 && (
                            <> · {Number(job.labor_hours)} hr @ {formatCents(job.labor_rate_cents)}/hr</>
                          )}
                        </span>
                        <span className="doc-tv">{formatCents(totals.labor_charge_cents)}</span>
                      </div>
                      <div className="doc-trow doc-total">
                        <span className="doc-tl">Total</span>
                        <span className="doc-tv">{formatCents(totals.total_charged_cents)}</span>
                      </div>
                    </div>
                  )}
                </section>
              )
            })}

            {showPrices && filtered.length > 1 && (
              <div className="doc-totals-solo" style={{ marginTop: 26 }}>
                <div className="doc-due-card">
                  <div>
                    <span className="doc-due-label">Grand total</span>
                    <span className="doc-due-sub">
                      {filtered.length} jobs · {totalHours.toFixed(1)} labor hours
                    </span>
                  </div>
                  <div className="doc-due-amt">{formatCents(grandTotal)}</div>
                </div>
              </div>
            )}

            <footer className="doc-foot">
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
            </footer>
          </div>
        </div>
      </div>
    </div>
  )
}
