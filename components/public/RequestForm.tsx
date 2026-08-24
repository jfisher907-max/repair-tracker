'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'

/**
 * The public service-request form — the shop's only contact channel (no
 * phone number is published, by design). Posts through /api/request so the
 * server observes the real IP/user agent; the database validates everything
 * again and rate-limits. The `company` field is a honeypot: visually hidden,
 * never labeled for humans, and any value in it gets the row silently
 * dropped server-side.
 */

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#8b94a7',
  marginBottom: 6,
}

const CONTACT_PREFS = [
  { value: 'text', label: 'Text me' },
  { value: 'call', label: 'Call me' },
  { value: 'email', label: 'Email me' },
] as const

export default function RequestForm() {
  // QR codes and NFC tags point at /?src=qr / /?src=nfc so the owner can see
  // where a request walked in from. Read once, lazily, on the client — the
  // value never renders, so the server/client difference can't mismatch.
  const [source] = useState(() => {
    if (typeof window === 'undefined') return 'web'
    const src = new URLSearchParams(window.location.search).get('src')
    return src === 'qr' || src === 'nfc' ? src : 'web'
  })
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [pref, setPref] = useState<'call' | 'text' | 'email' | ''>('')
  const [vehicle, setVehicle] = useState('')
  const [message, setMessage] = useState('')
  const [company, setCompany] = useState('') // honeypot
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const doneRef = useRef<HTMLDivElement>(null)

  // A live region that mounts already populated is not reliably announced;
  // moving focus onto the success card is what actually tells a screen
  // reader (and everyone else) that the send worked.
  useEffect(() => {
    if (sent) doneRef.current?.focus()
  }, [sent])

  // The success copy and the stored preference must only claim a channel the
  // customer actually provided — "we'll call" with no phone number is an
  // impossible promise, and an unhonorable preference in the owner's inbox
  // is worse than none.
  const honored =
    pref === 'email'
      ? email.trim()
        ? 'email'
        : ''
      : pref === 'call' || pref === 'text'
        ? phone.trim()
          ? pref
          : ''
        : ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    // Both contact fields are individually optional, so the browser's
    // required-field UI can't express "at least one" — check it here instead
    // of making the round trip the customer's first feedback.
    if (!phone.trim() && !email.trim()) {
      setError('Leave a phone number or an email so we can reach you.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          email,
          contactPref: honored || null,
          vehicle,
          message,
          source,
          company,
        }),
      })
      // The server replied — its copy is always friendly. A non-JSON body
      // (proxy error page) gets generic copy, not connection copy, because
      // the request did reach a server.
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) {
        setError(body?.error || 'Something went wrong — please try again.')
        return
      }
      setSent(true)
    } catch {
      // Only fetch itself throws now: the request never reached the shop.
      setError("Couldn't reach the shop — check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div
        ref={doneRef}
        tabIndex={-1}
        role="status"
        className="max-w-xl rounded-xl p-6"
        style={{ background: '#1a202c', border: '1px solid #222a38', outline: 'none' }}
      >
        <p className="text-lg font-semibold" style={{ color: '#6fe398' }}>
          ✓ Got it — thank you.
        </p>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: '#aeb6c4' }}>
          We&apos;ll look it over and get back to you within one business day
          {honored === 'email' ? ' by email' : honored === 'call' ? ' with a call' : honored === 'text' ? ' by text' : ''}.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label style={labelStyle} htmlFor="rq-name">Your name *</label>
          <input
            id="rq-name"
            className="pub-input"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="rq-vehicle">Vehicle (year, make &amp; model) *</label>
          <input
            id="rq-vehicle"
            className="pub-input"
            placeholder="e.g. 2015 Subaru Outback"
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            required
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="rq-phone">Phone</label>
          <input
            id="rq-phone"
            className="pub-input"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="rq-email">Email</label>
          <input
            id="rq-email"
            className="pub-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <p className="!mt-2 text-xs" style={{ color: '#8b94a7' }}>
        Phone or email — whichever you prefer, we just need one.
      </p>

      <div role="group" aria-labelledby="rq-pref-label">
        <span id="rq-pref-label" style={labelStyle}>How should we reach you?</span>
        <div className="flex flex-wrap gap-2">
          {CONTACT_PREFS.map((c) => {
            const selected = pref === c.value
            return (
              <button
                key={c.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setPref(selected ? '' : c.value)}
                className="min-h-11 rounded-full px-4 text-sm font-medium"
                style={{
                  background: selected ? '#f0a832' : '#1a202c',
                  color: selected ? '#201503' : '#aeb6c4',
                  border: `1px solid ${selected ? '#f0a832' : '#222a38'}`,
                }}
              >
                {/* the check is the non-color state signal */}
                {selected ? '✓ ' : ''}
                {c.label}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label style={labelStyle} htmlFor="rq-message">
          What&apos;s going on — or what work would you like done? *
        </label>
        <textarea
          id="rq-message"
          className="pub-input"
          style={{ minHeight: 120, resize: 'vertical' }}
          placeholder="Noises, warning lights, leaks, or the specific work you want — anything helps."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
        />
      </div>

      {/* Honeypot — hidden from people, irresistible to bots. The id and
          label are deliberately meaningless: "Company"-style wording matches
          Chrome's organization autofill heuristic, which fills hidden fields
          when a real customer picks their profile — silently eating their
          request. Never rename this to anything a form-filler classifies. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}>
        <label htmlFor="rq-xf">Leave this field blank</label>
        <input
          id="rq-xf"
          tabIndex={-1}
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore="true"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: '#f58e8b' }}>{error}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg px-6 py-3.5 text-base font-semibold sm:w-auto"
        style={{ background: '#f0a832', color: '#201503', opacity: busy ? 0.7 : 1 }}
      >
        {busy ? 'Sending…' : 'Send request'}
      </button>
      <p className="text-xs leading-relaxed" style={{ color: '#8b94a7' }}>
        Your info goes straight to the shop and nowhere else — no marketing
        lists, no third parties.
      </p>
    </form>
  )
}
