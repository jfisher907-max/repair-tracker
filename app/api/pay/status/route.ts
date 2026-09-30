import { cardPaymentsConfigured, cardPaymentsMode } from '@/lib/payments-server'

export const dynamic = 'force-dynamic'

/**
 * Public: tells the invoice page whether to offer a Pay-by-card button, and
 * Settings whether the keys are Stripe's test or live ones. Exposes only that
 * — never a key.
 */
export async function GET() {
  return Response.json({ enabled: cardPaymentsConfigured(), mode: cardPaymentsMode() })
}
