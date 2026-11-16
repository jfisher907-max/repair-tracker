'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import DashboardView from '@/components/dashboard/DashboardView'
import type { BillingCounts } from '@/components/dashboard/ActionLane'
import type { Loaded, NewRequest, OpenInvoice, OpenQuote } from '@/components/dashboard/TodayLists'
import { SkeletonDashboard } from '@/components/Skeleton'
import { docState, listBusinessDocuments, type BusinessDocument } from '@/components/BusinessDocuments'
import { listCores, type CoreOut } from '@/lib/cores'
import { loadFinanceRows, type FinanceRows } from '@/lib/finances'
import { loadTaxFilings } from '@/lib/sales-tax'
import type { Job, Settings, TaxBasis, TaxFiling } from '@/lib/types'
import { supabase } from '@/lib/supabase'

/**
 * `?view=money` is read from the live URL; a static page needs a Suspense
 * boundary for that so its shell can still be built (the Jobs page's rule).
 */
export default function Dashboard() {
  return (
    <Suspense fallback={<SkeletonDashboard />}>
      <DashboardInner />
    </Suspense>
  )
}

/**
 * The dashboard page only loads and hands over. All the money arithmetic
 * lives in lib/finances.ts and every pixel in components/dashboard/, so the
 * board can be rendered from fixture data without a database.
 */
