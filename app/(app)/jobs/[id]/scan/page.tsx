'use client'

import Link from 'next/link'
import { use, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken, supabase } from '@/lib/supabase'
import ReceiptPreview from '@/components/ReceiptPreview'
import { prepareUpload } from '@/lib/upload'
import { isSalesTaxLine, loadMarkupConfig, markedUpCharge, type MarkupConfig } from '@/lib/markup'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import {
  BILLED,
  COST_ONLY,
  UNSET,
  classifyRow,
  cleanPartNumber,
  normalizeRef,
  planPlacements,
  quotedPartNumber,
  type RowKind,
  type Slot,
} from '@/lib/receipt-match'
import type { ExtractionResult } from '@/lib/types'

/* Where a receipt row goes on Save (COST_ONLY / BILLED / UNSET, or an awaiting
   approved line's id) is defined with the pairing rules in lib/receipt-match. */

interface ReviewLine {
  part_number: string
  description: string
  qty: string
  unit_cost: string
  confidence: 'high' | 'low'
  /** An awaiting approved line's id, COST_ONLY or BILLED. */
  target: string
}

type Phase = 'pick' | 'working' | 'review' | 'saved-already'

/** What the review screen must know about the job before it can place rows. */
interface ScanContext {
  /** Approved (or template) parts still waiting for their cost. */
  slots: Slot[]
  jobNumber: string
  quoteNumbers: string[]
  /** A sent or paid invoice exists: this receipt may add cost, never charge. */
  locked: boolean
  /** The job came from a quote: rows that weren't on it are shop cost by default. */
  quoted: boolean
}

const EMPTY_CONTEXT: ScanContext = { slots: [], jobNumber: '', quoteNumbers: [], locked: false, quoted: false }

async function loadScanContext(jobId: string): Promise<ScanContext> {
  const [jobRes, slotRes, invRes, quoteRes] = await Promise.all([
    supabase.from('jobs').select('job_number').eq('id', jobId).single(),
    supabase
      .from('part_lines')
      .select('id, description, qty, unit_charge_cents, quote_line_id')
      .eq('job_id', jobId)
      .eq('awaiting_cost', true)
      .order('created_at'),
    supabase.from('invoices').select('status').eq('job_id', jobId),
    supabase.from('quotes').select('quote_number').eq('job_id', jobId).not('applied_at', 'is', null),
  ])
  const raw = (slotRes.data ?? []) as {
    id: string
    description: string
    qty: number
    unit_charge_cents: number | null
    quote_line_id: string | null
  }[]
  const quoteLineIds = raw.map((s) => s.quote_line_id).filter((x): x is string => !!x)
  const quoteLines = new Map<string, { part_number: string | null; unit_cost_cents: number | null }>()
  if (quoteLineIds.length) {
    const { data } = await supabase
      .from('quote_lines')
      .select('id, part_number, unit_cost_cents')
      .in('id', quoteLineIds)
    for (const q of (data ?? []) as {
      id: string
      part_number: string | null
      unit_cost_cents: number | null
    }[])
      quoteLines.set(q.id, q)
  }
  const quotes = (quoteRes.data ?? []) as { quote_number: string }[]
  return {
    slots: raw.map((s) => ({
      id: s.id,
      description: s.description,
      qty: Number(s.qty),
      unit_charge_cents: s.unit_charge_cents,
      quote_part_number: s.quote_line_id ? (quoteLines.get(s.quote_line_id)?.part_number ?? null) : null,
      // What the quote said the part would cost. Left null, the second pairing
      // pass (exact cost x qty, for ticket rows with no part number) can never
      // match anything — it was dead code.
      expected_cost_cents: s.quote_line_id
        ? (quoteLines.get(s.quote_line_id)?.unit_cost_cents ?? null)
        : null,
    })),
    jobNumber: jobRes.data?.job_number ?? '',
    quoteNumbers: quotes.map((q) => q.quote_number),
    locked: ((invRes.data ?? []) as { status: string }[]).some(
      (i) => i.status === 'sent' || i.status === 'paid',
    ),
    quoted: quotes.length > 0,
  }
}

/** A row with no approved part to fill: shop cost on a quoted (or invoiced)
 *  job, where billing it would go past what the customer OK'd; a normal
 *  charge on a job with no estimate behind it, as before. */
function defaultTarget(ctx: Pick<ScanContext, 'locked' | 'quoted'>): string {
  return ctx.locked || ctx.quoted ? COST_ONLY : BILLED
}

/** Rows from the reader, each with a proposed home. Every pairing is shown
 *  and can be changed — the balance check proves the receipt adds up, not
 *  that a caliper went to the right slot. */
