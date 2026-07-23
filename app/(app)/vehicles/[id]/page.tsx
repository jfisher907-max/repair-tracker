'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import JobRow from '@/components/JobRow'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { supabase } from '@/lib/supabase'
import { formatMiles } from '@/lib/money'
import { vehicleLabel, type Customer, type Vehicle } from '@/lib/types'

export default function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [owner, setOwner] = useState<Customer | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [jobs, setJobs] = useState<JobWithContext[]>([])
  const [editing, setEditing] = useState(false)
  const [changingOwner, setChangingOwner] = useState(false)
  const [form, setForm] = useState({
    year: '', make: '', model: '', engine: '', vin: '', license_plate: '', notes: '',
  })

  const load = useCallback(async () => {
    const [{ data: v }, { data: cs }, all] = await Promise.all([
      supabase.from('vehicles').select('*, customer:customers(*)').eq('id', id).single(),
      supabase.from('customers').select('*').is('deleted_at', null).order('name'),
      fetchJobsWithContext(),
    ])
    const row = v as Vehicle & { customer: Customer | null }
    if (row) {
      const { customer, ...veh } = row
      setVehicle(veh as Vehicle)
      setOwner(customer)
      setForm({
        year: veh.year != null ? String(veh.year) : '',
        make: veh.make ?? '',
        model: veh.model ?? '',
        engine: veh.engine ?? '',
        vin: veh.vin ?? '',
        license_plate: veh.license_plate ?? '',
        notes: veh.notes ?? '',
      })
    }
    setCustomers((cs as Customer[]) ?? [])
    setJobs(all.filter((j) => j.vehicle?.id === id))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (!vehicle) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  async function saveEdit() {
    const { error } = await supabase
      .from('vehicles')
      .update({
        year: form.year ? Number(form.year) : null,
        make: form.make.trim() || null,
        model: form.model.trim() || null,
        engine: form.engine.trim() || null,
        vin: form.vin.trim() || null,
        license_plate: form.license_plate.trim() || null,
        notes: form.notes.trim() || null,
      })
      .eq('id', id)
    if (error) alert(error.message)
    else {
      setEditing(false)
      await load()
    }
  }

  async function changeOwner(newCustomerId: string) {
    if (!confirm('Change this vehicle’s owner? Job history stays with the vehicle.')) return
    const { error } = await supabase.from('vehicles').update({ customer_id: newCustomerId }).eq('id', id)
    if (error) alert(error.message)
    else {
      setChangingOwner(false)
      await load()
    }
  }

  async function softDelete() {
    if (!confirm(`Delete ${vehicleLabel(vehicle)}? Restore from Settings.`)) return
    const { error } = await supabase
      .from('vehicles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) alert(error.message)
    else router.push('/customers')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card space-y-2">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl">{vehicleLabel(vehicle)}</h1>
            <div className="text-sm" style={{ color: 'var(--text2)' }}>
              Owner:{' '}
              {owner ? (
                <Link href={`/customers/${owner.id}`} style={{ color: 'var(--blue)' }}>
                  {owner.name}
                </Link>
              ) : (
                'Unknown'
              )}
              <button
                className="ml-2 text-xs underline"
                style={{ color: 'var(--blue)' }}
                onClick={() => setChangingOwner(!changingOwner)}
              >
                change owner
              </button>
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => setEditing(!editing)}>
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>

        {changingOwner && (
          <select
            className="select"
            defaultValue=""
            onChange={(e) => e.target.value && changeOwner(e.target.value)}
          >
            <option value="" disabled>Move vehicle to…</option>
            {customers
              .filter((c) => c.id !== vehicle.customer_id)
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3" style={{ color: 'var(--text2)' }}>
          {vehicle.engine && <div>Engine: {vehicle.engine}</div>}
          {vehicle.vin && <div>VIN: {vehicle.vin}</div>}
          {vehicle.license_plate && <div>Plate: {vehicle.license_plate}</div>}
          {vehicle.notes && <div className="col-span-full">Notes: {vehicle.notes}</div>}
        </div>

        {editing && (
          <div className="grid grid-cols-3 gap-2 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
            <input className="input" inputMode="numeric" placeholder="Year" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
            <input className="input" placeholder="Make" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
            <input className="input" placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input className="input" placeholder="Engine" value={form.engine} onChange={(e) => setForm({ ...form, engine: e.target.value })} />
            <input className="input" placeholder="VIN" value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
            <input className="input" placeholder="Plate" value={form.license_plate} onChange={(e) => setForm({ ...form, license_plate: e.target.value })} />
            <input className="input col-span-3" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="col-span-3 flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
              <button className="btn btn-sm btn-danger" onClick={softDelete}>Delete vehicle</button>
            </div>
          </div>
        )}

        {owner && (
          <div className="border-t pt-2" style={{ borderColor: 'var(--border)' }}>
            <Link href={`/report?vehicle=${id}`} className="btn btn-sm btn-primary">
              🖨️ Print history for this vehicle
            </Link>
          </div>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="text-lg" style={{ color: 'var(--text2)' }}>
          Job timeline
          {jobs.length > 0 && (
            <span className="ml-2 text-sm" style={{ color: 'var(--text3)' }}>
              {(() => {
                const miles = jobs
                  .map((j) => j.job.odometer_miles)
                  .filter((m): m is number => m != null)
                if (miles.length < 2) return ''
                return `${formatMiles(Math.min(...miles))} → ${formatMiles(Math.max(...miles))} mi`
              })()}
            </span>
          )}
        </h2>
        {jobs.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text3)' }}>No jobs yet.</p>
        ) : (
          jobs.map((it) => <JobRow key={it.job.id} item={it} />)
        )}
      </section>
    </div>
  )
}
