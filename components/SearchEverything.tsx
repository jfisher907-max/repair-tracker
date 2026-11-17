'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Icon, { type IconName } from '@/components/icons'
import Overlay from '@/components/Overlay'
import { statusChipClass } from '@/lib/billing'
import {
  KIND_ORDER,
  KIND_WORDS,
  PLACES,
  STARTS,
  loadSearchIndex,
  matchPlaces,
  matchRecords,
  readVisits,
  recentRecords,
  type Place,
  type RecordKind,
  type SearchIndex,
  type SearchRecord,
} from '@/lib/search'

/**
 * Search everything (owner, 2026-11-16).
 *
 * One field over jobs, customers, vehicles and aircraft, quotes and invoices.
 * Before anything is typed it is a launcher: the records opened lately, every
 * page the bottom bar does not reach, and the four things he starts.
 *
 * Opened from the round button in the phone's bottom bar, the Search field in
 * the desktop sidebar, or Ctrl+K. A full sheet on a phone; a panel on a desk.
 *
 * It reads; it never writes. Everything on it is a link.
 */

/** How many of one kind to list before "Show all". */
const SHOWN = 5
const RECENT_SHOWN = 5

const KIND_ICON: Record<RecordKind, IconName> = {
  job: 'jobs',
  customer: 'person',
  vehicle: 'vehicle',
  quote: 'quote',
  invoice: 'billing',
}

interface Item {
  key: string
  href: string
  icon: IconName
  title: string
  number?: string
  sub?: string
  status?: string
  statusLabel?: string
}

interface Section {
  id: string
  heading: string
  layout: 'rows' | 'tiles'
  /** Tiles in the accent colour: the things he starts. */
  accent?: boolean
  items: Item[]
  /** A cut list: how many there are in all, and the kind to show in full. */
  more?: { total: number; kind: RecordKind }
}

const recordItem = (r: SearchRecord): Item => ({
  key: `${r.kind}-${r.id}`,
  href: r.href,
  icon: r.aircraft ? 'hangar' : KIND_ICON[r.kind],
  title: r.title,
  number: r.number,
  sub: r.sub,
  status: r.status,
  statusLabel: r.statusLabel,
})

const placeItem = (p: Place, prefix = ''): Item => ({
  key: `place-${p.href}`,
  href: p.href,
  icon: p.icon,
  title: `${prefix}${p.label}`,
})

/** "quotes", "quotes and invoices", "jobs, quotes and invoices". */
function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

