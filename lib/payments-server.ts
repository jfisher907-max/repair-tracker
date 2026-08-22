import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

/**
 * Server-only card payment plumbing. Nothing here may be imported from a
 * client component — these keys must never reach the browser bundle.
 */

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://kccmalbgfekapedgvhar.supabase.co'

/** Card payments are opt-in: with no keys set the app behaves exactly as before. */
export function cardPaymentsConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key)
}

/**
 * Service-role client, used only to record what Stripe reports as settled.
 * There is no signed-in user on that path, and the invoice/quote token in the
 * URL is shared with the customer, so the write cannot be granted to anon —
 * it would let anyone holding a link mark their own invoice paid. Access is
 * narrowed further by only ever calling the record_* functions with it.
 */
export function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function missingConfig(): Response {
  return Response.json(
    { error: 'card payments are not set up on this server' },
    { status: 501 },
  )
}

const CANONICAL_URL = (process.env.APP_URL ?? 'https://wingsnthings.repair').replace(/\/$/, '')
// Both hosts stay live — links already texted to customers use the vercel.app
// address (see docs). Local dev is allowed so the flow can be exercised with
// test keys.
const PUBLIC_ORIGINS = new Set([
  CANONICAL_URL,
  'https://wingsnthings.repair',
  'https://repair-tracker-three-psi.vercel.app',
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000']),
])

/**
 * Base URL for Stripe's success/cancel redirects. Stripe will send the
 * customer to ANY absolute URL we give it, and the Origin header is
 * attacker-supplied (anyone with a token can call the session route), so
 * the header is honored only when it is one of our own hosts; otherwise the
 * canonical domain is used. Never echo Origin or Host into a Stripe URL.
 */
export function publicBaseUrl(request: Request): string {
  const origin = request.headers.get('origin') ?? ''
  return PUBLIC_ORIGINS.has(origin) ? origin : CANONICAL_URL
}

export type RecordResult =
  | { ok: true; duplicate: boolean; jobId: string | null; flagged?: boolean }
  | { ok: false; error: string; retry: boolean }

/**
 * Record a completed Checkout Session in the ledger. Shared by the webhook
 * and by the return-from-Checkout reconciliation, and idempotent either way:
 * the PaymentIntent id is the ledger's unique external_ref, so the same
 * money can never post twice no matter how many times this runs.
 *
 * Only the session's own metadata says which document was paid — that is
 * the trust boundary. The amount is Stripe's settled amount_total.
 */
export async function recordCheckoutSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<RecordResult> {
  if (session.payment_status !== 'paid') {
    return { ok: false, error: 'not paid', retry: false }
  }

  const invoiceToken = session.metadata?.invoice_token
  const quoteToken = session.metadata?.quote_token
  if (!invoiceToken && !quoteToken) {
    return { ok: false, error: 'missing document reference', retry: false }
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id
  const externalRef = paymentIntentId ?? `cs_${session.id}`

  // Stripe deposits net of its fee, so the fee is booked as an expense and
  // the ledger stays on gross. Best effort — never blocks the payment.
  // The balance transaction also carries the settled amount in the
  // account's currency, which is the number to trust if a non-USD
  // presentment ever slipped through.
  let feeCents: number | null = null
  let settledUsd: number | null = null
  try {
    if (paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge.balance_transaction'],
      })
      const charge = intent.latest_charge as Stripe.Charge | null
      const balanceTx = charge?.balance_transaction as Stripe.BalanceTransaction | null
      if (balanceTx && typeof balanceTx.fee === 'number') feeCents = balanceTx.fee
      if (balanceTx && balanceTx.currency === 'usd' && typeof balanceTx.amount === 'number') {
        settledUsd = balanceTx.amount
      }
    }
  } catch {
    // Fee lookup is optional; the payment itself still gets recorded.
  }

  let amount: number | null = null
  if (session.currency === 'usd' && typeof session.amount_total === 'number') {
    amount = session.amount_total
  } else if (settledUsd != null) {
    amount = settledUsd
  }
  if (!amount || amount <= 0) {
    // Retry: a transient fee-lookup failure on a non-USD session should get
    // another chance rather than dropping real money.
    return { ok: false, error: `unrecognized amount/currency ${session.currency}`, retry: true }
  }

  const supabase = serviceClient()
  if (!supabase) {
    return { ok: false, error: 'server not configured to record payments', retry: true }
  }

  const rpc = quoteToken
    ? supabase.rpc('record_deposit_payment', {
        p_token: quoteToken,
        p_external_ref: externalRef,
        p_amount_cents: amount,
        p_fee_cents: feeCents,
        p_opened_against: session.metadata?.approved_at || null,
      })
    : supabase.rpc('record_card_payment', {
        p_token: invoiceToken,
        p_external_ref: externalRef,
        p_amount_cents: amount,
        p_fee_cents: feeCents,
      })

  const { data, error } = await rpc
  if (error) return { ok: false, error: error.message, retry: true }
  const result = data as {
    ok: boolean
    duplicate?: boolean
    error?: string
    job_id?: string | null
    flagged?: boolean
  }
  if (!result?.ok) {
    return { ok: false, error: result?.error ?? 'could not record payment', retry: true }
  }
  return {
    ok: true,
    duplicate: result.duplicate === true,
    jobId: result.job_id ?? null,
    flagged: result.flagged === true,
  }
}
