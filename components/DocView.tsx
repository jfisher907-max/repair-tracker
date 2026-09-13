'use client'

import DocBrand from '@/components/DocBrand'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/date'
import { formatTaxRate } from '@/lib/billing'
import type { AuthorizationEntry, DocLine, PartCondition } from '@/lib/types'

export interface DocData {
  docType: 'Quote' | 'Invoice'
  number: string
  status: string
  date: string
  /** Quote: valid-until. Invoice: due date. */
  secondaryDate: string | null
  customerName: string
  vehicleLabel: string
  title: string
  bodyText: string | null
  lines: DocLine[]
  laborHours: number
  laborRateCents: number
  laborCents: number
  linesCents: number
  taxRateBp: number
  taxCents: number
  totalCents: number
  memo: string | null
  paymentInstructions: string | null
  paidDate: string | null
  /** Partial payments received so far (invoices) — renders Paid / Balance due rows. */
  paidCents?: number
  /** Quote: deposit due on approval (the resolved figure). */
  depositCents?: number | null
  /** Invoice: the approvals behind the bill, frozen with it (AS 45.45.170(d)). */
  authorizations?: AuthorizationEntry[]
  business: { name: string; phone: string; address: string; email: string }
}

const CONDITION_LABEL: Record<PartCondition, string> = {
  new: 'New',
  used: 'Used',
  rebuilt: 'Rebuilt',
  reconditioned: 'Reconditioned',
}

const METHOD_LABEL: Record<string, string> = {
  online: 'online',
  phone: 'by phone',
  in_person: 'in person',
  text: 'by text',
}

/** AS 45.45.170(d) wants the date AND the time of an OK — in shop time. */
function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    timeZone: 'America/Anchorage',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** AS 45.45.210: printed conspicuously on the invoice, word for word. */
const REPAIR_ACT_NOTICE =
  'Motor vehicle repair trade practices are regulated by Alaska Statutes 45.45.130 - 45.45.240, administered by the Alaska Department of Law.'

/**
 * The customer-facing quote/invoice document ("Bold Brand" template).
 * Shared by the owner's print pages and the public token pages, so both
 * always render identically. Charge basis only — costs and profit never
 * appear here.
 */