function withTargets(lines: Omit<ReviewLine, 'target'>[], ctx: ScanContext): ReviewLine[] {
  const plan = planPlacements(
    lines.map((l) => ({
      kind: classifyRow(l.description),
      description: l.description,
      part_number: l.part_number,
      qty: Number(l.qty) || 1,
      unit_cost_cents: parseMoney(l.unit_cost),
    })),
    ctx.slots,
    ctx,
  )
  // One ticket line can pay for two approved lines ("CAL 2 @ 94.99" against a
  // left and a right), and it comes back split — so what's on screen is exactly
  // what gets saved.
  return plan.map((p) => ({ ...lines[p.source], qty: String(p.qty), target: p.target }))
}

/** What Save sends for a row's quantity: blank means one, anything typed has
 *  to be a real count. `Number('0') || 1` quietly turned a typed 0 into 1 on
 *  the way to the database while the screen totalled it as nothing. */
function rowQty(raw: string): number {
  const s = raw.trim()
  return s === '' ? 1 : Number(s)
}

const KIND_HINT: Record<RowKind, string | null> = {
  part: null,
  core: 'Core deposit — your money until the old part goes back',
  fee: 'Fee, freight or discount',
  tax: null,
}

/**
 * Receipt scan flow: photo -> upload -> AI extraction -> mandatory review.
 * AI output is never written unreviewed, and manual entry is a first-class
 * path. On a quoted job the receipt FILLS the approved parts (fill_receipt,
 * migration 0030): it records what you paid and the customer keeps the
 * approved price. Receipt lines that weren't on the quote are shop cost
 * unless you choose to bill them.
 */
