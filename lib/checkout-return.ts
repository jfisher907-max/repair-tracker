'use client'

import { useEffect, useRef, useState } from 'react'

export type CheckoutReturnState =
  /** Not returning from Checkout. */
  | 'idle'
  /** Came back with a session id; asking Stripe what happened. */
  | 'checking'
  /** Stripe says paid and the ledger has it. */
  | 'recorded'
  /** Stripe says paid; the ledger write is still pending (webhook will land). */
  | 'paid'
  /** Session complete but the payment method is still processing. */
  | 'processing'
  /** Customer backed out, or the session could not be confirmed. */
  | 'none'

/**
 * After Stripe sends the customer back (`?paid=1&cs=…` or `?deposit=1&cs=…`),
 * reconcile with Stripe directly through /api/pay/session-state instead of
 * hoping the webhook beat the redirect — then re-read the document a few
 * times so the balance on screen catches up with the ledger.
 *
 * StrictMode-safe: the URL is read and scrubbed exactly once and the decision
 * is cached in a ref, so the dev-mode setup→cleanup→setup double-invoke
 * reproduces the same reconciliation instead of reading an already-scrubbed
 * (empty) URL on the second pass and getting stuck.
 */
export function useCheckoutReturn(opts: {
  token: string
  kind: 'invoice' | 'quote'
  flag: 'paid' | 'deposit'
  reload: () => Promise<void> | void
}): CheckoutReturnState {
  const { token, kind, flag, reload } = opts
  const [state, setState] = useState<CheckoutReturnState>('idle')
  // The URL decision, captured once. undefined = not yet read.
  const captured = useRef<{ returning: boolean; cs: string } | null>(null)
  // Latest reload, so the effect can stay mount-only without going stale.
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  useEffect(() => {
    if (captured.current === null) {
      const params = new URLSearchParams(window.location.search)
      const returning = params.has(flag)
      const backedOut = params.has('canceled')
      captured.current = { returning, cs: params.get('cs') ?? '' }
      if (returning || backedOut) {
        window.history.replaceState({}, '', window.location.pathname)
      }
    }
    const decision = captured.current
    // Not returning from Checkout (or a clean cancel): stay idle.
    if (!decision.returning) return

    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    setState('checking')

    async function safeReload() {
      if (cancelled) return
      await reloadRef.current()
    }

    async function run() {
      let next: CheckoutReturnState = 'paid'
      if (decision.cs) {
        try {
          const res = await fetch(
            `/api/pay/session-state?cs=${encodeURIComponent(decision.cs)}&token=${encodeURIComponent(token)}&kind=${kind}`,
          )
          const body = await res.json()
          if (res.ok && body.enabled) {
            if (body.payment_status === 'paid') next = body.recorded ? 'recorded' : 'paid'
            else if (body.status === 'complete') next = 'processing'
            else next = 'none'
          }
        } catch {
          // Stripe unreachable from here: fall back to the webhook + polling.
        }
      }
      if (cancelled) return
      setState(next)
      await safeReload()
      if (cancelled) return
      // The ledger write (ours or the webhook's) is async relative to the
      // redirect; re-read a few times so the figures on screen catch up.
      let tries = 0
      timer = setInterval(async () => {
        tries += 1
        await safeReload()
        if (tries >= 5 || cancelled) clearInterval(timer)
      }, 2000)
    }
    run()

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
    // Mount-only: the URL is captured once in the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}
