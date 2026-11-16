import {
  explainEmailOutcome,
  explainNotConfigured,
  ownerAlertStatus,
  ownerEmailChannel,
  sendOwnerEmail,
  testAlertEmail,
} from '@/lib/owner-alert'
import { clientForRequest, unauthorized } from '@/lib/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * "Would an AOG alert reach me?" — asked from Settings, answered on screen.
 *
 * The real alert only fires when a stranger submits the public form, and its
 * outcome lands in a runtime log the owner has to go and find. This sends one
 * email down the same path (lib/owner-alert) on demand and hands the result
 * back, in Resend's own words when it says no.
 *
 * Owner only, and it can only ever write to OWNER_NOTIFY_EMAIL: the caller
 * chooses nothing, not the recipient, not the subject, not the text. The key
 * never leaves the server, and is scrubbed from any error that might quote it.
 */

const noStore = { 'Cache-Control': 'no-store' }

/** A valid sign-in is not enough to send mail: it has to be the owner's. */
async function ownerOnly(request: Request): Promise<Response | null> {
  const auth = await clientForRequest(request)
  if (!auth) return unauthorized()
  // The same function every table's RLS policy asks, run as the caller.
  const { data, error } = await auth.supabase.rpc('is_owner')
  if (error || data !== true) return Response.json({ error: 'forbidden' }, { status: 403 })
  return null
}

/** GET: what is set up. Names and addresses, never the key. */
export async function GET(request: Request) {
  const refused = await ownerOnly(request)
  if (refused) return refused
  return Response.json(ownerAlertStatus(), { headers: noStore })
}

/** POST: send one test alert and say what happened to it. */
export async function POST(request: Request) {
  const refused = await ownerOnly(request)
  if (refused) return refused

  const channel = ownerEmailChannel()
  if (!channel) {
    return Response.json(explainNotConfigured(ownerAlertStatus()), { headers: noStore })
  }
  const { subject, text } = testAlertEmail()
  const outcome = await sendOwnerEmail('email (test from Settings)', channel, subject, text)
  return Response.json(explainEmailOutcome(outcome, channel), { headers: noStore })
}
