'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import JobClockButton from '@/components/JobClockButton'
import type { JobWithContext } from '@/lib/data'
import { formatCents } from '@/lib/money'
import { needsReading } from '@/lib/reading'
import { READING, lineOf, serviceMarkText } from '@/lib/service-line'
import { vehicleLabel, type Job } from '@/lib/types'
import { plural, shortDate } from './format'

/**
 * Home's Today view (owner, 2026-11-16: "I find myself having to make several
 * selections in menus to get to the information I want").
 *
 * The lane above used to be a row of doors: a count, and a tap to the list
 * that held the thing. These two sections are the things themselves, each one
 * tap from Home: what is on the bench, and what is waiting on him.
 *
 * Presentational, like the rest of the board. Everything arrives as props so
 * a throwaway route can render it from fixtures.
 */

/** An invoice that is out, or written and not sent. */
export interface OpenInvoice {
  id: string
  invoice_number: string
  job_id: string
  customer_name: string
  job_title: string
  total_cents: number
  due_date: string | null
  status: 'draft' | 'sent'
}

/** A quote that is out, or written and not sent. */
export interface OpenQuote {
  id: string
  quote_number: string
  title: string
  status: 'draft' | 'sent'
  sent_at: string | null
  created_at: string
  customer_name: string
  /** quote_totals.total_cents; null when the view had no row for it. */
  total_cents: number | null
}

/** A request from the public form that nobody has answered yet. */
export interface NewRequest {
  id: string
  name: string
  vehicle: string
  aog?: boolean
  service_line?: string | null
  created_at: string
}

/**
 * A list as the page holds it: undefined while it loads, null when the read
 * failed. The two are kept apart because "nothing is waiting" is a claim, and
 * a failed read must never make it.
 */
export type Loaded<T> = T[] | null | undefined

const EDGE = {
  stop: 'var(--status-stop-solid)',
  wait: 'var(--status-wait-solid)',
  info: 'var(--status-info-solid)',
  idle: 'var(--status-idle-solid)',
} as const

/** How many of one kind to list before the rest becomes a link to the full list. */
const SHOWN = 4

