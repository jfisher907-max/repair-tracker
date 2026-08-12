'use client'

import { useEffect, useState } from 'react'

export type ReceiptKind = 'image' | 'pdf' | 'file'

const ZOOMS = [1, 1.5, 2, 3, 4]

/**
 * The receipt, big enough to actually read while typing its lines into the
 * form beside it. Images get zoom + rotate (phone photos land sideways);
 * PDFs render in the browser's own viewer. Either can go full screen, or
 * pop into a second tab for a two-monitor setup.
 *
 * Zoom pans inside this pane only — the page itself never scrolls sideways.
 */
export default function ReceiptPreview({
  url,
  kind,
  fileName,
  label,
}: {
  url: string | null
  kind: ReceiptKind
  fileName: string
  label?: string
}) {
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(0)
  const [full, setFull] = useState(false)

  // Esc closes full screen, and the page behind it shouldn't scroll.
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [full])

  const isImage = kind === 'image' && url
  const isPdf = kind === 'pdf' && url

  const controls = (
    <div className="flex flex-wrap items-center gap-1">
      {isImage && (
        <>
          <button
            className="btn btn-sm !min-h-[34px] !px-2"
            aria-label="Zoom out"
            disabled={zoom <= ZOOMS[0]}
            onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] ?? ZOOMS[0])}
          >
            −
          </button>
          <span className="min-w-[34px] text-center text-xs" style={{ color: 'var(--text3)' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="btn btn-sm !min-h-[34px] !px-2"
            aria-label="Zoom in"
            disabled={zoom >= ZOOMS[ZOOMS.length - 1]}
            onClick={() =>
              setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] ?? z)
            }
          >
            +
          </button>
          <button
            className="btn btn-sm !min-h-[34px] !px-2"
            aria-label="Rotate"
            title="Rotate"
            onClick={() => setRot((r) => (r + 90) % 360)}
          >
            ↻
          </button>
        </>
      )}
      {url && (
        <>
          <button
            className="btn btn-sm !min-h-[34px] !px-2"
            aria-label={full ? 'Exit full screen' : 'Full screen'}
            title={full ? 'Exit full screen' : 'Full screen'}
            onClick={() => setFull(!full)}
          >
            {full ? '✕' : '⛶'}
          </button>
          <a
            className="btn btn-sm !min-h-[34px] !px-2"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in new tab"
            title="Open in a new tab"
          >
            ↗
          </a>
        </>
      )}
    </div>
  )

  // An explicit height (not max-height) so the scrolling pane inside can
  // resolve `h-full` and clip properly.
  const body = (
    <div className={full ? 'min-h-0 flex-1' : 'h-[44vh] lg:h-[calc(100dvh-17rem)] lg:min-h-[320px]'}>
      {isImage ? (
        <ZoomableImage key={url} url={url} zoom={zoom} rot={rot} />
      ) : isPdf ? (
        <iframe
          src={url}
          title={fileName || 'Receipt PDF'}
          className="h-full w-full rounded-lg border-0"
          style={{ background: '#fff' }}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 py-8 text-center">
          <span className="text-4xl">🧾</span>
          <span className="text-xs" style={{ color: 'var(--text3)' }}>
            {fileName || 'No preview available'}
          </span>
        </div>
      )}
    </div>
  )

  return (
    <>
      <div className="card flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label !mb-0 truncate">
            {label ?? (kind === 'pdf' ? 'PDF receipt' : 'Receipt')}
          </span>
          {controls}
        </div>
        {body}
        {fileName && (
          <span className="truncate text-xs" style={{ color: 'var(--text3)' }}>{fileName}</span>
        )}
      </div>

      {full && (
        <div
          className="fixed inset-0 z-50 flex flex-col gap-2 p-3"
          style={{ background: 'rgba(6,8,12,0.94)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Receipt preview"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">{fileName || 'Receipt'}</span>
            {controls}
          </div>
          {body}
        </div>
      )}
    </>
  )
}

/**
 * Zoom is width-driven: at 100% the image exactly fits the pane, so there is
 * nothing to pan until you deliberately zoom in. Rotation swaps the box the
 * image occupies, which is why the stage is sized in pixels rather than by
 * the image's own layout.
 */
function ZoomableImage({ url, zoom, rot }: { url: string; zoom: number; rot: number }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const quarter = rot % 180 !== 0

  // Measure off-DOM: a blob: image usually finishes loading before React can
  // attach an onLoad handler, so relying on that event silently loses the
  // dimensions — and with them, rotation.
  useEffect(() => {
    let cancelled = false
    const probe = new Image()
    probe.onload = () => {
      if (!cancelled) setNat({ w: probe.naturalWidth, h: probe.naturalHeight })
    }
    probe.src = url
    return () => {
      cancelled = true
    }
  }, [url])

  // Everything is a percentage of the pane, so nothing depends on measuring it:
  // at 100% the receipt fits exactly, and only a deliberate zoom creates
  // something to pan. A quarter turn swaps the box the image occupies, so the
  // wrapper takes the inverted aspect ratio and the image is sized against it.
  const aspect = nat ? nat.w / nat.h : 1
  const rotated = quarter && nat

  return (
    <div className="h-full overflow-auto rounded-lg" style={{ background: 'var(--bg2)' }}>
      {rotated ? (
        <div
          style={{
            position: 'relative',
            width: `${zoom * 100}%`,
            aspectRatio: `${nat.h} / ${nat.w}`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Receipt"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: `${aspect * 100}%`,
              height: `${100 / aspect}%`,
              maxWidth: 'none',
              transform: `translate(-50%, -50%) rotate(${rot}deg)`,
            }}
          />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Receipt"
          style={{
            display: 'block',
            width: `${zoom * 100}%`,
            maxWidth: 'none',
            transform: rot === 180 ? 'rotate(180deg)' : undefined,
          }}
        />
      )}
    </div>
  )
}
