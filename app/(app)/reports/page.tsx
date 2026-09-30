'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { SkeletonList } from '@/components/Skeleton'
import { BRAND_NAME } from '@/lib/brand'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { isBookedJob, preLedgerCash } from '@/lib/finances'
import { collectedForJob, governingInvoice, owedGrossCents } from '@/lib/calc'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/date'
import { EXPENSE_LINES, totalsByLine } from '@/lib/schedule-c'
import type { Expense, Invoice, Payment, Settings, Tip } from '@/lib/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The shop's books: P&L by month, cash collected, sales tax for filing,
 * receivables aging, and top customers. Prints as a light document for the
 * tax preparer via the shared report styling.
 */
export default function ReportsPage() {
  const [jobs, setJobs] = useState<JobWithContext[] | null>(null)
  // Payments and invoices start NULL, like jobs: the report waits for them.
  // An empty list is a real answer ("no payments") that the pre-ledger
  // fallback and the receivables read as settled or unbilled, so an empty
  // list must never stand in for "not loaded yet" or "the read failed".
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  // Tips (0048) start null too: "no tips" is a real answer, "not loaded" is not.
  const [tips, setTips] = useState<Tip[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [year, setYear] = useState<number>(new Date().getFullYear())
  // Accrual = when work was billed (job dates). Cash = when money moved
  // (payment/purchase dates) — what a Schedule-C cash-basis filer reports.
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual')
  const [partOutflows, setPartOutflows] = useState<{ date: string; cents: number }[]>([])

  useEffect(() => {
    fetchJobsWithContext().then(setJobs)
    // Parts spending by purchase date (fallback: job date) for the cash view.
    // Cash out the door includes the sales tax paid at the counter, which is a
    // cost of the job and never a customer charge (migration 0027).
    Promise.all([
      supabase.from('part_lines').select('line_total_cents, purchase_date, job:jobs(date, deleted_at)'),
      supabase.from('receipts').select('tax_cents, purchase_date, job:jobs(date, deleted_at)'),
    ]).then(([lines, receipts]) => {
      type J = { date: string; deleted_at: string | null } | null
      const lineRows = (lines.data as unknown as { line_total_cents: number; purchase_date: string | null; job: J }[]) ?? []
      const taxRows = (receipts.data as unknown as { tax_cents: number; purchase_date: string | null; job: J }[]) ?? []
      setPartOutflows([
        ...lineRows
          .filter((r) => r.job && !r.job.deleted_at)
          .map((r) => ({ date: r.purchase_date ?? r.job!.date, cents: r.line_total_cents })),
        ...taxRows
          .filter((r) => r.job && !r.job.deleted_at && r.tax_cents > 0)
          .map((r) => ({ date: r.purchase_date ?? r.job!.date, cents: r.tax_cents })),
      ])
    })
    // Exclude payments belonging to soft-deleted jobs — their revenue is
    // excluded too, so counting their cash would skew Collected vs Billed.
    supabase
      .from('payments')
      .select('*, job:jobs(deleted_at)')
      .then(({ data, error }) => {
        if (error) {
          setLoadError(`Payments did not load (${error.message}).`)
          return
        }
        const rows = (data as (Payment & { job: { deleted_at: string | null } | null })[]) ?? []
        setPayments(rows.filter((p) => !p.job?.deleted_at).map(({ job: _job, ...p }) => p as Payment))
      })
    // Tips on binned jobs are out with the job, the same as its payments.
    supabase
      .from('tips')
      .select('*, job:jobs(deleted_at)')
      .then(({ data, error }) => {
        if (error) {
          setLoadError(`Tips did not load (${error.message}).`)
          return
        }
        const rows = (data as (Tip & { job: { deleted_at: string | null } | null })[]) ?? []
        setTips(rows.filter((t) => t.job && !t.job.deleted_at))
      })
    supabase.from('expenses').select('*').then(({ data }) => setExpenses((data as Expense[]) ?? []))
    // `*` carries included_tax_cents (0041/0045) — the sales tax the shop owes
    // on an invoice that went out with no tax line, 5% of its price — which
    // the sales-tax table below adds to tax_cents.
    supabase
      .from('invoices')
      .select('*')
      .then(({ data, error }) => {
        if (error) {
          setLoadError(`Invoices did not load (${error.message}).`)
          return
        }
        setInvoices((data as Invoice[]) ?? [])
      })
    supabase.from('settings').select('*').single().then(({ data }) => setSettings(data as Settings))
  }, [])

  useEffect(() => {
    const name = settings?.business_name || BRAND_NAME
    document.title = `${name} — Reports ${year}`
    return () => {
      document.title = BRAND_NAME
    }
  }, [settings, year])

  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()])
    for (const j of jobs ?? []) set.add(Number(j.job.date.slice(0, 4)))
    for (const e of expenses) set.add(Number(e.date.slice(0, 4)))
    return [...set].sort((a, b) => b - a)
  }, [jobs, expenses])

  const report = useMemo(() => {
    if (!jobs || !payments || !invoices || !tips) return null
    const inYear = (iso: string) => Number(iso.slice(0, 4)) === year
    const monthOf = (iso: string) => Number(iso.slice(5, 7)) - 1

    // Accrual counts DONE jobs only (0043): a scheduled or in-progress job has
    // billed nothing yet. The cash view below is by payment and purchase date
    // on any job, exactly as before — a deposit on a booked job is cash in.
    const doneJobs = jobs.filter((j) => !isBookedJob(j.job))

    // collected = ledger payments only (the accrual table's column); cashIn =
    // those plus the cash on jobs settled before the ledger existed (the cash
    // table's Money in). Two different figures, captioned as such.
    // tips (0048): income on the tip's date in BOTH views — a tip is not billed
    // work, so it has no job date to accrue on; it is income the day it is
    // handed over. Never inside revenue, collected or cashIn, never taxed.
    const months = MONTHS.map(() => ({ revenue: 0, parts: 0, overhead: 0, collected: 0, cashIn: 0, partsPaid: 0, tips: 0 }))
    for (const j of doneJobs.filter((j) => inYear(j.job.date))) {
      const m = months[monthOf(j.job.date)]
      // Revenue is the job's charge LESS the sales tax the shop owes on an
      // untaxed invoice (0041/0045): 5% of the invoiced price, which the
      // customer did not pay on top, so the shop pays it out of the price.
      // This is the shop's own P&L, not the CBJ return — for the return the
      // whole invoiced price is the gross sale (Procedure 130; the quarter
      // table below). job_totals.included_tax_cents is the governing invoice's
      // figure — the job's LARGEST live (non-void) invoice, ties to the newest
      // — resolved in the view itself, the same rule finances.ts and the job
      // page apply. It comes off in the job's own month, where the charge was
      // booked. total_charged_cents is untouched: the customer paid what the
      // paper said.
      const included = j.totals?.included_tax_cents ?? 0
      m.revenue += (j.totals?.total_charged_cents ?? 0) - included
      m.parts += j.totals?.parts_cost_cents ?? 0
    }
    for (const e of expenses.filter((e) => inYear(e.date))) {
      months[monthOf(e.date)].overhead += e.amount_cents
    }
    for (const p of payments.filter((p) => inYear(p.date))) {
      months[monthOf(p.date)].collected += p.amount_cents
      months[monthOf(p.date)].cashIn += p.amount_cents
    }
    // Real cash with no payment row: a job settled before payment tracking
    // (J001, $150.00). The SAME fallback finances.ts counts (preLedgerCash),
    // dated on the job's date because no payment date exists. Any job, done
    // or not — cash is cash.
    const jobsWithLedger = new Set(payments.map((p) => p.job_id))
    const preLedger = preLedgerCash(jobs, jobsWithLedger).filter((c) => inYear(c.date))
    for (const c of preLedger) months[monthOf(c.date)].cashIn += c.amount_cents
    const preLedgerCents = preLedger.reduce((s, c) => s + c.amount_cents, 0)
    for (const o of partOutflows.filter((o) => inYear(o.date))) {
      months[monthOf(o.date)].partsPaid += o.cents
    }
    for (const t of tips.filter((t) => inYear(t.date))) {
      months[monthOf(t.date)].tips += t.amount_cents
    }

    const byMethod = new Map<string, number>()
    for (const p of payments.filter((p) => inYear(p.date))) {
      byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount_cents)
    }
    if (preLedgerCents > 0) byMethod.set('before payment tracking', preLedgerCents)

    // Sales tax BILLED by filing quarter — issued (sent/paid) invoices by
    // issue date, collected or not. The tax charged on a line and the tax the
    // shop owes on an untaxed invoice (0041/0045) are one amount to the
    // state, so both count; the untaxed part is kept separately for the
    // caption under the table.
    //
    // Sales (the gross sale for the CBJ return) is the invoiced price before
    // any tax LINE: total − tax_cents. On an untaxed invoice that is the WHOLE
    // total — CBJ Procedure 130 does not let a seller who billed no tax back
    // it out, so the full invoiced price is the sale. Never total − included.
    //
    // Exempt (0047) = the sales on invoices that carry no tax AND record the
    // customer's exemption (tax_exempt_note). Taxable = Sales − Exempt. The
    // tax owed = tax lines billed + the included tax on untaxed invoices that
    // are NOT exempt: an exempt invoice owes nothing (the 0047 trigger books 0
    // on it; it is excluded here as well, so a hand-set figure cannot leak
    // in). Tips (0048) are not on any invoice, so they are in none of these.
    const taxQuarters = [0, 0, 0, 0]
    const salesQuarters = [0, 0, 0, 0]
    const exemptQuarters = [0, 0, 0, 0]
    let taxIncludedIssued = 0
    for (const i of invoices.filter(
      (i) => (i.status === 'sent' || i.status === 'paid') && inYear(i.issue_date),
    )) {
      const exempt = i.tax_cents === 0 && !!i.tax_exempt_note?.trim()
      const included = exempt ? 0 : (i.included_tax_cents ?? 0)
      const q = Math.floor(monthOf(i.issue_date) / 3)
      const sale = i.total_cents - i.tax_cents
      taxQuarters[q] += i.tax_cents + included
      salesQuarters[q] += sale
      if (exempt) exemptQuarters[q] += sale
      taxIncludedIssued += included
    }

    const totals = months.reduce(
      (acc, m) => ({
        revenue: acc.revenue + m.revenue,
        parts: acc.parts + m.parts,
        overhead: acc.overhead + m.overhead,
        collected: acc.collected + m.collected,
        cashIn: acc.cashIn + m.cashIn,
        partsPaid: acc.partsPaid + m.partsPaid,
        tips: acc.tips + m.tips,
      }),
      { revenue: 0, parts: 0, overhead: 0, collected: 0, cashIn: 0, partsPaid: 0, tips: 0 },
    )

    const taxCollected = invoices
      .filter((i) => i.status !== 'void' && inYear(i.issue_date))
      .reduce((s, i) => s + i.tax_cents + (i.included_tax_cents ?? 0), 0)

    // Receivables as of today (not year-scoped): who owes what, and for how
    // long. Done jobs only — nothing is owed on work not finished. The balance
    // is what the customer's paper says (owedGrossCents): the governing
    // invoice's total, tax line included, less every payment on the job.
    const now = new Date()
    const aging = { b30: 0, b60: 0, b90: 0, b90p: 0 }
    const owed: { name: string; job: string; balance: number; days: number }[] = []
    const paidByJob = new Map<string, number>()
    for (const p of payments) paidByJob.set(p.job_id, (paidByJob.get(p.job_id) ?? 0) + p.amount_cents)
    const invoicesByJob = new Map<string, Invoice[]>()
    for (const i of invoices) {
      const list = invoicesByJob.get(i.job_id) ?? []
      list.push(i)
      invoicesByJob.set(i.job_id, list)
    }
    for (const j of doneJobs) {
      if (j.job.payment_status === 'paid' || !j.totals) continue
      const collected = collectedForJob(
        j.job,
        j.totals.total_charged_cents,
        paidByJob.get(j.job.id) ?? 0,
        paidByJob.has(j.job.id),
      )
      const gov = governingInvoice(invoicesByJob.get(j.job.id) ?? [])
      const balance = owedGrossCents(j.totals.total_charged_cents, gov?.total_cents, collected)
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
    for (const j of doneJobs.filter((j) => inYear(j.job.date))) {
      const name = j.customer?.name ?? '—'
      byCustomer.set(name, (byCustomer.get(name) ?? 0) + (j.totals?.total_charged_cents ?? 0))
    }
    const topCustomers = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

    // Expenses by Schedule C line (EXP-2), numbered for this tax year.
    const byLine = totalsByLine(expenses.filter((e) => inYear(e.date)), year)

    return {
      months,
      totals,
      taxCollected,
      taxQuarters,
      salesQuarters,
      exemptQuarters,
      taxIncludedIssued,
      preLedgerCents,
      byMethod: [...byMethod.entries()].sort((a, b) => b[1] - a[1]),
      aging,
      owed,
      topCustomers,
      byLine,
    }
  }, [jobs, expenses, payments, invoices, tips, partOutflows, year])

  if (loadError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl">Reports</h1>
        <p className="text-sm" style={{ color: 'var(--red)' }}>
          {loadError} The books are not shown, because without them the cash and balances would
          be wrong. Reload to try again.
        </p>
      </div>
    )
  }

  if (!jobs || !report) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl">Reports</h1>
        <SkeletonList rows={4} height={100} />
      </div>
    )
  }

  // Tips (0048) are income in both views, on their own line: added to net,
  // never folded into Billed or Money in.
  const net = report.totals.revenue + report.totals.tips - report.totals.parts - report.totals.overhead
  const netCash = report.totals.cashIn + report.totals.tips - report.totals.partsPaid - report.totals.overhead
  const showTips = report.totals.tips > 0
  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const activeMonths = report.months
    .map((m, i) => ({ ...m, i }))
    .filter(
      (m) =>
        m.revenue !== 0 ||
        m.overhead !== 0 ||
        m.collected !== 0 ||
        m.cashIn !== 0 ||
        m.partsPaid !== 0 ||
        m.parts !== 0 ||
        m.tips !== 0,
    )

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Reports</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            <button
              className="btn btn-sm"
              style={basis === 'accrual' ? { borderColor: 'var(--accent)', color: 'var(--accent2)' } : undefined}
              onClick={() => setBasis('accrual')}
            >
              Accrual
            </button>
            <button
              className="btn btn-sm"
              style={basis === 'cash' ? { borderColor: 'var(--accent)', color: 'var(--accent2)' } : undefined}
              onClick={() => setBasis('cash')}
            >
              Cash
            </button>
          </div>
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
            Print / Save PDF
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
            <h2 className="text-lg font-bold">
              Profit &amp; Loss ({basis === 'accrual' ? 'accrual basis' : 'cash basis'})
            </h2>
            {basis === 'accrual' ? (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Billed</th>
                    {showTips && <th className="num">Tips</th>}
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
                      {showTips && <td className="num">{formatCents(m.tips)}</td>}
                      <td className="num">{formatCents(m.parts)}</td>
                      <td className="num">{formatCents(m.overhead)}</td>
                      <td className="num">{formatCents(m.revenue + m.tips - m.parts - m.overhead)}</td>
                      <td className="num">{formatCents(m.collected)}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, borderTop: '1px solid #9ca3af' }}>
                    <td>Total</td>
                    <td className="num">{formatCents(report.totals.revenue)}</td>
                    {showTips && <td className="num">{formatCents(report.totals.tips)}</td>}
                    <td className="num">{formatCents(report.totals.parts)}</td>
                    <td className="num">{formatCents(report.totals.overhead)}</td>
                    <td className="num">{formatCents(net)}</td>
                    <td className="num">{formatCents(report.totals.collected)}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Money in</th>
                    {showTips && <th className="num">Tips</th>}
                    <th className="num">Parts paid</th>
                    <th className="num">Overhead</th>
                    <th className="num">Net cash</th>
                  </tr>
                </thead>
                <tbody>
                  {activeMonths.map((m) => (
                    <tr key={m.i}>
                      <td>{MONTHS[m.i]}</td>
                      <td className="num">{formatCents(m.cashIn)}</td>
                      {showTips && <td className="num">{formatCents(m.tips)}</td>}
                      <td className="num">{formatCents(m.partsPaid)}</td>
                      <td className="num">{formatCents(m.overhead)}</td>
                      <td className="num">{formatCents(m.cashIn + m.tips - m.partsPaid - m.overhead)}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, borderTop: '1px solid #9ca3af' }}>
                    <td>Total</td>
                    <td className="num">{formatCents(report.totals.cashIn)}</td>
                    {showTips && <td className="num">{formatCents(report.totals.tips)}</td>}
                    <td className="num">{formatCents(report.totals.partsPaid)}</td>
                    <td className="num">{formatCents(report.totals.overhead)}</td>
                    <td className="num">{formatCents(netCash)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <p className="report-meta mt-1">
              {basis === 'accrual'
                ? `Billed = customer charges on jobs marked done and dated in ${year} (labor + parts at your prices, before any tax line), less the sales tax you owe on invoices that went out with no tax line; scheduled and in-progress jobs are not billed yet.${showTips ? ' Tips = tips received, by the day they were handed over: income, but not billed work and not a sale, so no sales tax.' : ''} Net = billed${showTips ? ' + tips' : ''} − parts cost − overhead. Collected = payment rows in the ledger only, by payment date, sales tax included${report.preLedgerCents > 0 ? `; it leaves out ${formatCents(report.preLedgerCents)} settled before payment tracking, so it is NOT the cash view's Money in` : ''} — a record of payments, not a column to subtract from Billed.`
                : `Cash basis: money in = payments received in ${year}${report.preLedgerCents > 0 ? `, plus ${formatCents(report.preLedgerCents)} on jobs settled before payment tracking (no payment row, so dated on the job's date)` : ''}; sales tax included, since it sits in the bank until it is remitted.${showTips ? ' Tips are cash in on their own line, by the day they were handed over; they are not payments and carry no sales tax.' : ''} Parts paid by purchase date; net cash = in${showTips ? ' + tips' : ''} − parts − overhead. This is the view that matches the bank account (Schedule C cash filers report this). Its Money in is not the accrual view's Collected column.`}
            </p>
          </section>

          {report.byMethod.length > 0 && (
            <section>
              <h2 className="text-lg font-bold">Collected by method — {year}</h2>
              <table className="report-table" style={{ maxWidth: '24rem' }}>
                <tbody>
                  {report.byMethod.map(([method, cents]) => (
                    <tr key={method}>
                      <td style={{ textTransform: 'capitalize' }}>{method}</td>
                      <td className="num">{formatCents(cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {(report.byLine.partII.length > 0 ||
            report.byLine.partV.length > 0 ||
            report.byLine.equipmentLarge != null ||
            report.byLine.legacy.length > 0) && (
            <section>
              <h2 className="text-lg font-bold">Expenses by tax-form line — {year}</h2>
              {(report.byLine.partII.length > 0 || report.byLine.partV.length > 0) && (
                <table className="report-table" style={{ maxWidth: '30rem' }}>
                  <tbody>
                    {report.byLine.partII.map(({ key, line, cents }) => (
                      <tr key={key}>
                        <td style={{ width: '3rem' }}>{line}</td>
                        <td>{EXPENSE_LINES[key].formName}</td>
                        <td className="num">{formatCents(cents)}</td>
                      </tr>
                    ))}
                    {/* 27b is the Part V total; its items sit under it. */}
                    {report.byLine.partV.length > 0 && (
                      <tr>
                        <td style={{ width: '3rem' }}>{report.byLine.partVLine}</td>
                        <td>Other expenses (Part V)</td>
                        <td className="num">{formatCents(report.byLine.partVCents)}</td>
                      </tr>
                    )}
                    {report.byLine.partV.map(({ key, cents }) => (
                      <tr key={key}>
                        <td />
                        <td style={{ paddingLeft: '1.25rem' }}>{EXPENSE_LINES[key].formName}</td>
                        <td className="num">{formatCents(cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {/* Kept off line 13 on purpose: line 13 is depreciation worked
                  out on Form 4562, never the purchase price. */}
              {report.byLine.equipmentLarge != null && (
                <>
                  <table className="report-table" style={{ maxWidth: '30rem' }}>
                    <tbody>
                      <tr>
                        <td>For your preparer: equipment over $2,500 (Form 4562)</td>
                        <td className="num">{formatCents(report.byLine.equipmentLarge)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="report-meta mt-1">
                    Purchase prices, not a line-13 figure: the preparer works out the write-off on Form 4562.
                  </p>
                </>
              )}
              {report.byLine.legacy.length > 0 && (
                <>
                  <table className="report-table" style={{ maxWidth: '30rem' }}>
                    <tbody>
                      {report.byLine.legacy.map(({ label, cents }) => (
                        <tr key={label}>
                          <td>{label}</td>
                          <td className="num">{formatCents(cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="report-meta mt-1">
                    Not on a tax-form line yet: saved before the lines. Pick a line for each on the Expenses page.
                  </p>
                </>
              )}
            </section>
          )}

          <section>
            <h2 className="text-lg font-bold">Sales tax billed on issued invoices — {year}</h2>
            <table className="report-table" style={{ maxWidth: '30rem' }}>
              <thead>
                <tr>
                  <th>Quarter</th>
                  <th className="num">Sales</th>
                  <th className="num">Exempt</th>
                  <th className="num">Taxable</th>
                  <th className="num">Sales tax</th>
                </tr>
              </thead>
              <tbody>
                {report.taxQuarters.map((cents, q) => (
                  <tr key={q}>
                    <td>Q{q + 1} ({MONTHS[q * 3]}–{MONTHS[q * 3 + 2]})</td>
                    <td className="num">{formatCents(report.salesQuarters[q])}</td>
                    <td className="num">{formatCents(report.exemptQuarters[q])}</td>
                    <td className="num">{formatCents(report.salesQuarters[q] - report.exemptQuarters[q])}</td>
                    <td className="num">{formatCents(cents)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, borderTop: '1px solid #9ca3af' }}>
                  <td>Year total</td>
                  <td className="num">{formatCents(report.salesQuarters.reduce((a, b) => a + b, 0))}</td>
                  <td className="num">{formatCents(report.exemptQuarters.reduce((a, b) => a + b, 0))}</td>
                  <td className="num">
                    {formatCents(
                      report.salesQuarters.reduce((a, b) => a + b, 0) -
                        report.exemptQuarters.reduce((a, b) => a + b, 0),
                    )}
                  </td>
                  <td className="num">{formatCents(report.taxQuarters.reduce((a, b) => a + b, 0))}</td>
                </tr>
              </tbody>
            </table>
            <p className="report-meta mt-1">
              Issued (sent or paid) invoices only, by issue date, whether the customer has paid yet or
              not — the numbers for your filing periods. This is tax billed, not tax collected: the
              dashboard&apos;s collected figure follows payment dates, and the two differ whenever an
              invoice is paid in a later quarter. Sales = the full invoiced price before any tax line.
              Exempt = sales on invoices with no tax that record the customer&apos;s exemption; Taxable =
              Sales − Exempt. Sales tax = the tax lines billed plus 5% of the price on every untaxed
              invoice that is not exempt. Tips are not sales and are in none of these columns.
            </p>
            {report.taxIncludedIssued > 0 && (
              <p className="report-meta mt-1">
                {formatCents(report.taxIncludedIssued)} of the tax is on invoices that went out with no
                tax line. Their whole invoiced price is the sale (CBJ Procedure 130: tax cannot be backed
                out of a price that billed none), and the 5% is owed on top of it, out of your pocket.
              </p>
            )}
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