function DashboardInner() {
  // Today unless the URL says Money: opening the app lands on the work.
  const view = useSearchParams().get('view') === 'money' ? 'money' : 'today'
  /** Today's lists (2026-11-16). undefined = loading; null = that read failed. */
  const [requests, setRequests] = useState<Loaded<NewRequest>>(undefined)
  const [openInvoices, setOpenInvoices] = useState<Loaded<OpenInvoice>>(undefined)
  const [openQuotes, setOpenQuotes] = useState<Loaded<OpenQuote>>(undefined)
  const [rows, setRows] = useState<FinanceRows | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Core deposits out of the shop — the lane counts the ones not yet credited. */
  const [cores, setCores] = useState<CoreOut[]>([])
  /** Licenses and policies close to lapsing — surfaced here so they can't sneak up. */
  const [docAlerts, setDocAlerts] = useState<BusinessDocument[]>([])
  /** Open requests from the public site's form — the shop's only inbound channel. */
  const [newRequests, setNewRequests] = useState(0)
  /**
   * Of those, the ones where the customer said the aircraft is on the ground
   * (0071). Counted separately because the lane gives AOG its own door: email
   * and push are both optional env vars, so on a shop with neither configured
   * this door is the ONLY thing that says an aircraft is down.
   */
  const [aogRequests, setAogRequests] = useState(0)
  const [billing, setBilling] = useState<BillingCounts>({ openQuotes: 0, unpaidInvoices: 0, overdue: 0 })
  const [businessName, setBusinessName] = useState('')
  /** Tax filings recorded (0053): undefined while loading, null when the read failed. */
  const [taxFilings, setTaxFilings] = useState<TaxFiling[] | null | undefined>(undefined)
  const [taxBasis, setTaxBasis] = useState<TaxBasis | null>(null)
  /** The resale-card answer (TAX-3, 0056); undefined = the row or its column isn't there. */
  const [resaleCardPrompt, setResaleCardPrompt] = useState<Settings['resale_card_prompt']>(undefined)

  useEffect(() => {
    loadFinanceRows()
      .then(setRows)
      .catch((e) => setError(String(e.message ?? e)))
    listCores()
      .then(setCores)
      .catch(() => {})
    listBusinessDocuments()
      .then((docs) => setDocAlerts(docs.filter((d) => docState(d) !== 'ok')))
      .catch(() => {})
    supabase
      .from('service_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new')
      .then(({ count }) => setNewRequests(count ?? 0))
    // Before 0071 there is no `aog` column, so this filter errors and `count`
    // comes back null — which reads as "none down", the same as a shop that has
    // never had one. The AOG door simply does not appear, and the Requests
    // door above is unaffected.
    supabase
      .from('service_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new')
      .eq('aog', true)
      .then(({ count }) => setAogRequests(count ?? 0))
    // `*`, not a column list: sales_tax_basis (0053) is read when it exists,
    // and a database without it still gives the business name.
    supabase
      .from('settings')
      .select('*')
      .single()
      .then(({ data }) => {
        setBusinessName(data?.business_name ?? '')
        const b = data?.sales_tax_basis
        setTaxBasis(b === 'cash' || b === 'accrual' ? b : null)
        // Undefined before 0056 or on a failed read: its door stays away.
        setResaleCardPrompt(data?.resale_card_prompt)
      })
    // A failed read is not "nothing filed": the ledger says it could not read
    // them, and the Taxes door shows (it errs toward reminding).
    loadTaxFilings()
      .then(setTaxFilings)
      .catch(() => setTaxFilings(null))
    const today = new Date()
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    Promise.all([
      supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .in('status', ['draft', 'sent'])
        .is('deleted_at', null),
      supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .in('status', ['draft', 'sent']),
      supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent')
        .lt('due_date', todayIso),
    ]).then(([q, i, o]) =>
      setBilling({ openQuotes: q.count ?? 0, unpaidInvoices: i.count ?? 0, overdue: o.count ?? 0 }),
    )

    // Today's lists: the records behind those counts. Each read stands alone,
    // and one that fails is recorded as failed (null), never as an empty list:
    // the board must not say "nothing is waiting" about a list it could not read.
    supabase
      .from('service_requests')
      .select('*')
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => setRequests(error ? null : ((data ?? []) as NewRequest[])))
    supabase
      .from('invoices')
      .select('id, invoice_number, job_id, customer_name, job_title, total_cents, due_date, status')
      .in('status', ['draft', 'sent'])
      .then(({ data, error }) => setOpenInvoices(error ? null : ((data ?? []) as OpenInvoice[])))
    Promise.all([
      supabase
        .from('quotes')
        .select('id, quote_number, title, status, sent_at, created_at, customer:customers(name)')
        .in('status', ['draft', 'sent'])
        .is('deleted_at', null),
      supabase.from('quote_totals').select('quote_id, total_cents'),
    ]).then(([q, t]) => {
      if (q.error) return setOpenQuotes(null)
      // The totals are a courtesy on the row; a quote still lists without one.
      const totals = new Map(
        ((t.data ?? []) as { quote_id: string; total_cents: number }[]).map((x) => [x.quote_id, x.total_cents]),
      )
      type QuoteJoin = Omit<OpenQuote, 'customer_name' | 'total_cents'> & {
        customer: { name: string } | { name: string }[] | null
      }
      setOpenQuotes(
        ((q.data ?? []) as unknown as QuoteJoin[]).map(({ customer, ...x }) => ({
          ...x,
          customer_name: (Array.isArray(customer) ? customer[0]?.name : customer?.name) ?? '',
          total_cents: totals.get(x.id) ?? null,
        })),
      )
    })
  }, [])

  /**
   * A bench card's clock button. The write is the job page's own (the same
   * patch from lib/labor-time); the row is updated here so the card shows the
   * clock running without a reload. A write that does not land changes
   * nothing here, so the button stays as it was.
   */
  const patchJob = useCallback(async (jobId: string, patch: Partial<Job>) => {
    const { error } = await supabase.from('jobs').update(patch).eq('id', jobId)
    if (error) {
      // A refusal carries a database code; a dead connection does not. Saying
      // "check your connection" over a refusal sends him looking in the wrong place.
      alert(
        error.code
          ? 'The clock did not save: the job would not take the change. Open the job to see why.'
          : 'The clock did not save. Check your connection and try again.',
      )
      return
    }
    setRows((prev) =>
      prev
        ? { ...prev, jobs: prev.jobs.map((it) => (it.job.id === jobId ? { ...it, job: { ...it.job, ...patch } } : it)) }
        : prev,
    )
  }, [])

  if (error) return <p style={{ color: 'var(--red)' }}>Couldn&apos;t load: {error}</p>
  if (!rows) return <SkeletonDashboard />

  if (rows.jobs.length === 0) {
    return (
      <div className="card mx-auto max-w-md space-y-4 text-center">
        <h1 className="text-2xl">Welcome to your shop</h1>
        <p style={{ color: 'var(--text2)' }}>
          Start your first job — you can add the customer and their vehicle right in the same
          form. Parts and receipts come after.
        </p>
        <Link href="/jobs/new" className="btn btn-primary w-full">
          + Start your first job
        </Link>
      </div>
    )
  }

  return (
    <DashboardView
      rows={rows}
      cores={cores}
      docAlerts={docAlerts}
      newRequests={newRequests}
      aogRequests={aogRequests}
      billing={billing}
      businessName={businessName}
      taxFilings={taxFilings}
      taxBasis={taxBasis}
      resaleCardPrompt={resaleCardPrompt}
      view={view}
      requests={requests}
      openInvoices={openInvoices}
      openQuotes={openQuotes}
      onJobPatch={patchJob}
    />
  )
}
