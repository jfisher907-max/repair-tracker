'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AuthGate from '@/components/AuthGate'
import DocBrand from '@/components/DocBrand'
import { BRAND_NAME } from '@/lib/brand'
import { supabase } from '@/lib/supabase'
import { isLive, type Recommendation } from '@/lib/recommendations'
import { computeTotals, governingInvoice } from '@/lib/calc'
import { formatTaxRate } from '@/lib/billing'
import { formatCents, formatMiles } from '@/lib/money'
import { formatDate } from '@/lib/date'
import {
  AIRCRAFT_HOURS_LABEL,
  PAPER,
  formatAirframeHours,
  lineOf,
  needsPartConditions,
} from '@/lib/service-line'
import {
  vehicleLabel,
  type Customer,
  type Invoice,
  type Job,
  type PartCondition,
  type PartLine,
  type Vehicle,
} from '@/lib/types'

/**
 * Customer-facing repair history — the flagship output. Letter-size, prints
 * from iPhone Safari and desktop; "PDF" is the browser's print-to-PDF.
 * HARD RULE: never show Jake's parts cost, markup, or profit. All money on
 * this page is the customer-facing charge.
 *
 * A job with a live invoice prints what that invoice billed — its frozen
 * lines, parts, labor hours and rate, sales tax line and Total, read off the
 * governing invoice (largest live, ties to newest), exactly as the invoice
 * document (DocView) prints them. Everything money- or hours-shaped for an
 * invoiced job comes from that ONE paper, so a job edited after its invoice
 * never prints line amounts that do not add to its Parts row, or two labor
 * hour counts. Never the job's charge × a rate: six early invoices went out with no
 * tax line, and their Total is their price. A job with no invoice yet prints
 * its charge, labelled before tax. The Grand total is the sum of those
 * per-job figures. Nothing here is stored: every print re-reads the rows.
 * included_tax_cents is books-only and is never selected here.
 *
 * An aircraft (AVN-3) prints as one: "Aircraft Repair History", its tail and
 * serial number instead of VIN and plate, airframe hours instead of miles —
 * the invoice's frozen hours when it was invoiced, else the job's — and no
 * New / Used part tags. Car output is unchanged.
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

/** The customer-facing fields of an invoice — no books-only columns. */
type ReportInvoice = Pick<
  Invoice,
  | 'id'
  | 'job_id'
  | 'invoice_number'
  | 'status'
  | 'lines'
  | 'labor_hours'
  | 'labor_rate_cents'
  | 'labor_cents'
  | 'parts_cents'
  | 'tax_rate_bp'
  | 'tax_cents'
  | 'total_cents'
  | 'created_at'
  | 'service_line'
  | 'aircraft'
>

// service_line and aircraft (0055): the paper it went out on, and its frozen
// airframe hours — both customer-facing.
const INVOICE_FIELDS =
  'id, job_id, invoice_number, status, lines, labor_hours, labor_rate_cents, labor_cents, parts_cents, tax_rate_bp, tax_cents, total_cents, created_at, service_line, aircraft'

interface ReportJob {
  job: Job
  vehicle: Vehicle
  lines: PartLine[]
  /** The governing live invoice: what the customer was billed. Null = not invoiced yet. */
  invoice: ReportInvoice | null
}

/** Live invoices of these jobs, keyed to each job's governing one. A failed
 *  read throws: a history must never print a pre-tax figure as billed
 *  because the invoices did not load. */
async function loadGoverningInvoices(jobIds: string[]): Promise<Map<string, ReportInvoice>> {
  const byJob = new Map<string, ReportInvoice>()
  if (jobIds.length === 0) return byJob
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_FIELDS)
    .in('job_id', jobIds)
    .neq('status', 'void')
  if (error) throw error
  const grouped = new Map<string, ReportInvoice[]>()
  for (const inv of (data as ReportInvoice[] | null) ?? []) {
    const list = grouped.get(inv.job_id) ?? []
    list.push(inv)
    grouped.set(inv.job_id, list)
  }
  for (const [jobId, list] of grouped) {
    const gov = governingInvoice(list)
    if (gov) byJob.set(jobId, gov)
  }
  return byJob
}

/** What a job's history entry prints as its Total: the invoice's billed total, or the charge before tax. */
function billedTotal(j: ReportJob): number {
  return j.invoice ? j.invoice.total_cents : computeTotals(j.job, j.lines).total_charged_cents
}

/** A job's labor hours as its history entry prints them: the invoice's, or the job's when not invoiced. */
function billedHours(j: Pick<ReportJob, 'job' | 'invoice'>): number {
  return Number(j.invoice ? j.invoice.labor_hours : j.job.labor_hours)
}

/** An aircraft job's airframe hours as its entry prints them: frozen on the
 *  invoice when it was invoiced, else the job's own. */
function airframeHoursOf(j: Pick<ReportJob, 'job' | 'invoice'>): number | null {
  const frozen = j.invoice?.aircraft?.airframe_hours
  const hours = j.invoice ? (frozen ?? null) : (j.job.airframe_hours ?? null)
  return hours == null || Number.isNaN(Number(hours)) ? null : Number(hours)
}

