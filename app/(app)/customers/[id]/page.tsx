'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import JobRow from '@/components/JobRow'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/money'
import { unpaidBalanceCents } from '@/lib/calc'
import { vehicleLabel, type Customer, type Vehicle } from '@/lib/types'
import VehicleFields, { emptyVehicleDraft, vehiclePayload } from '@/components/VehicleFields'

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [jobs, setJobs] = useState<JobWithContext[]>([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' })
  const [addingVehicle, setAddingVehicle] = useState(false)
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [veh, setVeh] = useState(emptyVehicleDraft)

  const load = useCallback(async () => {
    const [{ data: c }, { data: v }, all] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).single(),
      supabase.from('vehicles').select('*').eq('customer_id', id).is('deleted_at', null),
      fetchJobsWithContext(),
    ])
    const cust = c as Customer
    setCustomer(cust)
    setForm({
      name: cust?.name ?? '',
      phone: cust?.phone ?? '',
      email: cust?.email ?? '',
      notes: cust?.notes ?? '',
    })
    setVehicles((v as Vehicle[]) ?? [])
    setJobs(all.filter((j) => j.customer?.id === id))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (!customer) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  const lifetime = jobs.reduce(
    (acc, j) => {
      acc.charged += j.totals?.total_charged_cents ?? 0
      acc.unpaid += j.totals ? unpaidBalanceCents(j.job, j.totals.total_charged_cents) : 0
      return acc
    },
    { charged: 0, unpaid: 0 },
  )

  async function saveEdit() {
    const { error } = await supabase
      .from('customers')
      .update({
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
      })
      .eq('id', id)
    if (error) alert(error.message)
    else {
      setEditing(false)
      await load()
    }
  }

  async function saveVehicle() {
    const hasAnything = Object.values(veh).some((v) => v.trim() !== '')
    if (!hasAnything) {
      alert('Fill in at least one vehicle field.')
      return
    }
    setSavingVehicle(true)
    const { error } = await supabase.from('vehicles').insert({
      customer_id: id,
      ...vehiclePayload(veh),
    })
    setSavingVehicle(false)
    if (error) alert(error.message)
    else {
      setAddingVehicle(false)
      setVeh(emptyVehicleDraft)
      await load()
    }
  }

  async function softDelete() {
    if (!confirm(`Delete ${customer!.name}? Their vehicles and jobs stay; restore from Settings.`)) return
    const { error } = await supabase
      .from('customers')
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
            <h1 className="text-2xl">{customer.name}</h1>
            <div className="text-sm" style={{ color: 'var(--text2)' }}>
              {[customer.phone, customer.email].filter(Boolean).join(' · ') || 'No contact info'}
            </div>
            {customer.notes && (
              <p className="mt-1 text-sm" style={{ color: 'var(--text3)' }}>{customer.notes}</p>
            )}
          </div>
          <button className="btn btn-sm" onClick={() => setEditing(!editing)}>
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>
        {editing && (
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" type="tel" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="input" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="flex gap-2 sm:col-span-2">
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
              <button className="btn btn-sm btn-danger" onClick={softDelete}>Delete customer</button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
          <span className="text-sm" style={{ color: 'var(--text2)' }}>
            {jobs.length} jobs · lifetime <b className="money">{formatCents(lifetime.charged)}</b>
            {lifetime.unpaid > 0 && (
              <> · owes <b className="money" style={{ color: 'var(--red)' }}>{formatCents(lifetime.unpaid)}</b></>
            )}
          </span>
          <Link href={`/report?customer=${id}`} className="btn btn-sm btn-primary">
            🖨️ Print repair history
          </Link>
        </div>
      </div>

      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <span className="label !mb-0">Vehicles</span>
          <button className="btn btn-sm" onClick={() => setAddingVehicle(!addingVehicle)}>
            {addingVehicle ? 'Cancel' : '+ Add vehicle'}
          </button>
        </div>
        {addingVehicle && (
          <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border2)' }}>
            <VehicleFields value={veh} onChange={setVeh} />
            <button className="btn btn-primary btn-sm" onClick={saveVehicle} disabled={savingVehicle}>
              {savingVehicle ? 'Saving…' : 'Save vehicle'}
            </button>
          </div>
        )}
        {vehicles.length === 0 && !addingVehicle && (
          <p className="text-sm" style={{ color: 'var(--text3)' }}>No vehicles on file.</p>
        )}
        {vehicles.map((v) => (
          <Link
            key={v.id}
            href={`/vehicles/${v.id}`}
            className="flex items-center justify-between rounded-lg border p-3 hover:brightness-110"
            style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
          >
            <span className="font-semibold">{vehicleLabel(v)}</span>
            <span className="text-sm" style={{ color: 'var(--text3)' }}>
              {v.license_plate ?? ''}
            </span>
          </Link>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-lg" style={{ color: 'var(--text2)' }}>Job history</h2>
        {jobs.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text3)' }}>No jobs yet.</p>
        ) : (
          jobs.map((it) => <JobRow key={it.job.id} item={it} />)
        )}
      </section>
    </div>
  )
}
