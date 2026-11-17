'use client'

import { useEffect } from 'react'

/**
 * Runs `run` when the page is opened at, or moved to, `#name`.
 *
 * Search's "New" shortcuts land on a list page with its add form already open
 * (`/expenses#new`, `/customers#new`), the way a Home bench card's "+ Part"
 * lands on a job (`#add-part`). The form is page state, not a route, so the
 * hash is the message.
 *
 * The hash is used once and then taken off the address: the same shortcut
 * works a second time, and a reload does not reopen a form he closed.
 *
 * `run` must be stable (useCallback), or this re-subscribes every render.
 */
export function useHashAction(name: string, run: () => void) {
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== `#${name}`) return
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      run()
    }
    check()
    // The router can put the hash on the address a beat after the page mounts.
    const late = window.setTimeout(check, 150)
    // Already on the page: a plain link to the hash fires this.
    window.addEventListener('hashchange', check)
    return () => {
      window.clearTimeout(late)
      window.removeEventListener('hashchange', check)
    }
  }, [name, run])
}
