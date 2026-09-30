'use client'

import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { docState, type BusinessDocument } from '@/components/BusinessDocuments'
import { coreState, watchCore, RETURN_WINDOW_DAYS, type CoreOut } from '@/lib/cores'
import type { Finances } from '@/lib/finances'
import { taxToPlanFor, type TaxReminder } from '@/lib/sales-tax'
import { money, shortDate } from './format'

type Edge = 'ok' | 'wait' | 'stop' | 'info' | 'idle'

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
  taxes = null,
  resaleCard = false,
  now = new Date(),
}: {
  f: Finances
  cores: CoreOut[]
  docAlerts: BusinessDocument[]
  newRequests: number
  billing: BillingCounts
  /** The sales-tax return coming due, when one is inside 30 days or late (lib/sales-tax taxReminder). */
  taxes?: TaxReminder | null
  /** The one-time resale-card reminder is waiting for an answer (lib/sales-tax resalePromptDue). */
  resaleCard?: boolean
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

  // One money door (owner, 2026-09-12: "the 4 invoices under owed-to-you
  // should be associated with billing"). Work done but not yet invoiced and
  // invoices out unpaid are the same list to him: what has to be billed and
  // collected. The count is the paperwork; the title carries the money.
  const billingParts: ReactNode[] = []
  if (f.uninvoicedJobs > 0) {
    billingParts.push(
      <>
        {f.uninvoicedJobs} to invoice
        {f.oldestOwed && (
          <>
            {' '}
            (<span className="wnt-id">{f.oldestOwed.jobNumber}</span> oldest)
          </>
        )}
      </>,
    )
  }
  if (billing.unpaidInvoices > 0) {
    billingParts.push(
      `${billing.unpaidInvoices} invoice${billing.unpaidInvoices === 1 ? '' : 's'} out${billing.overdue > 0 ? ` · ${billing.overdue} overdue` : ''}`,
    )
  }
  const billingSub =
    billingParts.length === 0 ? (
      'nothing outstanding'
    ) : (
      <>
        {billingParts.map((part, i) => (
          <span key={i}>
            {i > 0 && ' · '}
            {part}
          </span>
        ))}
      </>
    )
  const billingCount = f.uninvoicedJobs + billing.unpaidInvoices

  // The pipeline (0043): approved work that is booked or on the lift, and
  // not in the books yet. The count is the jobs; the title carries the booked
  // money in the neutral colour — it is neither owed nor earned. The sub
  // names the next car in: the soonest booked date on or after today. When
  // every booked day has passed, Finances hands back the one that has waited
  // longest, and a past date is never called "next" — it is "waiting", the
  // jobs list's "drop-off day has passed".
  const next = f.booked.next
  const p = (n: number) => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
  const scheduledSub: ReactNode = !next ? (
    'nothing booked'
  ) : next.stage === 'in_progress' ? (
    <>
      <span className="wnt-id">{next.jobNumber}</span> · in progress
    </>
  ) : (
    <>
      {next.date < today ? 'waiting: ' : 'next: '}
      <span className="wnt-id">{next.jobNumber}</span> · {shortDate(next.date)}
    </>
  )

  const doors: Door[] = [
    {
      href: '/jobs?status=scheduled',
      n: f.booked.jobs,
      label: 'Scheduled',
      title:
        f.booked.cents > 0 ? (
          <>
            Scheduled <span className="money">{money(f.booked.cents)}</span>
          </>
        ) : (
          'Scheduled'
        ),
      sub: scheduledSub,
      edge: f.booked.jobs > 0 ? 'info' : 'idle',
    },
    {
      href: '/billing',
      n: billingCount,
      label: 'Billing',
      title:
        f.unpaid > 0 ? (
          <>
            {/* f.unpaid is before tax (the books' basis); an invoice's tax
                line is on top of it, so the figure says so. */}
            Billing <span className="money money-owed">{money(f.unpaid)} owed before tax</span>
          </>
        ) : (
          'Billing'
        ),
      sub: billingSub,
      // Finished work with no bill sent is the most urgent thing on the board.
      edge:
        billing.overdue > 0 || f.uninvoicedJobs > 0
          ? 'stop'
          : billing.unpaidInvoices > 0
            ? 'wait'
            : 'idle',
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
  // Taxes (0053; the owner's TAX-7 answer): the Paperwork door's pattern for
  // a return coming due. It counts to the OFFICIAL date — the city counts the
  // day it receives a return, so the weekend grace day is named, never aimed
  // at. Built by lib/sales-tax taxReminder: present from 30 days out ("wait"),
  // "stop" from 7 days out and once the date has passed, gone once the
  // quarter is recorded as filed and paid IN FULL (lib/sales-tax filingStatus).
  if (taxes) {
    const both = taxes.both
    const differ = !taxes.basis && both.cash.tax !== both.accrual.tax
    // What is still owed after the payments recorded for the quarter; a paid
    // quarter that is not yet marked filed says so instead of a figure.
    const paid = taxes.status.paidCents
    const amount = paid > 0 ? taxes.status.balance : taxToPlanFor(both, taxes.basis)
    const paidInFull = paid > 0 && amount === 0
    const official = taxes.due.official
    const effective = taxes.due.effective
    const period = `${shortDate(taxes.quarter.start).slice(0, 3)}–${shortDate(taxes.quarter.end).slice(0, 3)} sales tax`
    const when =
      taxes.daysLeft > 0
        ? `due ${shortDate(official)}${taxes.due.moved ? ` (city takes it to ${shortDate(effective)})` : ''}`
        : taxes.daysLeft === 0
          ? `due today${taxes.due.moved ? ` (city takes it to ${shortDate(effective)})` : ''}`
          : `${-taxes.daysLeft} day${taxes.daysLeft === -1 ? '' : 's'} past ${shortDate(official)}${
              taxes.due.moved && today <= effective ? ` · last day ${shortDate(effective)}` : ''
            }`
    doors.push({
      href: '/taxes',
      n: 1,
      label: 'Taxes',
      title: (
        <>
          Taxes{' '}
          {!paidInFull && <span className="money">{differ ? `up to ${money(amount)}` : money(amount)}</span>}
        </>
      ),
      sub: `${period} · ${
        paidInFull ? 'paid, not marked filed · ' : paid > 0 ? `${money(paid)} paid, rest ` : ''
      }${when}`,
      edge: taxes.edge,
    })
  }
  // Resale card (TAX-3; the owner's answer: "Ask once my first return is
  // filed"): a question, not a deadline, so it is 'info'. It is here from the
  // day the Jul–Sep 2026 return is recorded as filed until he answers it on
  // the Taxes page, where the card and its two buttons are; either answer is
  // kept on the settings row (0056), so the door never comes back.
  if (resaleCard) {
    doors.push({
      href: '/taxes',
      n: 1,
      label: 'Resale card',
      title: 'Resale card',
      sub: 'first return filed · ask the city?',
      edge: 'info',
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
