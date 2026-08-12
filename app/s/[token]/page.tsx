'use client'

import { use, useEffect, useState } from 'react'
import DocBrand from '@/components/DocBrand'
import { BRAND_NAME } from '@/lib/brand'
import { useDocumentTitle } from '@/lib/title'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/date'

interface StatementItem {
  job_number: string
  title: string
  date: string
  invoice_number: string | null
  due_date: string | null
  total_cents: number
  paid_cents: number
}

interface PublicStatement {
  customer_name: string
  business: {
    name: string
    phone: string
    address: string
    email: string
    payment_instructions: string
  }
  items: StatementItem[]
}

/**
 * PUBLIC customer statement — QuickBooks-style: every open balance on one
 * page, one total due. Token-keyed like quotes/invoices; customer-safe
 * fields only. Balances update live, so the same link stays current.
 * Bold Brand template, matching quotes/invoices.
 */
export default function PublicStatementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [statement, setStatement] = useState<PublicStatement | null | 'missing'>(null)

  useEffect(() => {
    supabase.rpc('get_public_statement', { token }).then(({ data, error }) => {
      if (error || !data) setStatement('missing')
      else setStatement(data as PublicStatement)
    })
  }, [token])

  const loaded = statement && statement !== 'missing' ? statement : null
  useDocumentTitle(loaded ? `Statement — ${loaded.business.name || BRAND_NAME}` : null)

  if (statement === null) {
    return <div className="p-8 text-center" style={{ color: 'var(--text3)' }}>Loading statement…</div>
  }
  if (statement === 'missing') {
    return (
      <div className="p-8 text-center" style={{ color: 'var(--text2)' }}>
        This statement link isn&apos;t valid anymore. Please contact the shop.
      </div>
    )
  }

  const open = statement.items
    .map((i) => ({ ...i, balance: Math.max(0, i.total_cents - i.paid_cents) }))
    .filter((i) => i.balance > 0)
  const totalDue = open.reduce((s, i) => s + i.balance, 0)
  const generated = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="doc-wrap min-h-dvh px-0 py-0 sm:px-4 sm:py-8" style={{ background: '#e5e7eb' }}>
      <div className="doc-root">
        <DocBrand
          business={statement.business}
          docType="Statement"
          docRef={generated}
          badge={open.length > 0 ? 'Open balance' : 'Paid in full'}
        />

        <div className="doc-body">
          <dl className="doc-meta">
            <div>
              <dt>Prepared for</dt>
              <dd>{statement.customer_name}</dd>
            </div>
            <div>
              <dt>As of</dt>
              <dd>{generated}</dd>
            </div>
            <div>
              <dt>Open items</dt>
              <dd>{open.length}</dd>
            </div>
          </dl>

          {open.length === 0 ? (
            <div className="doc-job">
              <h2>Nothing owed</h2>
              <p>No outstanding balance — thank you, you&apos;re all paid up.</p>
            </div>
          ) : (
            <>
              <table className="doc-table doc-table--tight" style={{ marginTop: 26 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Work</th>
                    <th>Invoice</th>
                    <th className="doc-n doc-col-optional">Total</th>
                    <th className="doc-n doc-col-optional">Paid</th>
                    <th className="doc-n">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((i) => (
                    <tr key={i.job_number}>
                      <td className="doc-dim">{formatDate(i.date)}</td>
                      <td className="doc-desc">{i.title}</td>
                      <td className="doc-dim">{i.invoice_number ?? '—'}</td>
                      <td className="doc-n doc-dim doc-col-optional">{formatCents(i.total_cents)}</td>
                      <td className="doc-n doc-dim doc-col-optional">{formatCents(i.paid_cents)}</td>
                      <td className="doc-n">{formatCents(i.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="doc-totals-solo">
                <div className="doc-due-card">
                  <div>
                    <span className="doc-due-label">Total due</span>
                    <span className="doc-due-sub">
                      {open.length} open item{open.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="doc-due-amt">{formatCents(totalDue)}</div>
                </div>
              </div>
            </>
          )}

          {statement.business.payment_instructions && open.length > 0 && (
            <footer className="doc-foot">
              <p>
                <b>Payment:</b> {statement.business.payment_instructions}
              </p>
            </footer>
          )}
        </div>
      </div>
    </div>
  )
}
