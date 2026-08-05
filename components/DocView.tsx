'use client'

import DocBrand from '@/components/DocBrand'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/date'
import { formatTaxRate } from '@/lib/billing'
import type { DocLine } from '@/lib/types'

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
  business: { name: string; phone: string; address: string; email: string }
}

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
  /** Dates inside the due-card sub line wrap as a unit, never mid-date. */
  const nbsp = (s: string) => s.replace(/ /g, ' ')
  const isSettled = !isQuote && (doc.paidDate != null || (paid > 0 && paid >= doc.totalCents))
  const isVoid = doc.status === 'void'
  const balanceCents = Math.max(0, doc.totalCents - paid)

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

  const footRef = isVoid
    ? `${doc.number} · void`
    : isQuote
      ? `${doc.number} · estimated ${formatCents(doc.totalCents)}`
      : isSettled
        ? `${doc.number} · paid in full`
        : `${doc.number} · ${formatCents(balanceCents)} due${doc.secondaryDate ? ` ${formatDate(doc.secondaryDate)}` : ''}`

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
                  <td className="doc-desc">{l.description}</td>
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
              <span className="doc-memo-label">Memo</span>
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
          </div>
        </div>

        <footer className="doc-foot">
          {isQuote ? (
            <p>
              This is an estimate. Final billing reflects actual parts and labor; you&apos;ll be
              contacted before any significant change.
            </p>
          ) : doc.paymentInstructions ? (
            <p>
              <b>Payment:</b> {doc.paymentInstructions}
            </p>
          ) : (
            <p />
          )}
          <p className="doc-foot-ref">{footRef}</p>
        </footer>
      </div>
    </div>
  )
}
