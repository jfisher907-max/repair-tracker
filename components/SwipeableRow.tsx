'use client'

import { useRef, useState, type ReactNode, type TouchEvent, type MouseEvent } from 'react'

/** How much of the delete action is revealed by a full swipe. */
const REVEAL = 92

/**
 * iOS-style swipe-left-to-delete for list rows. Touch only — desktop keeps
 * the Delete buttons on the detail pages. Design constraints:
 *
 * - Direction-locked: a gesture is either a horizontal swipe or a vertical
 *   scroll, decided by its first movement, never both (touch-action: pan-y
 *   keeps native scrolling alive).
 * - The row's own tap (usually a Link) must not fire after a swipe, and a
 *   tap on an open row closes it instead of navigating.
 * - Delete always confirms — a swipe is too cheap a gesture to destroy
 *   money records without a second look.
 */
export default function SwipeableRow({
  enabled = true,
  confirmText,
  onDelete,
  deleteLabel = 'Delete',
  children,
}: {
  /** Rows that must never be deleted simply don't swipe. */
  enabled?: boolean
  confirmText: string
  onDelete: () => Promise<void>
  deleteLabel?: string
  children: ReactNode
}) {
  const [dx, setDx] = useState(0)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const lock = useRef<'h' | 'v' | null>(null)
  const swiped = useRef(false)

  if (!enabled) return <>{children}</>

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY }
    lock.current = null
  }

  function onTouchMove(e: TouchEvent) {
    if (!start.current) return
    const t = e.touches[0]
    const ddx = t.clientX - start.current.x
    const ddy = t.clientY - start.current.y
    if (!lock.current) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return
      lock.current = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v'
      if (lock.current === 'h') setDragging(true)
    }
    if (lock.current !== 'h') return
    swiped.current = true
    const base = open ? -REVEAL : 0
    setDx(Math.max(-REVEAL - 28, Math.min(0, base + ddx)))
  }

  function onTouchEnd() {
    if (lock.current === 'h') {
      const shouldOpen = dx < -REVEAL / 2
      setOpen(shouldOpen)
      setDx(shouldOpen ? -REVEAL : 0)
    }
    setDragging(false)
    start.current = null
    lock.current = null
    // The ghost click from THIS gesture (if the browser fires one) arrives
    // before this timeout; the next real tap must not be eaten by it.
    setTimeout(() => {
      swiped.current = false
    }, 80)
  }

  function onClickCapture(e: MouseEvent) {
    // The ghost click at the end of a swipe must not fire the Link; a real
    // tap on an open row closes it instead of navigating.
    if (swiped.current) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      setDx(0)
    }
  }

  async function doDelete() {
    if (busy) return
    if (!confirm(confirmText)) {
      setOpen(false)
      setDx(0)
      return
    }
    setBusy(true)
    try {
      await onDelete()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setOpen(false)
      setDx(0)
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl" style={{ touchAction: 'pan-y' }}>
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex flex-col items-center justify-center text-xs font-bold"
        style={{ width: REVEAL, background: 'var(--red)', color: '#fff' }}
        onClick={doDelete}
        disabled={busy}
        aria-label={deleteLabel}
        tabIndex={open ? 0 : -1}
      >
        <span className="text-lg leading-none">🗑</span>
        {busy ? 'Deleting…' : deleteLabel}
      </button>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={onClickCapture}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 180ms ease',
        }}
      >
        {children}
      </div>
    </div>
  )
}
