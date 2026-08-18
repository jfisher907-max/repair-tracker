'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { centsToInput, parseMoney } from '@/lib/money'
import { vehicleLabel, type Customer, type Job, type Vehicle } from '@/lib/types'
import VehicleFields, { emptyVehicleDraft, vehiclePayload } from '@/components/VehicleFields'
import { syncJobPayment } from '@/lib/payments'
import { listTemplates, type JobTemplate, type JobTemplateLine } from '@/lib/templates'

interface VehicleOption extends Vehicle {
  customer: Customer | null
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * New/edit job form. Critical requirement: a brand-new customer's first job is
 * ONE continuous flow — customer + vehicle + job are all created on a single
 * submit, no separate forms.
 */
export default function JobForm({ job }: { job?: Job }) {
  const router = useRouter()
  const editing = !!job

  // Vehicle picker
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicleQuery, setVehicleQuery] = useState('')
  const [vehicleId, setVehicleId] = useState<string | null>(job?.vehicle_id ?? null)
  const [creatingVehicle, setCreatingVehicle] = useState(false)

  // New-vehicle panel (with optional new customer)
  const [customerId, setCustomerId] = useState<'new' | string>('new')
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' })
  const [newVehicle, setNewVehicle] = useState(emptyVehicleDraft)

  // Job fields
  const [date, setDate] = useState(job?.date ?? todayLocal())
  const [title, setTitle] = useState(job?.title ?? '')
  const [odometer, setOdometer] = useState(job?.odometer_miles != null ? String(job.odometer_miles) : '')
  const [laborHours, setLaborHours] = useState(job ? String(job.labor_hours) : '')
  const [laborRate, setLaborRate] = useState(job ? centsToInput(job.labor_rate_cents) : '')
  const [workPerformed, setWorkPerformed] = useState(job?.work_performed ?? '')
  const [notes, setNotes] = useState(job?.notes ?? '')
  const [promisedDate, setPromisedDate] = useState(job?.promised_date ?? '')
  const [templates, setTemplates] = useState<JobTemplate[]>([])
  const [templateLines, setTemplateLines] = useState<JobTemplateLine[]>([])
  const [templateName, setTemplateName] = useState<string | null>(null)
  const [warrantyMonths, setWarrantyMonths] = useState(
    job?.warranty_months != null ? String(job.warranty_months) : '',
  )
  const [warrantyMiles, setWarrantyMiles] = useState(
    job?.warranty_miles != null ? String(job.warranty_miles) : '',
  )

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Retry safety: if the submit fails partway (customer/vehicle created but the
  // job insert failed), resubmitting must reuse what already exists instead of
  // creating duplicates.
  const createdCustomerId = useRef<string | null>(null)
  const createdVehicleId = useRef<string | null>(null)
  const createdJobId = useRef<string | null>(null)

  useEffect(() => {
    supabase
      .from('vehicles')
      .select('*, customer:customers(*)')
      .is('deleted_at', null)
      .then(({ data }) => setVehicles((data as unknown as VehicleOption[]) ?? []))
    supabase
      .from('customers')
      .select('*')
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => setCustomers((data as Customer[]) ?? []))
    if (!editing) {
      listTemplates().then(setTemplates)
      supabase
        .from('settings')
        .select('default_labor_rate_cents')
        .single()
        .then(({ data }) => {
          if (data) setLaborRate(centsToInput(data.default_labor_rate_cents))
        })
    }
  }, [editing])

