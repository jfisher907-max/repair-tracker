'use client'

import { useEffect, useState } from 'react'

interface Shot {
  url: string
  caption: string | null
}

/**
 * The photo strip on a customer's quote or invoice.
 *
 * Fetches through /api/photos, which verifies the token server-side and mints
 * short-lived signed URLs — the storage bucket itself stays private. Renders
 * nothing at all when there are no photos to show, so a document without them
 * looks deliberate rather than broken.
 *
 * no-print: the frozen document below is the record. "Tap a photo" means
 * nothing on paper.
 */
export default function SharedPhotos({
  token,
  kind,
  title,
}: {
  token: string
  kind: 'quote' | 'invoice'
  title: string
}) {
  const [shots, setShots] = useState<Shot[]>([])

  useEffect(() => {
    let alive = true
    fetch(`/api/photos?token=${encodeURIComponent(token)}&kind=${kind}`)
      .then((r) => r.json())
      .then((b) => {
        if (alive && Array.isArray(b?.photos)) setShots(b.photos)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [token, kind])

  if (shots.length === 0) return null

  return (
    <div className="no-print mx-auto max-w-2xl px-4 pb-2 pt-3">
      <div className="card space-y-2">
        <span className="label !mb-0">{title}</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shots.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-lg border"
              style={{ borderColor: 'var(--border)' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.url}
                alt={s.caption || 'Photo from the shop'}
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
              {s.caption && (
                <span className="block px-2 py-1 text-xs" style={{ color: 'var(--text2)' }}>
                  {s.caption}
                </span>
              )}
            </a>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          Tap a photo to see it full size.
        </p>
      </div>
    </div>
  )
}
