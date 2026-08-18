'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { prepareUpload } from '@/lib/upload'

interface JobPhoto {
  id: string
  job_id: string
  storage_path: string
  caption: string | null
  customer_visible: boolean
  created_at: string
}

/**
 * Photos of the vehicle itself — the worn pad, the pre-existing dent, the
 * finished repair. Capture opens straight to the camera on a phone; files go
 * to the same private bucket as receipts under a job-photos/ prefix, and are
 * read back through signed URLs.
 *
 * Signed URLs die, and phones keep this page alive long past their expiry:
 * an installed PWA resumed the next morning re-fetches every image against
 * dead links — no previews, dead taps. So the card heals itself: URLs are
 * re-signed when stale or failed, on foreground, and on tap.
 */

/** Sign for 12h, and treat anything older than expiry-minus-5min as stale. */
const SIGN_TTL_SECONDS = 12 * 3600
const RESIGN_AGE_MS = (SIGN_TTL_SECONDS - 300) * 1000

export default function JobPhotos({ jobId }: { jobId: string }) {
  const [photos, setPhotos] = useState<JobPhoto[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [signFailed, setSignFailed] = useState(false)
  const [viewing, setViewing] = useState<JobPhoto | null>(null)
  /** Mirrors `urls` so load() can skip already-signed paths without depending on it. */
  const signedRef = useRef<Record<string, string>>({})
  /** When each path was signed, to re-sign before links expire under a long-lived page. */
  const signedAtRef = useRef<Record<string, number>>({})
  /** One automatic retry per broken image per mount — heals, never loops. */
  const retriedRef = useRef<Set<string>>(new Set())

  // Escape closes the viewer, and the page behind it must not scroll.
  useEffect(() => {
    if (!viewing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewing(null)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [viewing])

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('job_photos')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at')
    const rows = (data as JobPhoto[]) ?? []
    setPhotos(rows)
    const now = Date.now()
    const unsigned = rows.filter((p) => {
      const at = signedAtRef.current[p.storage_path]
      return !signedRef.current[p.storage_path] || at == null || now - at > RESIGN_AGE_MS
    })
    if (unsigned.length) {
      const { data: signed, error: signErr } = await supabase.storage
        .from('receipts')
        .createSignedUrls(
          unsigned.map((p) => p.storage_path),
          SIGN_TTL_SECONDS,
        )
      if (signErr) {
        // Leave the placeholders standing but say so — a tap retries, and so
        // does the next return to the foreground. A swallowed error here
        // meant permanently blank tiles on a flaky connection.
        setSignFailed(true)
        return
      }
      const map: Record<string, string> = {}
      for (const s of signed ?? []) {
        if (s.signedUrl && s.path) {
          map[s.path] = s.signedUrl
          signedAtRef.current[s.path] = now
        }
      }
      // Merge rather than replace: a caption edit re-runs load(), and swapping
      // in fresh URLs would make every thumbnail in the grid download again.
      signedRef.current = { ...signedRef.current, ...map }
      setUrls((prev) => ({ ...prev, ...map }))
      setSignFailed(false)
    }
  }, [jobId])

  useEffect(() => {
    load()
  }, [load])

  // A phone resuming this page hours later has expired links — re-sign on
  // foreground. Cheap when nothing is stale: one table read, no signing.
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    return () => {
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
    }
  }, [load])

  /** A broken image (expired or half-fetched link) evicts itself and re-signs once. */
  function imgFailed(p: JobPhoto) {
    if (retriedRef.current.has(p.storage_path)) return
    retriedRef.current.add(p.storage_path)
    delete signedRef.current[p.storage_path]
    delete signedAtRef.current[p.storage_path]
    setUrls((prev) => {
      const next = { ...prev }
      delete next[p.storage_path]
      return next
    })
    load()
  }

  async function addFiles(list: FileList) {
    setBusy(true)
    setNote(`Uploading ${list.length} photo${list.length === 1 ? '' : 's'}…`)
    let failed = 0
    for (const picked of Array.from(list)) {
      try {
        const { file } = await prepareUpload(picked)
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `job-photos/${jobId}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage.from('receipts').upload(path, file, {
          contentType: file.type || 'application/octet-stream',
        })
        if (upErr) throw upErr
        const { error } = await supabase
          .from('job_photos')
          .insert({ job_id: jobId, storage_path: path })
        if (error) throw error
      } catch {
        failed += 1
      }
    }
    setBusy(false)
    setNote(failed ? `${failed} photo${failed === 1 ? '' : 's'} failed to upload.` : '')
    setTimeout(() => setNote(''), 4000)
    await load()
  }

  async function setCaption(p: JobPhoto, caption: string) {
    await supabase
      .from('job_photos')
      .update({ caption: caption.trim() || null })
      .eq('id', p.id)
    await load()
  }

  async function toggleVisible(p: JobPhoto) {
    await supabase
      .from('job_photos')
      .update({ customer_visible: !p.customer_visible })
      .eq('id', p.id)
    await load()
  }

  async function remove(p: JobPhoto) {
    if (!confirm('Delete this photo? The file is removed for good.')) return
    await supabase.storage.from('receipts').remove([p.storage_path])
    await supabase.from('job_photos').delete().eq('id', p.id)
    delete signedRef.current[p.storage_path]
    delete signedAtRef.current[p.storage_path]
    retriedRef.current.delete(p.storage_path)
    if (viewing?.id === p.id) setViewing(null)
    await load()
  }

  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label !mb-0">Photos{photos?.length ? ` (${photos.length})` : ''}</span>
        <div className="flex items-center gap-2">
          {note && (
            <span className="flash-in text-xs" style={{ color: 'var(--text2)' }}>{note}</span>
          )}
          <label className="btn btn-sm cursor-pointer">
            {busy ? 'Working…' : '📷 Add photos'}
            <input
              type="file"
              accept="image/*"
              // Opens the camera directly on a phone rather than the library.
              capture="environment"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      </div>

      {signFailed && (
        <p className="text-xs" style={{ color: 'var(--red)' }}>
          Previews couldn’t load — check the connection, then tap a photo to retry.
        </p>
      )}

      {photos && photos.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          No photos yet. Shoot the fault before you fix it and the finished work after — it sells
          the job, and it settles arguments about what the car looked like when it arrived.
        </p>
      )}

      {photos && photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p) => (
            <div
              key={p.id}
              className="overflow-hidden rounded-lg border"
              style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
            >
              <button
                className="block w-full"
                onClick={() => {
                  setViewing(p)
                  // A tile with no link means signing failed or expired — the
                  // tap is the retry, never a dead end.
                  if (!signedRef.current[p.storage_path]) load()
                }}
                aria-label={p.caption || 'Open photo'}
              >
                {urls[p.storage_path] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={urls[p.storage_path]}
                    alt={p.caption || 'Job photo'}
                    className="aspect-square w-full object-cover"
                    onError={() => imgFailed(p)}
                  />
                ) : (
                  <span className="flex aspect-square items-center justify-center text-2xl">🖼️</span>
                )}
              </button>
              <div className="space-y-1 p-1.5">
                <input
                  className="input !min-h-[44px]" style={{ fontSize: 16 }}
                  placeholder="Caption"
                  defaultValue={p.caption ?? ''}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== (p.caption ?? '')) setCaption(p, e.target.value)
                  }}
                />
                <div className="flex items-center justify-between gap-1">
                  <button
                    className="btn btn-sm !min-h-[30px] !px-1.5 !text-[0.65rem]"
                    style={
                      p.customer_visible
                        ? { borderColor: 'var(--green)', color: 'var(--green)' }
                        : undefined
                    }
                    onClick={() => toggleVisible(p)}
                    title="Mark this photo as one the customer may see"
                  >
                    {p.customer_visible ? '👁 Customer' : 'Internal'}
                  </button>
                  <button
                    className="btn btn-sm btn-danger !min-h-[30px] !px-1.5"
                    aria-label="Delete photo"
                    onClick={() => remove(p)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex flex-col gap-2 p-3"
          style={{ background: 'rgba(6,8,12,0.94)' }}
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">{viewing.caption || 'Photo'}</span>
            <button className="btn btn-sm" onClick={() => setViewing(null)}>✕ Close</button>
          </div>
          {/* The image directly, not a card inside a card — the previous
              version nested a second full-screen viewer and left most of the
              screen unused. Pinch-zoom works because the viewport allows it. */}
          {urls[viewing.storage_path] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={urls[viewing.storage_path]}
              alt={viewing.caption || 'Job photo'}
              className="min-h-0 w-full flex-1 object-contain"
              onError={() => imgFailed(viewing)}
            />
          ) : (
            <div
              className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm"
              style={{ color: 'var(--text3)' }}
            >
              {signFailed
                ? 'The photo link couldn’t be fetched — check the connection, close this, and tap the photo again.'
                : 'Loading photo…'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
