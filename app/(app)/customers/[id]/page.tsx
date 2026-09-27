'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import JobRow from '@/components/JobRow'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/money'
import { collectedForJob, governingInvoice, statementTotalCents } from '@/lib/calc'
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
  /** job_authorized_totals on this customer's jobs: the statement's approved-total cap (0035). */
  const [auths, setAuths] = useState<
    { job_id: string; checked: boolean; quoted_cents: number; authorized_cents: number }[]
  >([])
  /** settings.default_tax_rate_bp: the tax an uninvoiced job's statement line includes (0049). */
  const [defaultTaxRateBp, setDefaultTaxRateBp] = useState<number | null>(null)
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
    let au: typeof auths = []
    let rate: number | null = null
    let failed = false
    if (jobIds.length) {
      const [invRes, payRes, authRes, settingsRes] = await Promise.all([
        supabase
          .from('invoices')
          .select('job_id, status, total_cents, created_at')
          .in('job_id', jobIds)
          .neq('status', 'void'),
        supabase.from('payments').select('job_id, amount_cents').in('job_id', jobIds),
        supabase
          .from('job_authorized_totals')
          .select('job_id, checked, quoted_cents, authorized_cents')
          .in('job_id', jobIds),
        supabase.from('settings').select('default_tax_rate_bp').single(),
      ])
      failed = !!invRes.error || !!payRes.error || !!authRes.error || !!settingsRes.error
      inv = (invRes.data as typeof invoices | null) ?? []
      pay = (payRes.data as typeof payments | null) ?? []
      au = (authRes.data as typeof auths | null) ?? []
      rate = (settingsRes.data as { default_tax_rate_bp: number } | null)?.default_tax_rate_bp ?? null
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
    setAuths(au)
    setDefaultTaxRateBp(rate)
    setMoneyFailed(failed)
    setJobs(mine)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (!customer) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  // "Owes" is EXACTLY what the statement link below shows them (the owner,
  // 2026-09-27: statements list finished work only; migration 0049), so the
  // figure and the "Send statement" button can never disagree with the page
  // the customer opens:
  //   · finished (done) jobs not marked paid, only — a scheduled or
  //     in-progress job (0043) is booked, not owed, deposits or not; its total
  //     is shown as booked, before tax;
  //   · each at its statement total (statementTotalCents, the mirror of the
  //     0049 SQL): the larger of the capped charge and the governing
  //     invoice's total, tax line included (0035's rule, the same target as
  //     the job page's balance); or, with no invoice yet, the capped
  //     before-tax charge plus the sales tax the invoice will bill;
  //   · less what was paid on it (the ledger, else the cached amount — the
  //     statement's coalesce). Tips (0048) are not payments and never count.
  // "Lifetime" counts an unpaid done job at that same statement total and a
  // paid one at what it was billed (the larger of its charge and its
  // governing invoice), so what a customer owes never exceeds their lifetime.
  const lifetime = jobs.reduce(
    (acc, j) => {
      if (isBookedJob(j.job)) {
        acc.booked += j.totals?.total_charged_cents ?? 0
        return acc
      }
      if (!j.totals) return acc
      const gov = governingInvoice(invoices.filter((i) => i.job_id === j.job.id))
      if (j.job.payment_status === 'paid') {
        acc.charged += Math.max(j.totals.total_charged_cents, gov?.total_cents ?? 0)
        return acc
      }
      const onStatement = statementTotalCents({
        totalChargedCents: j.totals.total_charged_cents,
        governingInvoiceTotalCents: gov?.total_cents,
        auth: auths.find((a) => a.job_id === j.job.id) ?? null,
        defaultTaxRateBp,
      })
      acc.charged += onStatement
      const onLedger = payments.filter((p) => p.job_id === j.job.id)
      const collected = collectedForJob(
        j.job,
        j.totals.total_charged_cents,
        onLedger.reduce((s, p) => s + p.amount_cents, 0),
        onLedger.length > 0,
      )
      acc.unpaid += Math.max(0, onStatement - collected)
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
