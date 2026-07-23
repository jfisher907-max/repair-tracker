'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Customer, Vehicle } from '@/lib/types'
import { vehicleLabel } from '@/lib/types'
import VehicleFields, { emptyVehicleDraft, vehiclePayload } from '@/components/VehicleFields'

export default function CustomersPage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [vehiclesByCustomer, setVehiclesByCustomer] = useState<Map<string, Vehicle[]>>(new Map())
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' })
  const [veh, setVeh] = useState(emptyVehicleDraft)

  useEffect(() => {
    Promise.all([
      supabase.from('customers').select('*').is('deleted_at', null).order('name'),
      supabase.from('vehicles').select('*').is('deleted_at', null),
    ]).then(([c, v]) => {
      setCustomers((c.data as Customer[]) ?? [])
      const map = new Map<string, Vehicle[]>()
      for (const veh of (v.data as Vehicle[]) ?? []) {
        const list = map.get(veh.customer_id) ?? []
        list.push(veh)
        map.set(veh.customer_id, list)
      }
      setVehiclesByCustomer(map)
    })
  }, [])

  const filtered = useMemo(() => {
    if (!customers) return []
    const needle = q.trim().toLowerCase()
    if (!needle) return customers
    return customers.filter((c) => {
      const vehicles = vehiclesByCustomer.get(c.id) ?? []
      return [c.name, c.phone ?? '', c.email ?? '', ...vehicles.map((v) => vehicleLabel(v))]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [customers, q, vehiclesByCustomer])

  async function saveCustomer() {
    if (!form.name.trim()) {
      alert('Customer name is required.')
      return
    }
    setSaving(true)
    const { data, error } = await supabase
      .from('customers')
      .insert({
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
      })
      .select('id')
      .single()
    if (error) {
      setSaving(false)
      alert(error.message)
      return
    }

    // Vehicle is optional — only create one if any field was filled in.
    const hasVehicle = Object.values(veh).some((v) => v.trim() !== '')
    if (hasVehicle) {
      const { error: vehErr } = await supabase.from('vehicles').insert({
        customer_id: data.id,
        ...vehiclePayload(veh),
      })
      if (vehErr) {
        setSaving(false)
        alert(`Customer saved, but the vehicle didn't: ${vehErr.message}`)
        router.push(`/customers/${data.id}`)
        return
      }
    }
    router.push(`/customers/${data.id}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">Customers</h1>
        <button className="btn btn-primary" onClick={() => setAdding(!adding)}>
          + New Customer
        </button>
      </div>

      {adding && (
        <div className="card grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Name *</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              className="input"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes</label>
            <input
              className="input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <div className="label">Vehicle (optional)</div>
            <VehicleFields value={veh} onChange={setVeh} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn btn-primary" onClick={saveCustomer} disabled={saving}>
              {saving ? 'Saving…' : 'Save customer'}
            </button>
            <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <input
        className="input"
        placeholder="Search customers…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {!customers ? (
        <p style={{ color: 'var(--text3)' }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="card text-center" style={{ color: 'var(--text2)' }}>
          {customers.length === 0 ? (
            <>
              No customers yet — use “+ New Customer” above, or add one right inside the{' '}
              <Link href="/jobs/new" style={{ color: 'var(--accent2)' }}>new-job flow</Link>.
            </>
          ) : (
            'No matches.'
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const vehicles = vehiclesByCustomer.get(c.id) ?? []
            return (
              <Link
                key={c.id}
                href={`/customers/${c.id}`}
                className="card flex items-center justify-between !py-3 hover:brightness-110"
              >
                <div className="min-w-0">
                  <div className="font-semibold">{c.name}</div>
                  <div className="truncate text-sm" style={{ color: 'var(--text2)' }}>
                    {vehicles.length
                      ? vehicles.map((v) => vehicleLabel(v)).join(', ')
                      : 'No vehicles yet'}
                  </div>
                </div>
                <div className="text-sm" style={{ color: 'var(--text3)' }}>{c.phone}</div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
