'use client'

import { createPortal } from 'react-dom'

/**
 * Mounts a full-screen overlay (the photo viewer, the receipt viewer, a
 * hangar dialog) on <body> instead of where it was written.
 *
 * WHY THIS EXISTS — the glass trap. `backdrop-filter`, like `transform`,
 * makes an element the containing block for every `position: fixed` element
 * inside it. Liquid Glass puts a backdrop-filter on `.card`, and all three of
 * these overlays were written INSIDE a card: the photo viewer is a child of
 * JobPhotos' own `.card`, the receipt viewer's pages wrap it in one, the
 * hangar dialogs open from inside a JetCard. Left in place they would stop
 * measuring the screen and start measuring the card — the same bug we already
 * fixed once when a page animation was the ancestor.
 *
 * Portalling to <body> is the fix that cannot regress: it does not matter
 * what any ancestor in the page does, because there are no longer any
 * ancestors. `inset: 0` on the overlay then means the viewport, always.
 *
 * The wrapper carries .glass-scope so the overlay still sees the glass
 * surface contract (and its reduced-transparency / print fallbacks), which
 * .app-frame would otherwise have been the only source of.
 *
 * Renders nothing where there is no document. That is safe for exactly the
 * reason these overlays exist: every one of them is opened by a tap, so it is
 * never in the tree on the first render — there is no server HTML for the
 * client to disagree with. An overlay that could be open on arrival would
 * need a mounted flag instead.
 */
export default function Overlay({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(<div className="glass-scope">{children}</div>, document.body)
}
