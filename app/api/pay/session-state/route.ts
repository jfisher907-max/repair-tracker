import { recordCheckoutSession, stripeClient } from '@/lib/payments-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]+$/

/**
 * Public: the landing page's reconciliation after Checkout.
 *
 * Stripe's webhook can land a beat after the customer does, and a missing
 * server key can delay it for longer. Rather than show "Pay by card" again
 * over money that has already moved, the page asks Stripe directly: if the
 * session is paid, it is recorded here (same idempotent recorder as the
 * webhook, so the two can never double-post), and the page is told so.
 *
 * The session must belong to the document whose token the caller holds —
 * the session id alone (it appears in the redirect URL) opens nothing.
 * Exposes only status words, never amounts or keys.
 */
export async function GET(request: Request) {
  const stripe = stripeClient()
  if (!stripe) return Response.json({ enabled: false })

  const url = new URL(request.url)
  const cs = url.searchParams.get('cs') ?? ''
  const token = url.searchParams.get('token') ?? ''
  const kind = url.searchParams.get('kind') === 'quote' ? 'quote' : 'invoice'
  if (!SESSION_ID.test(cs) || !UUID.test(token)) {
    return Response.json({ error: 'bad request' }, { status: 400 })
  }

  let session
  try {
    session = await stripe.checkout.sessions.retrieve(cs)
  } catch {
    return Response.json({ error: 'unknown session' }, { status: 404 })
  }

  const expected = kind === 'quote' ? session.metadata?.quote_token : session.metadata?.invoice_token
  if (!expected || expected !== token) {
    return Response.json({ error: 'unknown session' }, { status: 404 })
  }

  let recorded = false
  if (session.payment_status === 'paid') {
    const result = await recordCheckoutSession(stripe, session)
    recorded = result.ok
  }

  return Response.json({
    enabled: true,
    status: session.status,
    payment_status: session.payment_status,
    recorded,
  })
}
