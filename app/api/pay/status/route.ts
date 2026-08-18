import { cardPaymentsConfigured } from '@/lib/payments-server'

export const dynamic = 'force-dynamic'

/**
 * Public: tells the invoice page whether to offer a Pay-by-card button.
 * Exposes only a boolean — never a key.
 */
export async function GET() {
  return Response.json({ enabled: cardPaymentsConfigured() })
}
