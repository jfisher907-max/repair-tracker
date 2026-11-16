/**
 * The owner's request alert, by email.
 *
 * Server only: this reads RESEND_API_KEY. Client code may import the TYPES
 * from here (they are erased at build), never a function.
 *
 * One place builds the email request so the two callers cannot drift apart:
 * the public intake (app/api/request), which sends the real alert, and the
 * Settings test button (app/api/alert-test), which exists to answer "would the
 * real one reach me?". A test that built its own request would only prove that
 * the test works.
 */
import { notifyOutcome, type NotifyOutcome } from './notify'

/**
 * Resend's shared test sender. It may only write to the address the Resend
 * account was opened with, and refuses everything else with a 403.
 */
export const RESEND_TEST_SENDER = 'onboarding@resend.dev'

/** How an aircraft-on-ground alert starts its subject. A mail filter keys on it. */
export const AOG_SUBJECT_PREFIX = '*** AOG ***'

type Env = Record<string, string | undefined>

export type OwnerEmailChannel = { key: string; to: string; from: string }

/**
 * The email channel, or null when it is not set up.
 *
 * Deliberately no trimming and no tidying: a key with a stray line break is
 * broken in production, and the test button has to hit the same wall the real
 * alert does.
 */
export function ownerEmailChannel(env: Env = process.env): OwnerEmailChannel | null {
  const key = env.RESEND_API_KEY
  const to = env.OWNER_NOTIFY_EMAIL
  if (!key || !to) return null
  return { key, to, from: env.NOTIFY_FROM_EMAIL ?? RESEND_TEST_SENDER }
}

/** Send one email to the owner and say what Resend did with it. */
export function sendOwnerEmail(
  channel: string,
  ch: OwnerEmailChannel,
  subject: string,
  text: string,
): Promise<NotifyOutcome> {
  return notifyOutcome(channel, () =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ch.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: ch.from, to: ch.to, subject, text }),
      signal: AbortSignal.timeout(4000),
    }),
  )
}

/** What Settings shows before anything is sent. Never carries the key. */
export type OwnerAlertStatus = {
  email: {
    configured: boolean
    /** Names of the settings that are not there. Names only. */
    missing: string[]
    to: string | null
    from: string
    /** Still on Resend's test sender, which can reach one address only. */
    testSender: boolean
  }
  /** Pushover is set up, so the first AOG request in 10 minutes also pushes. */
  push: boolean
}

export function ownerAlertStatus(env: Env = process.env): OwnerAlertStatus {
  const ch = ownerEmailChannel(env)
  const missing: string[] = []
  if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY')
  if (!env.OWNER_NOTIFY_EMAIL) missing.push('OWNER_NOTIFY_EMAIL')
  const from = env.NOTIFY_FROM_EMAIL ?? RESEND_TEST_SENDER
  return {
    email: {
      configured: !!ch,
      missing,
      to: env.OWNER_NOTIFY_EMAIL || null,
      from,
      testSender: from === RESEND_TEST_SENDER,
    },
    push: !!(env.PUSHOVER_TOKEN && env.PUSHOVER_USER),
  }
}

/** The test button's answer: one plain line, and the provider's words under it. */
export type AlertTestResult = {
  ok: boolean
  headline: string
  detail?: string
}

/** The test alert itself. It says twice that nothing is wrong. */
export function testAlertEmail(): { subject: string; text: string } {
  return {
    subject: `${AOG_SUBJECT_PREFIX} TEST — sent from Settings, no aircraft is down`,
    text:
      'This is a test alert. You sent it from Settings in Wings N Things.\n\n' +
      'No request came in and no aircraft is on the ground.\n\n' +
      `A real AOG request arrives the same way, with a subject that starts ${AOG_SUBJECT_PREFIX}, ` +
      'and links to https://wingsnthings.repair/requests',
  }
}

/** Resend answers `{ statusCode, name, message }`. Anything else is shown as it came. */
function providerMessage(detail: string): string {
  try {
    const parsed: unknown = JSON.parse(detail)
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const m = (parsed as { message: unknown }).message
      if (typeof m === 'string' && m.trim()) return m.trim()
    }
  } catch {
    // Not JSON: an HTML error page, a proxy's text, nothing at all.
  }
  return detail.trim()
}

/**
 * The key must never reach the browser, and an error message can quote it: a
 * key with a line break in it is rejected by `fetch` itself, which names the
 * offending header value in full.
 */
