'use client'

import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { docState, type BusinessDocument } from '@/components/BusinessDocuments'
import { coreState, watchCore, RETURN_WINDOW_DAYS, type CoreOut } from '@/lib/cores'
import type { Finances } from '@/lib/finances'
import { money, shortDate } from './format'

type Edge = 'ok' | 'wait' | 'stop' | 'idle'

interface Door {
  href: string
  n: number
  title: ReactNode
  sub: ReactNode
  edge: Edge
  label: string
}

export interface BillingCounts {
  openQuotes: number
  unpaidInvoices: number
  overdue: number
}

/** A purchase date plus the supplier's return window, as YYYY-MM-DD. */
function returnBy(purchaseDate: string): string {
  const d = new Date(`${purchaseDate}T12:00:00`)
  d.setDate(d.getDate() + RETURN_WINDOW_DAYS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * The counts that need a hand today, each a 44px door with the count up
 * front and a status edge: stop = act now, wait = something is pending,
 * idle = nothing here.
 */
export default function ActionLane({
  f,
  cores,
  docAlerts,
  newRequests,
  billing,
  now = new Date(),
}: {
  f: Finances
  cores: CoreOut[]
  docAlerts: BusinessDocument[]
  newRequests: number
  billing: BillingCounts
  now?: Date
}) {
  // Cores: what is out of the shop and not yet back as a credit.
  const live = cores.filter((c) => {
    const s = coreState(c)
    return s === 'out' || s === 'awaiting_credit'
  })
  // Units, not rows: a consolidated ticket line ("CORE CHARGE 2 @ 30.00") is
  // two cores out, the way coreDepositTotalCents counts its deposit.
  const liveUnits = live.reduce((s, c) => s + (Number(c.qty) || 1), 0)
  const outCores = live.filter((c) => coreState(c) === 'out')
  const anyOverdue = live.some((c) => watchCore(c, now.getTime()).overdue)
  const earliest = outCores
    .map((c) => c.purchase_date ?? c.created_at.slice(0, 10))
    .sort()[0]
  const coreSub =
    live.length === 0
      ? 'none out'
      : outCores.length > 0
        ? `back by ${shortDate(returnBy(earliest))}`
        : 'check the credit landed'

  const owedSub =
    f.owedJobs === 0 ? (
      'nothing owed'
    ) : f.uninvoicedJobs > 0 ? (
      <>
        {f.uninvoicedJobs} not invoiced yet
        {f.oldestOwed && (
          <>
            {' · '}
            <span className="wnt-id">{f.oldestOwed.jobNumber}</span>
          </>
        )}
      </>
    ) : (
      'all invoiced'
    )

  // Billing is the invoices side only; open quotes get their own door.
  const billingSub =
    billing.unpaidInvoices === 0
      ? 'nothing outstanding'
      : `${billing.unpaidInvoices} unpaid · ${billing.overdue} overdue`

  const doors: Door[] = [
    {
      href: '/jobs?status=unpaid',
      n: f.owedJobs,
      label: 'Owed to you',
      title:
        f.owedJobs > 0 ? (
          <>
            Owed to you <span className="money money-owed">{money(f.unpaid)}</span>
          </>
        ) : (
          'Owed to you'
        ),
      sub: owedSub,
      edge: f.owedJobs > 0 ? 'stop' : 'idle',
    },
    {
      href: '/followups',
      n: liveUnits,
      label: 'Cores out',
      title: 'Cores out',
      sub: coreSub,
      edge: live.length === 0 ? 'idle' : anyOverdue ? 'stop' : 'wait',
    },
    {
      href: '/requests',
      n: newRequests,
      label: 'Requests',
      title: 'Requests',
      sub: newRequests > 0 ? 'a customer is waiting' : 'nothing waiting',
      edge: newRequests > 0 ? 'wait' : 'idle',
    },
    {
      href: '/billing',
      n: billing.unpaidInvoices,
      label: 'Billing',
      title: 'Billing',
      sub: billingSub,
      edge: billing.overdue > 0 ? 'stop' : billing.unpaidInvoices > 0 ? 'wait' : 'idle',
    },
  ]
  // A quote out is a customer who has not answered yet; the door only exists
  // while there is one to chase.
  if (billing.openQuotes > 0) {
    doors.push({
      href: '/jobs?tab=quotes',
      n: billing.openQuotes,
      label: 'Quotes',
      title: 'Quotes',
      sub: 'waiting on a customer',
      edge: 'wait',
    })
  }
  if (docAlerts.length > 0) {
    const expired = docAlerts.filter((d) => docState(d) === 'expired')
    doors.push({
      href: '/settings',
      n: docAlerts.length,
      label: 'Paperwork',
      title: 'Paperwork',
      sub: docAlerts
        .map((d) => `${d.name} ${docState(d) === 'expired' ? 'expired' : 'expires soon'}`)
        .join(' · '),
      edge: expired.length > 0 ? 'stop' : 'wait',
    })
  }

  return (
    <nav className="lane" aria-label="Needs attention">
      {doors.map((d, i) => (
        <Link
          key={d.label}
          href={d.href}
          className={`lane-door edge-${d.edge}`}
          style={{ '--t': i } as CSSProperties}
        >
          <span className={`lane-n${d.n === 0 ? ' is-zero' : ''}`}>{d.n}</span>
          <span className="lane-t">
            <b>{d.title}</b>
            <span>{d.sub}</span>
          </span>
        </Link>
      ))}
    </nav>
  )
}
