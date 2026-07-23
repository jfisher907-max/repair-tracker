'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { centsToInput, parseMoney } from '@/lib/money'
import { vehicleLabel, type Customer, type Job, type Vehicle } from '@/lib/types'

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
  const [newVehicle, setNewVehicle] = useState({
    year: '', make: '', model: '', engine: '', vin: '', license_plate: '',
  })

  // Job fields
  const [date, setDate] = useState(job?.date ?? todayLocal())
  const [title, setTitle] = useState(job?.title ?? '')
  const [odometer, setOdometer] = useState(job?.odometer_miles != null ? String(job.odometer_miles) : '')
  const [laborHours, setLaborHours] = useState(job ? String(job.labor_hours) : '')
  const [laborRate, setLaborRate] = useState(job ? centsToInput(job.labor_rate_cents) : '')
  const [workPerformed, setWorkPerformed] = useState(job?.work_performed ?? '')
  const [notes, setNotes] = useState(job?.notes ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

    setBusy(true)
    try {
      if (creatingVehicle) {
        let cid = customerId
        if (cid === 'new') {
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
          cid = data.id
        }
        const { data: veh, error: vehErr } = await supabase
          .from('vehicles')
          .insert({
            customer_id: cid,
            year: newVehicle.year ? Number(newVehicle.year) : null,
            make: newVehicle.make.trim() || null,
            model: newVehicle.model.trim() || null,
            engine: newVehicle.engine.trim() || null,
            vin: newVehicle.vin.trim() || null,
            license_plate: newVehicle.license_plate.trim() || null,
          })
          .select('id')
          .single()
        if (vehErr) throw vehErr
        targetVehicleId = veh.id
      }

      const payload = {
        vehicle_id: targetVehicleId,
        date,
        title: title.trim(),
        odometer_miles: odometer ? Number(odometer.replace(/[,\s]/g, '')) : null,
        labor_hours: laborHours ? Number(laborHours) : 0,
        labor_rate_cents: parseMoney(laborRate) ?? 0,
        work_performed: workPerformed.trim() || null,
        notes: notes.trim() || null,
      }

      if (editing) {
        const { error } = await supabase.from('jobs').update(payload).eq('id', job.id)
        if (error) throw error
        router.push(`/jobs/${job.id}`)
      } else {
        const { data, error } = await supabase.from('jobs').insert(payload).select('id').single()
        if (error) throw error
        router.push(`/jobs/${data.id}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl">{editing ? `Edit ${job.job_number}` : 'New Job'}</h1>

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
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Year</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={newVehicle.year}
                    onChange={(e) => setNewVehicle({ ...newVehicle, year: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Make</label>
                  <input
                    className="input"
                    value={newVehicle.make}
                    onChange={(e) => setNewVehicle({ ...newVehicle, make: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Model</label>
                  <input
                    className="input"
                    value={newVehicle.model}
                    onChange={(e) => setNewVehicle({ ...newVehicle, model: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Engine</label>
                  <input
                    className="input"
                    value={newVehicle.engine}
                    onChange={(e) => setNewVehicle({ ...newVehicle, engine: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">VIN</label>
                  <input
                    className="input"
                    value={newVehicle.vin}
                    onChange={(e) => setNewVehicle({ ...newVehicle, vin: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Plate</label>
                  <input
                    className="input"
                    value={newVehicle.license_plate}
                    onChange={(e) => setNewVehicle({ ...newVehicle, license_plate: e.target.value })}
                  />
                </div>
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
