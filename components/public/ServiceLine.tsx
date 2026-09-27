'use client'

import {
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

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
 * `hidden` attribute. On the client the first real snapshot reads the URL
 * hash — #aviation / #automotive deep-link a side — and React re-renders
 * after hydration without a mismatch (that is what getServerSnapshot is for;
 * reading the hash in a lazy useState would mismatch the hidden attributes).
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

let current: ServiceLine | null = null
const listeners = new Set<() => void>()

function lineFromHash(): ServiceLine | null {
  const h = window.location.hash.slice(1).toLowerCase()
  return h === 'aviation' || h === 'automotive' ? h : null
}

function getSnapshot(): ServiceLine {
  if (current === null) current = lineFromHash() ?? 'automotive'
  return current
}

function getServerSnapshot(): ServiceLine {
  return 'automotive'
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  // Typing #aviation into the address bar (or following an in-page link to
  // it) fires hashchange, not a reload.
  const onHash = () => {
    const l = lineFromHash()
    if (l) {
      current = l
      onChange()
    }
  }
  window.addEventListener('hashchange', onHash)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('hashchange', onHash)
  }
}

export function setServiceLine(line: ServiceLine) {
  current = line
  listeners.forEach((l) => l())
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
    <Tag className={className} hidden={active !== line}>
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
              onClick={() => setServiceLine(l)}
              onKeyDown={onKeyDown}
              className="pub-tab min-h-11 flex-1 rounded-lg px-6 text-base font-semibold sm:flex-none"
              style={{
                fontFamily: 'var(--font-doc-display), sans-serif',
                background: selected ? '#10141c' : 'transparent',
                color: selected ? '#f0a832' : '#2a3040',
                // No inline boxShadow here: it would beat .pub-tab:focus-visible
                // and erase the keyboard focus ring.
              }}
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
            className="pub-tabpanel mt-6 rounded-lg"
          >
            {/* Sized to its content: six cards run three-up on a wide
                screen, a short list stays as wide as its cards need rather
                than stranding two cards in a three-column grid. */}
            <div
              className={
                cards.length >= 3
                  ? 'grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3'
                  : 'grid max-w-2xl gap-x-8 gap-y-6 sm:grid-cols-2'
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
 * pills, with the check as the non-color state signal.
 */
export function LineToggle({ labelStyle }: { labelStyle: CSSProperties }) {
  const active = useServiceLine()
  const refs = useRef<Partial<Record<ServiceLine, HTMLButtonElement | null>>>({})

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const next = lineForKey(e.key, active)
    if (!next) return
    e.preventDefault()
    setServiceLine(next)
    refs.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-labelledby="rq-line-label">
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
              onClick={() => setServiceLine(l)}
              onKeyDown={onKeyDown}
              className="pub-tab min-h-11 rounded-full px-4 text-sm font-medium"
              style={{
                background: selected ? '#f0a832' : '#1a202c',
                color: selected ? '#201503' : '#aeb6c4',
                border: `1px solid ${selected ? '#f0a832' : '#222a38'}`,
              }}
            >
              {selected ? '✓ ' : ''}
              {LINE_LABEL[l]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
