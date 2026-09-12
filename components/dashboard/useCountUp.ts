'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { bigFigure, type FigureKind } from './format'

const DURATION = 600
const START_DELAY = 150

/**
 * A figure that counts up from zero over 600ms on arrival and lands on the
 * exact text. Part of the page's one orchestrated arrival, so it runs once per
 * value — a year change is data motion and replays it. Skipped entirely under
 * prefers-reduced-motion, and guarded by a timer so a background tab (where
 * requestAnimationFrame pauses) still lands the exact figure.
 *
 * The animation writes the element's text directly (the DOM is the external
 * system here); React renders the final text, so the markup is always right
 * before, after, and without JavaScript.
 */
export function useCountUp(kind: FigureKind, target: number): [RefObject<HTMLDivElement | null>, string] {
  const ref = useRef<HTMLDivElement | null>(null)
  const finalText = bigFigure(kind, target)

  useEffect(() => {
    const el = ref.current
    if (!el || !Number.isFinite(target)) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      el.textContent = finalText
      return
    }
    let raf = 0
    let start: number | null = null
    let done = false
    el.textContent = bigFigure(kind, 0)
    const step = (ts: number) => {
      if (done) return
      if (start === null) start = ts
      const t = Math.min(1, (ts - start) / DURATION)
      const eased = 1 - Math.pow(1 - t, 3)
      if (t < 1) {
        el.textContent = bigFigure(kind, target * eased)
        raf = requestAnimationFrame(step)
      } else {
        done = true
        el.textContent = finalText
      }
    }
    const kick = window.setTimeout(() => {
      raf = requestAnimationFrame(step)
    }, START_DELAY)
    const land = window.setTimeout(() => {
      done = true
      el.textContent = finalText
    }, START_DELAY + DURATION + 60)
    return () => {
      done = true
      window.clearTimeout(kick)
      window.clearTimeout(land)
      cancelAnimationFrame(raf)
      el.textContent = finalText
    }
  }, [kind, target, finalText])

  return [ref, finalText]
}
