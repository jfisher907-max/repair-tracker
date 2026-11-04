import { clientForRequest, unauthorized } from '@/lib/server'
import { pushConfigured, sendPushToOwner } from '@/lib/push-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST: Settings' "Send a test" button — pushes to every device with alerts on. */
export async function POST(request: Request) {
  const auth = await clientForRequest(request)
  if (!auth) return unauthorized()
  if (!pushConfigured()) {
    return Response.json({ ok: false, error: 'Push is not set up on the server (VAPID keys missing).' })
  }
  const result = await sendPushToOwner({
    title: 'Test alert',
    body: 'This is what a new service request will look like.',
    url: '/requests',
    tag: 'push-test',
  })
  return Response.json({ ok: result.sent > 0, ...result })
}
