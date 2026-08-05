'use client'

import WingMark from '@/components/WingMark'

/**
 * The charcoal brand band shared by every customer-facing document —
 * quotes, invoices, statements, and printed service records — so all of
 * Jake's paper carries the same letterhead.
 */
export interface DocBusiness {
  name: string
  phone: string
  address: string
  email: string
}

export default function DocBrand({
  business,
  docType,
  docRef,
  badge,
}: {
  business: DocBusiness
  docType: string
  /** The big white reference under the doc type: number ("INV-014") or a date. */
  docRef?: string | null
  badge?: string | null
}) {
  const phoneEmail = [business.phone, business.email]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' · ')

  return (
    <header className="doc-brand">
      <div className="doc-brand-id">
        <div className="doc-brand-row">
          <WingMark size={38} />
          <h1>{business.name || `${docType}${docRef ? ` ${docRef}` : ''}`}</h1>
        </div>
        {(business.address || phoneEmail) && (
          <p className="doc-contact">
            {business.address && (
              <>
                {business.address}
                <br />
              </>
            )}
            {phoneEmail}
          </p>
        )}
      </div>
      <div className="doc-id">
        {business.name && (
          <>
            <div className="doc-type">{docType}</div>
            {docRef && <div className="doc-num">{docRef}</div>}
          </>
        )}
        {badge && <span className="doc-badge">{badge}</span>}
      </div>
    </header>
  )
}
