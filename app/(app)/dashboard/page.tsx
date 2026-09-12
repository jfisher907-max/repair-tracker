'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import DashboardView from '@/components/dashboard/DashboardView'
import type { BillingCounts } from '@/components/dashboard/ActionLane'
import { SkeletonDashboard } from '@/components/Skeleton'
import { docState, listBusinessDocuments, type BusinessDocument } from '@/components/BusinessDocuments'
import { listCores, type CoreOut } from '@/lib/cores'
import { loadFinanceRows, type FinanceRows } from '@/lib/finances'
import { supabase } from '@/lib/supabase'

/**
 * The dashboard page only loads and hands over. All the money arithmetic
 * lives in lib/finances.ts and every pixel in components/dashboard/, so the
 * board can be rendered from fixture data without a database.
 */
export default function Dashboard() {
  const [rows, setRows] = useState<FinanceRows | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Core deposits out of the shop — the lane counts the ones not yet credited. */
  const [cores, setCores] = useState<CoreOut[]>([])
  /** Licenses and policies close to lapsing — surfaced here so they can't sneak up. */
  const [docAlerts, setDocAlerts] = useState<BusinessDocument[]>([])
  /** Open requests from the public site's form — the shop's only inbound channel. */
  const [newRequests, setNewRequests] = useState(0)
  const [billing, setBilling] = useState<BillingCounts>({ openQuotes: 0, unpaidInvoices: 0, overdue: 0 })
  const [businessName, setBusinessName] = useState('')

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
    supabase
      .from('settings')
      .select('business_name')
      .single()
      .then(({ data }) => setBusinessName(data?.business_name ?? ''))
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
      billing={billing}
      businessName={businessName}
    />
  )
}
