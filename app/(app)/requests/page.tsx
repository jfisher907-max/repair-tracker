'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/date'
import { useDocumentTitle } from '@/lib/title'

interface ServiceRequest {
  id: string
  name: string
  phone: string | null
  email: string | null
  contact_pref: 'call' | 'text' | 'email' | null
  vehicle: string
  message: string
  status: 'new' | 'contacted' | 'closed'
  source: string
  created_at: string
}

const STATUS_LABEL: Record<ServiceRequest['status'], string> = {
  new: 'New',
  contacted: 'Contacted',
  closed: 'Closed',
}

/**
 * The inbox behind the public "Request service" form — the shop's only
 * inbound channel, since no phone number is published. Flow is deliberately
 * thin: read it, reach out (tap-to-call/text/email), mark it moved along.
 * Turning a request into a customer + job stays a human decision.
 */
export default function RequestsPage() {
  useDocumentTitle('Service requests')
  const [requests, setRequests] = useState<ServiceRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('service_requests')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setRequests((data as ServiceRequest[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function setStatus(r: ServiceRequest, status: ServiceRequest['status']) {
    const { error } = await supabase
      .from('service_requests')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', r.id)
    if (error) alert(error.message)
    else await load()
  }

  if (error) return <p style={{ color: 'var(--red)' }}>{error}</p>
  if (requests === null) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  const open = requests.filter((r) => r.status !== 'closed')
  const closed = requests.filter((r) => r.status === 'closed')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">Service requests</h1>
        {closed.length > 0 && (
          <button className="btn btn-sm" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? 'Hide closed' : `Closed (${closed.length})`}
          </button>
        )}
      </div>

      {requests.length === 0 && (
        <div className="card text-sm" style={{ color: 'var(--text3)' }}>
          Nothing yet. Requests from the website&apos;s &ldquo;Request service&rdquo; form land
          here — and later, the same form behind your QR codes and NFC tags.
        </div>
      )}

      {(showClosed ? [...open, ...closed] : open).map((r) => (
        <div key={r.id} className="card space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="font-semibold">{r.name}</span>
              <span className="ml-2 text-sm" style={{ color: 'var(--text2)' }}>{r.vehicle}</span>
            </div>
            <div className="flex flex-none items-center gap-2">
              {r.source !== 'web' && (
                <span className="chip" style={{ background: 'var(--bg3)' }}>{r.source.toUpperCase()}</span>
              )}
              <span
                className="chip"
                style={{
                  background: r.status === 'new' ? 'var(--accent)' : 'var(--bg3)',
                  color: r.status === 'new' ? '#111' : undefined,
                }}
              >
                {STATUS_LABEL[r.status]}
              </span>
            </div>
          </div>

          <p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--text2)' }}>{r.message}</p>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {r.phone && (
              <>
                <a className="btn btn-sm" href={`tel:${r.phone}`}><span className="emoji-mobile">📞 </span>{r.phone}</a>
                <a className="btn btn-sm" href={`sms:${r.phone}`}><span className="emoji-mobile">💬 </span>Text</a>
              </>
            )}
            {r.email && (
              <a className="btn btn-sm" href={`mailto:${r.email}`}><span className="emoji-mobile">✉️ </span>{r.email}</a>
            )}
            {r.contact_pref && (
              <span className="text-xs" style={{ color: 'var(--text3)' }}>
                prefers {r.contact_pref === 'call' ? 'a call' : r.contact_pref === 'text' ? 'text' : 'email'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--text3)' }}>
              {formatDate(r.created_at.slice(0, 10))}
            </span>
            <div className="flex gap-2">
              {r.status === 'new' && (
                <button className="btn btn-sm" onClick={() => setStatus(r, 'contacted')}>
                  <span className="emoji-mobile">✓ </span>Mark contacted
                </button>
              )}
              {r.status !== 'closed' ? (
                <>
                  <Link className="btn btn-sm" href="/jobs/new">
                    <span className="emoji-mobile">🔧 </span>Start job
                  </Link>
                  <button className="btn btn-sm" onClick={() => setStatus(r, 'closed')}>
                    Close
                  </button>
                </>
              ) : (
                <button className="btn btn-sm" onClick={() => setStatus(r, 'new')}>
                  Reopen
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