  const matches = useMemo(() => {
    const needle = vehicleQuery.trim().toLowerCase()
    if (!needle) return vehicles.slice(0, 8)
    return vehicles
      .filter((v) =>
        [vehicleLabel(v), v.customer?.name ?? '', v.license_plate ?? '', v.vin ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 8)
  }, [vehicles, vehicleQuery])

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    let targetVehicleId = vehicleId
    if (!editing && creatingVehicle) targetVehicleId = null
    if (!editing && !creatingVehicle && !targetVehicleId) {
      setError('Pick a vehicle or add a new one.')
      return
    }
    if (creatingVehicle && customerId === 'new' && !newCustomer.name.trim()) {
      setError('Customer name is required.')
      return
    }

    // Number() on text like "12mo" is NaN, and NaN serializes to null on the
    // wire — the save would succeed with the value silently gone. Reject it
    // here instead; these three all feed later decisions (warranty disputes,
    // mileage projections).
    const odometerNum = odometer.trim() ? Number(odometer.replace(/[,\s]/g, '')) : null
    const warrantyMonthsNum = warrantyMonths.trim() ? Number(warrantyMonths.trim()) : null
    const warrantyMilesNum = warrantyMiles.trim()
      ? Number(warrantyMiles.replace(/[,\s]/g, ''))
      : null
    const badNumber = (n: number | null) => n != null && (!Number.isInteger(n) || n < 0)
    if (badNumber(odometerNum)) {
      setError('Odometer needs a plain number of miles.')
      return
    }
    if (badNumber(warrantyMonthsNum) || badNumber(warrantyMilesNum)) {
      setError('Warranty needs plain whole numbers — e.g. 12 months, 12,000 miles.')
      return
    }

    setBusy(true)
    try {
      if (creatingVehicle) {
        let cid = customerId
        if (cid === 'new') {
          if (createdCustomerId.current) {
            cid = createdCustomerId.current
          } else {
            const { data, error } = await supabase
              .from('customers')
              .insert({
                name: newCustomer.name.trim(),
                phone: newCustomer.phone.trim() || null,
                email: newCustomer.email.trim() || null,
              })
              .select('id')
              .single()
            if (error) throw error
            createdCustomerId.current = data.id
            cid = data.id
          }
        }
        if (createdVehicleId.current) {
          targetVehicleId = createdVehicleId.current
        } else {
          const { data: veh, error: vehErr } = await supabase
            .from('vehicles')
            .insert({ customer_id: cid, ...vehiclePayload(newVehicle) })
            .select('id')
            .single()
          if (vehErr) throw vehErr
          createdVehicleId.current = veh.id
          targetVehicleId = veh.id
        }
      }

      const payload = {
        vehicle_id: targetVehicleId,
        date,
        title: title.trim(),
        odometer_miles: odometerNum,
        labor_hours: laborHours ? Number(laborHours) : 0,
        labor_rate_cents: parseMoney(laborRate) ?? 0,
        work_performed: workPerformed.trim() || null,
        notes: notes.trim() || null,
        promised_date: promisedDate || null,
        warranty_months: warrantyMonthsNum,
        warranty_miles: warrantyMilesNum,
      }

      if (editing) {
        const { error } = await supabase.from('jobs').update(payload).eq('id', job.id)
        if (error) throw error
        // Labor changes move the amount owed — re-derive cached payment
        // status from the ledger (no-op for jobs without ledger entries).
        try {
          await syncJobPayment(job.id)
        } catch {}
        router.push(`/jobs/${job.id}`)
      } else {
        // Same retry rule as customer/vehicle above: if the job landed but the
        // template-lines insert failed, resubmitting must not create a twin.
        let jobId = createdJobId.current
        if (!jobId) {
          const { data, error } = await supabase.from('jobs').insert(payload).select('id').single()
          if (error) throw error
          createdJobId.current = data.id
          jobId = data.id
        }
        // A template's lines come along as pre-priced charge lines; costs stay
        // zero until the real parts are bought and the receipt is scanned.
        if (templateLines.length) {
          const { error: lineErr } = await supabase.from('part_lines').insert(
            templateLines.map((l) => ({
              job_id: jobId,
              description: l.description,
              qty: l.qty,
              unit_cost_cents: 0,
              unit_charge_cents: l.unit_charge_cents,
            })),
          )
          if (lineErr) throw lineErr
        }
        router.push(`/jobs/${jobId}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl">{editing ? `Edit ${job.job_number}` : 'New Job'}</h1>

      {/* Start from a template — the shop's own repeat jobs, two taps. */}
      {!editing && templates.length > 0 && (
        <div className="card space-y-2">
          <span className="label !mb-0">Start from a saved job</span>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`btn btn-sm ${templateName === t.name ? 'btn-primary' : ''}`}
                onClick={() => {
                  setTitle(t.title)
                  setWorkPerformed(t.work_performed ?? '')
                  setLaborHours(String(Number(t.labor_hours)))
                  setTemplateLines(t.lines ?? [])
                  setTemplateName(t.name)
                }}
              >
                {t.name}
              </button>
            ))}
            {templateName && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setTemplateLines([])
                  setTemplateName(null)
                }}
              >
                ✕ Clear
              </button>
            )}
          </div>
          {templateName && (
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              {templateLines.length} pre-priced line{templateLines.length === 1 ? '' : 's'} will be
              added to the job. Parts costs stay blank until you scan the receipt.
            </p>
          )}
        </div>
      )}

      {/* Vehicle picker */}
      {!editing && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <span className="label !mb-0">Vehicle</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setCreatingVehicle(!creatingVehicle)
                setVehicleId(null)
              }}
            >
              {creatingVehicle ? 'Pick existing instead' : '+ New customer / vehicle'}
            </button>
          </div>

          {!creatingVehicle ? (
            selectedVehicle ? (
              <div className="flex items-center justify-between rounded-lg border p-3" style={{ borderColor: 'var(--accent)' }}>
                <div>
                  <div className="font-semibold">{vehicleLabel(selectedVehicle)}</div>
                  <div className="text-sm" style={{ color: 'var(--text2)' }}>
                    {selectedVehicle.customer?.name}
                    {selectedVehicle.license_plate ? ` · ${selectedVehicle.license_plate}` : ''}
                  </div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => setVehicleId(null)}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="Search by vehicle, customer, plate, VIN…"
                  value={vehicleQuery}
                  onChange={(e) => setVehicleQuery(e.target.value)}
                />
                <div className="space-y-1">
                  {matches.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg border p-3 text-left"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
                      onClick={() => setVehicleId(v.id)}
                    >
                      <span className="font-semibold">{vehicleLabel(v)}</span>
                      <span className="text-sm" style={{ color: 'var(--text2)' }}>
                        {v.customer?.name}
                      </span>
                    </button>
                  ))}
                  {matches.length === 0 && (
                    <p className="text-sm" style={{ color: 'var(--text3)' }}>
                      No matches — use “+ New customer / vehicle”.
                    </p>
                  )}
                </div>
              </>
            )
          ) : (
            <div className="space-y-3">
              <div>
                <label className="label">Customer</label>
                <select
                  className="select"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="new">+ New customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {customerId === 'new' && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-3">
                    <label className="label">Name *</label>
                    <input
                      className="input"
                      value={newCustomer.name}
                      onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Phone</label>
                    <input
                      className="input"
                      type="tel"
                      value={newCustomer.phone}
                      onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Email</label>
                    <input
                      className="input"
                      type="email"
                      value={newCustomer.email}
                      onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="label">Vehicle</label>
                <VehicleFields value={newVehicle} onChange={setNewVehicle} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Job details */}
      <div className="card grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Date *</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <label className="label">Odometer (miles)</label>
          <input
            className="input"
            inputMode="numeric"
            placeholder="123,456"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Promised back</label>
          <input
            className="input"
            type="date"
            value={promisedDate}
            onChange={(e) => setPromisedDate(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Warranty (months)</label>
            <input
              className="input"
              inputMode="numeric"
              placeholder="12"
              value={warrantyMonths}
              onChange={(e) => setWarrantyMonths(e.target.value)}
            />
          </div>
          <div>
            <label className="label">…or miles</label>
            <input
              className="input"
              inputMode="numeric"
              placeholder="12,000"
              value={warrantyMiles}
              onChange={(e) => setWarrantyMiles(e.target.value)}
            />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Title *</label>
          <input
            className="input"
            placeholder="Water pump replacement"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Work performed</label>
          <textarea
            className="textarea"
            placeholder="What was done, parts replaced, findings…"
            value={workPerformed}
            onChange={(e) => setWorkPerformed(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Labor hours</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="2.5"
            value={laborHours}
            onChange={(e) => setLaborHours(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Labor rate ($/hr)</label>
          <input
            className="input"
            inputMode="decimal"
            value={laborRate}
            onChange={(e) => setLaborRate(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Private notes</label>
          <textarea
            className="textarea !min-h-[60px]"
            placeholder="Only you see these"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="flex gap-2">
        <button className="btn btn-primary flex-1" disabled={busy} type="submit">
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create job'}
        </button>
        <button type="button" className="btn" onClick={() => router.back()}>
          Cancel
        </button>
      </div>
    </form>
  )
}
