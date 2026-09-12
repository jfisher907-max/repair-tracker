'use client'

import Link from 'next/link'
import { useState } from 'react'
import { formatCents } from '@/lib/money'
import { vehicleLabel } from '@/lib/types'
import {
  coreDepositTotalCents,
  coreState,
  setCoreOutcome,
  summarizeCores,
  watchCore,
  type CoreOut,
  type CoreOutcome,
  type CoreWriteResult,
} from '@/lib/cores'

/** Settled this recently and it can still be undone from here. */
const UNDO_WINDOW_DAYS = 14

/**
 * The core-deposit worklist.
 *
 * A core is the shop's money until the old unit goes back AND the supplier
 * accepts it, so this tracks both halves. The customer never pays a core —
 * the one exception is a core the store DENIES, which can go on that job's
 * bill at face value. The tally at the bottom is what cores have actually cost.
 */
export default function CoreDeposits({
  cores,
  onChanged,
}: {
  cores: CoreOut[]
  onChanged: () => Promise<void>
}) {
  /** Which core is mid-denial: the row asks bill-or-absorb before it writes. */
  const [denying, setDenying] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  /** Every action goes through one writer, so every outcome reports the same way. */
  async function apply(c: CoreOut, outcome: CoreOutcome, headline: string) {
    setBusy(c.id)
    try {
      const r: CoreWriteResult = await setCoreOutcome(c, outcome)
      setDenying(null)
      setMsg(
        [
          headline,
          r.creditAlreadyBooked
            ? 'The store’s credit slip is already a line on this job, so the deposit was left as it is.'
            : '',
          r.overApproval
            ? 'That puts the job over what the customer approved — record their OK on the job before invoicing it.'
            : '',
          r.approvalUnknown
            ? 'Couldn’t check the job against its approved estimate just now — check it on the job before you invoice.'
            : '',
          r.draftInvoice ? `${r.draftInvoice} was updated to match.` : '',
          r.draftBlocked ?? '',
        ]
          .filter(Boolean)
          .join(' '),
      )
      await onChanged()
    } catch (e) {
      alert(`Couldn't update the core: ${e instanceof Error ? e.message : e}`)
    }
    setBusy(null)
  }

  if (cores.length === 0) return null

  const ledger = summarizeCores(cores)
  const watched = cores.map((c) => ({ core: c, watch: watchCore(c) }))
  // Anything still needing a decision, worst first: a core wrongly on the
  // customer's bill outranks everything, then overdue, then oldest.
  const open = watched
    .filter((x) => x.watch.wronglyBilled || x.watch.state === 'out' || x.watch.state === 'awaiting_credit')
    .sort(
      (a, b) =>
        Number(b.watch.wronglyBilled) - Number(a.watch.wronglyBilled) ||
        Number(b.watch.overdue) - Number(a.watch.overdue) ||
        b.watch.days - a.watch.days,
    )
  // Settled recently enough that a mis-tap can still be taken back.
  const undoable = watched.filter(
    (x) =>
      !x.watch.wronglyBilled &&
      (x.watch.state === 'credited' || x.watch.state === 'denied') &&
      x.watch.days <= UNDO_WINDOW_DAYS,
  )
  const outCents = ledger.out.cents + ledger.awaitingCredit.cents
  const settled = ledger.credited.count + ledger.deniedAbsorbed.count + ledger.deniedBilled.count
  // Cores belong to a job, so they are listed under it: the job is the door and
  // the cores hang beneath it. Groups keep the worst-first order of their
  // first row, so a job with a wrongly billed core still leads the card.
  const groups: { key: string; job: CoreOut['job']; rows: typeof open }[] = []
  for (const x of open) {
    const key = x.core.job?.id ?? x.core.job_id
    let g = groups.find((it) => it.key === key)
    if (!g) {
      g = { key, job: x.core.job, rows: [] }
      groups.push(g)
    }
    g.rows.push(x)
  }

  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <span className="label !mb-0">Core deposits</span>
        {/* A core on a customer's bill is never "settled" and is never money
            the shop is owed, so it leads the header in its own right — the
            wrongly-billed bucket sat in no total and the card could print
            "all settled" directly above a live violation. */}
        <span
          className="money text-sm font-bold"
          style={{
            color:
              ledger.wronglyBilled.cents > 0
                ? 'var(--status-stop-fg)'
                : outCents > 0
                  ? 'var(--status-wait-fg)'
                  : 'var(--text3)',
          }}
        >
          {ledger.wronglyBilled.cents > 0
            ? `${formatCents(ledger.wronglyBilled.cents)} on a customer’s bill`
            : outCents > 0
              ? `${formatCents(outCents)} out`
              : 'all settled'}
        </span>
      </div>

      {groups.map((g) => (
        <section
          key={g.key}
          className="core-job"
          aria-label={g.job ? `Cores on ${g.job.job_number}` : 'Cores with no job'}
          style={{
            borderLeftColor: g.rows.some((r) => r.watch.wronglyBilled || r.watch.overdue)
              ? 'var(--status-stop-solid)'
              : 'var(--status-wait-solid)',
          }}
        >
          <JobHead job={g.job} count={g.rows.reduce((n, r) => n + (Number(r.core.qty) || 1), 0)} />
          {g.rows.map(({ core: c, watch }) => {
        const deposit = coreDepositTotalCents(c)
        const state = coreState(c)
        return (
          <div key={c.id} className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <span className="font-semibold">{c.description}</span>{' '}
                <span style={{ color: 'var(--text3)' }}>
                  {[
                    Number(c.qty) > 1 ? `×${Number(c.qty)}` : '',
                    c.store,
                    watch.days > 0 ? `${watch.days}d` : 'today',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <div
                  className="text-xs"
                  style={{
                    color: watch.wronglyBilled || watch.overdue ? 'var(--status-stop-fg)' : 'var(--text3)',
                  }}
                >
                  {watch.wronglyBilled
                    ? 'On the customer’s bill — a core only goes on a bill when the store denies it'
                    : watch.next}
                </div>
              </div>
              <div className="flex flex-none items-center gap-2">
                <span className="money">{formatCents(deposit)}</span>
                {watch.wronglyBilled ? (
                  <>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={busy === c.id}
                      onClick={() =>
                        apply(
                          c,
                          state === 'credited' ? 'credited' : state === 'awaiting_credit' ? 'awaiting_credit' : 'out',
                          `${formatCents(deposit)} taken off ${c.job?.job_number ?? 'the job'}’s bill.`,
                        )
                      }
                    >
                      Take it off the bill
                    </button>
                    {/* Never offered on a core the store already CREDITED:
                        calling that a denial would erase a real refund and
                        report the customer's money as recovered from a denial. */}
                    {state !== 'credited' && (
                      <button
                        className="btn btn-sm"
                        disabled={busy === c.id}
                        onClick={() =>
                          apply(c, 'denied_billed', `${formatCents(deposit)} kept on ${c.job?.job_number ?? 'the job'} as a denied core.`)
                        }
                      >
                        It was denied
                      </button>
                    )}
                  </>
                ) : watch.state === 'out' ? (
                  <>
                    {/* The credit usually lands at the counter, so the common
                        case is one tap. The two-step is for when it doesn't. */}
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={busy === c.id}
                      onClick={() => apply(c, 'credited', `${formatCents(deposit)} back from ${c.store ?? 'the store'} ✓`)}
                    >
                      ✓ Back &amp; credited
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy === c.id}
                      onClick={() => apply(c, 'awaiting_credit', `${c.description} marked handed back.`)}
                    >
                      No credit yet
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-sm"
                      disabled={busy === c.id}
                      onClick={() => apply(c, 'credited', `${formatCents(deposit)} back from ${c.store ?? 'the store'} ✓`)}
                    >
                      ✓ Credit landed
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy === c.id}
                      onClick={() => setDenying(denying === c.id ? null : c.id)}
                    >
                      ⊘ Denied
                    </button>
                  </>
                )}
              </div>
            </div>
            {denying === c.id && (
              <div
                className="panel-in flex flex-wrap items-center gap-2 rounded p-2 text-xs"
                style={{ background: 'var(--surface-sunken)' }}
              >
                <span style={{ color: 'var(--text2)' }}>
                  The store refused it — who covers the {formatCents(deposit)}?
                </span>
                <button
                  className="btn btn-sm"
                  disabled={busy === c.id}
                  onClick={() =>
                    apply(c, 'denied_billed', `${formatCents(deposit)} charged to ${c.job?.job_number ?? 'the job'} at cost.`)
                  }
                >
                  Bill {c.job?.job_number ?? 'the job'}
                </button>
                <button
                  className="btn btn-sm"
                  disabled={busy === c.id}
                  onClick={() =>
                    apply(c, 'denied_absorbed', `${formatCents(deposit)} absorbed — it stays your cost on ${c.job?.job_number ?? 'the job'}.`)
                  }
                >
                  Absorb it
                </button>
                <button className="btn btn-sm" onClick={() => setDenying(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )
      })}
        </section>
      ))}

      {msg && (
        <p className="flash-in text-xs" style={{ color: 'var(--text2)' }} role="status">
          {msg}
        </p>
      )}

      {undoable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text3)' }}>
          <span>Just settled:</span>
          {undoable.map(({ core: c, watch }) => (
            <button
              key={c.id}
              className="btn btn-sm"
              disabled={busy === c.id}
              title={`Put ${c.description} back on the list`}
              onClick={() =>
                apply(c, 'out', `${c.description} is back on the list as still out.`)
              }
            >
              ↺ {watch.state === 'credited' ? 'credited' : 'denied'} {formatCents(coreDepositTotalCents(c))}
              {c.job?.job_number ? ` · ${c.job.job_number}` : ''}
            </button>
          ))}
        </div>
      )}

      {settled > 0 && (
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          Settled: {formatCents(ledger.credited.cents)} credited back
          {ledger.deniedAbsorbed.count > 0 && (
            <> · {formatCents(ledger.deniedAbsorbed.cents)} absorbed</>
          )}
          {ledger.deniedBilled.count > 0 && <> · {formatCents(ledger.deniedBilled.cents)} billed on</>}
        </p>
      )}

      <p className="text-xs" style={{ color: 'var(--text3)' }}>
        A core is your deposit, not the customer&apos;s charge, and it stops counting as a cost
        once the store credits it back. Only a core the store denies ever goes on a bill.
      </p>
    </div>
  )
}

/** The job a group of cores belongs to: gold id, title, who and what — and a door to it. */
function JobHead({ job, count }: { job: CoreOut['job']; count: number }) {
  const units = `${count} core${count === 1 ? '' : 's'}`
  if (!job) {
    return (
      <div className="core-job-head">
        <span className="font-semibold">No job attached</span>
        <span className="ml-auto text-xs" style={{ color: 'var(--text3)' }}>{units}</span>
      </div>
    )
  }
  return (
    <Link href={`/jobs/${job.id}`} className="core-job-head">
      <span className="wnt-id text-xs">{job.job_number}</span>
      <span className="min-w-0 truncate font-semibold">{job.title}</span>
      <span className="min-w-0 truncate text-sm" style={{ color: 'var(--text2)' }}>
        {job.vehicle?.customer?.name ?? 'Unknown customer'} · {vehicleLabel(job.vehicle)}
      </span>
      <span className="ml-auto flex-none text-xs" style={{ color: 'var(--text3)' }}>
        {units} →
      </span>
    </Link>
  )
}