export default function DocView({ doc }: { doc: DocData }) {
  const isQuote = doc.docType === 'Quote'
  const showLinePrices = doc.lines.length > 1 || doc.lines.some((l) => Number(l.qty) !== 1)

  const paid = doc.paidCents ?? 0
  /** Dates inside the due-card sub line wrap as a unit, never mid-date.
   *  String.fromCharCode(160), never a literal non-breaking space: the
   *  literal was flattened to an ordinary space once already, which left
   *  this replacing a space with a space and quietly doing nothing. */
  const nbsp = (s: string) => s.replace(/ /g, String.fromCharCode(160))
  const isSettled = !isQuote && (doc.paidDate != null || (paid > 0 && paid >= doc.totalCents))
  const isVoid = doc.status === 'void'
  const balanceCents = Math.max(0, doc.totalCents - paid)
  const trail = !isQuote ? (doc.authorizations ?? []) : []

  // The charcoal card carries the one number that matters: what the
  // customer owes (invoice), what the work will run (quote), or PAID.
  const card = isVoid
    ? null
    : isQuote
      ? {
          settled: false,
          label: 'Estimated total',
          sub: doc.secondaryDate ? `valid until ${nbsp(formatDate(doc.secondaryDate))}` : null,
          amount: doc.totalCents,
        }
      : isSettled
        ? {
            settled: true,
            label: 'Paid in full',
            sub: doc.paidDate ? `received ${nbsp(formatDate(doc.paidDate))}` : null,
            amount: doc.totalCents,
          }
        : {
            settled: false,
            label: 'Balance due',
            sub: doc.secondaryDate ? `by ${nbsp(formatDate(doc.secondaryDate))}` : null,
            amount: balanceCents,
          }

  return (
    <div className="doc-root">
      <DocBrand business={doc.business} docType={doc.docType} docRef={doc.number} badge={doc.status} />

      <div className="doc-body">
        <dl className="doc-meta">
          <div>
            <dt>{isQuote ? 'Prepared for' : 'Billed to'}</dt>
            <dd>{doc.customerName}</dd>
          </div>
          {doc.vehicleLabel && (
            <div>
              <dt>Vehicle</dt>
              <dd>{doc.vehicleLabel}</dd>
            </div>
          )}
          <div>
            <dt>{isQuote ? 'Quote date' : 'Issue date'}</dt>
            <dd>{formatDate(doc.date)}</dd>
          </div>
          {doc.secondaryDate && (
            <div>
              <dt>{isQuote ? 'Valid until' : 'Due date'}</dt>
              <dd>{formatDate(doc.secondaryDate)}</dd>
            </div>
          )}
        </dl>

        <div className="doc-job">
          <h2>{doc.title}</h2>
          {doc.bodyText && <p>{doc.bodyText}</p>}
        </div>

        {doc.lines.length > 0 && (
          <table className="doc-table">
            <thead>
              <tr>
                <th>Description</th>
                <th className="doc-n">Qty</th>
                {showLinePrices && (
                  <>
                    <th className="doc-n">Unit</th>
                    <th className="doc-n">Amount</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={i}>
                  <td className="doc-desc">
                    {l.description}
                    {/* AS 45.45.190: each part replaced is identified as new,
                        used, rebuilt or reconditioned. Its own small word —
                        never appended to the description text. */}
                    {l.condition && <span className="doc-cond">{CONDITION_LABEL[l.condition]}</span>}
                  </td>
                  <td className="doc-n doc-dim">{Number(l.qty)}</td>
                  {showLinePrices && (
                    <>
                      <td className="doc-n doc-dim">{formatCents(l.unit_charge_cents)}</td>
                      <td className="doc-n">{formatCents(l.line_total_cents)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="doc-settle">
          {doc.memo && (
            <div className="doc-memo">
              <span className="doc-memo-label">Notes</span>
              <p>{doc.memo}</p>
            </div>
          )}
          <div className="doc-totals">
            {doc.linesCents !== 0 && (
              <div className="doc-trow">
                <span className="doc-tl">Parts</span>
                <span className="doc-tv">{formatCents(doc.linesCents)}</span>
              </div>
            )}
            {doc.laborCents !== 0 && (
              <div className="doc-trow">
                <span className="doc-tl">
                  Labor
                  {doc.laborHours > 0 && <> · {Number(doc.laborHours)} hr @ {formatCents(doc.laborRateCents)}/hr</>}
                </span>
                <span className="doc-tv">{formatCents(doc.laborCents)}</span>
              </div>
            )}
            {doc.taxRateBp > 0 && (
              <div className="doc-trow">
                <span className="doc-tl">Sales tax ({formatTaxRate(doc.taxRateBp)})</span>
                <span className="doc-tv">{formatCents(doc.taxCents)}</span>
              </div>
            )}
            {!isQuote && (
              <div className="doc-trow doc-total">
                <span className="doc-tl">Total</span>
                <span className="doc-tv">{formatCents(doc.totalCents)}</span>
              </div>
            )}
            {!isQuote && paid > 0 && paid < doc.totalCents && (
              <div className="doc-trow doc-paid">
                <span className="doc-tl">Paid to date</span>
                <span className="doc-tv">−{formatCents(paid)}</span>
              </div>
            )}
            {card && (
              <div className={`doc-due-card${card.settled ? ' doc-settled' : ''}`}>
                <div>
                  <span className="doc-due-label">{card.label}</span>
                  {card.sub && <span className="doc-due-sub">{card.sub}</span>}
                </div>
                <div className="doc-due-amt">{formatCents(card.amount)}</div>
              </div>
            )}
            {isQuote && (doc.depositCents ?? 0) > 0 && (
              <div className="doc-trow doc-paid">
                <span className="doc-tl">Deposit due on approval</span>
                <span className="doc-tv">{formatCents(doc.depositCents ?? 0)}</span>
              </div>
            )}
          </div>
        </div>

        {trail.length > 0 && (
          <div className="doc-auth">
            <span className="doc-memo-label">Authorized</span>
            <ul>
              {trail.map((a, i) => (
                <li key={i}>
                  {formatWhen(a.at)} — {a.label}
                  {a.by_name && <> by {a.by_name}</>}
                  {a.method && (
                    <>
                      {' '}
                      ({METHOD_LABEL[a.method] ?? a.method}
                      {a.phone_called && <>, called {a.phone_called}</>})
                    </>
                  )}
                  {' · '}
                  {formatCents(a.amount_cents)} before tax
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="doc-foot">
          {isQuote ? (
            /* Mirrors the posted notice AS 45.45.150 requires: the estimate is
               a ceiling, never exceeded without the customer's OK (AS 45.45.140
               and .170 — Alaska has no percentage grace, so the app enforces it
               and this sentence states it).

               The wording is the owner's (2026-09-13), raised to a more formal
               register. Two things it must not become. Not a bare "prices are
               subject to change": that would put a claim on a customer document
               that Alaska does not allow and the app does not do, and room for
               prices to move comes from the expiry in the meta row above, not
               from disclaiming the ceiling. And no promise that the bill may
               come in LOWER — the owner will happily bill under the estimate
               when he can, but he does not want the customer arriving expecting
               it. The ceiling is stated; the floor is not. */
            <p>
              This is a written estimate, valid until the date shown above. The final price will
              not exceed it without your authorization.
            </p>
          ) : (
            <>
              {doc.paymentInstructions && (
                <p>
                  <b>Payment:</b> {doc.paymentInstructions}
                </p>
              )}
              <p className="doc-legal">{REPAIR_ACT_NOTICE}</p>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
