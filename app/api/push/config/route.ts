import { clientForRequest, unauthorized } from '@/lib/server'
import { pushConfigured, vapidPublicKey } from '@/lib/push-server'

export const dynamic = 'force-dynamic'

/** GET: is push set up on the server, and the public key a device subscribes with. */
export async function GET(request: Request) {
  const auth = await clientForRequest(request)
  if (!auth) return unauthorized()
  return Response.json({ configured: pushConfigured(), publicKey: vapidPublicKey() })
}
