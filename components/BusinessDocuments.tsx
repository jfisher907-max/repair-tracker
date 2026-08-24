'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { prepareUpload } from '@/lib/upload'
import { formatDate, todayLocalIso } from '@/lib/date'
import { addDays } from '@/lib/reminders'

export interface BusinessDocument {
  id: string
  name: string
  storage_path: string
  mime_type: string | null
  expires_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Days of warning before a license or policy lapses. */
export const DOC_WARN_DAYS = 30

export type DocState = 'ok' | 'soon' | 'expired'

export function docState(d: Pick<BusinessDocument, 'expires_at'>, today = todayLocalIso()): DocState {
  if (!d.expires_at) return 'ok'
  if (d.expires_at < today) return 'expired'
  if (d.expires_at <= addDays(today, DOC_WARN_DAYS)) return 'soon'
  return 'ok'
}

export async function listBusinessDocuments(): Promise<BusinessDocument[]> {
  const { data, error } = await supabase
    .from('business_documents')
    .select('*')
    .order('expires_at', { ascending: true, nullsFirst: false })
  if (error) throw new Error(error.message)
  return (data as BusinessDocument[]) ?? []
}

const SUGGESTED = ['Business license', 'Liability insurance', 'Resale certificate', 'EPA 609']

/**
 * The shop's own paperwork — license, insurance, certifications — with the
 * expiry dates that actually matter. Files go to the private receipts bucket
 * under business-docs/ and come back through signed URLs, same as receipts.
 */
export default function BusinessDocuments() {
  const [docs, setDocs] = useState<BusinessDocument[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [expires, setExpires] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    try {
      setDocs(await listBusinessDocuments())
    } catch (e) {
      setMsg({ text: `Couldn't load documents: ${e instanceof Error ? e.message : e}`, ok: false })
      setDocs([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    if (busy) return
    if (!name.trim()) return setMsg({ text: 'Give the document a name.', ok: false })
    if (!file) return setMsg({ text: 'Pick the PDF or photo to attach.', ok: false })
    setBusy(true)
    setMsg(null)
    try {
      const { file: prepared, kind } = await prepareUpload(file)
      const ext =
        kind === 'pdf' ? 'pdf' : (prepared.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `business-docs/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('receipts').upload(path, prepared, {
        contentType:
          prepared.type || (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
      })
      if (upErr) throw upErr
      const { error } = await supabase.from('business_documents').insert({
        name: name.trim(),
        storage_path: path,
        mime_type: prepared.type || null,
        expires_at: expires || null,
        notes: notes.trim() || null,
      })
      if (error) {
        // Don't strand an orphan file if the row didn't land.
        await supabase.storage.from('receipts').remove([path])
        throw error
      }
      setAdding(false)
      setName('')
      setExpires('')
      setNotes('')
      setFile(null)
      setMsg({ text: 'Saved ✓', ok: true })
      setTimeout(() => setMsg(null), 3000)
      await load()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), ok: false })
    } finally {
      setBusy(false)
    }
  }

  async function open(d: BusinessDocument) {
    // Open the window synchronously — iOS discards the tap's popup permission
    // across an await (the Expenses 📎 lesson).
    const win = window.open('about:blank', '_blank')
    const { data } = await supabase.storage.from('receipts').createSignedUrl(d.storage_path, 3600)
    if (data?.signedUrl && win) win.location.href = data.signedUrl
    else {
      win?.close()
      setMsg({ text: 'Couldn’t open that file — check the connection and try again.', ok: false })
    }
  }

  async function remove(d: BusinessDocument) {
    if (!confirm(`Delete “${d.name}”? The file is removed for good.`)) return
    await supabase.storage.from('receipts').remove([d.storage_path])
    const { error } = await supabase.from('business_documents').delete().eq('id', d.id)
    if (error) return setMsg({ text: error.message, ok: false })
    await load()
  }

  const today = todayLocalIso()

  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <span className="label !mb-0">Business documents</span>
        {!adding && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            + Add
          </button>
        )}
      </div>

      {docs == null ? (
        <p className="text-sm" style={{ color: 'var(--text3)' }}>Loading…</p>
      ) : docs.length === 0 && !adding ? (
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          License, insurance certificate, resale certificate, EPA card — the PDFs someone asks
          for at the worst moment. Add an expiry date and the dashboard warns you 30 days
          before it lapses.
        </p>
      ) : (
        docs.map((d) => {
          const state = docState(d, today)
          return (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="min-w-0">
                <span className="font-semibold">{d.name}</span>
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  {d.expires_at ? (
                    <span
                      style={
                        state === 'expired'
                          ? { color: 'var(--red)', fontWeight: 600 }
                          : state === 'soon'
                            ? { color: 'var(--orange)', fontWeight: 600 }
                            : undefined
                      }
                    >
                      {state === 'expired' ? 'expired ' : 'expires '}
                      {formatDate(d.expires_at)}
                    </span>
                  ) : (
                    'no expiry'
                  )}
                  {d.notes && ` · ${d.notes}`}
                </div>
              </div>
              <div className="flex flex-none items-center gap-2">
                <button className="btn btn-sm" onClick={() => open(d)}>
                  <span className="emoji-mobile">📄 </span>Open
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  aria-label={`Delete ${d.name}`}
                  onClick={() => remove(d)}
                >
                  ✕
                </button>
              </div>
            </div>
          )
        })
      )}

      {adding && (
        <form
          className="space-y-2 border-t pt-2"
          style={{ borderColor: 'var(--border)' }}
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="flex flex-wrap gap-1">
            {SUGGESTED.map((n) => (
              <button
                key={n}
                type="button"
                className="chip"
                style={{ background: 'var(--bg3)', cursor: 'pointer' }}
                onClick={() => setName(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <input
            className="input"
            placeholder="What is it — e.g. Liability insurance"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="label">Expires (optional)</span>
              <input
                className="input"
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </div>
            <div>
              <span className="label">Notes</span>
              <input
                className="input"
                placeholder="Policy #, issuer…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <label className="btn w-full cursor-pointer">
            <span className="emoji-mobile">📎 </span>
            {file ? file.name : 'Choose PDF or photo'}
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? 'Uploading…' : 'Save document'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setAdding(false)
                setFile(null)
                setMsg(null)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {msg && (
        <p className="flash-in text-sm" style={{ color: msg.ok ? 'var(--green)' : 'var(--red)' }}>
          {msg.text}
        </p>
      )}

      {/* The brand files live in the bundle, not the database — they're part
          of the app, so they're always one tap away on any device. */}
      <div className="border-t pt-2" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="min-w-0">
            <span className="font-semibold">Logo files</span>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>
              Email signature, social, print — PNG and SVG
            </div>
          </div>
          <div className="flex flex-none items-center gap-2">
            <a className="btn btn-sm" href="/brand/wings-n-things-logo-email.png" download>
              <span className="emoji-mobile">⬇ </span>Email logo
            </a>
            <a className="btn btn-sm" href="/brand/wings-n-things-brand.zip" download>
              <span className="emoji-mobile">⬇ </span>All files
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
