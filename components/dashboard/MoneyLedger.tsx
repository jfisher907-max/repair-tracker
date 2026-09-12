'use client'

import type { CSSProperties, ReactNode } from 'react'
import type { Finances } from '@/lib/finances'
import { money, plural } from './format'

/**
 * How the money moves from what was billed to what is cash profit, and where
 * the work earned it. Every figure comes from Finances and every step adds on
 * screen: a row that is a sum IS the sum of the rows above it.
 *
 * Work is DONE jobs only (0043). Booked work is the dashboard's Scheduled
 * door's job, not the ledger's: the ledger keeps to money that exists. The
 * two places booked work touches real money — a deposit paid ahead, parts
 * bought ahead — are named here so the chain and the bridge still add.
 *
 * Shared with the Billing page, so the two can never tell a different story.
 */
export default function MoneyLedger({
  f,
  year,
  id,
  card = true,
  now = new Date(),
  hidden = false,
}: {
  f: Finances
  year: 'all' | number
  /** The id the Cash profit tile's aria-controls points at. */
  id?: string
  /** Render as a board card (default) or bare, for a host that has its own surface. */
  card?: boolean
  /** The board's one clock, so "this year" agrees with the tiles beside it. */
  now?: Date
  /** Kept in the DOM but not shown: the toggle's aria-controls still resolves. */
  hidden?: boolean
}) {
  const thisYear = now.getFullYear()
  const scopeWords = year === 'all' ? 'all time' : year === thisYear ? 'this year' : `in ${year}`

  // Billed and owed follow the JOB's date; payments follow the day they landed.
  // Across a year boundary the two drift, and the drift is shown as its own
  // line rather than hidden in a total that no longer adds. A deposit held on
  // work not started is cash that settles nothing billed yet, so it sits on
  // its own line after "collected on the work" and is not timing.
  const collectedOnWork = f.collected - f.taxCollected - f.depositsOnBooked
  const timing = collectedOnWork - (f.charged - f.unpaid)
  // Earned − owed equals cash profit only when the parts on this scope's jobs
  // are the parts bought in this scope — true inside a year, not across one —
  // once the cash that belongs to booked work (parts bought ahead, deposits
  // held) is named. Written from the same figures the rows above use.
  const bridgeGap = f.earned - f.unpaid - f.partsSpendOnBooked + f.depositsOnBooked - f.cashProfit
  const hasBookedCash = f.partsSpendOnBooked > 0 || f.depositsOnBooked > 0
  // Sales tax the state is owed comes in two ways: charged on a tax line, or
  // hidden inside a total that went out with no tax line (the owner's rule:
  // 5% of what those customers paid is the state's). Both add to the same
  // "held for the state" figure; the split is shown so the second kind is
  // never mistaken for money the shop kept. The invoice COUNT belongs only on
  // the job-dated "Billed" caption: the collected-side amounts follow payment
  // dates, and last year's untaxed job paid this year would show "0 invoices"
  // beside a real amount.
  const taxChargedCollected = f.taxCollected - f.taxIncludedCollected
  const taxNotYetCollected = f.taxBilled - f.taxCollected

  const laborShare = f.earned > 0 ? Math.max(0, Math.min(1, f.laborCharged / f.earned)) : 0
  const partsShare = f.earned > 0 ? Math.max(0, Math.min(1 - laborShare, f.partsMarkup / f.earned)) : 0
  const pctWords = (x: number) => `${Math.round(x * 100)}%`

  const partsCap = [
    'your cost, counted when bought',
    f.owedJobs > 0 ? `includes the parts on the ${plural(f.owedJobs, 'unpaid job')}` : '',
    f.partsSpendOnBooked > 0 ? `and ${money(f.partsSpendOnBooked)} bought for scheduled work` : '',
  ]
    .filter(Boolean)
    .join('; ')
    .replace('; and ', ' and ')

  const body = (
    <div className="ledger-grid">
      <div className="ledger-block" aria-label="How the money moves from billed to cash profit">
        <span className="label">From billed to cash profit</span>
        <Row
          op=""
          label="Billed to customers, before sales tax"
          cap={`${plural(f.count, 'job')} done and dated ${scopeWords}, paid or not${
            f.taxIncludedBilled > 0
              ? `; net of the ${money(f.taxIncludedBilled)} sales tax inside ${plural(f.taxIncludedInvoices, 'untaxed total')}`
              : ''
          }`}
          amount={f.charged}
        />
        <Row
          op="−"
          label="Still owed to you"
          cap={
            f.owedJobs === 0
              ? 'nothing outstanding'
              : `${plural(f.owedJobs, 'job')}, ${f.uninvoicedJobs === 0 ? 'all invoiced' : f.uninvoicedJobs === f.owedJobs ? 'none invoiced yet' : `${f.uninvoicedJobs} not invoiced yet`}`
          }
          amount={-f.unpaid}
          tone={f.unpaid > 0 ? 'owed' : undefined}
        />
        {timing !== 0 && (
          <Row
            op={timing > 0 ? '+' : '−'}
            label="Paid in a different year from the job"
            cap="payments count on the day they landed; billed and owed on the job's date"
            amount={timing}
          />
        )}
        <Row op="=" label="Collected on the work, before tax" amount={collectedOnWork} sum />
        {f.depositsOnBooked > 0 && (
          <Row
            op="+"
            label="Deposits held on scheduled work"
            cap="paid ahead on jobs not started; it is theirs until the work is done"
            amount={f.depositsOnBooked}
          />
        )}
        <Row op="+" label="Sales tax the customers paid on top" cap="charged on a tax line; rides along inside the payments" amount={taxChargedCollected} />
        {f.taxIncludedCollected > 0 && (
          <Row
            op="+"
            label="Sales tax included in untaxed totals"
            cap="on invoices that went out with no tax line; 5% of what those customers paid is the state's"
            amount={f.taxIncludedCollected}
          />
        )}
        <Row op="=" label="Payments received" cap="what actually landed, by payment date" amount={f.collected} sum tone="in" />
        <Row op="−" label="Parts and counter tax you paid" cap={partsCap} amount={-f.partsSpend} />
        <Row
          op="−"
          label="Sales tax held for the state"
          cap={f.taxIncludedCollected > 0 ? 'the state’s money, never yours: charged on top and included in untaxed totals' : 'the state’s money, never yours'}
          amount={-f.taxCollected}
        />
        <Row op="=" label="Cash profit, before overhead" amount={f.cashProfit} sum total tone={f.cashProfit >= 0 ? 'in' : 'owed'} />
        {f.overhead > 0 && (
          <>
            <Row op="−" label="Overhead (expenses)" cap="rent, tools, insurance — spending that is not parts for a job" amount={-f.overhead} />
            <Row op="=" label="After overhead" amount={f.cashProfit - f.overhead} sum tone={f.cashProfit - f.overhead >= 0 ? 'in' : 'owed'} />
          </>
        )}
        <p className="ledger-bridge">
          {/* Every piece below is a Finances figure; the sentence is the bridge
              identity written out, naming the booked-work pieces only when
              they are not zero, so it is true by construction. */}
          Earned <b>{money(f.earned)}</b> less the <b>{money(f.unpaid)}</b> still owed
          {f.partsSpendOnBooked > 0 && (
            <>
              , less the <b>{money(f.partsSpendOnBooked)}</b> of parts bought for scheduled work
            </>
          )}
          {f.depositsOnBooked > 0 && (
            <>
              , plus the <b>{money(f.depositsOnBooked)}</b> held as deposits on scheduled work
            </>
          )}
          {bridgeGap === 0 ? (
            hasBookedCash ? (
              <>
                {' '}is <b>{money(f.cashProfit)}</b>, the cash profit: it adds to the cent.
                {f.owedJobs > 0 && ' The parts on the unpaid jobs are already bought.'}
              </>
            ) : (
              <>
                {' '}is <b>{money(f.cashProfit)}</b>: the two big figures agree to the cent.
                {f.owedJobs > 0 && ' The parts on the unpaid jobs are already bought.'}
              </>
            )
          ) : (
            <>
              {' '}is <b>{money(f.earned - f.unpaid - f.partsSpendOnBooked + f.depositsOnBooked)}</b>; cash profit is <b>{money(f.cashProfit)}</b>. The <b>{money(Math.abs(bridgeGap))}</b> between them is timing — parts bought, or payments landing, in a different year from their job.
            </>
          )}
        </p>
      </div>

      <div className="ledger-block" aria-label="Where the work earned its money">
        <span className="label">Where it was earned</span>
        <Row op="" label="Labor billed" cap={`${(Math.round(f.hours * 10) / 10).toFixed(1)} hr sold on ${plural(f.count, 'job')} done`} amount={f.laborCharged} />
        <Row op="" label="Parts billed" amount={f.partsCharged} />
        <Row op="−" label="What the parts cost you" cap="counter tax included" amount={-f.partsCostOnJobs} />
        <Row op="=" label="Parts margin" amount={f.partsMarkup} sum />
        {f.earned > 0 && f.laborCharged >= 0 && f.partsMarkup >= 0 && (
          <>
            <div
              className="split-bar"
              role="img"
              aria-label={`Labor ${pctWords(laborShare)} of what the work earned, parts margin ${pctWords(partsShare)}`}
            >
              <i className="split-labor" style={{ '--w': `${(laborShare * 100).toFixed(2)}%`, '--i': 0 } as CSSProperties} />
              <i className="split-parts" style={{ '--w': `${(partsShare * 100).toFixed(2)}%`, '--i': 1 } as CSSProperties} />
            </div>
            <div className="split-labels" aria-hidden="true">
              <span>
                <i className="legend-sw sw-labor" />
                Labor {pctWords(laborShare)} · <b>{money(f.laborCharged)}</b>
              </span>
              <span>
                <i className="legend-sw sw-parts" />
                Parts margin {pctWords(partsShare)} · <b>{money(f.partsMarkup)}</b>
              </span>
            </div>
          </>
        )}
        {/* Overhead is taken off once, after cash profit in the first block. */}
        <Row op="=" label="Earned on the work" cap="labor plus parts margin on the jobs done, paid or not, before overhead" amount={f.earned} sum total tone={f.earned >= 0 ? 'in' : 'owed'} />
      </div>

      {/* The state's money, shown as what it is: a figure you owe, not a
          subtraction buried mid-chain. Same number as the "held for the
          state" line above; Reports breaks it down by filing quarter. */}
      <div className="ledger-block" aria-label="Sales tax owed to the state">
        <span className="label">Owed to the state</span>
        <Row
          op=""
          label="Sales tax collected, to remit"
          cap="5% on the paid share of each invoice; it rode in with the payments and is the state's money"
          amount={f.taxCollected}
          sum
          total
        />
        {taxNotYetCollected > 0 && (
          <Row
            op=""
            label="Billed, not collected yet"
            cap="tax on invoices still unpaid; it moves to the line above when those customers pay"
            amount={taxNotYetCollected}
          />
        )}
        <p className="ledger-bridge">
          The gross figure for {year === 'all' ? 'all time' : year}. Reports has it by filing quarter. Remittances are not
          recorded here yet, so nothing is taken off for returns already filed.
        </p>
      </div>
    </div>
  )

  if (!card) return <div id={id} hidden={hidden}>{body}</div>
  return (
    <section id={id} className="card ledger-card" aria-label="The money ledger" hidden={hidden}>
      {body}
    </section>
  )
}

/** One line of the ledger: operator, label with its plain-words caption, amount. */
function Row({
  op,
  label,
  cap,
  amount,
  sum,
  total,
  tone,
}: {
  op: '' | '+' | '−' | '='
  label: ReactNode
  cap?: ReactNode
  amount: number
  sum?: boolean
  total?: boolean
  tone?: 'in' | 'owed'
}) {
  return (
    <div className={`lrow${sum ? ' sum' : ''}${total ? ' total' : ''}`}>
      <span className="lop" aria-hidden="true">
        {op}
      </span>
      <span className="llabel">
        {label}
        {cap && <small>{cap}</small>}
      </span>
      <span className={`lamt money${tone ? ` money-${tone}` : ''}`}>{money(amount)}</span>
    </div>
  )
}
