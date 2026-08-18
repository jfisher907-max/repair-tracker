'use client'

import { useCallback, useEffect, useState } from 'react'
import ReceiptPreview from '@/components/ReceiptPreview'
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
 * read back through short-lived signed URLs.
 */
export default function JobPhotos({ jobId }: { jobId: string }) {
  const [photos, setPhotos] = useState<JobPhoto[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [viewing, setViewing] = useState<JobPhoto | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('job_photos')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at')
    const rows = (data as JobPhoto[]) ?? []
    setPhotos(rows)
    if (rows.length) {
      const { data: signed } = await supabase.storage
        .from('receipts')
        .createSignedUrls(
          rows.map((p) => p.storage_path),
          3600,
        )
      const map: Record<string, string> = {}
      for (const s of signed ?? []) {
        if (s.signedUrl && s.path) map[s.path] = s.signedUrl
      }
      setUrls(map)
    }
  }, [jobId])

  useEffect(() => {
    load()
  }, [load])

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
                onClick={() => setViewing(p)}
                aria-label={p.caption || 'Open photo'}
              >
                {urls[p.storage_path] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={urls[p.storage_path]}
                    alt={p.caption || 'Job photo'}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <span className="flex aspect-square items-center justify-center text-2xl">🖼️</span>
                )}
              </button>
              <div className="space-y-1 p-1.5">
                <input
                  className="input !min-h-[32px] !text-xs"
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

      {viewing && urls[viewing.storage_path] && (
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
          <div className="min-h-0 flex-1">
            <ReceiptPreview
              url={urls[viewing.storage_path]}
              kind="image"
              fileName={viewing.caption || ''}
              label="Photo"
            />
          </div>
        </div>
      )}
    </div>
  )
}
