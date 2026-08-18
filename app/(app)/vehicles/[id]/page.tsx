'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import JobRow from '@/components/JobRow'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { supabase } from '@/lib/supabase'
import { formatMiles } from '@/lib/money'
import { vehicleLabel, type Customer, type Vehicle } from '@/lib/types'
import { listForVehicle, statusColors, type Recommendation } from '@/lib/recommendations'
import VehicleFields, { emptyVehicleDraft, vehiclePayload } from '@/components/VehicleFields'
import ServiceReminders from '@/components/ServiceReminders'
import type { OdometerReading } from '@/lib/reminders'

export default function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [owner, setOwner] = useState<Customer | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [jobs, setJobs] = useState<JobWithContext[]>([])
  const [editing, setEditing] = useState(false)
  const [changingOwner, setChangingOwner] = useState(false)
  const [form, setForm] = useState(emptyVehicleDraft)
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [recs, setRecs] = useState<Recommendation[]>([])

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
        trim: veh.trim ?? '',
        engine: veh.engine ?? '',
        vin: veh.vin ?? '',
        license_plate: veh.license_plate ?? '',
      })
      setNotes(veh.notes ?? '')
    }
    setCustomers((cs as Customer[]) ?? [])
    setRecs(await listForVehicle(id))
    setJobs(all.filter((j) => j.vehicle?.id === id))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (!vehicle) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  async function saveEdit() {
    const { error } = await supabase
      .from('vehicles')
      .update({ ...vehiclePayload(form), notes: notes.trim() || null })
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

  const readings: OdometerReading[] = jobs
    .filter((it) => it.job.odometer_miles != null)
    .map((it) => ({ date: it.job.date, miles: it.job.odometer_miles! }))

  const recsByJob = new Map<string, Recommendation[]>()
  for (const r of recs) {
    const list = recsByJob.get(r.job_id) ?? []
    list.push(r)
    recsByJob.set(r.job_id, list)
  }

  const q = search.trim().toLowerCase()
  const shownJobs = q
    ? jobs.filter((it) =>
        [
          it.job.title,
          it.job.work_performed,
          it.job.job_number,
          ...(recsByJob.get(it.job.id) ?? []).map((r) => r.description),
        ]
          .some((f) => (f ?? '').toLowerCase().includes(q)),
      )
    : jobs

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
          <div className="space-y-2 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
            <VehicleFields value={form} onChange={setForm} />
            <input className="input" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex gap-2">
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

      <ServiceReminders vehicleId={id} readings={readings} />

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
        {jobs.length > 0 && (
          <input
            className="input"
            placeholder="Search this vehicle's history — work, parts, recommendations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search service history"
          />
        )}
        {jobs.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text3)' }}>No jobs yet.</p>
        ) : shownJobs.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text3)' }}>
            Nothing on this vehicle matches “{search}”.
          </p>
        ) : (
          shownJobs.map((it) => (
            <div key={it.job.id} className="space-y-1">
              <JobRow item={it} />
              {recsByJob.get(it.job.id)?.map((r) => (
                <p
                  key={r.id}
                  className="rounded-lg px-3 py-2 text-sm"
                  style={{
                    background: 'var(--bg2)',
                    color: 'var(--text2)',
                    borderLeft: `3px solid ${statusColors[r.status]}`,
                  }}
                >
                  <b style={{ color: statusColors[r.status] }}>
                    {r.status === 'open' ? 'Recommended' : `Recommended (${r.status})`}:
                  </b>{' '}
                  <span className="whitespace-pre-wrap">{r.description}</span>
                </p>
              ))}
            </div>
          ))
        )}
      </section>
    </div>
  )
}
