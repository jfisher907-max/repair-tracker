import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://kccmalbgfekapedgvhar.supabase.co'
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_90jiDuHcej7FyYxnb-vP-w_DM8LYmzp'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Customer approves or declines a quote.
 *
 * Goes through the server so the IP and user agent are observed rather than
 * self-reported — a browser can claim anything. The typed name and the consent
 * tick come from the customer and are recorded as given; together with the
 * timestamp and the frozen copy of the document, that is what an authorization
 * record is supposed to contain.
 */
export async function POST(request: Request) {
  let body: {
    token?: string
    response?: string
    name?: string
    consent?: boolean
    declinedIds?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 })
  }

  // Line ids the customer unchecked. Anything not a UUID is discarded here;
  // anything not belonging to the quote is discarded again in the database.
  const declinedIds = Array.isArray(body.declinedIds)
    ? body.declinedIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 200)
    : []

  const token = String(body.token ?? '')
  const response = String(body.response ?? '')
  if (!UUID.test(token) || (response !== 'approved' && response !== 'declined')) {
    return Response.json({ error: 'bad request' }, { status: 400 })
  }
  const name = String(body.name ?? '').trim().slice(0, 120)
  if (response === 'approved' && name.length < 2) {
    return Response.json({ error: 'Please type your name to approve.' }, { status: 400 })
  }
  if (response === 'approved' && body.consent !== true) {
    return Response.json({ error: 'Please tick the box to approve.' }, { status: 400 })
  }

  // x-forwarded-for is a client-to-proxy chain; the first entry is the caller.
  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  const ip =
    forwarded.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    null
  const userAgent = request.headers.get('user-agent')

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.rpc('respond_public_quote', {
    token,
    response,
    p_name: name || null,
    p_consent: response === 'approved' ? true : (body.consent ?? null),
    p_ip: ip,
    p_user_agent: userAgent,
    p_declined_ids: declinedIds.length ? declinedIds : null,
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) {
    // Already answered, expired, or not a live quote.
    return Response.json({ error: 'This quote is no longer open.' }, { status: 409 })
  }
  return Response.json({ status: data })
}
