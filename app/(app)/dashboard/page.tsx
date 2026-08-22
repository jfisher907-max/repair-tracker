'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import JobRow from '@/components/JobRow'
import { SkeletonDashboard } from '@/components/Skeleton'
import { fetchJobsWithContext, type JobWithContext } from '@/lib/data'
import { collectedForJob, unpaidBalanceCents } from '@/lib/calc'
import { formatCents } from '@/lib/money'
import { supabase } from '@/lib/supabase'
import { docState, listBusinessDocuments, type BusinessDocument } from '@/components/BusinessDocuments'

export default function Dashboard() {
  const [items, setItems] = useState<JobWithContext[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState<'all' | number>('all')
  const [billing, setBilling] = useState<{
    openQuotes: number
    unpaidInvoices: number
    overdue: number
  } | null>(null)
  const [businessName, setBusinessName] = useState('')
  // Collapsed by default — it's a "how am I really doing" panel, not a
  // glance panel. The choice sticks per device.
  const [moneyOpen, setMoneyOpen] = useState(false)
  useEffect(() => {
    try {
      setMoneyOpen(localStorage.getItem('dash-money-open') === '1')
    } catch {}
  }, [])
  function toggleMoney() {
    setMoneyOpen((v) => {
      try {
        localStorage.setItem('dash-money-open', v ? '0' : '1')
      } catch {}
      return !v
    })
  }
  /** The money actually received, by payment date — the cash side of the tiles. */
  const [payments, setPayments] = useState<
    { amount_cents: number; date: string; job_id: string; invoice_id: string | null }[]
  >([])
  /** Parts money going out, by PURCHASE date — the other half of cash basis. */
  const [partOutflows, setPartOutflows] = useState<{ date: string; cents: number }[]>([])
  /** Sales tax rides along in payments but belongs to the state, never to profit. */
  const [taxableInvoices, setTaxableInvoices] = useState<
    { id: string; job_id: string; tax_cents: number; total_cents: number }[]
  >([])
  /** Licenses and policies close to lapsing — surfaced here so they can't sneak up. */
  const [docAlerts, setDocAlerts] = useState<BusinessDocument[]>([])
  /** Open requests from the public site's form — the shop's only inbound channel. */
  const [newRequests, setNewRequests] = useState(0)
  /** Overhead — the spending that isn't parts for a specific job. */
  const [expenses, setExpenses] = useState<{ amount_cents: number; date: string }[]>([])

  useEffect(() => {
    fetchJobsWithContext().then(setItems).catch((e) => setError(String(e.message ?? e)))
    // Payments on binned jobs must not count — their billed/parts/unpaid all
    // vanish with the job, so leaving their cash in would inflate profit and
    // break collected + unpaid = billed. (Reports already filters this way.)
    supabase
      .from('payments')
      .select('amount_cents, date, job_id, invoice_id, job:jobs(deleted_at)')
      .then(({ data }) => {
        const rows =
          (data as unknown as {
            amount_cents: number
            date: string
            job_id: string
            invoice_id: string | null
            job: { deleted_at: string | null } | null
          }[]) ?? []
        setPayments(
          rows
            .filter((p) => !p.job?.deleted_at)
            .map((p) => ({
              amount_cents: p.amount_cents,
              date: p.date,
              job_id: p.job_id,
              invoice_id: p.invoice_id,
            })),
        )
      })
    supabase
      .from('part_lines')
      .select('line_total_cents, purchase_date, job:jobs(date, deleted_at)')
      .then(({ data }) => {
        const rows =
          (data as unknown as {
            line_total_cents: number
            purchase_date: string | null
            job: { date: string; deleted_at: string | null } | null
          }[]) ?? []
        setPartOutflows(
          rows
            .filter((r) => r.job && !r.job.deleted_at)
            .map((r) => ({ date: r.purchase_date ?? r.job!.date, cents: r.line_total_cents })),
        )
      })
    supabase
      .from('invoices')
      .select('id, job_id, tax_cents, total_cents, status')
      .neq('status', 'void')
      .then(({ data }) => setTaxableInvoices(data ?? []))
    supabase
      .from('expenses')
      .select('amount_cents, date')
      .then(({ data }) => setExpenses(data ?? []))
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

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const it of items ?? []) set.add(new Date(it.job.date + 'T00:00:00').getFullYear())
    // A year whose only activity is cash landing on last year's jobs still
    // has to be selectable.
    for (const p of payments) set.add(Number(p.date.slice(0, 4)))
    return [...set].sort((a, b) => b - a)
  }, [items, payments])

  const scoped = useMemo(() => {
    if (!items) return []
    if (year === 'all') return items
    return items.filter((it) => new Date(it.job.date + 'T00:00:00').getFullYear() === year)
  }, [items, year])

  const stats = useMemo(() => {
    const inYear = (iso: string) => year === 'all' || Number(iso.slice(0, 4)) === year
    let hours = 0
    let charged = 0
    let unpaid = 0
    // The two places a job's money is earned: hours sold, and the margin
    // between what parts cost and what they were charged at.
    let laborCharged = 0
    let partsCharged = 0
    let partsCostOnJobs = 0
    for (const it of scoped) {
      hours += Number(it.job.labor_hours)
      const t = it.totals
      if (!t) continue
      charged += t.total_charged_cents
      laborCharged += t.labor_charge_cents
      partsCharged += t.parts_charged_cents
      partsCostOnJobs += t.parts_cost_cents
      unpaid += unpaidBalanceCents(it.job, t.total_charged_cents)
    }
    const partsMarkup = partsCharged - partsCostOnJobs

    // Cash, not accrual. The old "profit" counted every job as if it were
    // paid, so an unpaid $2,000 job read as money in the bank.
    //
    // BOTH sides are cash-dated or the number is nonsense: payments by
    // PAYMENT date, parts by PURCHASE date. Mixing them (parts by job date)
    // made a December job paid in January show a false loss for the year.
    const jobsWithLedger = new Set(payments.map((p) => p.job_id))
    let collected = payments.filter((p) => inYear(p.date)).reduce((s, p) => s + p.amount_cents, 0)
    for (const it of scoped) {
      if (jobsWithLedger.has(it.job.id) || !it.totals) continue
      collected += collectedForJob(it.job, it.totals.total_charged_cents, 0, false)
    }
    const partsSpend = partOutflows.filter((o) => inYear(o.date)).reduce((s, o) => s + o.cents, 0)

    // Sales tax arrives inside those payments but is the state's money, so it
    // is neither revenue nor profit. Because ALL job money now settles an
    // invoice (a deposit included), tax is prorated against every payment on
    // the job — matched to the job's governing (largest) live invoice, the
    // same revision rule used everywhere else. Keying it to invoice-attributed
    // payments alone left a deposit's tax share sitting in profit.
    const govByJob = new Map<string, { tax_cents: number; total_cents: number }>()
    for (const inv of taxableInvoices) {
      const cur = govByJob.get(inv.job_id)
      if (!cur || inv.total_cents > cur.total_cents) {
        govByJob.set(inv.job_id, { tax_cents: inv.tax_cents, total_cents: inv.total_cents })
      }
    }
    let taxCollected = 0
    for (const [jobId, inv] of govByJob) {
      if (inv.tax_cents <= 0 || inv.total_cents <= 0) continue
      const paidOnJob = payments
        .filter((p) => p.job_id === jobId && inYear(p.date))
        .reduce((s, p) => s + p.amount_cents, 0)
      if (paidOnJob <= 0) continue
      taxCollected += Math.round(inv.tax_cents * Math.min(1, paidOnJob / inv.total_cents))
    }

    const overhead = expenses.filter((e) => inYear(e.date)).reduce((s, e) => s + e.amount_cents, 0)

    return {
      count: scoped.length,
      hours,
      charged,
      partsSpend,
      collected,
      taxCollected,
      cashProfit: collected - partsSpend - taxCollected,
      unpaid,
      laborCharged,
      partsCharged,
      partsCostOnJobs,
      partsMarkup,
      // What the work earned, paid or not: hours sold plus parts margin.
      earned: laborCharged + partsMarkup,
      overhead,
    }
  }, [scoped, payments, partOutflows, taxableInvoices, expenses, year])

  const unpaidJobs = scoped.filter((it) => it.job.payment_status !== 'paid')
  const recent = scoped.slice(0, 6)

  if (error) return <p style={{ color: 'var(--red)' }}>Couldn&apos;t load: {error}</p>
  if (!items) return <SkeletonDashboard />

  if (items.length === 0) {
    return (
      <div className="card mx-auto max-w-md space-y-4 text-center">
        <div className="text-4xl">🚗</div>
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

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm" style={{ color: 'var(--text3)' }}>{today}</div>
          <h1 className="text-3xl leading-tight">{businessName || 'Dashboard'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="select !w-auto !min-h-[38px]"
            value={String(year)}
            onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All time</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <Link href="/quotes/new" className="btn hidden sm:inline-flex">
            + New Quote
          </Link>
          <Link href="/jobs/new" className="btn btn-primary hidden sm:inline-flex">
            + New Job
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatTile icon="🔧" label="Jobs" value={String(stats.count)} />
        <StatTile icon="⏱️" label="Labor hours" value={stats.hours.toFixed(1)} />
        <StatTile icon="💵" label="Billed" value={formatCents(stats.charged)} hint="what the work came to" />
        <StatTile icon="🏦" label="Collected" value={formatCents(stats.collected)} hint="payments received" />
        <StatTile
          icon="🛒"
          label="Parts spend"
          value={formatCents(stats.partsSpend)}
          hint="your cost, when bought"
        />
        <StatTile
          icon="📈"
          label="Cash profit"
          value={formatCents(stats.cashProfit)}
          accent={stats.cashProfit >= 0 ? 'var(--green)' : 'var(--red)'}
          hint="money in − parts, before overhead"
        />
        <StatTile
          icon="⚠️"
          label="Unpaid balance"
          value={formatCents(stats.unpaid)}
          accent={stats.unpaid > 0 ? 'var(--red)' : 'var(--green)'}
          hint="still owed to you"
        />
      </div>

      {/* Where the money is actually earned — the labor/markup split lives
          nowhere else in the app, and it's the number that says whether the
          markup matrix is pulling its weight. Collapsed to one line until
          asked. */}
      <div className="card space-y-1.5">
        <button
          type="button"
          className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
          onClick={toggleMoney}
          aria-expanded={moneyOpen}
        >
          <span className="label !mb-0">Where your money comes from</span>
          <span className="flex items-center gap-2">
            {!moneyOpen && (
              <span className="money text-sm font-bold" style={{ color: 'var(--green)' }}>
                {formatCents(stats.earned)}
              </span>
            )}
            <span style={{ color: 'var(--text3)' }}>{moneyOpen ? '▾' : '▸'}</span>
          </span>
        </button>
        {moneyOpen && (
          <>
        <MoneyRow label="Labor billed" value={stats.laborCharged} />
        <MoneyRow label="Parts billed" value={stats.partsCharged} />
        <MoneyRow label="What the parts cost you" value={-stats.partsCostOnJobs} muted />
        <MoneyRow label="Parts markup" value={stats.partsMarkup} accent="var(--accent2)" />
        <div className="border-t pt-1.5" style={{ borderColor: 'var(--border)' }}>
          <MoneyRow
            label="Earned on the work"
            value={stats.earned}
            accent="var(--green)"
            bold
          />
        </div>
        {stats.overhead > 0 && (
          <>
            <MoneyRow label="Overhead (expenses)" value={-stats.overhead} muted />
            <MoneyRow
              label="After overhead"
              value={stats.earned - stats.overhead}
              accent={stats.earned - stats.overhead >= 0 ? 'var(--green)' : 'var(--red)'}
              bold
            />
          </>
        )}
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          Labor + parts markup = what the work earned, whether or not it&apos;s been paid yet.
          The tiles above are cash: what has actually reached you.
        </p>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:hidden">
        <Link href="/jobs/new" className="btn btn-primary">
          + New Job
        </Link>
        <Link href="/quotes/new" className="btn">
          + New Quote
        </Link>
        <Link href="/reports" className="btn">
          📊 Reports
        </Link>
        <Link href="/expenses" className="btn">
          🧰 Expenses
        </Link>
      </div>

      {/* Always rendered: on the phone this row is the only door to the
          inbox, so it can't vanish just because nothing is waiting. */}
      <Link
        href="/requests"
        className="card flex items-center justify-between gap-3 !py-3 hover:brightness-110"
        style={{
          borderLeft: `3px solid ${newRequests > 0 ? 'var(--accent)' : 'var(--border)'}`,
        }}
      >
        <span className="font-semibold">📥 Service requests</span>
        <span className="text-sm" style={{ color: newRequests > 0 ? 'var(--text2)' : 'var(--text3)' }}>
          {newRequests > 0 ? `${newRequests} new — a customer is waiting to hear back` : 'none waiting'}
        </span>
      </Link>
      {docAlerts.length > 0 && (
        <Link
          href="/settings"
          className="card flex items-center justify-between gap-3 !py-3 hover:brightness-110"
          style={{ borderLeft: `3px solid ${docAlerts.some((d) => docState(d) === 'expired') ? 'var(--red)' : 'var(--orange)'}` }}
        >
          <span className="font-semibold">📄 Paperwork</span>
          <span className="text-sm" style={{ color: 'var(--text2)' }}>
            {docAlerts.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ' · '}
                <span style={{ color: docState(d) === 'expired' ? 'var(--red)' : 'var(--orange)' }}>
                  {d.name} {docState(d) === 'expired' ? 'expired' : 'expires soon'}
                </span>
              </span>
            ))}
          </span>
        </Link>
      )}

      {billing && (billing.openQuotes > 0 || billing.unpaidInvoices > 0) && (
        <Link
          // Land on the list that matches the number that made him tap.
          href={billing.unpaidInvoices > 0 ? '/billing?tab=invoices' : '/billing'}
          className="card flex items-center justify-between !py-3 hover:brightness-110"
        >
          <span className="font-semibold">🧾 Billing</span>
          <span className="text-sm" style={{ color: 'var(--text2)' }}>
            {billing.openQuotes > 0 && (
              <>{billing.openQuotes} open quote{billing.openQuotes === 1 ? '' : 's'}</>
            )}
            {billing.openQuotes > 0 && billing.unpaidInvoices > 0 && ' · '}
            {billing.unpaidInvoices > 0 && (
              <span style={{ color: 'var(--red)' }}>
                {billing.unpaidInvoices} unpaid invoice{billing.unpaidInvoices === 1 ? '' : 's'}
                {billing.overdue > 0 && <b> ({billing.overdue} overdue)</b>}
              </span>
            )}
          </span>
        </Link>
      )}

      {unpaidJobs.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">Unpaid jobs</h2>
          {unpaidJobs.map((it) => (
            <JobRow key={it.job.id} item={it} />
          ))}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="section-title flex-1">Recent jobs</h2>
          <Link href="/jobs" className="text-sm" style={{ color: 'var(--accent2)' }}>
            View all →
          </Link>
        </div>
        {recent.map((it) => (
          <JobRow key={it.job.id} item={it} />
        ))}
      </section>
    </div>
  )
}

/** One line of the money breakdown: label left, figure right. */
function MoneyRow({
  label,
  value,
  accent,
  muted,
  bold,
}: {
  label: string
  value: number
  accent?: string
  muted?: boolean
  bold?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span style={{ color: muted ? 'var(--text3)' : 'var(--text2)' }}>{label}</span>
      <span
        className={`money ${bold ? 'font-bold' : ''}`}
        style={{ color: accent ?? (muted ? 'var(--text3)' : undefined) }}
      >
        {value < 0 ? `−${formatCents(Math.abs(value))}` : formatCents(value)}
      </span>
    </div>
  )
}

function StatTile({
  icon,
  label,
  value,
  accent,
  hint,
}: {
  icon: string
  label: string
  value: string
  accent?: string
  /** One line under the number, for what the number does and doesn't count. */
  hint?: string
}) {
  return (
    <div className="stat-tile" style={accent ? { borderTop: `2px solid ${accent}` } : undefined}>
      <div className="flex items-start justify-between">
        <div className="stat-label">{label}</div>
        <span className="text-sm" style={{ opacity: 0.45 }}>{icon}</span>
      </div>
      <div className="stat-value money" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {hint && (
        <div className="text-[0.7rem] leading-tight" style={{ color: 'var(--text3)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}
