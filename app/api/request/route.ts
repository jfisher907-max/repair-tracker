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
  const { data, error } = await supabase.rpc('submit_service_request', {
    p_name: name,
    p_phone: str(body.phone, 40) || null,
    p_email: str(body.email, 200) || null,
    p_contact_pref: str(body.contactPref, 10) || null,
    p_vehicle: vehicle,
    p_message: str(body.message, 4000),
    p_source: str(body.source, 10) || 'web',
    p_company: str(body.company, 200) || null,
    p_ip: ip,
    p_user_agent: userAgent.slice(0, 400),
  })

  if (error) {
    return Response.json(
      { ok: false, error: 'Could not send your request — please try again.' },
      { status: 500 },
    )
  }
  const result = data as { ok: boolean; error?: string; id?: string }
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
          subject: `New service request — ${name} (${vehicle})`,
          text: `A new service request just came in.\n\nOpen it: https://wingsnthings.repair/requests\n\n(Details are in the app, not this email.)`,
        }),
        signal: AbortSignal.timeout(4000),
      })
    } catch {
      // The request is safely stored; the dashboard banner still shows it.
    }
  }

  return Response.json({ ok: true })
}
