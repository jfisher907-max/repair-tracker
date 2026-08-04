'use client'

import { use, useEffect, useState } from 'react'
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
  const contact = [statement.business.phone, statement.business.address, statement.business.email]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' · ')
  const generated = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="min-h-dvh" style={{ background: '#e5e7eb' }}>
      <div className="report-root mx-auto max-w-[8.5in] px-8 py-10">
        <header>
          {statement.business.name ? (
            <>
              <h1 className="text-3xl font-bold">{statement.business.name}</h1>
              <div className="mt-1 text-lg" style={{ color: '#374151' }}>Account Statement</div>
            </>
          ) : (
            <h1 className="text-3xl font-bold">Account Statement</h1>
          )}
          {contact && <div className="mt-0.5 text-sm" style={{ color: '#4b5563' }}>{contact}</div>}
          <hr className="report-rule" />
          <div className="report-meta grid grid-cols-2 gap-x-8 gap-y-0.5">
            <div><b>Customer:</b> {statement.customer_name}</div>
            <div><b>As of:</b> {generated}</div>
          </div>
        </header>

        <main className="mt-6">
          {open.length === 0 ? (
            <p className="text-lg">No outstanding balance — thank you, you&apos;re all paid up.</p>
          ) : (
            <>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Work</th>
                    <th>Invoice</th>
                    <th className="num">Total</th>
                    <th className="num">Paid</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((i) => (
                    <tr key={i.job_number}>
                      <td>{formatDate(i.date)}</td>
                      <td>{i.title}</td>
                      <td>{i.invoice_number ?? '—'}</td>
                      <td className="num">{formatCents(i.total_cents)}</td>
                      <td className="num">{formatCents(i.paid_cents)}</td>
                      <td className="num">{formatCents(i.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="report-table report-totals" style={{ maxWidth: '20rem', marginLeft: 'auto' }}>
                <tbody>
                  <tr className="total-row">
                    <td>Total due</td>
                    <td className="num">{formatCents(totalDue)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </main>

        {statement.business.payment_instructions && open.length > 0 && (
          <footer className="mt-8 border-t pt-3 text-sm" style={{ borderColor: '#9ca3af' }}>
            <p className="whitespace-pre-wrap" style={{ color: '#374151' }}>
              <b>Payment:</b> {statement.business.payment_instructions}
            </p>
          </footer>
        )}
      </div>
    </div>
  )
}
