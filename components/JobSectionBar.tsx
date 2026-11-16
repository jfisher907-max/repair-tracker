'use client'

import { useEffect, useRef, useState } from 'react'

export interface JobSection {
  /** The section's element id on the page, e.g. "sec-parts". */
  id: string
  label: string
}

/**
 * The job page's sections, one tap each (owner, 2026-11-16).
 *
 * A job page is about three phone screens: Parts sit a screen down, Money
 * two, Invoices below that, and every visit to one of them was a scroll and a
 * hunt. This bar stays under the top buttons and jumps straight to a section;
 * the one in view is lit, so it also says where you are.
 *
 * The page names its sections (it knows which ones it is rendering); this
 * component only reads where they are. It adds no state to the job.
 */
export default function JobSectionBar({ sections }: { sections: JobSection[] }) {
  const bar = useRef<HTMLElement>(null)
  const [active, setActive] = useState<string | null>(null)
  // The list is rebuilt on every render of the page; its ids are what matter.
  const key = sections.map((s) => s.id).join(' ')

  useEffect(() => {
    const ids = key ? key.split(' ') : []
    if (ids.length === 0) return
    let frame = 0
    const read = () => {
      frame = 0
      const el = bar.current
      if (!el) return
      // A section is "in view" once its top has passed under the bar.
      const line = el.getBoundingClientRect().bottom + 16
      let current: string | null = null
      for (const id of ids) {
        const sec = document.getElementById(id)
        if (sec && sec.getBoundingClientRect().top <= line) current = id
      }
      // The last sections of a short page never reach the line: at the very
      // bottom, the last one is the one being read.
      const doc = document.documentElement
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2 && doc.scrollHeight > window.innerHeight + 2) {
        current = ids[ids.length - 1]
      }
      setActive(current)
    }
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    queue()
    window.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', queue)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', queue)
      window.removeEventListener('resize', queue)
    }
  }, [key])

  // Keep the lit chip on screen when the bar itself is wider than the phone.
  // Its own scroller is moved by hand: scrollIntoView here would cut short the
  // page's smooth scroll that a tap just started.
  useEffect(() => {
    const el = bar.current
    if (!el || !active) return
    const chip = el.querySelector<HTMLElement>(`[data-for="${active}"]`)
    if (!chip) return
    const left = chip.offsetLeft - (el.clientWidth - chip.offsetWidth) / 2
    el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [active])

  function go(id: string) {
    const sec = document.getElementById(id)
    if (!sec) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    sec.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
  }

  // One section is not a choice.
  if (sections.length < 2) return null

  return (
    <nav ref={bar} className="glass-float secbar" aria-label="Sections of this job">
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          data-for={s.id}
          className={`secbar-item${active === s.id ? ' on' : ''}`}
          aria-current={active === s.id ? 'true' : undefined}
          onClick={() => go(s.id)}
        >
          {s.label}
        </button>
      ))}
    </nav>
  )
}
