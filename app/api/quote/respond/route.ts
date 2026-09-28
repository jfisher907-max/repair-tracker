import { serviceClient } from '@/lib/payments-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Customer approves or declines a quote.
 *
 * Goes through the server so the IP and user agent are observed rather than
 * self-reported — a browser can claim anything. The typed name and the consent
 * tick come from the customer and are recorded as given; together with the
 * timestamp and the frozen copy of the document, that is what an authorization
 * record is supposed to contain.
 *
 * SERVER ONLY (2026-09-27, security review): respond_public_quote runs with
 * the service-role key, and migration 0052 revokes it from anon — so the
 * checks below (a real name, the consent tick, the observed IP) can no longer
 * be skipped by calling the function straight from a browser with the public
 * key. Deploy this route BEFORE applying 0052, or approvals stop working.
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

  const supabase = serviceClient()
  if (!supabase) {
    // The service-role key is not configured on this server.
    return Response.json(
      { error: 'Approvals are not available right now — please call the shop.' },
      { status: 503 },
    )
  }
  const { data, error } = await supabase.rpc('respond_public_quote', {
    token,
    response,
    p_name: name || null,
    p_consent: response === 'approved' ? true : (body.consent ?? null),
    p_ip: ip,
    p_user_agent: userAgent,
    p_declined_ids: declinedIds.length ? declinedIds : null,
  })

  if (error) {
    // Never hand a database message to a public caller; the log keeps it.
    console.error('respond_public_quote failed', error)
    return Response.json(
      { error: 'Something went wrong recording your answer — please try again.' },
      { status: 500 },
    )
  }
  if (!data) {
    // Already answered, expired, or not a live quote.
    return Response.json({ error: 'This estimate is no longer open.' }, { status: 409 })
  }
  return Response.json({ status: data })
}
