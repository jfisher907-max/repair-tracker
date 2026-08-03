'use client'

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
  business: { name: string; phone: string; address: string; email: string }
}

/**
 * The customer-facing quote/invoice document. Shared by the owner's print
 * pages and the public token pages, so both always render identically.
 * Charge basis only — costs and profit never appear here.
 */
export default function DocView({ doc }: { doc: DocData }) {
  const contact = [doc.business.phone, doc.business.address, doc.business.email]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' · ')
  const showLinePrices = doc.lines.length > 1 || doc.lines.some((l) => Number(l.qty) !== 1)

  return (
    <div className="report-root mx-auto max-w-[8.5in] px-8 py-10">
      <header>
        {doc.business.name ? (
          <>
            <h1 className="text-3xl font-bold">{doc.business.name}</h1>
            <div className="mt-1 text-lg" style={{ color: '#374151' }}>
              {doc.docType} {doc.number}
            </div>
          </>
        ) : (
          <h1 className="text-3xl font-bold">
            {doc.docType} {doc.number}
          </h1>
        )}
        {contact && (
          <div className="mt-0.5 text-sm" style={{ color: '#4b5563' }}>{contact}</div>
        )}
        <hr className="report-rule" />
        <div className="report-meta grid grid-cols-2 gap-x-8 gap-y-0.5 sm:grid-cols-4">
          <div><b>Customer:</b> {doc.customerName}</div>
          {doc.vehicleLabel && <div><b>Vehicle:</b> {doc.vehicleLabel}</div>}
          <div><b>{doc.docType === 'Quote' ? 'Quote date' : 'Invoice date'}:</b> {formatDate(doc.date)}</div>
          {doc.secondaryDate && (
            <div>
              <b>{doc.docType === 'Quote' ? 'Valid until' : 'Due'}:</b> {formatDate(doc.secondaryDate)}
            </div>
          )}
          {doc.paidDate && (
            <div style={{ color: '#166534' }}><b>PAID</b> {formatDate(doc.paidDate)}</div>
          )}
        </div>
      </header>

      <main className="mt-6">
        <h2 className="text-lg font-bold">{doc.title}</h2>
        {doc.bodyText && (
          <p className="mt-1.5 whitespace-pre-wrap text-[0.92rem]">{doc.bodyText}</p>
        )}

        {doc.lines.length > 0 && (
          <table className="report-table">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num" style={{ width: '10%' }}>Qty</th>
                {showLinePrices && (
                  <>
                    <th className="num" style={{ width: '15%' }}>Unit</th>
                    <th className="num" style={{ width: '15%' }}>Amount</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.description}</td>
                  <td className="num">{Number(l.qty)}</td>
                  {showLinePrices && (
                    <>
                      <td className="num">{formatCents(l.unit_charge_cents)}</td>
                      <td className="num">{formatCents(l.line_total_cents)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <table className="report-table report-totals" style={{ maxWidth: '22rem', marginLeft: 'auto' }}>
          <tbody>
            {doc.linesCents !== 0 && (
              <tr>
                <td>Parts</td>
                <td className="num">{formatCents(doc.linesCents)}</td>
              </tr>
            )}
            {doc.laborCents !== 0 && (
              <tr>
                <td>
                  Labor
                  {doc.laborHours > 0 && (
                    <> ({Number(doc.laborHours)} hr @ {formatCents(doc.laborRateCents)}/hr)</>
                  )}
                </td>
                <td className="num">{formatCents(doc.laborCents)}</td>
              </tr>
            )}
            {doc.taxRateBp > 0 && (
              <tr>
                <td>Sales tax ({formatTaxRate(doc.taxRateBp)})</td>
                <td className="num">{formatCents(doc.taxCents)}</td>
              </tr>
            )}
            <tr className="total-row">
              <td>{doc.docType === 'Quote' ? 'Estimated total' : 'Total due'}</td>
              <td className="num">{formatCents(doc.totalCents)}</td>
            </tr>
          </tbody>
        </table>

        {doc.memo && (
          <p className="mt-4 whitespace-pre-wrap text-sm" style={{ color: '#374151' }}>{doc.memo}</p>
        )}
      </main>

      <footer className="mt-8 border-t pt-3 text-sm" style={{ borderColor: '#9ca3af' }}>
        {doc.docType === 'Quote' ? (
          <p style={{ color: '#4b5563' }}>
            This is an estimate. Final billing reflects actual parts and labor; you&apos;ll be
            contacted before any significant change.
          </p>
        ) : doc.paymentInstructions ? (
          <p className="whitespace-pre-wrap" style={{ color: '#374151' }}>
            <b>Payment:</b> {doc.paymentInstructions}
          </p>
        ) : null}
      </footer>
    </div>
  )
}