export default function ScanReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ receipt?: string }>
}) {
  const { id: jobId } = use(params)
  const { receipt: resumeId } = use(searchParams)
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>(resumeId ? 'working' : 'pick')
  const [statusMsg, setStatusMsg] = useState(resumeId ? 'Opening the saved receipt…' : '')
  const [notice, setNotice] = useState<string | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  /** Object URLs we made must be handed back; signed URLs must not be revoked. */
  const [ownsPhotoUrl, setOwnsPhotoUrl] = useState(false)
  const [photoKind, setPhotoKind] = useState<'image' | 'pdf' | 'file'>('image')
  const [fileName, setFileName] = useState('')
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)
  const [extracted, setExtracted] = useState(false)

  const [store, setStore] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [receiptTotal, setReceiptTotal] = useState('')
  /** Sales tax printed on the receipt. A cost of the job, never a customer
      charge — see migration 0027. */
  const [salesTax, setSalesTax] = useState('')
  const [poRef, setPoRef] = useState('')
  const [ticketNo, setTicketNo] = useState('')
  const [balanceNote, setBalanceNote] = useState('')
  const [rows, setRows] = useState<ReviewLine[]>([])
  const [storeSuggestions, setStoreSuggestions] = useState<string[]>([])
  const [markup, setMarkup] = useState<MarkupConfig>({ enabled: false, tiers: [] })
  const [ctx, setCtx] = useState<ScanContext>(EMPTY_CONTEXT)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dupWarning, setDupWarning] = useState<string | null>(null)
  const [dupChecked, setDupChecked] = useState(false)

  // A picked file can't be routed until both answers are in: whether the
  // reader is on (a pick before /api/ai-status answered used to fall through
  // to manual entry) and which approved parts the rows can fill.
  const aiReady = useRef<Promise<boolean> | null>(null)
  const ctxReady = useRef<Promise<ScanContext> | null>(null)

  useEffect(() => {
    supabase
      .from('settings')
      .select('store_suggestions')
      .single()
      .then(({ data }) => setStoreSuggestions(data?.store_suggestions ?? []))
    loadMarkupConfig().then(setMarkup)
    ctxReady.current = loadScanContext(jobId).then((c) => {
      setCtx(c)
      return c
    })
    aiReady.current = getAccessToken().then(async (token) => {
      try {
        const res = await fetch('/api/ai-status', { headers: { Authorization: `Bearer ${token}` } })
        const body = await res.json()
        setAiConfigured(!!body.configured)
        return !!body.configured
      } catch {
        setAiConfigured(false)
        return false
      }
    })
  }, [jobId])

  useEffect(() => {
    if (!photoUrl || !ownsPhotoUrl) return
    return () => URL.revokeObjectURL(photoUrl)
  }, [photoUrl, ownsPhotoUrl])

  // "Finish receipt": reopen a receipt that was uploaded but never saved, on
  // the file already stored — no second photo, no second receipt row.
  useEffect(() => {
    if (!resumeId) return
    let cancelled = false
    ;(async () => {
      const [{ data: rec, error }, { count }] = await Promise.all([
        supabase.from('receipts').select('*').eq('id', resumeId).single(),
        supabase.from('part_lines').select('id', { count: 'exact', head: true }).eq('receipt_id', resumeId),
      ])
      if (cancelled) return
      if (error || !rec || rec.job_id !== jobId) {
        setNotice('That receipt isn’t on this job.')
        setPhase('pick')
        return
      }
      if (rec.saved_at || (count ?? 0) > 0) {
        setPhase('saved-already')
        return
      }
      setReceiptId(rec.id)
      setPhotoKind(/\.pdf$/i.test(rec.storage_path) ? 'pdf' : 'image')
      setFileName(String(rec.storage_path).split('/').pop() ?? '')
      const { data: signed } = await supabase.storage.from('receipts').createSignedUrl(rec.storage_path, 3600)
      if (cancelled) return
      setOwnsPhotoUrl(false)
      setPhotoUrl(signed?.signedUrl ?? null)
      setStore(rec.store ?? '')
      setPurchaseDate(rec.purchase_date ?? '')
      setReceiptTotal(rec.receipt_total_cents != null ? centsToInput(rec.receipt_total_cents) : '')
      setSalesTax(rec.tax_cents ? centsToInput(rec.tax_cents) : '')
      const [configured, c] = await Promise.all([
        aiReady.current ?? Promise.resolve(false),
        ctxReady.current ?? loadScanContext(jobId),
      ])
      if (cancelled) return
      if (configured) await runExtraction(rec.id, c)
      else {
        setNotice(manualNotice(c))
        setPhase('review')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [resumeId, jobId])

  function manualNotice(c: ScanContext): string {
    return c.slots.length
      ? 'The receipt reader isn’t on. Tap “Start from the approved parts” and just type what you paid for each — or type the lines as printed.'
      : 'The receipt reader isn’t on — type the lines in below. The file is saved either way.'
  }

  const runningTotalCents = useMemo(
    () =>
      rows.reduce((sum, r) => {
        // Count exactly what Save sends: rows with no description are dropped
        // from the payload, and a blank qty saves as 1. Counting them any other
        // way let the bar show a balanced receipt that the save then rejected.
        if (!r.description.trim()) return sum
        const qty = rowQty(r.qty)
        if (!Number.isFinite(qty) || qty <= 0) return sum
        const unit = parseMoney(r.unit_cost) ?? 0
        return sum + Math.round(qty * unit)
      }, 0),
    [rows],
  )
  const printedTotalCents = parseMoney(receiptTotal)
  const taxCents = parseMoney(salesTax) ?? 0
  // The paper balances when the parts you typed plus the tax you paid equal
  // the printed total. Tax is not a line because it must never reach the
  // customer's invoice.
  const accountedCents = runningTotalCents + taxCents
  const balanced = printedTotalCents != null && printedTotalCents - accountedCents === 0
  const unaccountedCents = printedTotalCents == null ? 0 : printedTotalCents - accountedCents

  /**
   * A row named like sales tax is never acceptable, however it got here.
   * Left in, it bills the customer tax and the invoice then taxes that
   * subtotal again — and it makes the arithmetic balance, so without this the
   * screen would show a green all-clear over the exact bug.
   */
  const taxRowIdx = rows
    .map((r, i) => (r.description.trim() && isSalesTaxLine(r.description) ? i : -1))
    .filter((i) => i >= 0)
  const hasTaxRow = taxRowIdx.length > 0
  const mismatch = printedTotalCents == null ? hasTaxRow : !balanced || hasTaxRow

  /** Juneau charges 5%. A remainder far past that is a missed line, a typo, or
   *  a credit slip — not tax, and banking it invents cost that never left. */
  const MAX_PLAUSIBLE_TAX_BP = 1500
  const taxLooksPlausible =
    runningTotalCents > 0 &&
    unaccountedCents > 0 &&
    unaccountedCents * 10000 <= runningTotalCents * MAX_PLAUSIBLE_TAX_BP
  const impliedTaxPct =
    runningTotalCents > 0 ? ((unaccountedCents / runningTotalCents) * 100).toFixed(1) : null

  const slotById = useMemo(() => new Map(ctx.slots.map((s) => [s.id, s])), [ctx.slots])
  /** Which row fills each approved part. */
  const takenBy = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((r, i) => {
      if (slotById.has(r.target)) m.set(r.target, i)
    })
    return m
  }, [rows, slotById])

  const poWarning = useMemo(() => {
    const po = normalizeRef(poRef)
    if (!po || !ctx.jobNumber) return null
    const mine = [ctx.jobNumber, ...ctx.quoteNumbers].map((n) => normalizeRef(n))
    return mine.includes(po)
      ? null
      : `The PO on this ticket is ${poRef.trim()}, but this is ${ctx.jobNumber}. If it belongs to another job, cancel and scan it there.`
  }, [poRef, ctx])

  const counts = useMemo(() => {
    const valid = rows.filter((r) => r.description.trim())
    return {
      fills: valid.filter((r) => slotById.has(r.target)).length,
      shop: valid.filter((r) => r.target === COST_ONLY).length,
      billed: valid.filter((r) => r.target === BILLED).length,
    }
  }, [rows, slotById])

  const needsNote = !balanced
  /** Rows that still have to say where they go — guessing bills a part twice. */
  const unplacedRows = rows.filter((r) => r.description.trim() && r.target === UNSET).length
  /** A blank cost is not "$0". Saved as one it clears "awaiting cost" and the
   *  part reads as pure margin forever; the job screen refuses a blank too. */
  const uncostedRows = rows.filter(
    (r) => r.description.trim() && parseMoney(r.unit_cost) === null,
  ).length
  /** A typed 0 (or letters) isn't a quantity — the RPC refuses it too. */
  const badQtyRows = rows.filter((r) => {
    if (!r.description.trim()) return false
    const q = rowQty(r.qty)
    return !Number.isFinite(q) || q <= 0
  }).length
  const canSave =
    !!receiptId &&
    !saving &&
    !hasTaxRow &&
    unplacedRows === 0 &&
    uncostedRows === 0 &&
    badQtyRows === 0 &&
    (!needsNote || balanceNote.trim() !== '')

  /** Move a tax row into the tax box: add its amount, drop the row. Moving,
   *  not copying, is what prevents counting it on both sides. */
  function moveTaxRow(i: number) {
    const r = rows[i]
    const cents = Math.round((Number(r.qty) || 0) * (parseMoney(r.unit_cost) ?? 0))
    setSalesTax(centsToInput(taxCents + cents))
    setRows(rows.filter((_, k) => k !== i))
  }

  async function runExtraction(recId: string, c: ScanContext) {
    setStatusMsg('Reading the receipt…')
    try {
      const token = await getAccessToken()
      const res = await fetch('/api/extract-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ receiptId: recId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setNotice(
          `Couldn’t read the receipt automatically (${body.error ?? res.status}) — enter the lines by hand. The file is saved.`,
        )
        setPhase('review')
        return
      }
      const extraction: ExtractionResult = await res.json()
      setStore(extraction.store ?? '')
      setPurchaseDate(extraction.purchase_date ?? '')
      setReceiptTotal(extraction.receipt_total != null ? extraction.receipt_total.toFixed(2) : '')
      setSalesTax(extraction.sales_tax != null ? extraction.sales_tax.toFixed(2) : '')
      setPoRef(extraction.po_number ?? '')
      setTicketNo(extraction.invoice_number ?? '')
      setRows(
        withTargets(
          extraction.lines.map((l) => ({
            part_number: l.part_number ?? '',
            description: l.description,
            qty: String(l.qty),
            unit_cost: l.unit_cost.toFixed(2),
            confidence: l.confidence,
          })),
          c,
        ),
      )
      setExtracted(true)
      setNotice(
        c.slots.length
          ? 'Check every line against the receipt, and check which approved part each one fills. Low-confidence values are highlighted.'
          : 'Check every line against the receipt before saving — low-confidence values are highlighted.',
      )
      setPhase('review')
    } catch (e) {
      setNotice(
        `Couldn’t read the receipt automatically (${e instanceof Error ? e.message : String(e)}) — enter the lines by hand.`,
      )
      setPhase('review')
    }
  }

  async function onPickFile(picked: File) {
    setPhase('working')
    setNotice(null)
    setStatusMsg('Preparing file…')
    const { file, kind } = await prepareUpload(picked)
    setPhotoKind(kind)
    setFileName(file.name)
    // PDFs preview too — the browser's own viewer renders them in the pane.
    setOwnsPhotoUrl(kind !== 'file')
    setPhotoUrl(kind === 'file' ? null : URL.createObjectURL(file))
    try {
      setStatusMsg('Uploading…')
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${jobId}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('receipts').upload(path, file, {
        contentType: file.type || 'application/octet-stream',
      })
      if (upErr) throw upErr

      // The row exists from upload on, so an interrupted scan can be
      // finished later ("Finish receipt" on the job) instead of re-shot, and
      // the parts invoice is on record either way.
      const { data: rec, error: recErr } = await supabase
        .from('receipts')
        .insert({ job_id: jobId, storage_path: path })
        .select('id')
        .single()
      if (recErr) throw recErr
      setReceiptId(rec.id)

      const [configured, c] = await Promise.all([
        aiReady.current ?? Promise.resolve(false),
        ctxReady.current ?? loadScanContext(jobId),
      ])
      if (!configured) {
        setNotice(manualNotice(c))
        setPhase('review')
        return
      }
      await runExtraction(rec.id, c)
    } catch (e) {
      setNotice(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
      setPhase('pick')
    }
  }

  /** One row per approved part not yet on this receipt — Jake types only
   *  what he paid. The fastest path when the reader is off. */
  function startFromSlots() {
    const open = ctx.slots.filter((s) => !takenBy.has(s.id))
    const fresh: ReviewLine[] = open.map((s) => ({
      part_number: quotedPartNumber(s) ?? '',
      description: s.description,
      qty: String(s.qty),
      unit_cost: '',
      confidence: 'high',
      target: s.id,
    }))
    const isBlank = (r: ReviewLine) => !r.description.trim() && !r.unit_cost.trim()
    setRows([...rows.filter((r) => !isBlank(r)), ...fresh])
  }

  /** Same ticket entered twice? Warn once, never block — one PDF can hold
   *  two tickets, and a store can ring up two identical totals. */
  async function findDuplicate(): Promise<string | null> {
    type Hit = { store?: string | null; job: { job_number: string } | null }
    const ticket = ticketNo.trim()
    if (ticket) {
      const { data } = await supabase
        .from('receipts')
        .select('id, job:jobs(job_number)')
        .eq('vendor_invoice_no', ticket)
        .neq('id', receiptId!)
        .limit(1)
      const hit = (data as unknown as Hit[] | null)?.[0]
      if (hit) return `Ticket ${ticket} is already saved${hit.job ? ` on ${hit.job.job_number}` : ''}.`
    }
    if (purchaseDate && printedTotalCents != null) {
      // The date and the printed total carry this on their own. Matching the
      // store name exactly missed the case the check exists for: the reader
      // writes "O'Reilly Auto Parts" where the hand-typed copy says "OReilly",
      // so the first AI re-scan of an existing receipt sailed through.
      const { data } = await supabase
        .from('receipts')
        .select('id, store, job:jobs(job_number)')
        .eq('purchase_date', purchaseDate)
        .eq('receipt_total_cents', printedTotalCents)
        .neq('id', receiptId!)
        .neq('extraction_status', 'pending')
        .limit(1)
      const hit = (data as unknown as Hit[] | null)?.[0]
      if (hit)
        return `A ${hit.store?.trim() || store.trim() || 'parts'} receipt for ${formatCents(printedTotalCents)} on ${purchaseDate} is already on file${hit.job ? ` (${hit.job.job_number})` : ''}. Same ticket?`
    }
    return null
  }

  async function confirmSave() {
    if (!canSave || !receiptId) return
    setSaveError(null)
    if (!dupChecked) {
      const dup = await findDuplicate()
      setDupChecked(true)
      if (dup) {
        setDupWarning(dup)
        return
      }
    }
    setSaving(true)
    const valid = rows.filter((r) => r.description.trim())
    const header = {
      store: store.trim() || null,
      purchase_date: purchaseDate || null,
      receipt_total_cents: printedTotalCents,
      tax_cents: taxCents,
      extraction_status: extracted ? 'extracted' : 'manual',
      balance_note: balanced ? null : balanceNote.trim() || null,
      po_ref: poRef.trim() || null,
      vendor_invoice_no: ticketNo.trim() || null,
    }
    const payload = valid.map((r) => {
      const qty = rowQty(r.qty)
      const cost = parseMoney(r.unit_cost) ?? 0
      const base = {
        description: r.description.trim(),
        part_number: cleanPartNumber(r.part_number) || null,
        qty,
        unit_cost_cents: cost,
      }
      if (r.target === COST_ONLY) return { ...base, kind: 'cost_only' }
      if (r.target === BILLED)
        // An unquoted part is priced off the matrix as it lands — this is where
        // margin is won or lost on work nobody quoted.
        return { ...base, kind: 'billed', unit_charge_cents: markedUpCharge(cost, markup, r.description) }
      return { ...base, kind: 'fill', target_line_id: r.target }
    })
    const { error } = await supabase.rpc('fill_receipt', {
      p_receipt_id: receiptId,
      p_header: header,
      p_rows: payload,
    })
    if (error) {
      setSaveError(error.message)
      setSaving(false)
      return
    }
    router.push(`/jobs/${jobId}`)
  }

  function setRow(i: number, patch: Partial<ReviewLine>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  function addRow() {
    // Same rule as the reader's rows: while an approved part is still open, a
    // new line says where it goes instead of defaulting onto the bill.
    const claimed = new Set(rows.map((r) => r.target))
    const slotsOpen = ctx.slots.some((s) => !claimed.has(s.id))
    setRows([
      ...rows,
      {
        part_number: '',
        description: '',
        qty: '1',
        unit_cost: '',
        confidence: 'high',
        target: slotsOpen ? UNSET : defaultTarget(ctx),
      },
    ])
  }

  return (
    <div className={`mx-auto space-y-4 ${phase === 'review' ? 'max-w-5xl' : 'max-w-3xl'}`}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">{resumeId ? 'Finish receipt' : 'Scan receipt'}</h1>
        <Link href={`/jobs/${jobId}`} className="btn btn-sm">← Back to job</Link>
      </div>

      {phase === 'pick' && (
        <div className="card space-y-3 text-center">
          {notice && (
            <p className="text-sm" style={{ color: 'var(--status-stop-fg)' }}>{notice}</p>
          )}
          <p style={{ color: 'var(--text2)' }}>
            Snap a photo of the receipt or pick one from your library. Lines get read
            automatically{aiConfigured === false ? ' (the reader isn’t on — you’ll type them in)' : ''},
            then you review everything before it’s saved.
          </p>
          <label className="btn btn-primary w-full cursor-pointer">
            Photo or PDF
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
          <p style={{ color: 'var(--text2)' }}>{statusMsg}</p>
          {photoUrl && photoKind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="Receipt" className="mx-auto max-h-72 rounded-lg" />
          ) : (
            fileName && (
              <p className="text-sm" style={{ color: 'var(--text3)' }}>
                {photoKind === 'pdf' ? 'PDF' : 'photo'} · {fileName}
              </p>
            )
          )}
        </div>
      )}

      {phase === 'saved-already' && (
        <div className="card space-y-3 text-center">
          <p style={{ color: 'var(--text2)' }}>
            This receipt was already saved — its costs are on the job.
          </p>
          <Link href={`/jobs/${jobId}`} className="btn btn-primary w-full">Back to the job</Link>
        </div>
      )}

      {phase === 'review' && (
        <div className="panel-in grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,44%)]">
          <div className="order-2 min-w-0 space-y-3 lg:order-1">
            {notice && (
              <div
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--accent-dim)', background: 'var(--bg1)', color: 'var(--accent2)' }}
              >
                {notice}
              </div>
            )}

            {ctx.slots.length > 0 && (
              <div className="card space-y-1.5">
                <div className="label">Approved parts waiting for their cost</div>
                {ctx.slots.map((s) => {
                  const i = takenBy.get(s.id)
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        {s.description}
                        {s.qty !== 1 && ` ×${s.qty}`}
                      </span>
                      <span
                        className="flex-none text-xs"
                        style={{ color: i != null ? 'var(--green)' : 'var(--text3)' }}
                      >
                        {i != null ? `✓ line ${i + 1}` : 'not on this receipt'}
                      </span>
                    </div>
                  )
                })}
                <button
                  type="button"
                  className="btn btn-sm w-full"
                  disabled={ctx.slots.every((s) => takenBy.has(s.id))}
                  onClick={startFromSlots}
                >
                  Start from the approved parts
                </button>
                <p className="text-xs" style={{ color: 'var(--text3)' }}>
                  A line that fills an approved part records what you paid; the customer keeps
                  the price they approved.
                </p>
              </div>
            )}

            {ctx.locked && (
              <div
                className="rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--status-wait-bg)', color: 'var(--status-wait-fg)' }}
              >
                This job’s invoice is already sent or paid, so this receipt records your cost only —
                nothing new can be billed from here.
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
              <div>
                <label className="label">Receipt total (as printed)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={receiptTotal}
                  onChange={(e) => setReceiptTotal(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Sales tax paid</label>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={salesTax}
                  onChange={(e) => setSalesTax(e.target.value)}
                />
              </div>
              <div>
                <label className="label">PO on the ticket</label>
                <input
                  className="input"
                  placeholder={ctx.jobNumber || 'J014'}
                  value={poRef}
                  onChange={(e) => setPoRef(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Ticket #</label>
                <input
                  className="input"
                  placeholder="optional"
                  value={ticketNo}
                  onChange={(e) => {
                    setTicketNo(e.target.value)
                    setDupChecked(false)
                    setDupWarning(null)
                  }}
                />
              </div>
              {poWarning && (
                <p className="col-span-2 text-xs" style={{ color: 'var(--status-stop-fg)' }}>
                  {poWarning}
                </p>
              )}
            </div>

            <div className="card space-y-2">
              <div className="label">Line items</div>
              {rows.map((r, i) => {
                const slot = slotById.get(r.target)
                const kind = classifyRow(r.description)
                const isTax = r.description.trim() !== '' && isSalesTaxLine(r.description)
                const cost = parseMoney(r.unit_cost)
                const qty = Number(r.qty) || 0
                return (
                  <div
                    key={i}
                    className="space-y-1.5 rounded-lg p-1.5"
                    style={
                      r.confidence === 'low'
                        ? { background: 'var(--status-wait-bg)', outline: '1px solid var(--gold-line)' }
                        : undefined
                    }
                  >
                    <div className="grid grid-cols-[1fr_64px_88px_44px] items-end gap-1.5">
                      <div className="space-y-1">
                        <input
                          className="input !min-h-[40px]"
                          placeholder="Description"
                          value={r.description}
                          onChange={(e) => setRow(i, { description: e.target.value })}
                        />
                        {/* 16px font (the .input default) — anything smaller
                            makes iOS zoom the viewport on focus. */}
                        <input
                          className="input"
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
                        placeholder="cost"
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
                    {!isTax && (
                      <select
                        className="select !min-h-[40px]"
                        aria-label="Where this line goes"
                        value={r.target}
                        onChange={(e) => setRow(i, { target: e.target.value })}
                      >
                        {r.target === UNSET && (
                          <option value={UNSET}>Choose where this line goes…</option>
                        )}
                        {ctx.slots
                          .filter((s) => !takenBy.has(s.id) || takenBy.get(s.id) === i)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              Fills: {s.description}
                              {s.qty !== 1 ? ` ×${s.qty}` : ''} (approved {formatCents(s.unit_charge_cents)})
                            </option>
                          ))}
                        <option value={COST_ONLY}>Shop cost — not on the bill</option>
                        <option value={BILLED} disabled={ctx.locked}>
                          {ctx.quoted ? 'Bill the customer (not on the approved quote)' : 'Bill the customer'}
                        </option>
                      </select>
                    )}
                    {slot && (
                      <p
                        className="text-xs"
                        style={{
                          color:
                            cost != null && cost > (slot.unit_charge_cents ?? 0)
                              ? 'var(--status-stop-fg)'
                              : 'var(--text3)',
                        }}
                      >
                        Customer pays the approved{' '}
                        {formatCents(slot.unit_charge_cents)}/ea · you paid{' '}
                        {cost != null ? formatCents(cost) : '—'}
                        {cost != null && ` · margin ${formatCents((slot.unit_charge_cents ?? 0) - cost)}/ea`}
                        {qty > 0 && qty < slot.qty && ` · buys ${qty} of ${slot.qty}; the rest keeps waiting`}
                        {qty > slot.qty && ` · ${qty - slot.qty} extra go on your books`}
                      </p>
                    )}
                    {!slot && !isTax && KIND_HINT[kind] && (
                      <p className="text-xs" style={{ color: 'var(--text3)' }}>{KIND_HINT[kind]}</p>
                    )}
                    {!slot && !isTax && r.target === UNSET && (
                      <p className="text-xs" style={{ color: 'var(--status-wait-fg)' }}>
                        This job still has approved parts with no cost yet. Say whether this line
                        pays for one of them, is your own shop cost, or is a new charge — billing it
                        by mistake charges the part twice.
                      </p>
                    )}
                    {!slot && r.target === BILLED && ctx.quoted && (
                      <p className="text-xs" style={{ color: 'var(--status-wait-fg)' }}>
                        Not on what the customer approved — billing it needs their OK first.
                      </p>
                    )}
                  </div>
                )
              })}
              <button className="btn btn-sm w-full" onClick={addRow}>
                + Add line
              </button>

              <div
                className="flex items-center justify-between rounded-lg px-3 py-2"
                role="status"
                style={{
                  background: mismatch ? 'var(--status-stop-bg)' : 'var(--bg2)',
                  color: mismatch
                    ? 'var(--status-stop-fg)'
                    : printedTotalCents == null
                      ? 'var(--text2)'
                      : 'var(--green)',
                }}
              >
                <span className="text-sm font-semibold">
                  {printedTotalCents == null
                    ? 'Parts + tax'
                    : `Parts + tax ${mismatch ? '≠' : '='} printed total`}
                </span>
                <span className="money font-bold">
                  {formatCents(accountedCents)}
                  {printedTotalCents != null && ` / ${formatCents(printedTotalCents)}`}
                </span>
              </div>
              {hasTaxRow && (
                <div className="space-y-1">
                  <p className="text-xs" style={{ color: 'var(--status-stop-fg)' }}>
                    Sales tax is on a line. Billed to the customer it gets taxed again — move it
                    into the tax box instead.
                  </p>
                  {taxRowIdx.map((i) => (
                    <button
                      key={i}
                      type="button"
                      className="btn btn-sm w-full"
                      onClick={() => moveTaxRow(i)}
                    >
                      Move “{rows[i].description.trim()}” into sales tax
                    </button>
                  ))}
                </div>
              )}
              {!hasTaxRow && !balanced && printedTotalCents != null && unaccountedCents > 0 && (
                taxLooksPlausible ? (
                  <button
                    type="button"
                    className="btn btn-sm w-full"
                    onClick={() => setSalesTax(centsToInput(taxCents + unaccountedCents))}
                  >
                    {formatCents(unaccountedCents)} unaccounted ({impliedTaxPct}% of parts) — bank
                    it as sales tax
                  </button>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--status-stop-fg)' }}>
                    {runningTotalCents <= 0
                      ? `${formatCents(unaccountedCents)} unaccounted, but the lines total ${formatCents(runningTotalCents)} — on a credit slip type the printed total as a negative.`
                      : `${formatCents(unaccountedCents)} unaccounted — that is ${impliedTaxPct}% of the parts, too much for sales tax. Check for a line you haven't entered yet.`}
                  </p>
                )
              )}
              {!hasTaxRow && !balanced && printedTotalCents != null && unaccountedCents < 0 && (
                <p className="text-xs" style={{ color: 'var(--status-stop-fg)' }}>
                  {formatCents(-unaccountedCents)} over the printed total — check a line amount or
                  the tax figure.
                </p>
              )}
              {!hasTaxRow && needsNote && (
                <div>
                  <label className="label">
                    {printedTotalCents == null ? 'No printed total?' : 'Doesn’t add up?'} Say why to
                    save anyway
                  </label>
                  <input
                    className="input"
                    placeholder={
                      rows.length === 0
                        ? 'e.g. file only — costs entered on the job'
                        : 'e.g. total cut off in the photo'
                    }
                    value={balanceNote}
                    onChange={(e) => setBalanceNote(e.target.value)}
                  />
                </div>
              )}
              <p className="text-xs" style={{ color: 'var(--text3)' }}>
                Sales tax goes in its own box, not in a line: it counts as your cost, never on the
                customer&apos;s invoice. Core deposits and anything that wasn&apos;t on the approved
                quote go on your books as shop cost unless you choose to bill them. Negative
                amounts are fine for returns.
              </p>
            </div>

            {badQtyRows > 0 && (
              <p className="text-sm" style={{ color: 'var(--status-wait-fg)' }}>
                {badQtyRows} line{badQtyRows === 1 ? ' has' : 's have'} a quantity that isn’t a
                count — leave it blank for one, or type how many. A return goes in as a negative
                cost, never a negative quantity.
              </p>
            )}
            {(unplacedRows > 0 || uncostedRows > 0) && (
              <p className="text-sm" style={{ color: 'var(--status-wait-fg)' }}>
                {unplacedRows > 0 &&
                  `${unplacedRows} line${unplacedRows === 1 ? '' : 's'} still ${unplacedRows === 1 ? 'has' : 'have'} to say where ${unplacedRows === 1 ? 'it goes' : 'they go'} — this job has approved parts with no cost yet. `}
                {uncostedRows > 0 &&
                  `${uncostedRows} line${uncostedRows === 1 ? '' : 's'} ${uncostedRows === 1 ? 'needs' : 'need'} what you paid — type 0 if it cost nothing, or remove the line if it isn’t on this ticket.`}
              </p>
            )}
            {dupWarning && (
              <p className="text-sm" style={{ color: 'var(--status-wait-fg)' }}>
                {dupWarning} Tap save again if it’s a different ticket.
              </p>
            )}
            {saveError && (
              <p className="text-sm" style={{ color: 'var(--status-stop-fg)' }}>{saveError}</p>
            )}
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" disabled={!canSave} onClick={confirmSave}>
                {saving
                  ? 'Saving…'
                  : dupWarning
                    ? 'Save anyway'
                    : 'Save receipt'}
              </button>
              <Link href={`/jobs/${jobId}`} className="btn">Cancel</Link>
            </div>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              {[
                counts.fills ? `fills ${counts.fills} approved part${counts.fills === 1 ? '' : 's'}` : null,
                counts.shop ? `${counts.shop} shop cost` : null,
                counts.billed ? `${counts.billed} billed` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'no lines — saves the file and the tax only'}
            </p>
          </div>

          {/* Receipt sits above the form on a phone, beside it on a PC —
              and stays put while the line items scroll. */}
          <div className="order-1 min-w-0 lg:order-2 lg:sticky lg:top-4 lg:self-start">
            <ReceiptPreview url={photoUrl} kind={photoKind} fileName={fileName} />
          </div>
        </div>
      )}
    </div>
  )
}
