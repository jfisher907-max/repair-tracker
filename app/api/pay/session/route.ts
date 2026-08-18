import { createClient } from '@supabase/supabase-js'
import { cardPaymentsConfigured, missingConfig, stripeClient } from '@/lib/payments-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://kccmalbgfekapedgvhar.supabase.co'
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_90jiDuHcej7FyYxnb-vP-w_DM8LYmzp'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Opens a Stripe Checkout session for one invoice.
 *
 * The caller is an unauthenticated customer, so the ONLY thing accepted from
 * them is the invoice token. The amount is read from the invoice on the
 * server — never sent up from the page — so a tampered request cannot change
 * what gets charged.
 */
export async function POST(request: Request) {
  if (!cardPaymentsConfigured()) return missingConfig()
  const stripe = stripeClient()
  if (!stripe) return missingConfig()

  let token = ''
  try {
    const body = await request.json()
    token = String(body?.token ?? '')
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 })
  }
  if (!UUID.test(token)) return Response.json({ error: 'bad request' }, { status: 400 })

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.rpc('get_public_invoice', { token })
  if (error || !data) return Response.json({ error: 'invoice not found' }, { status: 404 })

  const invoice = data as {
    invoice_number: string
    status: string
    job_title: string
    total_cents: number
    amount_paid_cents: number
    business: { name: string }
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
  // Stripe's floor for a card charge.
  if (balance < 50) {
    return Response.json({ error: 'balance is too small to pay by card' }, { status: 409 })
  }

  const origin = request.headers.get('origin') || new URL(request.url).origin
  const invoiceUrl = `${origin}/i/${token}`

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: balance,
              product_data: {
                name: `Invoice ${invoice.invoice_number}`,
                description: invoice.job_title?.slice(0, 300) || undefined,
              },
            },
          },
        ],
        // The webhook trusts this, and only this, to identify the invoice.
        metadata: { invoice_token: token, invoice_number: invoice.invoice_number },
        payment_intent_data: {
          metadata: { invoice_token: token, invoice_number: invoice.invoice_number },
        },
        success_url: `${invoiceUrl}?paid=1`,
        cancel_url: `${invoiceUrl}?canceled=1`,
      },
      // Retrying the button must not open a second charge for the same balance.
      { idempotencyKey: `inv_${token}_${balance}` },
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
