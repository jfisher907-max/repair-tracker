'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { SkeletonList } from '@/components/Skeleton'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { unpaidBalanceCents } from '@/lib/calc'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/date'
import type { Expense, Invoice, Payment, Settings } from '@/lib/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The shop's books: P&L by month, cash collected, sales tax for filing,
 * receivables aging, and top customers. Prints as a light document for the
 * tax preparer via the shared report styling.
 */
export default function ReportsPage() {
  const [jobs, setJobs] = useState<JobWithContext[] | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [year, setYear] = useState<number>(new Date().getFullYear())

  useEffect(() => {
    fetchJobsWithContext().then(setJobs)
    supabase.from('payments').select('*').then(({ data }) => setPayments((data as Payment[]) ?? []))
    supabase.from('expenses').select('*').then(({ data }) => setExpenses((data as Expense[]) ?? []))
    supabase.from('invoices').select('*').then(({ data }) => setInvoices((data as Invoice[]) ?? []))
    supabase.from('settings').select('*').single().then(({ data }) => setSettings(data as Settings))
  }, [])

  useEffect(() => {
    const name = settings?.business_name || 'Shop'
    document.title = `${name} — Reports ${year}`
    return () => {
      document.title = 'Repair Tracker'
    }
  }, [settings, year])

  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()])
    for (const j of jobs ?? []) set.add(Number(j.job.date.slice(0, 4)))
    for (const e of expenses) set.add(Number(e.date.slice(0, 4)))
    return [...set].sort((a, b) => b - a)
  }, [jobs, expenses])

  const report = useMemo(() => {
    if (!jobs) return null
    const inYear = (iso: string) => Number(iso.slice(0, 4)) === year
    const monthOf = (iso: string) => Number(iso.slice(5, 7)) - 1

    const months = MONTHS.map(() => ({ revenue: 0, parts: 0, overhead: 0, collected: 0 }))
    for (const j of jobs.filter((j) => inYear(j.job.date))) {
      const m = months[monthOf(j.job.date)]
      m.revenue += j.totals?.total_charged_cents ?? 0
      m.parts += j.totals?.parts_cost_cents ?? 0
    }
    for (const e of expenses.filter((e) => inYear(e.date))) {
      months[monthOf(e.date)].overhead += e.amount_cents
    }
    for (const p of payments.filter((p) => inYear(p.date))) {
      months[monthOf(p.date)].collected += p.amount_cents
    }

    const totals = months.reduce(
      (acc, m) => ({
        revenue: acc.revenue + m.revenue,
        parts: acc.parts + m.parts,
        overhead: acc.overhead + m.overhead,
        collected: acc.collected + m.collected,
      }),
      { revenue: 0, parts: 0, overhead: 0, collected: 0 },
    )

    const taxCollected = invoices
      .filter((i) => i.status !== 'void' && inYear(i.issue_date))
      .reduce((s, i) => s + i.tax_cents, 0)

    // Receivables as of today (not year-scoped): who owes what, and for how long.
    const now = new Date()
    const aging = { b30: 0, b60: 0, b90: 0, b90p: 0 }
    const owed: { name: string; job: string; balance: number; days: number }[] = []
    for (const j of jobs) {
      if (j.job.payment_status === 'paid' || !j.totals) continue
      const balance = unpaidBalanceCents(j.job, j.totals.total_charged_cents)
      if (balance <= 0) continue
      const days = Math.floor((now.getTime() - new Date(`${j.job.date}T00:00:00`).getTime()) / 86400000)
      owed.push({ name: j.customer?.name ?? '—', job: j.job.job_number, balance, days })
      if (days <= 30) aging.b30 += balance
      else if (days <= 60) aging.b60 += balance
      else if (days <= 90) aging.b90 += balance
      else aging.b90p += balance
    }
    owed.sort((a, b) => b.days - a.days)

    const byCustomer = new Map<string, number>()
    for (const j of jobs.filter((j) => inYear(j.job.date))) {
      const name = j.customer?.name ?? '—'
      byCustomer.set(name, (byCustomer.get(name) ?? 0) + (j.totals?.total_charged_cents ?? 0))
    }
    const topCustomers = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

    const byCategory = new Map<string, number>()
    for (const e of expenses.filter((e) => inYear(e.date))) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount_cents)
    }

    return { months, totals, taxCollected, aging, owed, topCustomers, byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]) }
  }, [jobs, expenses, payments, invoices, year])

  if (!jobs || !report) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl">Reports</h1>
        <SkeletonList rows={4} height={100} />
      </div>
    )
  }

  const net = report.totals.revenue - report.totals.parts - report.totals.overhead
  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const activeMonths = report.months
    .map((m, i) => ({ ...m, i }))
    .filter((m) => m.revenue !== 0 || m.overhead !== 0 || m.collected !== 0)

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Reports</h1>
        <div className="flex items-center gap-2">
          <select
            className="select !w-auto !min-h-[38px]"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button className="btn btn-sm btn-primary" onClick={() => window.print()}>
            🖨️ Print / Save PDF
          </button>
        </div>
      </div>

      {/* The printable books — light document, same family as invoices/reports */}
      <div className="report-root mx-auto max-w-[8.5in] px-8 py-10">
        <header>
          <h1 className="text-3xl font-bold">{settings?.business_name || 'Shop Reports'}</h1>
          <div className="mt-1 text-lg" style={{ color: '#374151' }}>
            Financial Summary — {year}
          </div>
          <hr className="report-rule" />
          <div className="report-meta">Generated {generated} · amounts in USD</div>
        </header>

        <main className="mt-6 space-y-7">
          <section>
            <h2 className="text-lg font-bold">Profit &amp; Loss</h2>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Billed</th>
                  <th className="num">Parts cost</th>
                  <th className="num">Overhead</th>
                  <th className="num">Net</th>
                  <th className="num">Collected</th>
                </tr>
              </thead>
              <tbody>
                {activeMonths.map((m) => (
                  <tr key={m.i}>
                    <td>{MONTHS[m.i]}</td>
                    <td className="num">{formatCents(m.revenue)}</td>
                    <td className="num">{formatCents(m.parts)}</td>
                    <td className="num">{formatCents(m.overhead)}</td>
                    <td className="num">{formatCents(m.revenue - m.parts - m.overhead)}</td>
                    <td className="num">{formatCents(m.collected)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, borderTop: '1px solid #9ca3af' }}>
                  <td>Total</td>
                  <td className="num">{formatCents(report.totals.revenue)}</td>
                  <td className="num">{formatCents(report.totals.parts)}</td>
                  <td className="num">{formatCents(report.totals.overhead)}</td>
                  <td className="num">{formatCents(net)}</td>
                  <td className="num">{formatCents(report.totals.collected)}</td>
                </tr>
              </tbody>
            </table>
            <p className="report-meta mt-1">
              Billed = customer charges on jobs dated in {year} (labor + parts at your prices).
              Collected = payments recorded in the ledger. Net = billed − parts cost − overhead.
            </p>
          </section>

          {report.byCategory.length > 0 && (
            <section>
              <h2 className="text-lg font-bold">Overhead by category</h2>
              <table className="report-table" style={{ maxWidth: '24rem' }}>
                <tbody>
                  {report.byCategory.map(([cat, cents]) => (
                    <tr key={cat}>
                      <td>{cat}</td>
                      <td className="num">{formatCents(cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section>
            <h2 className="text-lg font-bold">Sales tax collected — {year}</h2>
            <p className="mt-1">
              <b>{formatCents(report.taxCollected)}</b> across invoices issued in {year}.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">Receivables (as of today)</h2>
            {report.owed.length === 0 ? (
              <p className="mt-1">Nothing outstanding — everyone&apos;s paid up.</p>
            ) : (
              <>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Job</th>
                      <th className="num">Days out</th>
                      <th className="num">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.owed.map((o) => (
                      <tr key={o.job}>
                        <td>{o.name}</td>
                        <td>{o.job}</td>
                        <td className="num">{o.days}</td>
                        <td className="num">{formatCents(o.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="report-meta mt-1">
                  Aging: 0–30d {formatCents(report.aging.b30)} · 31–60d {formatCents(report.aging.b60)} ·
                  61–90d {formatCents(report.aging.b90)} · 90d+ {formatCents(report.aging.b90p)}
                </p>
              </>
            )}
          </section>

          {report.topCustomers.length > 0 && (
            <section>
              <h2 className="text-lg font-bold">Top customers — {year}</h2>
              <table className="report-table" style={{ maxWidth: '24rem' }}>
                <tbody>
                  {report.topCustomers.map(([name, cents]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num">{formatCents(cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </main>

        <footer className="mt-8 border-t pt-3 text-sm" style={{ borderColor: '#9ca3af', color: '#4b5563' }}>
          Internal report — includes cost and profit figures. Not for customers.
        </footer>
      </div>
    </div>
  )
}
