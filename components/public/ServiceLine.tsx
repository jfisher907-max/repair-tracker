'use client'

import {
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'

/**
 * Automotive / Aviation — the one choice that tailors the public page.
 *
 * ONE shared state, driven from two places: the tab bar at the top of
 * "What we do" and the compact toggle at the top of the request form (for
 * visitors who jump straight to #request). It lives in a tiny module store
 * read through useSyncExternalStore, so every consumer on the page sees the
 * same value without a provider threading through the server component.
 *
 * Static-for-Google: the server snapshot is always 'automotive', so the
 * prerendered HTML carries BOTH sides' copy with the aviation side under the
 * `hidden` attribute. On the client the store starts from the URL hash —
 * #aviation / #automotive deep-link a side — and React re-renders after
 * hydration without a mismatch (that is what getServerSnapshot is for).
 *
 * No flash on /#aviation: React only takes over after hydration, so the page
 * carries a tiny inline script (LINE_BOOT_SCRIPT in app/(public)/page.tsx)
 * that sets <html data-line="aviation"> before the first paint. CSS in
 * globals.css keys off it — it hides every [data-line-only="automotive"]
 * element, un-hides [data-line-only="aviation"] despite its `hidden`
 * attribute, and paints the Aviation tab/pill as selected. The store keeps
 * that attribute equal to its own value on every change, so after hydration
 * the CSS and React always say the same thing and never fight.
 *
 * Choosing a side rewrites the hash with history.replaceState: no scroll
 * jump, no history entry, and the path + ?src=qr survive (a relative '#…'
 * URL keeps both). No element on the page has the id "aviation" or
 * "automotive", so a deep link opens the side without jumping to it. Any
 * other hash — #request above all — leaves the chosen side alone.
 */

export type ServiceLine = 'automotive' | 'aviation'

export const SERVICE_LINES: readonly ServiceLine[] = ['automotive', 'aviation']

const LINE_LABEL: Record<ServiceLine, string> = {
  automotive: 'Automotive',
  aviation: 'Aviation',
}

// Must agree with LINE_BOOT_SCRIPT in app/(public)/page.tsx (the pre-paint
// script lives there: a value exported from this 'use client' module would
// reach the server page as a client reference, not a string).
function lineFromHash(): ServiceLine | null {
  const h = window.location.hash.slice(1).toLowerCase()
  return h === 'aviation' || h === 'automotive' ? h : null
}

// Initialized once, when the module loads in the browser (before hydration),
// so getSnapshot is a pure read.
let current: ServiceLine =
  typeof window === 'undefined' ? 'automotive' : (lineFromHash() ?? 'automotive')
const listeners = new Set<() => void>()

function apply(line: ServiceLine) {
  current = line
  // Keep <html data-line> equal to the store, so the pre-hydration CSS in
  // globals.css can never contradict what React renders.
  try {
    document.documentElement.dataset.line = line
  } catch {
    // No document to annotate; React's own `hidden` attributes still apply.
  }
  listeners.forEach((l) => l())
}

// ONE listener for the whole page, not one per subscribed component. Typing
// #aviation into the address bar (or following an in-page link to it) fires
// hashchange, not a reload.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const l = lineFromHash()
    if (l && l !== current) apply(l)
  })
}

function getSnapshot(): ServiceLine {
  return current
}

