import webpush from 'web-push'
import { serviceClient } from '@/lib/payments-server'

/**
 * Server-only Web Push plumbing (migration 0068). Never import from a client
 * component: VAPID_PRIVATE_KEY must stay on the server.
 *
 * Opt-in like card payments and receipt AI: with no VAPID keys set, every
 * function here is a quiet no-op and the app behaves exactly as before.
 *
 * Env (Vercel):
 *   VAPID_PUBLIC_KEY   — handed to the browser when it subscribes (public by design)
 *   VAPID_PRIVATE_KEY  — signs every push; server only
 *   VAPID_SUBJECT      — optional contact for push services, mailto: or https:
 */

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null
}

let vapidSet = false
function ensureVapid(): boolean {
  if (!pushConfigured()) return false
  if (!vapidSet) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'https://wingsnthings.repair',
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    )
    vapidSet = true
  }
  return true
}

export interface PushMessage {
  title: string
  body: string
  /** App path the notification opens when tapped. */
  url: string
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string
}

interface SubRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Sends to every device the owner turned alerts on for. Best effort: never
 * throws, returns how many devices accepted it. Devices the push service says
 * are gone (404/410) are removed so they stop costing a request every time.
 */
export async function sendPushToOwner(msg: PushMessage): Promise<{ sent: number; failed: number }> {
  const none = { sent: 0, failed: 0 }
  if (!ensureVapid()) return none
  const supabase = serviceClient()
  if (!supabase) return none

  const { data, error } = await supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth')
  if (error || !data?.length) return none

  const payload = JSON.stringify(msg)
  const results = await Promise.all(
    (data as SubRow[]).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          // Urgent + a day to live: a request should wake the phone, and a
          // phone that's off overnight should still get it in the morning.
          { TTL: 60 * 60 * 24, urgency: 'high', timeout: 4000 },
        )
        return { id: s.id, ok: true as const }
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        return { id: s.id, ok: false as const, gone: status === 404 || status === 410 }
      }
    }),
  )

  const okIds = results.filter((r) => r.ok).map((r) => r.id)
  const goneIds = results.filter((r) => !r.ok && r.gone).map((r) => r.id)
  await Promise.all([
    okIds.length
      ? supabase.from('push_subscriptions').update({ last_sent_at: new Date().toISOString() }).in('id', okIds)
      : null,
    goneIds.length ? supabase.from('push_subscriptions').delete().in('id', goneIds) : null,
  ])
  return { sent: okIds.length, failed: results.length - okIds.length }
}
