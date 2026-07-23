'use client'

import Link from 'next/link'
import { use, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken, supabase } from '@/lib/supabase'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import type { ExtractionResult } from '@/lib/types'

interface ReviewLine {
  part_number: string
  description: string
  qty: string
  unit_cost: string
  confidence: 'high' | 'low'
}

type Phase = 'pick' | 'working' | 'review'

const RENDERABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/**
 * Normalize the picked file for storage + AI reading. PDFs pass through
 * (Claude reads them natively). iPhone HEIC photos get converted to JPEG
 * on-device — Safari can decode its own HEIC — so they render everywhere
 * and the extractor accepts them. If the browser can't decode the format,
 * the original uploads as-is (still viewable/downloadable, entry is manual).
 */
async function prepareUpload(file: File): Promise<{ file: File; kind: 'image' | 'pdf' | 'file' }> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { file, kind: 'pdf' }
  if (RENDERABLE.includes(file.type)) return { file, kind: 'image' }
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.87))
    if (!blob) throw new Error('conversion produced no data')
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return { file: new File([blob], name, { type: 'image/jpeg' }), kind: 'image' }
  } catch {
    return { file, kind: 'file' }
  }
}

/**
 * Receipt scan flow: photo → upload → AI extraction → mandatory review screen.
 * AI output is never written to the database unreviewed. If there's no API key,
 * or extraction fails, the same review screen opens empty for manual typing —
 * manual entry is a first-class path, not an error state.
 */
