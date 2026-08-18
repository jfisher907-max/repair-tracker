import type Stripe from 'stripe'
import { serviceClient, stripeClient } from '@/lib/payments-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Stripe webhook — the only thing that may mark an invoice paid.
 *
 * The page that sends a customer to Checkout never records anything: a
 * customer could simply not pay, or close the tab mid-flow. Money is recorded
 * here, from Stripe's signed report of what actually settled.
 */
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

  if (event.type !== 'checkout.session.completed') {
    return Response.json({ received: true, ignored: event.type })
  }

  const session = event.data.object as Stripe.Checkout.Session
  if (session.payment_status !== 'paid') {
    return Response.json({ received: true, ignored: 'not paid' })
  }

  const token = session.metadata?.invoice_token
  const amount = session.amount_total
  if (!token || !amount || amount <= 0) {
    return Response.json({ received: true, ignored: 'missing invoice reference' })
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id
  // The PaymentIntent is stable across webhook retries; the ledger's unique
  // external_ref uses it so the same money can never post twice.
  const externalRef = paymentIntentId ?? `cs_${session.id}`

  // Stripe deposits net of its fee, so book the fee as an expense and keep the
  // ledger on gross. Best effort — never let it block recording the payment.
  let feeCents: number | null = null
  try {
    if (paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge.balance_transaction'],
      })
      const charge = intent.latest_charge as Stripe.Charge | null
      const balanceTx = charge?.balance_transaction as Stripe.BalanceTransaction | null
      if (balanceTx && typeof balanceTx.fee === 'number') feeCents = balanceTx.fee
    }
  } catch {
    // Fee lookup is optional; the payment itself still gets recorded.
  }

  const supabase = serviceClient()
  if (!supabase) {
    // Returning 500 makes Stripe retry once the key is in place.
    return Response.json({ error: 'server not configured to record payments' }, { status: 500 })
  }

  const { data, error } = await supabase.rpc('record_card_payment', {
    p_token: token,
    p_external_ref: externalRef,
    p_amount_cents: amount,
    p_fee_cents: feeCents,
  })

  if (error) {
    // 500 so Stripe retries rather than dropping a real payment on the floor.
    return Response.json({ error: error.message }, { status: 500 })
  }
  const result = data as { ok: boolean; duplicate?: boolean; error?: string }
  if (!result?.ok) {
    return Response.json({ error: result?.error ?? 'could not record payment' }, { status: 500 })
  }

  return Response.json({ received: true, duplicate: result.duplicate === true })
}
