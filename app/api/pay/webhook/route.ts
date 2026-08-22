import type Stripe from 'stripe'
import { recordCheckoutSession, stripeClient } from '@/lib/payments-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Stripe webhook — records what actually settled.
 *
 * The page that sends a customer to Checkout never records anything: a
 * customer could simply not pay, or close the tab mid-flow. Money is recorded
 * here (and by the landing page's reconciliation, which shares the same
 * idempotent recorder) from Stripe's signed report of what settled.
 *
 * Subscribe the endpoint to BOTH events: completed covers cards, which settle
 * instantly; async_payment_succeeded covers any delayed method should one
 * ever be enabled on the account.
 */
const HANDLED = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])

export async function POST(request: Request) {
  const stripe = stripeClient()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripe || !secret) {
    return Response.json({ error: 'webhook not configured' }, { status: 501 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return Response.json({ error: 'unsigned' }, { status: 400 })

  // Raw body: the signature covers the exact bytes Stripe sent.
  const raw = await request.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret)
  } catch (e) {
    // A bad signature means it did not come from Stripe. Never act on it.
    return Response.json(
      { error: `signature check failed: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 400 },
    )
  }

  if (!HANDLED.has(event.type)) {
    return Response.json({ received: true, ignored: event.type })
  }

  const session = event.data.object as Stripe.Checkout.Session
  if (session.payment_status !== 'paid') {
    // completed-but-unpaid = a delayed method still processing; the
    // async_payment_succeeded event will follow when it settles.
    return Response.json({ received: true, ignored: 'not paid yet' })
  }

  const result = await recordCheckoutSession(stripe, session)
  if (!result.ok) {
    // 500 makes Stripe retry (for days, with backoff) rather than dropping
    // a real payment on the floor — e.g. until the service-role key exists.
    return Response.json({ error: result.error }, { status: result.retry ? 500 : 200 })
  }
  return Response.json({ received: true, duplicate: result.duplicate, flagged: result.flagged === true })
}
