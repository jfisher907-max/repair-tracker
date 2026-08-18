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
 * Service-role client, used only by the webhook. The webhook has no signed-in
 * user, and the invoice token in the URL is shared with the customer, so the
 * write cannot be granted to anon — it would let anyone holding a link mark
 * their own invoice paid. Access is narrowed further by only ever calling the
 * record_card_payment function with this client.
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
