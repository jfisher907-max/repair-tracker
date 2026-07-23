'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Customer, Vehicle } from '@/lib/types'
import { vehicleLabel } from '@/lib/types'

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [vehiclesByCustomer, setVehiclesByCustomer] = useState<Map<string, Vehicle[]>>(new Map())
  const [q, setQ] = useState('')

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">Customers</h1>
        <Link href="/jobs/new" className="btn btn-primary">+ New Job</Link>
      </div>
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
              No customers yet. Customers are created right inside the{' '}
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
