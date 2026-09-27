'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import JobRow from '@/components/JobRow'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/money'
import { collectedForJob, governingInvoice, owedGrossCents } from '@/lib/calc'
import { isBookedJob } from '@/lib/finances'
import { vehicleLabel, type Customer, type Vehicle } from '@/lib/types'
import VehicleFields, { emptyVehicleDraft, vehiclePayload } from '@/components/VehicleFields'

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [jobs, setJobs] = useState<JobWithContext[]>([])
  /** Live invoices and ledger payments on this customer's jobs: what their balance is measured against. */
  const [invoices, setInvoices] = useState<
    { job_id: string; status: string; total_cents: number; created_at: string }[]
  >([])
  const [payments, setPayments] = useState<{ job_id: string; amount_cents: number }[]>([])
  /** The invoice or payment read failed: no balance is shown rather than a wrong one. */
  const [moneyFailed, setMoneyFailed] = useState(false)
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
    const mine = all.filter((j) => j.customer?.id === id)
    const jobIds = mine.map((j) => j.job.id)
    // Invoices and payments are read BEFORE anything is set, so the page
    // never renders the jobs with an empty ledger — that would briefly print
    // "owes" at the pre-tax charge. A failed read shows as failed, not as a
    // balance computed from nothing.
    let inv: typeof invoices = []
    let pay: typeof payments = []
    let failed = false
    if (jobIds.length) {
      const [invRes, payRes] = await Promise.all([
        supabase
          .from('invoices')
          .select('job_id, status, total_cents, created_at')
          .in('job_id', jobIds)
          .neq('status', 'void'),
        supabase.from('payments').select('job_id, amount_cents').in('job_id', jobIds),
      ])
      failed = !!invRes.error || !!payRes.error
      inv = (invRes.data as typeof invoices | null) ?? []
      pay = (payRes.data as typeof payments | null) ?? []
    }
    setCustomer(cust)
    setForm({
      name: cust?.name ?? '',
      phone: cust?.phone ?? '',
      email: cust?.email ?? '',
      notes: cust?.notes ?? '',
    })
    setVehicles((v as Vehicle[]) ?? [])
    setInvoices(inv)
    setPayments(pay)
    setMoneyFailed(failed)
    setJobs(mine)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (!customer) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  // A scheduled or in-progress job (0043) is booked, not owed: its total is
  // shown as booked, not inside "owes", so this line agrees with the
  // dashboard, Billing and Reports about what the customer actually owes.
  // "Owes" is their paper balance (owedGrossCents): the governing invoice's
  // total, tax line included, less every payment — the figure the statement
  // link below shows them, not the pre-tax charge. "Lifetime" is on the SAME
  // basis — each done job at the larger of its charge and its governing
  // invoice's total, the target owedGrossCents measures against — so what a
  // customer owes can never exceed their lifetime total. Booked work has no
  // bill yet and is labelled before tax.
  const lifetime = jobs.reduce(
    (acc, j) => {
      if (isBookedJob(j.job)) {
        acc.booked += j.totals?.total_charged_cents ?? 0
        return acc
      }
      if (!j.totals) return acc
      const gov = governingInvoice(invoices.filter((i) => i.job_id === j.job.id))
      acc.charged += Math.max(j.totals.total_charged_cents, gov?.total_cents ?? 0)
      if (j.job.payment_status !== 'paid') {
        const onLedger = payments.filter((p) => p.job_id === j.job.id)
        const collected = collectedForJob(
          j.job,
          j.totals.total_charged_cents,
          onLedger.reduce((s, p) => s + p.amount_cents, 0),
          onLedger.length > 0,
        )
        acc.unpaid += owedGrossCents(j.totals.total_charged_cents, gov?.total_cents, collected)
      }
      return acc
    },
    { charged: 0, unpaid: 0, booked: 0 },
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
              {!customer.phone && !customer.email && 'No contact info'}
              {customer.phone && (
                <a href={`tel:${customer.phone}`} style={{ color: 'var(--blue)' }}>
                  {customer.phone}
                </a>
              )}
              {customer.phone && customer.email && ' · '}
              {customer.email && (
                <a href={`mailto:${customer.email}`} style={{ color: 'var(--blue)' }}>
                  {customer.email}
                </a>
              )}
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
          <div className="panel-in grid gap-2 sm:grid-cols-2">
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
            {jobs.length} jobs
            {moneyFailed ? (
              <> · <span style={{ color: 'var(--red)' }}>balances did not load — reload to see them</span></>
            ) : (
              <>
                {' '}· lifetime <b className="money">{formatCents(lifetime.charged)}</b>
                {lifetime.unpaid > 0 && (
                  <> · owes <b className="money" style={{ color: 'var(--red)' }}>{formatCents(lifetime.unpaid)}</b></>
                )}
              </>
            )}
            {lifetime.booked > 0 && (
              <> · booked <b className="money">{formatCents(lifetime.booked)}</b> before tax</>
            )}
          </span>
          <Link href={`/report?customer=${id}`} className="btn btn-sm btn-primary">
            Print repair history
          </Link>
          {!moneyFailed && lifetime.unpaid > 0 && (
            <button
              className="btn btn-sm"
              onClick={async () => {
                const url = `${window.location.origin}/s/${customer!.public_token}`
                try {
                  if (navigator.share) {
                    await navigator.share({ title: 'Account statement', url })
                  } else {
                    await navigator.clipboard.writeText(url)
                    alert('Statement link copied — text it to the customer. It always shows their current open balances.')
                  }
                } catch {}
              }}
            >
              Send statement
            </button>
          )}
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
          <div className="panel-in space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border2)' }}>
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