const CONDITION_LABEL: Record<PartCondition, string> = {
  new: 'New',
  used: 'Used',
  rebuilt: 'Rebuilt',
  reconditioned: 'Reconditioned',
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
  const [recs, setRecs] = useState<Recommendation[]>([])
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
          const { data: recRows } = await supabase
            .from('recommendations').select('*').eq('job_id', jobId)
          setRecs((recRows as Recommendation[]) ?? [])
          const invoiceByJob = await loadGoverningInvoices([jobId])
          // The same filter the all-jobs path uses: an off-invoice line is the
          // shop's own cost and never belongs on a customer's record.
          setJobs([
            {
              job: jobRow as Job,
              vehicle: v,
              lines: ((lineRows as PartLine[]) ?? []).filter((l) => l.on_invoice !== false),
              invoice: invoiceByJob.get(jobId) ?? null,
            },
          ])
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

        const { data: recRows } = jobIds.length
          ? await supabase.from('recommendations').select('*').in('job_id', jobIds)
          : { data: [] }
        setRecs((recRows as Recommendation[]) ?? [])
        const invoiceByJob = await loadGoverningInvoices(jobIds)

        const linesByJob = new Map<string, PartLine[]>()
        for (const l of (lineRows as PartLine[]) ?? []) {
          // Shop-cost lines (a core deposit, absorbed freight) were never sold
          // to the customer; they charge 0 and don't belong on their record.
          if (l.on_invoice === false) continue
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
            invoice: invoiceByJob.get(j.id) ?? null,
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
  // self-identifying ("J001 Service Record — Jane Doe.pdf").
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

  // Only live items belong on a customer document — a declined or completed
  // recommendation is history, not advice.
  const recsByJob = new Map<string, Recommendation[]>()
  for (const r of recs.filter(isLive)) {
    const list = recsByJob.get(r.job_id) ?? []
    list.push(r)
    recsByJob.set(r.job_id, list)
  }

  // Hours as each entry prints them: an invoiced job's from its invoice.
  const totalHours = filtered.reduce((s, j) => s + billedHours(j), 0)
  // Each job's own Total, summed: billed invoices at what they billed (tax
  // line included), jobs not invoiced yet at their charge before tax. The
  // not-yet-invoiced part is named under the figure, so a mixed total never
  // passes for a fully taxed one.
  const grandTotal = filtered.reduce((s, j) => s + billedTotal(j), 0)
  const notInvoiced = filtered.filter((j) => !j.invoice)
  const notInvoicedCents = notInvoiced.reduce((s, j) => s + billedTotal(j), 0)
  // How a total over these jobs is named, wherever it prints: plainly when
  // every job is invoiced; "before tax" when none is; and, when it is mixed,
  // with the before-tax share named — never a blanket "before tax" on a sum
  // that holds billed tax lines too.
  const allNotInvoiced = filtered.length > 0 && notInvoiced.length === filtered.length
  const notInvoicedWords =
    notInvoiced.length > 0 && !allNotInvoiced
      ? `includes ${formatCents(notInvoicedCents)} before tax on ${
          notInvoiced.length === 1 ? '1 job' : `${notInvoiced.length} jobs`
        } not invoiced yet`
      : ''
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
  /** Scoped to one aircraft (AVN-3): its words, its identity, its hours. */
  const scopeIsAircraft = lineOf(scopeVehicle) === 'aviation'
  const scopeAsset = PAPER[lineOf(scopeVehicle)].asset
  const lastAirframeHours = filtered.reduce<number | null>((max, j) => {
    const h = airframeHoursOf(j)
    return h != null && (max == null || h > max) ? h : max
  }, null)
  const generated = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  // The document title matches what's actually being printed: one job is a
  // service record, one vehicle is that vehicle's history, a whole customer
  // (possibly several vehicles) is their repair history.
  const docTitle = jobId
    ? 'Service Record'
    : vehicleId
      ? scopeIsAircraft
        ? 'Aircraft Repair History'
        : 'Vehicle Repair History'
      : 'Repair History'
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
            Print / Save PDF
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
                    <dt>{scopeAsset}</dt>
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
                      <dt>{scopeAsset}</dt>
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
              {vehicleId && !scopeIsAircraft && lastMiles != null && (
                <div>
                  <dt>Last recorded mileage</dt>
                  <dd>{formatMiles(lastMiles)} mi</dd>
                </div>
              )}
              {/* The aircraft's identity, where a car prints VIN and plate. */}
              {(jobId || vehicleId) && scopeIsAircraft && scopeVehicle?.serial_number && (
                <div>
                  <dt>Serial number</dt>
                  <dd>{scopeVehicle.serial_number}</dd>
                </div>
              )}
              {vehicleId && scopeIsAircraft && lastAirframeHours != null && (
                <div>
                  <dt>Last recorded {AIRCRAFT_HOURS_LABEL.toLowerCase()}</dt>
                  <dd>{formatAirframeHours(lastAirframeHours)}</dd>
                </div>
              )}
            </dl>

            {filtered.length === 0 && (
              <p className="doc-section-sub" style={{ marginTop: 24 }}>No jobs in the selected range.</p>
            )}
            {filtered.map(({ job, vehicle, lines, invoice }) => {
              const totals = computeTotals(job, lines)
              // Invoiced: the invoice's own figures, so the rows add to its
              // Total exactly as the invoice document prints them.
              const partsCents = invoice ? invoice.parts_cents : totals.parts_charged_cents
              const laborCents = invoice ? invoice.labor_cents : totals.labor_charge_cents
              const laborHours = billedHours({ job, invoice })
              const laborRate = invoice ? invoice.labor_rate_cents : job.labor_rate_cents
              // With a parts-charged override in place, per-line receipt prices
              // would expose actual cost vs. markup — so lines print without
              // prices and only the charged totals show. An invoice's frozen
              // lines already made that call when it was issued (an override
              // collapses them to one "Parts & materials" line), so they print
              // with their prices exactly as the customer received them.
              const showLinePrices = showPrices && (invoice ? true : job.parts_charged_override_cents == null)
              const invoiceLines = invoice?.lines ?? []
              // Each job by its own paper: the invoice's when invoiced, else its vehicle's.
              const jobLine = invoice ? lineOf(invoice) : lineOf(vehicle)
              const partTags = needsPartConditions(jobLine)
              const jobHours = jobLine === 'aviation' ? airframeHoursOf({ job, invoice }) : null
              return (
                <section key={job.id} className="doc-section">
                  <h2>
                    {formatDate(job.date)} — {job.title}
                  </h2>
                  <div className="doc-section-sub">
                    {vehicleLabel(vehicle)}
                    {jobLine === 'aviation'
                      ? jobHours != null && <> · {formatAirframeHours(jobHours)} airframe hrs</>
                      : job.odometer_miles != null && <> · {formatMiles(job.odometer_miles)} miles</>}
                    {laborHours > 0 && <> · {laborHours} labor hours</>}
                    {' · '}{job.job_number}
                  </div>
                  {job.work_performed && (
                    <p className="doc-section-body">{job.work_performed}</p>
                  )}
                  {(recsByJob.get(job.id) ?? []).length > 0 && (
                    <p className="doc-section-body">
                      <b>Recommended:</b>{' '}
                      {(recsByJob.get(job.id) ?? []).map((r) => r.description).join(' · ')}
                    </p>
                  )}

                  {invoice && invoiceLines.length > 0 && (
                    // The invoice's own frozen lines: they add to its Parts row
                    // by construction. The part number is already inside each
                    // description (withPartNumber), so it spans both columns.
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
                        {invoiceLines.map((l, i) => (
                          <tr key={i}>
                            <td className="doc-desc" colSpan={2}>
                              {l.description}
                              {partTags && l.condition && <span className="doc-cond">{CONDITION_LABEL[l.condition]}</span>}
                            </td>
                            <td className="doc-n doc-dim">{Number(l.qty)}</td>
                            {showLinePrices && (
                              <>
                                <td className="doc-n doc-dim">{formatCents(l.unit_charge_cents)}</td>
                                <td className="doc-n">{formatCents(l.line_total_cents)}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {!invoice && lines.length > 0 && (
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
                        <span className="doc-tv">{formatCents(partsCents)}</span>
                      </div>
                      <div className="doc-trow">
                        <span className="doc-tl">
                          Labor
                          {laborHours > 0 && (
                            <> · {laborHours} hr @ {formatCents(laborRate)}/hr</>
                          )}
                        </span>
                        <span className="doc-tv">{formatCents(laborCents)}</span>
                      </div>
                      {invoice && invoice.tax_cents > 0 && (
                        <div className="doc-trow">
                          <span className="doc-tl">Sales tax ({formatTaxRate(invoice.tax_rate_bp)})</span>
                          <span className="doc-tv">{formatCents(invoice.tax_cents)}</span>
                        </div>
                      )}
                      <div className="doc-trow doc-total">
                        <span className="doc-tl">{invoice ? 'Total' : 'Total before tax'}</span>
                        <span className="doc-tv">{formatCents(invoice ? invoice.total_cents : totals.total_charged_cents)}</span>
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
                    <span className="doc-due-label">{allNotInvoiced ? 'Grand total before tax' : 'Grand total'}</span>
                    <span className="doc-due-sub">
                      {filtered.length} jobs · {totalHours.toFixed(1)} labor hours
                      {notInvoicedWords && <> · {notInvoicedWords}</>}
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
                      <>
                        {' '}· {notInvoiced.length > 0 ? 'total before tax' : 'total'} <b>{formatCents(grandTotal)}</b>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <b>{filtered.length}</b> job{filtered.length === 1 ? '' : 's'} on record ·{' '}
                    <b>{totalHours.toFixed(1)}</b> labor hours
                    {showPrices && (
                      // Named exactly as the Grand total card names it — the
                      // card only prints for 2+ jobs, so on a one-job history
                      // this footer is the only total line on the page.
                      <>
                        {' '}· {allNotInvoiced ? 'grand total before tax' : 'grand total'}{' '}
                        <b>{formatCents(grandTotal)}</b>
                        {notInvoicedWords && <> ({notInvoicedWords})</>}
                      </>
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