export default function SearchEverything({ onClose }: { onClose: () => void }) {
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  /** undefined while the index loads. A kind inside it is null when its read failed. */
  const [index, setIndex] = useState<SearchIndex | undefined>(undefined)
  const [expanded, setExpanded] = useState<ReadonlySet<RecordKind>>(new Set())
  /** The row the arrow keys are on; -1 = none. */
  const [active, setActive] = useState(-1)
  // Read once, when the search opens: the list must not reshuffle under a thumb.
  const [visits] = useState(readVisits)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    let live = true
    loadSearchIndex().then((ix) => {
      if (live) setIndex(ix)
    })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => load(), [load])

  // The page behind must not scroll under the sheet, and focus goes back to
  // whatever opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const root = document.documentElement
    const was = root.style.overflow
    root.style.overflow = 'hidden'
    inputRef.current?.focus()
    return () => {
      root.style.overflow = was
      opener?.focus?.()
    }
  }, [])

  // A phone's keyboard covers the bottom of a fixed sheet without resizing it.
  // The list gets that much room underneath, so its last row can be scrolled
  // clear of the keys.
  useEffect(() => {
    const vv = window.visualViewport
    const panel = panelRef.current
    if (!vv || !panel) return
    const fit = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      panel.style.setProperty('--kb', `${Math.round(covered)}px`)
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => {
      vv.removeEventListener('resize', fit)
      vv.removeEventListener('scroll', fit)
    }
  }, [])

  const typed = query.trim().length > 0
  const failedKinds = index ? KIND_ORDER.filter((k) => index[k] === null) : []

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = []
    if (!typed) {
      if (index) {
        const recent = recentRecords(index, visits).slice(0, RECENT_SHOWN)
        if (recent.length > 0) {
          out.push({ id: 'recent', heading: 'Recent', layout: 'rows', items: recent.map(recordItem) })
        }
      }
      out.push({
        id: 'goto',
        heading: 'Go to',
        layout: 'tiles',
        items: PLACES.filter((p) => p.pinned).map((p) => placeItem(p)),
      })
      out.push({ id: 'new', heading: 'New', layout: 'tiles', accent: true, items: STARTS.map((p) => placeItem(p)) })
      return out
    }

    // A page or a "new" named in words comes first: there are never many, and
    // "taxes" should not have to be found under five lists of records.
    const places = [
      ...matchPlaces(PLACES, query).map((p) => placeItem(p)),
      ...matchPlaces(STARTS, query).map((p) => placeItem(p, 'New ')),
    ]
    if (places.length > 0) out.push({ id: 'goto', heading: 'Go to', layout: 'rows', items: places })

    if (index) {
      for (const kind of KIND_ORDER) {
        const records = index[kind]
        if (!records) continue
        const hits = matchRecords(records, query)
        if (hits.length === 0) continue
        const all = expanded.has(kind)
        out.push({
          id: kind,
          heading: KIND_WORDS[kind].heading,
          layout: 'rows',
          items: (all ? hits : hits.slice(0, SHOWN)).map(recordItem),
          more: !all && hits.length > SHOWN ? { total: hits.length, kind } : undefined,
        })
      }
    }
    return out
  }, [typed, query, index, visits, expanded])

  // The arrow keys walk every row and tile in the order they are drawn.
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections])
  const offsets = useMemo(() => {
    const m = new Map<string, number>()
    let n = 0
    for (const s of sections) {
      m.set(s.id, n)
      n += s.items.length
    }
    return m
  }, [sections])

  useEffect(() => {
    if (active < 0) return
    panelRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onType(value: string) {
    setQuery(value)
    setExpanded(new Set())
    // Enter opens the best match, so the first row is lit as soon as there is text.
    setActive(value.trim() ? 0 : -1)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (flat.length === 0) return
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a < 0 ? (step > 0 ? 0 : flat.length - 1) : (a + step + flat.length) % flat.length))
      return
    }
    if (e.key === 'Enter' && e.target === inputRef.current) {
      const at = active >= 0 && active < flat.length ? active : -1
      if (at < 0) return
      e.preventDefault()
      panelRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.click()
      return
    }
    if (e.key === 'Tab') {
      // Keep the Tab key inside the sheet while it is open.
      const stops = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input') ?? [],
      )
      if (stops.length === 0) return
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  /** A row or tile. Every one closes the search as it is followed. */
  function renderItem(item: Item, at: number, layout: Section['layout'], accent?: boolean) {
    const lit = at === active
    const className = layout === 'tiles' ? `search-tile${accent ? ' is-accent' : ''}` : 'search-row'
    const inner =
      layout === 'tiles' ? (
        <>
          <span className="search-tile-icon">
            <Icon name={item.icon} size={22} />
          </span>
          <span className="search-tile-label">{item.title}</span>
        </>
      ) : (
        <>
          <span className="search-row-icon">
            <Icon name={item.icon} size={20} />
          </span>
          <span className="search-row-text">
            <span className="search-row-title">
              {item.number && <span className="wnt-id">{item.number}</span>}
              <span className="truncate">{item.title}</span>
            </span>
            {item.sub && <span className="search-row-sub">{item.sub}</span>}
          </span>
          {item.status && (
            <span className={`${statusChipClass(item.status)} flex-none`}>{item.statusLabel ?? item.status}</span>
          )}
        </>
      )
    // A "#new" on the page he is already on: a plain link, so the browser
    // itself moves the hash and the page hears it (lib/use-hash-action). A
    // router link there changes the address without that event.
    const [path, hash] = item.href.split('#')
    if (hash && path === pathname) {
      return (
        <a key={item.key} href={item.href} className={className} data-active={lit} onClick={onClose}>
          {inner}
        </a>
      )
    }
    return (
      <Link key={item.key} href={item.href} className={className} data-active={lit} onClick={onClose}>
        {inner}
      </Link>
    )
  }

  const nothing = typed && index !== undefined && sections.length === 0

  return (
    <Overlay>
      <div
        className="glass-scrim search-scrim"
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        onClick={(e) => e.target === e.currentTarget && onClose()}
        onKeyDown={onKeyDown}
      >
        <div ref={panelRef} className="glass-dialog search-panel">
          <div className="search-head">
            <label className="search-field">
              <Icon name="search" size={20} />
              <span className="sr-only">Search everything</span>
              <input
                ref={inputRef}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Search jobs, people, plates…"
                value={query}
                onChange={(e) => onType(e.target.value)}
                aria-controls="search-results"
              />
              {query && (
                <button
                  type="button"
                  className="search-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    onType('')
                    inputRef.current?.focus()
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </label>
            <button type="button" className="search-cancel" onClick={onClose}>
              <span className="search-cancel-word">Cancel</span>
              <kbd className="search-cancel-key">Esc</kbd>
            </button>
          </div>

          {/* Dragging the list drops the phone's keyboard, so the rows it was
              covering can be read. */}
          <div
            id="search-results"
            className="search-body"
            onTouchMove={() => inputRef.current?.blur()}
          >
            {/* A list that could not be read is named. It is never folded into
                "nothing matches". */}
            {failedKinds.length > 0 && (
              <div className="search-note is-failed" role="status">
                <span>
                  Could not read {listWords(failedKinds.map((k) => KIND_WORDS[k].plural))}, so{' '}
                  {failedKinds.length === 1 ? 'that list is' : 'those lists are'} not being searched.
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setIndex(undefined)
                    load()
                  }}
                >
                  Try again
                </button>
              </div>
            )}

            {index === undefined && (
              <div className="search-note" role="status">
                {typed ? 'Searching…' : 'Loading your records…'}
              </div>
            )}

            {sections.map((s) => {
              const start = offsets.get(s.id) ?? 0
              return (
                <section key={s.id} className="search-sec" aria-label={s.heading}>
                  <h2 className="search-heading">{s.heading}</h2>
                  <div className={s.layout === 'tiles' ? 'search-tiles' : 'search-rows'}>
                    {s.items.map((item, i) => renderItem(item, start + i, s.layout, s.accent))}
                  </div>
                  {s.more && (
                    <button
                      type="button"
                      className="search-more"
                      onClick={() => {
                        const kind = s.more!.kind
                        setExpanded((prev) => new Set(prev).add(kind))
                      }}
                    >
                      Show all {s.more.total} {KIND_WORDS[s.more.kind].plural}
                    </button>
                  )}
                </section>
              )
            })}

            {nothing && (
              <div className="search-note" role="status">
                {failedKinds.length > 0 ? (
                  <>Nothing matches “{query.trim()}” in the lists that could be read.</>
                ) : (
                  <>
                    Nothing matches “{query.trim()}”. Search looks at job numbers and titles, customer
                    names, plates, VINs, tail and serial numbers, quotes and invoices.
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
