import { serviceClient } from '@/lib/payments-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Long enough to read a quote on a slow connection, short enough that a
 *  copied image URL stops working well before the link itself does. */
const SIGN_TTL = 60 * 60

/**
 * Photos a customer may see, signed on the server.
 *
 * The bucket stays completely private: `anon` is never granted storage read.
 * The caller proves entitlement by holding an unguessable quote or invoice
 * token, the database decides which photos that token unlocks
 * (get_shared_photos, service_role only), and only then does the server mint
 * short-lived signed URLs for exactly those files.
 *
 * The alternative — a storage policy letting anyone read any photo flagged
 * customer-visible — would grant on the FLAG rather than on holding the link.
 * This route is why that policy is not needed.
 *
 * Photos are evidence, never a blocker: every failure returns an empty list so
 * the document still renders.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? ''
  const kind = url.searchParams.get('kind') ?? ''

  const empty = Response.json({ photos: [] })
  if (!UUID.test(token) || (kind !== 'quote' && kind !== 'invoice')) return empty

  const supabase = serviceClient()
  if (!supabase) return empty // no service key configured (local dev)

  const { data, error } = await supabase.rpc('get_shared_photos', {
    p_token: token,
    p_kind: kind,
  })
  if (error) return empty

  const rows = (data as { path: string; caption: string | null }[] | null) ?? []
  if (rows.length === 0) return empty

  const { data: signed } = await supabase.storage
    .from('receipts')
    .createSignedUrls(rows.map((r) => r.path), SIGN_TTL)

  const urlByPath = new Map<string, string>()
  for (const s of signed ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)

  return Response.json({
    photos: rows
      .filter((r) => urlByPath.has(r.path))
      .map((r) => ({ url: urlByPath.get(r.path)!, caption: r.caption })),
  })
}
