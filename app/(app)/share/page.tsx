'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { BRAND_NAME } from '@/lib/brand'
import { useDocumentTitle } from '@/lib/title'

/**
 * Hand the public request form to someone — in person or by text.
 *
 * Jake, 2026-11-15: "a quick and easy way to share the customer side website
 * to people in person or via text so they can submit requests."
 *
 * In person, the phone IS the sign: a big QR code the other person scans with
 * their camera. By text, one tap opens the share sheet (Messages, AirDrop,
 * WhatsApp, email) with the message already written in Jake's own voice, like
 * the follow-up texts. Cars / Aircraft picks which side of the site they land on.
 */

/**
 * The public site, hard-coded on purpose (as the request email's links are).
 * A QR code gets saved and printed and kept, so it must never encode whichever
 * host the app happens to be open on — localhost, or a vercel.app address.
 */
const SITE = 'https://wingsnthings.repair'

type Side = 'automotive' | 'aviation'

/**
 * `qr` carries ?src=qr, the tag RequestForm already reads (and 0023's function
 * already allows), so a request that walks in off this code shows a QR chip in
 * the inbox. `link` is the plain address for texting: the only sources the
 * database accepts are web / qr / nfc, so a text tag would be stored as 'web'
 * anyway, and the plain address reads cleaner in a message bubble.
 *
 * #aviation is the hash the public page already deep-links on — the inline
 * script in app/(public)/page.tsx flips the side before first paint, so an
 * aircraft owner never sees the car side flash. It sits after the query string,
 * where ServiceLine.tsx keeps ?src intact.
 */
const SIDES: Record<Side, { tab: string; noun: string; link: string; qr: string }> = {
  automotive: { tab: 'Cars', noun: 'vehicle', link: SITE, qr: `${SITE}/?src=qr` },
  aviation: { tab: 'Aircraft', noun: 'aircraft', link: `${SITE}/#aviation`, qr: `${SITE}/?src=qr#aviation` },
}

type Qr = { value: string; src: string } | { value: string; failed: true }

/**
 * The QR code as a PNG data URL. An <img>, not an <svg>, on purpose: on an
 * iPhone a long-press on an image offers Save to Photos and Share, so saving it
 * for a sticker or a print shop needs no extra code.
 *
 * The result is keyed by the value it was made for and only handed back while
 * it still matches, so flipping Cars / Aircraft can never show — or let anyone
 * save — the previous side's code for the instant the new one takes to draw.
 */
function useQr(value: string): Qr | null {
  const [qr, setQr] = useState<Qr | null>(null)
  useEffect(() => {
    let live = true
    QRCode.toDataURL(value, {
      // M recovers ~15% damage: enough for a scuffed sticker or a glare
      // stripe across a phone screen, without the code getting dense.
      errorCorrectionLevel: 'M',
      // The 4-module quiet zone the spec requires. Scanners lose codes that
      // sit flush against something dark — this app's background included.
      margin: 4,
      // Drawn large and shown small: crisp on a retina screen, and big
      // enough to print a sign from without going soft.
      width: 1024,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(
      (src) => live && setQr({ value, src }),
      () => live && setQr({ value, failed: true }),
    )
    return () => {
      live = false
    }
  }, [value])
  return qr && qr.value === value ? qr : null
}

export default function SharePage() {
  useDocumentTitle('Share the request form')
  const [side, setSide] = useState<Side>('automotive')
  const [note, setNote] = useState<string | null>(null)
  const s = SIDES[side]
  const qr = useQr(s.qr)

  const message =
    `Here's the link to request service from ${BRAND_NAME} — tell me what your ` +
    `${s.noun} needs and I'll get back to you: ${s.link}`

  function flash(text: string) {
    setNote(text)
    setTimeout(() => setNote(null), 2500)
  }

  async function sendText() {
    try {
      // The follow-up texts' pattern: the URL rides inside `text` rather
      // than in `url`, which some share targets append a second time.
      if (navigator.share) await navigator.share({ text: message })
      else {
        // A desktop browser with no share sheet: hand over the whole
        // message, ready to paste into a text.
        await navigator.clipboard.writeText(message)
        flash('Message copied — paste it into a text.')
      }
    } catch {
      /* the share sheet was dismissed */
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(s.link)
      flash('Link copied.')
    } catch {
      flash('Could not copy — press and hold the link below instead.')
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-2xl">Share the request form</h1>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Show the code to someone with you, or text them the link.
        </p>
      </div>

      <div className="seg-track" role="group" aria-label="Which side of the site">
        {(Object.keys(SIDES) as Side[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`seg-item ${side === k ? 'on' : ''}`}
            aria-pressed={side === k}
            onClick={() => setSide(k)}
          >
            {SIDES[k].tab}
          </button>
        ))}
      </div>

      {/* White, always, in either theme: a QR code is read by contrast, and a
          dark-on-dark code is the classic one that will not scan. */}
      <div
        className="mx-auto overflow-hidden rounded-xl"
        style={{ background: '#fff', width: 'min(100%, 340px)', aspectRatio: '1 / 1' }}
      >
        {qr && 'src' in qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- a generated data: URL; next/image has nothing to optimise and would drop the long-press Save to Photos
          <img
            src={qr.src}
            alt={`QR code for ${s.qr}`}
            width={1024}
            height={1024}
            style={{ display: 'block', width: '100%', height: 'auto', imageRendering: 'pixelated' }}
          />
        ) : qr ? (
          <p className="p-6 text-center text-sm" style={{ color: '#333' }}>
            The code could not be drawn. Text the link instead.
          </p>
        ) : null}
      </div>
      <p className="text-center text-sm" style={{ color: 'var(--text2)' }}>
        Have them point their phone camera at it.
      </p>

      <button type="button" className="btn btn-primary w-full" onClick={sendText}>
        Text the link
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn" onClick={copyLink}>
          Copy link
        </button>
        {qr && 'src' in qr ? (
          <a className="btn" href={qr.src} download={`wings-n-things-request-${side}.png`}>
            Save QR image
          </a>
        ) : (
          <button type="button" className="btn" disabled>
            Save QR image
          </button>
        )}
      </div>

      <p role="status" aria-live="polite" className="min-h-5 text-center text-sm" style={{ color: 'var(--text2)' }}>
        {note}
      </p>

      <div className="card space-y-1 text-sm" style={{ color: 'var(--text2)' }}>
        <div>
          Link: <span style={{ color: 'var(--text-heading)', userSelect: 'all' }}>{s.link.replace('https://', '')}</span>
        </div>
        <div>Requests that come in off the code are tagged QR in your inbox.</div>
      </div>
    </div>
  )
}