/** "5 min ago", "3 hr ago", "2 days ago" from an ISO timestamp. */
export function agoWords(iso: string, now: Date): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const min = Math.max(0, Math.floor((now.getTime() - then) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const days = Math.floor(hr / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/**
 * Whole calendar days from one YYYY-MM-DD to another, the way Billing counts
 * an overdue invoice. Not hours divided by 24: just after midnight that calls
 * a bill due six days ago "5 days" late.
 */
function calendarDays(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.round(ms / 86_400_000))
}

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ------------------------------------------------------------------ */
/* On the bench                                                        */
/* ------------------------------------------------------------------ */

/**
 * Work in progress, with the three things done to a job all day on the card:
 * the clock, a part, a receipt; and, until it has one, a reminder to record
 * the mileage. Below it, anything booked whose drop-off day has arrived and
 * has not been started.
 */
export function Bench({
  jobs,
  now,
  onJobPatch,
}: {
  jobs: JobWithContext[]
  now: Date
  /** Saves a clock start or stop. Absent on a fixture route: the clock button is left off. */
  onJobPatch?: (jobId: string, patch: Partial<Job>) => Promise<void>
}) {
  const today = localIso(now)
  const working = jobs
    .filter((it) => it.job.stage === 'in_progress')
    // The job with the clock running is the one in his hands: it goes first.
    .sort((a, b) => Number(!!b.job.clock_started_at) - Number(!!a.job.clock_started_at) || (a.job.date < b.job.date ? -1 : 1))
  const arrived = jobs
    .filter((it) => it.job.stage === 'scheduled' && it.job.date <= today)
    .sort((a, b) => (a.job.date < b.job.date ? -1 : 1))

  return (
    <section className="today-sec bench" aria-labelledby="bench-title">
      <div className="today-head">
        <h2 id="bench-title" className="section-title">
          On the bench{working.length > 0 ? ` · ${working.length}` : ''}
        </h2>
      </div>

      {working.length === 0 && arrived.length === 0 && (
        <div className="card today-empty">
          Nothing in progress. A job shows here once it is marked In progress.
        </div>
      )}

      {working.map((it) => {
        const { job, vehicle, customer } = it
        const line = lineOf(vehicle)
        const mark = line === 'aviation' ? serviceMarkText(job) : null
        // On the lift with no mileage (airframe hours on an aircraft): the
        // card keeps saying so until it is in (owner, 2026-11-23).
        const remind = needsReading(job, line)
        return (
          <div
            key={job.id}
            className="card bench-card"
            style={{ borderLeft: `var(--edge-width) solid ${EDGE.wait}` }}
          >
            <Link href={`/jobs/${job.id}`} className="bench-open">
              {/* The chip rides the id line, so the title and the vehicle
                  below it get the card's full width. */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <span className="wnt-id text-xs">{job.job_number}</span>
                  {mark && (
                    <span className="chip" style={{ background: 'var(--bg3)', color: 'var(--accent2)' }}>
                      {mark}
                    </span>
                  )}
                </div>
                <span className="chip chip-open flex-none">in progress</span>
              </div>
              <div className="truncate font-semibold">{job.title}</div>
              <div className="truncate text-sm" style={{ color: 'var(--text2)' }}>
                {customer?.name ?? 'Unknown customer'} · {vehicleLabel(vehicle)}
              </div>
            </Link>
            {/* #reading opens the job with the reminder's field under the thumb. */}
            {remind && (
              <Link href={`/jobs/${job.id}#reading`} className="bench-remind">
                <span className="bench-remind-dot" aria-hidden="true" />
                <span className="min-w-0 flex-1">{READING[line].ask}</span>
                <span aria-hidden="true">→</span>
              </Link>
            )}
            <div className="bench-actions">
              {onJobPatch && <JobClockButton job={job} onUpdate={(patch) => onJobPatch(job.id, patch)} />}
              {/* #add-part opens the job's part form; the scan page is its own route. */}
              <Link href={`/jobs/${job.id}#add-part`} className="btn btn-sm">
                + Part
              </Link>
              <Link href={`/jobs/${job.id}/scan`} className="btn btn-sm">
                Receipt
              </Link>
            </div>
          </div>
        )
      })}

      {arrived.map((it) => {
        const { job, vehicle, customer } = it
        const waited = calendarDays(job.date, today)
        return (
          <Link
            key={job.id}
            href={`/jobs/${job.id}`}
            className="card flex items-center gap-3 !py-3"
            style={{ borderLeft: `var(--edge-width) solid ${EDGE.info}` }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="wnt-id text-xs">{job.job_number}</span>
                <span className="text-xs" style={{ color: 'var(--text3)' }}>
                  {job.date === today ? 'booked for today' : `booked ${shortDate(job.date)}`}
                </span>
              </div>
              <div className="truncate font-semibold">{job.title}</div>
              <div className="truncate text-sm" style={{ color: 'var(--text2)' }}>
                {customer?.name ?? 'Unknown customer'} · {vehicleLabel(vehicle)}
              </div>
            </div>
            <span className="chip chip-booked flex-none">
              {waited === 0 ? 'not started' : `waiting ${plural(waited, 'day')}`}
            </span>
          </Link>
        )
      })}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Waiting on you                                                      */
/* ------------------------------------------------------------------ */

interface Row {
  key: string
  href: string
  edge: keyof typeof EDGE
  /** The small first line: an id, a date. */
  meta: ReactNode
  title: ReactNode
  sub: ReactNode
  amount?: ReactNode
  chip: ReactNode
}

/**
 * Everything that needs a hand, as the records themselves, most pressing
 * first: a customer who wrote in, finished work with no bill, invoices out,
 * quotes with no answer.
 */
export function Waiting({
  requests,
  toInvoice,
  invoices,
  quotes,
  paidByJob,
  now,
}: {
  requests: Loaded<NewRequest>
  toInvoice: JobWithContext[]
  invoices: Loaded<OpenInvoice>
  quotes: Loaded<OpenQuote>
  /** Every payment on a job, summed: an invoice's balance is its total less this. */
  paidByJob: Map<string, number>
  now: Date
}) {
  const today = localIso(now)
  const groups: { name: string; rows: Row[]; more: { n: number; href: string; label: string } | null }[] = []
  const failed: { label: string; href: string }[] = []

  const cut = (rows: Row[], href: string, noun: string) => ({
    rows: rows.slice(0, SHOWN),
    more: rows.length > SHOWN ? { n: rows.length - SHOWN, href, label: `more ${noun}` } : null,
  })

  // 1. A person who wrote in. An aircraft on the ground goes above everything.
  if (requests === null) failed.push({ label: 'Requests', href: '/requests' })
  else if (requests) {
    const rows = [...requests]
      .sort((a, b) => Number(!!b.aog) - Number(!!a.aog) || (a.created_at < b.created_at ? 1 : -1))
      .map<Row>((r) => ({
        key: `r-${r.id}`,
        href: '/requests',
        edge: r.aog ? 'stop' : 'wait',
        meta: (
          <>
            <span>New request</span>
            <span>{agoWords(r.created_at, now)}</span>
          </>
        ),
        title: r.name || 'No name given',
        sub: r.vehicle || (r.service_line === 'aviation' ? 'Aircraft' : 'Vehicle not given'),
        chip: r.aog ? (
          <span className="chip" style={{ background: 'var(--red)', color: '#fff' }}>
            AOG
          </span>
        ) : (
          <span className="chip chip-open">answer it</span>
        ),
      }))
    groups.push({ name: 'requests', ...cut(rows, '/requests', 'requests') })
  }

  // 2. Work that is done and has no bill. Its parts are already paid for.
  {
    const rows = toInvoice.map<Row>((it) => ({
      key: `j-${it.job.id}`,
      // The job's own top row has "Create invoice"; there is no invoice
      // section to land on until one exists.
      href: `/jobs/${it.job.id}`,
      edge: 'stop',
      meta: (
        <>
          <span className="wnt-id">{it.job.job_number}</span>
          <span>done {shortDate(it.job.date)}</span>
        </>
      ),
      title: it.job.title,
      sub: `${it.customer?.name ?? 'Unknown customer'} · ${vehicleLabel(it.vehicle)}`,
      amount: (
        <>
          {formatCents(it.totals?.total_charged_cents)}
          <span className="today-basis">before tax</span>
        </>
      ),
      chip: <span className="chip chip-unpaid">to invoice</span>,
    }))
    groups.push({ name: 'to invoice', ...cut(rows, '/billing?tab=toinvoice', 'to invoice') })
  }

  // 3. Invoices: overdue, then out, then written and never sent.
  if (invoices === null) failed.push({ label: 'Invoices', href: '/billing' })
  else if (invoices) {
    const rank = (i: OpenInvoice) =>
      i.status === 'sent' && i.due_date && i.due_date < today ? 0 : i.status === 'sent' ? 1 : 2
    const rows = [...invoices]
      .sort((a, b) => rank(a) - rank(b) || ((a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1))
      .map<Row>((inv) => {
        const overdue = inv.status === 'sent' && !!inv.due_date && inv.due_date < today
        const balance = Math.max(0, inv.total_cents - (paidByJob.get(inv.job_id) ?? 0))
        const lateDays = overdue ? calendarDays(inv.due_date as string, today) : 0
        return {
          key: `i-${inv.id}`,
          href: `/invoices/${inv.id}`,
          edge: overdue ? 'stop' : inv.status === 'sent' ? 'wait' : 'idle',
          meta: (
            <>
              <span className="wnt-id">{inv.invoice_number}</span>
              <span>
                {inv.status === 'draft'
                  ? 'not sent yet'
                  : inv.due_date
                    ? `due ${shortDate(inv.due_date)}`
                    : 'sent'}
              </span>
            </>
          ),
          title: inv.customer_name,
          sub: inv.job_title,
          amount: formatCents(balance),
          chip: overdue ? (
            <span className="chip chip-overdue">overdue {lateDays}d</span>
          ) : inv.status === 'sent' ? (
            <span className="chip chip-sent">unpaid</span>
          ) : (
            <span className="chip chip-draft">draft</span>
          ),
        }
      })
    groups.push({ name: 'invoices', ...cut(rows, '/billing', 'invoices') })
  }

  // 4. Quotes: out with no answer (longest wait first), then drafts.
  if (quotes === null) failed.push({ label: 'Quotes', href: '/jobs?tab=quotes' })
  else if (quotes) {
    const sentAt = (x: OpenQuote) => x.sent_at ?? x.created_at
    const rows = [...quotes]
      .sort((a, b) =>
        a.status !== b.status ? (a.status === 'sent' ? -1 : 1) : sentAt(a) < sentAt(b) ? -1 : 1,
      )
      .map<Row>((x) => ({
        key: `q-${x.id}`,
        href: `/quotes/${x.id}`,
        edge: x.status === 'sent' ? 'wait' : 'idle',
        meta: (
          <>
            <span className="wnt-id">{x.quote_number}</span>
            <span>{x.status === 'sent' ? `sent ${agoWords(sentAt(x), now)}` : 'not sent yet'}</span>
          </>
        ),
        title: x.title || 'Untitled quote',
        sub: x.customer_name || 'Unknown customer',
        amount: x.total_cents == null ? undefined : formatCents(x.total_cents),
        chip:
          x.status === 'sent' ? (
            <span className="chip chip-open">no answer</span>
          ) : (
            <span className="chip chip-draft">draft</span>
          ),
      }))
    groups.push({ name: 'quotes', ...cut(rows, '/jobs?tab=quotes', 'quotes') })
  }

  const loading = requests === undefined || invoices === undefined || quotes === undefined
  const total = groups.reduce((s, g) => s + g.rows.length + (g.more?.n ?? 0), 0)

  return (
    <section className="today-sec waiting" aria-labelledby="waiting-title">
      <div className="today-head">
        <h2 id="waiting-title" className="section-title">
          Waiting on you{total > 0 ? ` · ${total}` : ''}
        </h2>
      </div>

      {groups.map((g) =>
        g.rows.length === 0 ? null : (
          <div key={g.name} className="today-group">
            {g.rows.map((r) => (
              <Link
                key={r.key}
                href={r.href}
                className="card flex items-center gap-3 !py-3"
                style={{ borderLeft: `var(--edge-width) solid ${EDGE[r.edge]}` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="today-meta">{r.meta}</div>
                  <div className="truncate font-semibold">{r.title}</div>
                  <div className="truncate text-sm" style={{ color: 'var(--text2)' }}>
                    {r.sub}
                  </div>
                </div>
                <div className="flex-none text-right">
                  {r.amount != null && <div className="money font-semibold">{r.amount}</div>}
                  {r.chip}
                </div>
              </Link>
            ))}
            {g.more && (
              <Link href={g.more.href} className="today-more">
                {g.more.n} {g.more.label} →
              </Link>
            )}
          </div>
        ),
      )}

      {/* A read that failed says so and points at the page that has the list.
          It never falls through to "nothing is waiting". */}
      {failed.map((x) => (
        <Link key={x.label} href={x.href} className="card today-empty today-failed">
          {x.label} could not be loaded here. Open {x.label} →
        </Link>
      ))}

      {total === 0 && failed.length === 0 && (
        <div className="card today-empty">{loading ? 'Checking…' : 'Nothing is waiting on you.'}</div>
      )}
    </section>
  )
}
