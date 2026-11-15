/**
 * Owner notifications — the one job here is to SAY WHAT HAPPENED.
 *
 * Server only. Nothing in this file is imported by client code.
 */

/**
 * Fire one notification and record the outcome.
 *
 * `fetch` rejects only on a network failure. An HTTP error is an ordinary
 * response, so a 401 (bad key), a 403 (Resend's sandbox sender may only write
 * to the account's own address) and a 422 all resolve happily, and a bare
 * `try { await fetch(...) } catch {}` counts every one of them as a success.
 * That is how the request intake stood until now: a dead notification channel
 * and a working one looked identical from the outside, with nothing written
 * down anywhere to tell them apart.
 *
 * It stays best effort — the caller has already stored the row — so this never
 * throws and never returns a failure to act on. What it does is put the outcome
 * in the runtime log, which is the only place the owner can go afterwards to
 * ask "did that actually leave?".
 *
 * @param channel  what is being sent, for the log line: 'email', 'push'.
 * @param send     makes the request. Takes no arguments so the caller owns the
 *                 URL, headers and body, and this owns only the outcome.
 * @returns        whether the provider accepted it — for tests and callers that
 *                 want to count, never for failing the customer's request.
 */
export async function notify(channel: string, send: () => Promise<Response>): Promise<boolean> {
  try {
    const res = await send()
    if (res.ok) {
      console.log(`[notify] ${channel}: accepted`)
      return true
    }
    // The provider's own words: a 403 explains itself ("you can only send
    // testing emails to your own email address") where a bare status does not.
    // Capped, and read inside its own catch so a body that cannot be read turns
    // into a short log line rather than an exception thrown past the caller.
    const detail = await res.text().catch(() => '')
    console.error(`[notify] ${channel}: REFUSED ${res.status} ${res.statusText} — ${detail.slice(0, 400)}`)
    return false
  } catch (e) {
    // Timed out (AbortSignal), DNS, TLS, connection reset.
    console.error(`[notify] ${channel}: FAILED — ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}
