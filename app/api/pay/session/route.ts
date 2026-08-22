import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  cardPaymentsConfigured,
  missingConfig,
  publicBaseUrl,
  stripeClient,
} from '@/lib/payments-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://kccmalbgfekapedgvhar.supabase.co'
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_90jiDuHcej7FyYxnb-vP-w_DM8LYmzp'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Stripe's floor for a card charge. */
const MIN_CHARGE = 50

/** The bucket quantum for expires_at (see below). 1800s is Stripe's floor for
 *  how far out a session may expire; the actual session lifetime lands at
 *  60–90 min because expires_at is anchored three buckets ahead. Short enough
 *  that a changed invoice/deposit can't be paid at an old figure much later. */
const SESSION_TTL_SECONDS = 30 * 60

/**
 * Opens a Stripe Checkout session for ONE of:
 *   { token }       — the remaining balance on an invoice
 *   { quoteToken }  — the outstanding deposit on an approved quote
 *
 * The caller is an unauthenticated customer, so the ONLY thing accepted from
 * them is the token. Every amount is read on the server from the document
 * itself — never sent up from the page — so a tampered request cannot change
 * what gets charged. Redirect URLs come from an allowlisted base, never from
 * the request's Origin header.
 */
export async function POST(request: Request) {
  if (!cardPaymentsConfigured()) return missingConfig()
  const stripe = stripeClient()
  if (!stripe) return missingConfig()

  let token = ''
  let quoteToken = ''
  try {
    const body = await request.json()
    token = String(body?.token ?? '')
    quoteToken = String(body?.quoteToken ?? '')
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 })
  }
  // Exactly one document per request.
  if ((token && quoteToken) || (!token && !quoteToken)) {
    return Response.json({ error: 'bad request' }, { status: 400 })
  }
  if ((token && !UUID.test(token)) || (quoteToken && !UUID.test(quoteToken))) {
    return Response.json({ error: 'bad request' }, { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const base = publicBaseUrl(request)

  let amount: number
  let name: string
  let description: string | undefined
  let metadata: Record<string, string>
  let returnUrl: string
  let successFlag: string
  let idempotencyKey: string

  if (quoteToken) {
    const { data, error } = await supabase.rpc('get_public_quote', { token: quoteToken })
    if (error || !data) return Response.json({ error: 'quote not found' }, { status: 404 })
    const quote = data as {
      quote_number: string
      status: string
      title: string
      deposit_cents: number | null
      deposit_outstanding_cents: number
      deposit_payable: boolean
      approved_at: string | null
    }
    if (quote.status !== 'approved') {
      return Response.json({ error: 'this quote has not been approved yet' }, { status: 409 })
    }
    if (!quote.deposit_payable) {
      return Response.json(
        { error: 'the shop needs to finish setting this quote up before a deposit can be taken' },
        { status: 409 },
      )
    }
    const outstanding = quote.deposit_outstanding_cents ?? 0
    if (outstanding <= 0) {
      return Response.json({ error: 'this deposit is already covered' }, { status: 409 })
    }
    if (outstanding < MIN_CHARGE) {
      return Response.json({ error: 'the remaining deposit is too small to pay by card' }, { status: 409 })
    }
    amount = outstanding
    name = `Deposit — Quote ${quote.quote_number}`
    description = quote.title?.slice(0, 300) || undefined
    metadata = {
      quote_token: quoteToken,
      quote_number: quote.quote_number,
      approved_at: quote.approved_at ?? '',
    }
    returnUrl = `${base}/q/${quoteToken}`
    successFlag = 'deposit=1'
    idempotencyKey = `dep_${quoteToken}_${amount}`
  } else {
    const { data, error } = await supabase.rpc('get_public_invoice', { token })
    if (error || !data) return Response.json({ error: 'invoice not found' }, { status: 404 })
    const invoice = data as {
      invoice_number: string
      status: string
      job_title: string
      total_cents: number
      amount_paid_cents: number
    }
    // Legacy invoices settled before the payments ledger existed carry status
    // 'paid' with no ledger rows, so the status must be checked as well as the
    // balance — otherwise they look payable and could be charged twice.
    if (invoice.status === 'paid') {
      return Response.json({ error: 'this invoice is already paid' }, { status: 409 })
    }
    if (invoice.status === 'void') {
      return Response.json({ error: 'this invoice was voided' }, { status: 409 })
    }
    const balance = invoice.total_cents - (invoice.amount_paid_cents ?? 0)
    if (balance <= 0) {
      return Response.json({ error: 'this invoice is already paid' }, { status: 409 })
    }
    if (balance < MIN_CHARGE) {
      return Response.json({ error: 'balance is too small to pay by card' }, { status: 409 })
    }
    amount = balance
    name = `Invoice ${invoice.invoice_number}`
    description = invoice.job_title?.slice(0, 300) || undefined
    metadata = { invoice_token: token, invoice_number: invoice.invoice_number }
    returnUrl = `${base}/i/${token}`
    successFlag = 'paid=1'
    idempotencyKey = `inv_${token}_${amount}`
  }

  const successUrl = `${returnUrl}?${successFlag}&cs={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${returnUrl}?canceled=1`

  // expires_at is a timestamp, so it must be a pure function of a coarse clock
  // bucket or a retry's params would differ. Anchor it THREE buckets out: at
  // the very end of a bucket the distance to (bucket+3) is still 2×TTL = 60min,
  // comfortably clear of Stripe's 30-min floor even with network/clock skew.
  const bucket = Math.floor(Date.now() / 1000 / SESSION_TTL_SECONDS)
  const expiresAt = (bucket + 3) * SESSION_TTL_SECONDS

  // Stripe rejects a reused idempotency key whose params differ at all, so the
  // key must fold in EVERYTHING that can vary within a bucket: the amount, the
  // line-item name/description (a job/quote title the owner may edit), and the
  // redirect host (publicBaseUrl echoes an allowlisted Origin, so the same
  // document opened from the custom domain and the vercel.app link differ). A
  // genuine same-page double-click sends identical params → same key → Stripe
  // returns the same session; only the truly-different cases fork.
  const keyMaterial = JSON.stringify({ idempotencyKey, name, description, amount, successUrl, cancelUrl, bucket })
  idempotencyKey = `${idempotencyKey}_${createHash('sha256').update(keyMaterial).digest('hex').slice(0, 24)}`

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        // Card family only (includes Apple Pay / Google Pay / Link): keeps
        // settlement synchronous, so the customer sees the result on return.
        payment_method_types: ['card'],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: { name, description },
            },
          },
        ],
        // The recorder trusts this, and only this, to identify the document.
        metadata,
        payment_intent_data: { metadata },
        expires_at: expiresAt,
        // {CHECKOUT_SESSION_ID} lets the landing page reconcile with Stripe
        // directly instead of waiting on the webhook.
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      { idempotencyKey },
    )
    if (!session.url) throw new Error('Stripe returned no checkout URL')
    return Response.json({ url: session.url })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'could not start checkout' },
      { status: 502 },
    )
  }
}