function getServerSnapshot(): ServiceLine {
  return 'automotive'
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export function setServiceLine(line: ServiceLine) {
  apply(line)
  try {
    window.history.replaceState(null, '', `#${line}`)
  } catch {
    // A sandboxed frame can refuse history writes; the choice still applies.
  }
}

export function useServiceLine(): ServiceLine {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Arrow / Home / End → the side to move to, or null for any other key. */
function lineForKey(key: string, from: ServiceLine): ServiceLine | null {
  const i = SERVICE_LINES.indexOf(from)
  const n = SERVICE_LINES.length
  if (key === 'ArrowRight' || key === 'ArrowDown') return SERVICE_LINES[(i + 1) % n]
  if (key === 'ArrowLeft' || key === 'ArrowUp') return SERVICE_LINES[(i - 1 + n) % n]
  if (key === 'Home') return SERVICE_LINES[0]
  if (key === 'End') return SERVICE_LINES[n - 1]
  return null
}

/**
 * Renders its children only on one side. Both sides are in the HTML; the
 * inactive one carries `hidden`. `as="span"` for copy inside a paragraph.
 *
 * Keep the element itself display:block (div) or inline (span) — put a grid
 * on a child — because the pre-hydration CSS that un-hides the aviation side
 * restores exactly those two display values.
 */
export function LineOnly({
  line,
  as = 'div',
  className,
  children,
}: {
  line: ServiceLine
  as?: 'div' | 'span'
  className?: string
  children: ReactNode
}) {
  const active = useServiceLine()
  const Tag = as
  return (
    <Tag className={className} hidden={active !== line} data-line-only={line}>
      {children}
    </Tag>
  )
}

export interface ServiceCard {
  title: string
  body: string
}

/**
 * The "What we do" tab bar and its two panels. The copy arrives as props
 * from the server page, so it stays in the prerendered HTML.
 *
 * WAI-ARIA tabs pattern: roving tabindex, automatic activation on the
 * arrow keys (Left/Right, plus Home/End), each panel labelled by its tab.
 * The selected look lives in globals.css (.pub-svc-tab[aria-selected]) so
 * the pre-hydration #aviation rule can paint it too.
 */
export function ServiceTabs({
  labelledBy,
  services,
}: {
  labelledBy: string
  services: Record<ServiceLine, ServiceCard[]>
}) {
  const active = useServiceLine()
  const tabRefs = useRef<Partial<Record<ServiceLine, HTMLButtonElement | null>>>({})

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    // Up/Down belong to page scrolling on a horizontal tab bar.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return
    const next = lineForKey(e.key, active)
    if (!next) return
    e.preventDefault()
    setServiceLine(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <div>
      <div
        role="tablist"
        aria-labelledby={labelledBy}
        className="mt-4 flex w-full gap-1 rounded-xl p-1 sm:inline-flex sm:w-auto"
        style={{ background: '#e9ebef', border: '1px solid #dadde4' }}
      >
        {SERVICE_LINES.map((l) => {
          const selected = active === l
          return (
            <button
              key={l}
              ref={(el) => {
                tabRefs.current[l] = el
              }}
              id={`svc-tab-${l}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`svc-panel-${l}`}
              tabIndex={selected ? 0 : -1}
              data-line-tab={l}
              onClick={() => setServiceLine(l)}
              onKeyDown={onKeyDown}
              className="pub-tab pub-svc-tab min-h-11 flex-1 rounded-lg px-6 text-base font-semibold sm:flex-none"
              style={{ fontFamily: 'var(--font-doc-display), sans-serif' }}
            >
              {LINE_LABEL[l]}
            </button>
          )
        })}
      </div>

      {SERVICE_LINES.map((l) => {
        const cards = services[l]
        return (
          <div
            key={l}
            id={`svc-panel-${l}`}
            role="tabpanel"
            aria-labelledby={`svc-tab-${l}`}
            tabIndex={0}
            hidden={active !== l}
            data-line-only={l}
            className="pub-tabpanel mt-6 rounded-lg"
          >
            {/* Sized to its content: six cards run three-up on a wide
                screen; four (or any count that doesn't fill rows of three)
                run two-up, so no row strands a single card. */}
            <div
              className={
                cards.length % 3 === 0
                  ? 'grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3'
                  : 'grid gap-x-8 gap-y-6 sm:grid-cols-2'
              }
            >
              {cards.map((s) => (
                <div key={s.title}>
                  <h3
                    className="text-base font-semibold"
                    style={{ fontFamily: 'var(--font-doc-display), sans-serif' }}
                  >
                    {s.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed" style={{ color: '#2a3040' }}>
                    {s.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The compact version at the top of the request form, on the dark band.
 * An exclusive either/or, so a radiogroup (not a second tablist — the tabs
 * above already own the panels); styled like the form's contact-preference
 * pills, with the check as the non-color state signal. The check is visual
 * only (aria-hidden): aria-checked already tells assistive tech.
 *
 * Switching sides changes the height of everything ABOVE the form (six
 * cards vs four, the steps, the intro). Browsers with scroll anchoring keep
 * the form still on their own; iOS Safari doesn't, so the form would jump
 * out from under the visitor's thumb. So: measure the toggle, commit the
 * switch synchronously, and scroll by exactly how far it moved — instantly,
 * never smooth, which also honours prefers-reduced-motion.
 */
export function LineToggle({ labelStyle }: { labelStyle: CSSProperties }) {
  const active = useServiceLine()
  const groupRef = useRef<HTMLDivElement>(null)
  const refs = useRef<Partial<Record<ServiceLine, HTMLButtonElement | null>>>({})

  function choose(next: ServiceLine) {
    const group = groupRef.current
    const before = group ? group.getBoundingClientRect().top : null
    flushSync(() => setServiceLine(next))
    if (group && before !== null) {
      const moved = group.getBoundingClientRect().top - before
      if (moved !== 0) window.scrollBy({ top: moved, behavior: 'instant' })
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const next = lineForKey(e.key, active)
    if (!next) return
    e.preventDefault()
    choose(next)
    refs.current[next]?.focus()
  }

  return (
    <div ref={groupRef} role="radiogroup" aria-labelledby="rq-line-label">
      <span id="rq-line-label" style={labelStyle}>What&apos;s this for?</span>
      <div className="flex flex-wrap gap-2">
        {SERVICE_LINES.map((l) => {
          const selected = active === l
          return (
            <button
              key={l}
              ref={(el) => {
                refs.current[l] = el
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              data-line-tab={l}
              onClick={() => choose(l)}
              onKeyDown={onKeyDown}
              className="pub-tab pub-line-pill min-h-11 rounded-full px-4 text-sm font-medium"
            >
              {/* Always rendered, shown by CSS for the checked pill — so the
                  pre-hydration #aviation rule can move it too. */}
              <span className="pub-line-check" aria-hidden="true">
                ✓{' '}
              </span>
              {LINE_LABEL[l]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