function withoutKey(text: string, key: string): string {
  let out = text
  for (const k of [key, key.trim()]) {
    if (k.length >= 4) out = out.split(k).join('[key]')
  }
  return out
}

/**
 * Turn an outcome into something a person can act on.
 *
 * The headline is ours and says what to do. The detail is the provider's own
 * sentence, because that is the part a search or a support ticket needs.
 */
export function explainEmailOutcome(outcome: NotifyOutcome, ch: OwnerEmailChannel): AlertTestResult {
  if (outcome.ok) {
    return {
      ok: true,
      headline: `Sent. Resend accepted it for ${ch.to}.`,
      detail:
        `Look in that inbox for a subject starting ${AOG_SUBJECT_PREFIX} TEST. It should arrive within a minute. ` +
        'If it is not there, check spam. Accepted means Resend took the email. Only the inbox proves it arrived.',
    }
  }

  if (outcome.kind === 'failed') {
    const said = withoutKey(outcome.detail, ch.key)
    // A line break or a non-keyboard character (a pasted long dash, a curly
    // quote) INSIDE the key. The key is the only setting that travels in a
    // header; the addresses go in the body, where any character is allowed.
    // One at the very end is harmless: it is trimmed off before sending.
    if (/invalid header value|ByteString/i.test(outcome.detail)) {
      return {
        ok: false,
        headline:
          'Not sent. RESEND_API_KEY has a line break or an odd character in the middle of it, so it cannot be sent at all. Paste the key again in the Vercel project settings, then redeploy.',
        detail: 'Nothing left the site. Real alerts are failing the same way.',
      }
    }
    if (/timed? ?out|timeout|aborted/i.test(outcome.detail)) {
      return {
        ok: false,
        headline: 'Not sent. Resend did not answer within 4 seconds. Try again in a minute.',
        detail: said,
      }
    }
    return {
      ok: false,
      headline: 'Not sent. The site could not reach Resend. Try again in a minute.',
      detail: said,
    }
  }

  const said = withoutKey(providerMessage(outcome.detail), ch.key)
  const detail = said ? `Resend said: ${said}` : `Resend answered ${outcome.status} with no reason.`
  const not = (what: string): AlertTestResult => ({ ok: false, headline: `Not sent. ${what}`, detail })

  if (/only send testing emails to your own email address/i.test(said)) {
    return not(
      `The sender is still Resend's test address, which can only write to the address the Resend account was opened with, and ${ch.to} is not it. ` +
        'Either set OWNER_NOTIFY_EMAIL to that address, or verify a domain in Resend and set NOTIFY_FROM_EMAIL to an address on it.',
    )
  }
  if (/domain is not verified/i.test(said)) {
    return not(
      `Resend has not verified the domain in the From address (${ch.from}). Finish the domain's DNS records in Resend, or use an address on a domain that is verified.`,
    )
  }
  if (/api key is invalid|missing api key/i.test(said)) {
    return not(
      'Resend does not recognise the key. RESEND_API_KEY in the Vercel project settings is mistyped, cut short or deleted. Make a new key in Resend and paste it in, then redeploy.',
    )
  }
  if (/not active|suspended/i.test(said)) {
    return not('Resend has switched this key off. Make a new key in Resend, put it in RESEND_API_KEY, then redeploy.')
  }
  if (/quota/i.test(said)) {
    return not("The Resend account has used up its sending allowance, so real alerts are not going out either until it resets.")
  }
  if (outcome.status === 429) {
    return not('Resend is being asked too fast. Wait a minute and try again.')
  }
  if (outcome.status === 422 || outcome.status === 400) {
    return not(
      `Resend could not use one of the addresses. Check OWNER_NOTIFY_EMAIL (${ch.to}) and the From address (${ch.from}) for typos.`,
    )
  }
  if (outcome.status === 401 || outcome.status === 403) {
    return not('Resend refused the key or the sender. The reason is below.')
  }
  if (outcome.status >= 500) {
    return not('Resend is having trouble on its side. Try again in a few minutes.')
  }
  return not(`Resend refused it (${outcome.status}).`)
}

/** The answer when there is nothing to test with. */
export function explainNotConfigured(status: OwnerAlertStatus): AlertTestResult {
  return {
    ok: false,
    headline: `Not sent. Email alerts are not set up: ${status.email.missing.join(' and ')} ${
      status.email.missing.length === 1 ? 'is' : 'are'
    } missing in the Vercel project settings.`,
    detail: 'After adding a setting there, the site has to be redeployed before it takes effect.',
  }
}
