import { serviceClient } from '@/lib/payments-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public service-request intake.
 *
 * Goes through the server so the IP and user agent are observed rather than
 * self-reported (same reasoning as /api/quote/respond) — the IP feeds the
 * database's per-caller rate limits. The RPC is executable by service_role
 * ONLY (migration 0025): the anon key is public, so an anon-callable
 * function would let anyone bypass this route and hand-pick every argument,
 * including the p_ip the rate limit keys on.
 *
 * All real validation and the honeypot check live in submit_service_request;
 * this route shapes the payload, hands it over, and — when notification env
 * vars are present — emails the owner about the new request. Honeypot hits
 * return no id, so bots never generate email.
 *
 * serviceLine records which side of the page (Automotive / Aviation) the
 * request came from. Validated strictly: 'aviation' or it is 'automotive'.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'bad request' }, { status: 400 })
  }

  const str = (v: unknown, cap: number) => String(v ?? '').slice(0, cap)

  // x-forwarded-for is set by Vercel to the real caller.
  const ip =
    (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null
  const userAgent = request.headers.get('user-agent') ?? ''

  const supabase = serviceClient()
  if (!supabase) {
    // Service key missing (fresh local checkout): the intake can't accept
    // safely, and pretending otherwise would eat a real customer's request.
    return Response.json(
      { ok: false, error: "The request line is down for a moment — please try again soon." },
      { status: 503 },
    )
  }

  const name = str(body.name, 120)
  const vehicle = str(body.vehicle, 200)
  const message = str(body.message, 4000)
  const serviceLine: 'automotive' | 'aviation' =
    body.serviceLine === 'aviation' ? 'aviation' : 'automotive'
  // AOG (0071) is aviation-only and it is the one field on this form that can
  // wake the owner, so it is narrowed here AND again inside the function.
  // Nothing below reads this value: the notifications read the function's own
  // `aog` / `page`, which is the server's decision rather than the caller's.
  const aog = body.aog === true && serviceLine === 'aviation'
  const args = {
    p_name: name,
    p_phone: str(body.phone, 40) || null,
    p_email: str(body.email, 200) || null,
    p_contact_pref: str(body.contactPref, 10) || null,
    p_vehicle: vehicle,
    p_message: message,
    p_source: str(body.source, 10) || 'web',
    p_company: str(body.company, 200) || null,
    p_ip: ip,
    p_user_agent: userAgent.slice(0, 400),
  }
  let res = await supabase.rpc('submit_service_request', {
    ...args,
    p_service_line: serviceLine,
    p_aog: aog,
  })
  // Deploy-order guard: until migration 0046 is applied the function has no
  // p_service_line, and PostgREST answers PGRST202 (no such function) WITHOUT
  // calling anything — so one retry on the old signature cannot double-insert.
  // The shop's only contact channel must not go down over a label; the row
  // just reads 'automotive' until 0046 lands. Remove once 0046 is applied.
  // Whether the stored row actually carries the line. After the fallback it
  // doesn't (the row reads 'automotive'), so the email must not claim one.
  let lineRecorded = true
  if (res.error?.code === 'PGRST202') {
    // 0071 not applied yet: drop p_aog and try 0046's signature. The request
    // is still stored, the inbox still shows it, and the reply carries no
    // `aog`/`page` — so nothing pages. Remove once 0071 is applied.
    res = await supabase.rpc('submit_service_request', { ...args, p_service_line: serviceLine })
  }
  if (res.error?.code === 'PGRST202') {
    lineRecorded = false
    res = await supabase.rpc('submit_service_request', args)
  }
  const { data, error } = res

  if (error) {
    return Response.json(
      { ok: false, error: 'Could not send your request — please try again.' },
      { status: 500 },
    )
  }
  const result = data as {
    ok: boolean
    error?: string
    id?: string
    /** The function's own verdict, not the caller's claim (0071). */
    aog?: boolean
    /** First AOG request in 10 minutes — the only thing that may page. */
    page?: boolean
  }
  if (!result?.ok) {
    return Response.json({ ok: false, error: result?.error ?? 'Could not send your request.' }, { status: 400 })
  }

  // Owner notification — only for a REAL insert (result.id present; honeypot
  // drops return ok with no id), and only when configured. Best effort: a
  // mail hiccup must never fail the customer's submission.
  if (result.id && process.env.RESEND_API_KEY && process.env.OWNER_NOTIFY_EMAIL) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.NOTIFY_FROM_EMAIL ?? 'onboarding@resend.dev',
          to: process.env.OWNER_NOTIFY_EMAIL,
          subject: result.aog
            ? `*** AOG *** ${serviceLine} service request — ${name} (${vehicle})`
            : lineRecorded
              ? `New ${serviceLine} service request — ${name} (${vehicle})`
              : `New service request — ${name} (${vehicle})`,
          text: `A new service request just came in.\n\nOpen it: https://wingsnthings.repair/requests\n\n(Details are in the app, not this email.)`,
        }),
        signal: AbortSignal.timeout(4000),
      })
    } catch {
      // The request is safely stored; the dashboard banner still shows it.
    }
  }

  // AOG push (0071). Email is the record; this is the thing that wakes him.
  // Gated on result.page, which the function sets only for the first AOG
  // request in 10 minutes — a stranger with a web form should not be able to
  // start an alert that repeats until acknowledged, over and over.
  //
  // Priority 2 is Pushover's emergency level: it repeats every `retry`
  // seconds until acknowledged, up to `expire`. 2 minutes for 30 is loud
  // enough to wake someone and short enough to stop on its own.
  //
  // Sent form-encoded, which is the documented shape, and never blocking:
  // like the email above, a notification hiccup must not fail the customer's
  // submission — the row is already stored and the inbox already shows it.
  //
  // THE PAYLOAD CARRIES NO FREE TEXT, for the same reason the email says
  // "Details are in the app, not this email." The form promises the customer
  // "your info goes straight to the shop and nowhere else — no marketing
  // lists, no third parties", and whatever is in this body is read by
  // Pushover and sits on a lock screen. The aircraft is enough to know which
  // one is down and whether to get up; the rest is one tap away.
  if (result.id && result.page && process.env.PUSHOVER_TOKEN && process.env.PUSHOVER_USER) {
    try {
      await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: process.env.PUSHOVER_TOKEN,
          user: process.env.PUSHOVER_USER,
          title: `AOG — ${vehicle}`.slice(0, 250),
          message: 'Aircraft on ground. Open the request for the details.',
          url: 'https://wingsnthings.repair/requests',
          url_title: 'Open the request',
          priority: '2',
          retry: '120',
          expire: '1800',
        }),
        signal: AbortSignal.timeout(4000),
      })
    } catch {
      // The request is safely stored; the dashboard banner still shows it.
    }
  }

  return Response.json({ ok: true })
}