export default function ScanReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = use(params)
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('pick')
  const [statusMsg, setStatusMsg] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoKind, setPhotoKind] = useState<'image' | 'pdf' | 'file'>('image')
  const [fileName, setFileName] = useState('')
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)
  const [extracted, setExtracted] = useState(false)

  const [store, setStore] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [receiptTotal, setReceiptTotal] = useState('')
  const [rows, setRows] = useState<ReviewLine[]>([])
  const [storeSuggestions, setStoreSuggestions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('settings')
      .select('store_suggestions')
      .single()
      .then(({ data }) => setStoreSuggestions(data?.store_suggestions ?? []))
    getAccessToken().then(async (token) => {
      try {
        const res = await fetch('/api/ai-status', { headers: { Authorization: `Bearer ${token}` } })
        const body = await res.json()
        setAiConfigured(!!body.configured)
      } catch {
        setAiConfigured(false)
      }
    })
  }, [])

  const runningTotalCents = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const qty = Number(r.qty) || 0
        const unit = parseMoney(r.unit_cost) ?? 0
        return sum + Math.round(qty * unit)
      }, 0),
    [rows],
  )
  const printedTotalCents = parseMoney(receiptTotal)
  const mismatch = printedTotalCents != null && Math.abs(printedTotalCents - runningTotalCents) > 0

  async function onPickFile(picked: File) {
    setPhase('working')
    setNotice(null)
    setStatusMsg('Preparing file…')
    const { file, kind } = await prepareUpload(picked)
    setPhotoKind(kind)
    setFileName(file.name)
    setPhotoUrl(kind === 'image' ? URL.createObjectURL(file) : null)
    try {
      setStatusMsg('Uploading…')
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${jobId}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('receipts').upload(path, file, {
        contentType: file.type || 'application/octet-stream',
      })
      if (upErr) throw upErr

      const { data: rec, error: recErr } = await supabase
        .from('receipts')
        .insert({ job_id: jobId, storage_path: path })
        .select('id')
        .single()
      if (recErr) throw recErr
      setReceiptId(rec.id)

      if (!aiConfigured) {
        setNotice('AI extraction isn’t set up (no API key on the server) — type the lines in below. The photo is saved either way.')
        setPhase('review')
        return
      }

      setStatusMsg('Reading the receipt…')
      const token = await getAccessToken()
      const res = await fetch('/api/extract-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ receiptId: rec.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setNotice(
          `Couldn’t read the receipt automatically (${body.error ?? res.status}) — enter the lines by hand. The photo is saved.`,
        )
        setPhase('review')
        return
      }
      const extraction: ExtractionResult = await res.json()
      setStore(extraction.store ?? '')
      setPurchaseDate(extraction.purchase_date ?? '')
      setReceiptTotal(extraction.receipt_total != null ? extraction.receipt_total.toFixed(2) : '')
      setRows(
        extraction.lines.map((l) => ({
          part_number: l.part_number ?? '',
          description: l.description,
          qty: String(l.qty),
          unit_cost: l.unit_cost.toFixed(2),
          confidence: l.confidence,
        })),
      )
      setExtracted(true)
      setNotice('Check every line against the photo before saving — low-confidence values are highlighted.')
      setPhase('review')
    } catch (e) {
      setNotice(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
      setPhase('pick')
    }
  }

  async function confirmSave() {
    if (!receiptId) return
    const valid = rows.filter((r) => r.description.trim())
    setSaving(true)
    try {
      const { error: recErr } = await supabase
        .from('receipts')
        .update({
          store: store.trim() || null,
          purchase_date: purchaseDate || null,
          receipt_total_cents: parseMoney(receiptTotal),
          extraction_status: extracted ? 'extracted' : 'manual',
        })
        .eq('id', receiptId)
      if (recErr) throw recErr

      if (valid.length) {
        const { error: linesErr } = await supabase.from('part_lines').insert(
          valid.map((r) => ({
            job_id: jobId,
            receipt_id: receiptId,
            store: store.trim() || null,
            purchase_date: purchaseDate || null,
            part_number: r.part_number.trim() || null,
            description: r.description.trim(),
            qty: Number(r.qty) || 1,
            unit_cost_cents: parseMoney(r.unit_cost) ?? 0,
          })),
        )
        if (linesErr) throw linesErr
      }
      router.push(`/jobs/${jobId}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  function setRow(i: number, patch: Partial<ReviewLine>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">Scan receipt</h1>
        <Link href={`/jobs/${jobId}`} className="btn btn-sm">← Back to job</Link>
      </div>

      {phase === 'pick' && (
        <div className="card space-y-3 text-center">
          <div className="text-4xl">🧾</div>
          <p style={{ color: 'var(--text2)' }}>
            Snap a photo of the receipt or pick one from your library. Lines get read
            automatically{aiConfigured === false ? ' (AI not set up — you’ll type them in)' : ''},
            then you review everything before it’s saved.
          </p>
          <label className="btn btn-primary w-full cursor-pointer">
            📷 Photo or PDF
            <input
              type="file"
              accept="image/*,application/pdf,.pdf,.heic,.heif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onPickFile(f)
              }}
            />
          </label>
        </div>
      )}

      {phase === 'working' && (
        <div className="card space-y-3 text-center">
          <div className="animate-pulse text-4xl">🔍</div>
          <p style={{ color: 'var(--text2)' }}>{statusMsg}</p>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="Receipt" className="mx-auto max-h-72 rounded-lg" />
          ) : (
            fileName && (
              <p className="text-3xl">
                {photoKind === 'pdf' ? '📄' : '🧾'}{' '}
                <span className="align-middle text-sm" style={{ color: 'var(--text3)' }}>{fileName}</span>
              </p>
            )
          )}
        </div>
      )}

      {phase === 'review' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            {notice && (
              <div
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--accent-dim)', background: 'var(--bg1)', color: 'var(--accent2)' }}
              >
                {notice}
              </div>
            )}

            <div className="card grid grid-cols-2 gap-2">
              <div>
                <label className="label">Store</label>
                <input
                  className="input"
                  list="scan-stores"
                  value={store}
                  onChange={(e) => setStore(e.target.value)}
                />
                <datalist id="scan-stores">
                  {storeSuggestions.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <label className="label">Date</label>
                <input
                  className="input"
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label className="label">Receipt total (as printed)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={receiptTotal}
                  onChange={(e) => setReceiptTotal(e.target.value)}
                />
              </div>
            </div>

            <div className="card space-y-2">
              <div className="label">Line items</div>
              {rows.map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_64px_88px_36px] items-end gap-1.5 rounded-lg p-1.5"
                  style={r.confidence === 'low' ? { background: '#3d2f1466', outline: '1px solid var(--accent-dim)' } : undefined}
                >
                  <div className="space-y-1">
                    <input
                      className="input !min-h-[40px]"
                      placeholder="Description"
                      value={r.description}
                      onChange={(e) => setRow(i, { description: e.target.value })}
                    />
                    <input
                      className="input !min-h-[34px] text-xs"
                      placeholder="Part #"
                      value={r.part_number}
                      onChange={(e) => setRow(i, { part_number: e.target.value })}
                    />
                  </div>
                  <input
                    className="input !min-h-[40px]"
                    inputMode="decimal"
                    aria-label="Quantity"
                    value={r.qty}
                    onChange={(e) => setRow(i, { qty: e.target.value })}
                  />
                  <input
                    className="input !min-h-[40px]"
                    inputMode="decimal"
                    aria-label="Unit cost"
                    value={r.unit_cost}
                    onChange={(e) => setRow(i, { unit_cost: e.target.value })}
                  />
                  <button
                    className="btn btn-sm btn-danger !min-h-[40px] !px-2"
                    onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                    aria-label="Remove line"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="btn btn-sm w-full"
                onClick={() =>
                  setRows([...rows, { part_number: '', description: '', qty: '1', unit_cost: '', confidence: 'high' }])
                }
              >
                + Add line
              </button>

              <div
                className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{
                  background: mismatch ? '#3d1b1b' : 'var(--bg2)',
                  color: mismatch ? 'var(--red)' : 'var(--green)',
                }}
              >
                <span className="text-sm font-semibold">
                  Lines total {mismatch ? '≠' : '='} printed total
                </span>
                <span className="money font-bold">
                  {formatCents(runningTotalCents)}
                  {printedTotalCents != null && ` / ${formatCents(printedTotalCents)}`}
                </span>
              </div>
              <p className="text-xs" style={{ color: 'var(--text3)' }}>
                Tax and core charges are ordinary lines (“Sales tax”, “Core charge”) so the job’s
                parts cost matches the real receipt. Negative amounts are fine for returns.
              </p>
            </div>

            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" disabled={saving} onClick={confirmSave}>
                {saving ? 'Saving…' : `Save ${rows.filter((r) => r.description.trim()).length} lines + receipt`}
              </button>
              <Link href={`/jobs/${jobId}`} className="btn">Cancel</Link>
            </div>
          </div>

          <div className="card self-start">
            <div className="label">{photoKind === 'pdf' ? 'PDF receipt' : 'Photo'}</div>
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="Receipt" className="w-full rounded-lg" />
            ) : (
              <p className="text-center text-4xl">
                {photoKind === 'pdf' ? '📄' : '🧾'}
                <span className="mt-1 block text-xs" style={{ color: 'var(--text3)' }}>{fileName}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
