'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  billedTaxRateBp,
  collectedForJob,
  computeTotals,
  governingInvoice,
  overCollectedCents,
  owedGrossCents,
} from '@/lib/calc'
import { buildInvoiceSnapshot, formatTaxRate, statusChipClass } from '@/lib/billing'
import { centsToInput, formatCents, formatMiles, parseMoney } from '@/lib/money'
import { PAYMENT_METHODS, deletePayment, deleteTip, recordPayment, recordTip, syncJobPayment } from '@/lib/payments'
import { formatDate, todayLocalIso } from '@/lib/date'
import { dbErrorWords } from '@/lib/sales-tax'
import { saveJobAsTemplate } from '@/lib/templates'
import {
  coreDepositTotalCents,
  coreState,
  isCoreDeposit,
  isCoreDescription,
  setCoreOutcome,
} from '@/lib/cores'
import JobPhotos from '@/components/JobPhotos'
import RecommendationList from '@/components/RecommendationList'
import BillingCheck, { RecordedOks, type BillingSheet, type JobOk } from '@/components/BillingCheck'
import {
  buildAuthorizationTrail,
  isOverApproval,
  loadJobAuthorization,
  type JobAuthorization,
} from '@/lib/authorization'
import { listForJob, toMemo, type Recommendation } from '@/lib/recommendations'
import { markedUpCharge, type MarkupConfig } from '@/lib/markup'
import {
  vehicleLabel,
  type Customer,
  type Invoice,
  type Job,
  type JobStage,
  type PartLine,
  type Payment,
  type PaymentMethod,
  type Quote,
  type Receipt,
  type Tip,
  type Vehicle,
} from '@/lib/types'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface LineDraft {
  purchase_date: string
  store: string
  part_number: string
  description: string
  qty: string
  unit_cost: string
  unit_charge: string
}

const emptyDraft: LineDraft = {
  purchase_date: '', store: '', part_number: '', description: '', qty: '1', unit_cost: '', unit_charge: '',
}

/** The three stages (0043), in the order the work moves through them. */
const STAGES: { value: JobStage; label: string }[] = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [job, setJob] = useState<Job | null>(null)
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [lines, setLines] = useState<PartLine[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invoicing, setInvoicing] = useState(false)
  const [payments, setPayments] = useState<Payment[]>([])
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [payDate, setPayDate] = useState(todayIso())
  const [payingBusy, setPayingBusy] = useState(false)
  /** A job marked paid before payments were tracked (J001): how and when the
   *  customer paid, recorded after the fact. No date is guessed for him. */
  const [legacyMethod, setLegacyMethod] = useState<PaymentMethod>('cash')
  const [legacyDate, setLegacyDate] = useState('')
  const [legacyBusy, setLegacyBusy] = useState(false)
  const [legacyMsg, setLegacyMsg] = useState<string | null>(null)
  /** Tips on this job (0048): income, never payments toward it. */
  const [tips, setTips] = useState<Tip[]>([])
  /** The tips read failed (e.g. before 0048 is applied): said, not shown as "no tips". */
  const [tipsFailed, setTipsFailed] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  const [tipAmount, setTipAmount] = useState('')
  const [tipMethod, setTipMethod] = useState<PaymentMethod>('cash')
  const [tipDate, setTipDate] = useState(todayIso)
  const [tipBusy, setTipBusy] = useState(false)
  const [tipMsg, setTipMsg] = useState<string | null>(null)
  /** The tip whose ✕ was tapped: confirmed in its own row, never a dialog. */
  const [tipDeleteId, setTipDeleteId] = useState<string | null>(null)
  /** A payment being recorded came to more than the balance: asked in the
   *  page whether the extra is a tip, never with a dialog. */
  const [overPay, setOverPay] = useState<{
    amount: number
    balance: number
    method: PaymentMethod
    date: string
  } | null>(null)
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const [addingPart, setAddingPart] = useState(false)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [savingLine, setSavingLine] = useState(false)
  const [busyLineId, setBusyLineId] = useState<string | null>(null)
  const [lineMsg, setLineMsg] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [payQuickOpen, setPayQuickOpen] = useState(false)
  const [payQuickMethod, setPayQuickMethod] = useState<PaymentMethod>('cash')
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [draft, setDraft] = useState<LineDraft>(emptyDraft)
  const [addedFlash, setAddedFlash] = useState<string | null>(null)
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set())
  /** Correcting the sales tax recorded on a receipt after the fact. */
  const [taxEditId, setTaxEditId] = useState<string | null>(null)
  const [taxInput, setTaxInput] = useState('')
  const [taxBusy, setTaxBusy] = useState(false)
  /** Entering the real cost on an approved part that's still waiting for one. */
  const [costEditId, setCostEditId] = useState<string | null>(null)
  const [costInput, setCostInput] = useState('')
  const [costBusy, setCostBusy] = useState(false)
  /** On a quoted job a part added by hand is shop cost unless this is ticked:
   *  billing it goes past what the customer approved. */
  const [billNewPart, setBillNewPart] = useState(false)
  /** Approved vs. now (job_authorized_totals) and which billing panel is open. */
  const [auth, setAuth] = useState<JobAuthorization | null>(null)
  /** The approval check itself couldn't be read — not the same as "it's fine". */
  const [authFailed, setAuthFailed] = useState(false)
  /** The AS 45.45.170(d) record of every OK past the estimate, owner's copy. */
  const [oks, setOks] = useState<JobOk[]>([])
  const [billingSheet, setBillingSheet] = useState<BillingSheet>(null)
  const descriptionRef = useRef<HTMLInputElement | null>(null)
  const [storeSuggestions, setStoreSuggestions] = useState<string[]>([])
  const [markup, setMarkup] = useState<MarkupConfig>({ enabled: false, tiers: [] })
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [editingLabor, setEditingLabor] = useState(false)
  const [savingLabor, setSavingLabor] = useState(false)
  const [laborHoursInput, setLaborHoursInput] = useState('')
  const [laborRateInput, setLaborRateInput] = useState('')
  const [editingOverride, setEditingOverride] = useState(false)
  const [overrideInput, setOverrideInput] = useState('')
  const [linkedQuotes, setLinkedQuotes] = useState<(Quote & { total_cents: number | null })[]>([])
  /** The stage control is writing. */
  const [stageBusy, setStageBusy] = useState(false)
  /** The "Booked for" date while it is being changed; null = show job.date. */
  const [bookedDraft, setBookedDraft] = useState<string | null>(null)
  /** Settings' sales tax rate: what a new invoice on this job will carry. Null until read. */
  const [defaultTaxRateBp, setDefaultTaxRateBp] = useState<number | null>(null)

  const load = useCallback(async () => {
    const { data: j, error: jErr } = await supabase
      .from('jobs')
      .select('*, vehicle:vehicles(*, customer:customers(*))')
      .eq('id', id)
      .single()
    if (jErr) {
      setError(jErr.message)
      return
    }
    const { vehicle: v, ...jobRow } = j as Job & { vehicle: Vehicle & { customer: Customer | null } }
    setJob(jobRow as Job)
    setVehicle(v ?? null)
    setCustomer(v?.customer ?? null)

    const [linesRes, receiptsRes, settingsRes, invoicesRes, paymentsRes, oksRes, tipsRes] = await Promise.all([
      supabase.from('part_lines').select('*').eq('job_id', id).order('created_at'),
      supabase.from('receipts').select('*').eq('job_id', id).order('created_at'),
      supabase
        .from('settings')
        .select('store_suggestions, parts_markup_enabled, parts_markup_tiers, default_tax_rate_bp')
        .single(),
      supabase.from('invoices').select('*').eq('job_id', id).order('created_at'),
      supabase.from('payments').select('*').eq('job_id', id).order('date'),
      // Chain order — the same (authorized_at, recorded_at, id) the database
      // rebuilds previous_ceiling_cents in, so the list reads in the order the
      // deltas telescope. `select('*')` on purpose: corrected_at arrives with
      // migration 0044, and naming it would break this read until then.
      supabase
        .from('job_authorizations')
        .select('*')
        .eq('job_id', id)
        .order('authorized_at')
        .order('recorded_at')
        .order('id'),
      // Tips (0048). Not payments: they change nothing owed on this page.
      supabase.from('tips').select('*').eq('job_id', id).order('date').order('created_at'),
    ])
    setLines((linesRes.data as PartLine[]) ?? [])
    const recs = (receiptsRes.data as Receipt[]) ?? []
    setReceipts(recs)
    setStoreSuggestions(settingsRes.data?.store_suggestions ?? [])
    setDefaultTaxRateBp(settingsRes.data?.default_tax_rate_bp ?? null)
    setRecs(await listForJob(id))
    setMarkup({
      enabled: !!settingsRes.data?.parts_markup_enabled,
      tiers: settingsRes.data?.parts_markup_tiers ?? [],
    })
    setInvoices((invoicesRes.data as Invoice[]) ?? [])
    setPayments((paymentsRes.data as Payment[]) ?? [])
    setOks((oksRes.data as JobOk[]) ?? [])
    // A failed tips read cannot move any balance (tips are not payments), so
    // the page still renders — but it says the tips did not load rather than
    // showing none.
    setTips(tipsRes.error ? [] : ((tipsRes.data as Tip[]) ?? []))
    setTipsFailed(!!tipsRes.error)

    if (recs.length) {
      const urls: Record<string, string> = {}
      await Promise.all(
        recs.map(async (r) => {
          const { data } = await supabase.storage.from('receipts').createSignedUrl(r.storage_path, 3600)
          if (data?.signedUrl) urls[r.id] = data.signedUrl
        }),
      )
      setReceiptUrls(urls)
    }

    // Quotes tied to this job: the one it came from plus any add-on quotes
    // for extra work found mid-job.
    const { data: lq } = await supabase
      .from('quotes')
      .select('*')
      .eq('job_id', id)
      .is('deleted_at', null)
      .order('created_at')
    const quoteRows = (lq as Quote[]) ?? []
    const totalsByQuote: Record<string, number> = {}
    if (quoteRows.length) {
      const { data: qt } = await supabase
        .from('quote_totals')
        .select('*')
        .in('quote_id', quoteRows.map((q) => q.id))
      for (const t of (qt as { quote_id: string; total_cents: number }[]) ?? [])
        totalsByQuote[t.quote_id] = t.total_cents
    }
    setLinkedQuotes(quoteRows.map((q) => ({ ...q, total_cents: totalsByQuote[q.id] ?? null })))
    // What the customer approved vs. what the job adds up to now. A failed
    // read must never read as "inside the estimate": it shows as a warning
    // here, and every write path re-reads it and refuses rather than guessing.
    try {
      setAuth(await loadJobAuthorization(id))
      setAuthFailed(false)
    } catch {
      setAuth(null)
      setAuthFailed(true)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <p style={{ color: 'var(--red)' }}>{error}</p>
  if (!job) return <p style={{ color: 'var(--text3)' }}>Loading…</p>

  /** Sales tax paid at the parts counter, across this job's receipts — a cost,
   *  never a customer charge. Folded into parts cost the same way job_totals
   *  does it, and broken out below the cost line so the figure can be
   *  reconciled against the paper receipt. */
  const receiptTaxCents = receipts.reduce((s, r) => s + (r.tax_cents ?? 0), 0)
  /** The governing invoice: the LARGEST live one, ties to the newest — the
   *  same rule job_totals and finances.ts use (lib/calc governingInvoice). It
   *  is what the customer is billed. Its included_tax_cents is the sales tax
   *  the shop owes on an invoice that went out with no tax line — 5% of its
   *  price, which the shop absorbs (0041/0045); it comes off profit here so
   *  the figure matches job_totals. `?? 0` covers a row read before the
   *  column exists. */
  const govInvoice = governingInvoice(invoices)
  const includedTaxCents = govInvoice?.included_tax_cents ?? 0
  const totals = computeTotals(job, lines, receiptTaxCents, includedTaxCents)
  // Ledger is authoritative once it has entries; jobs settled before payment
  // tracking existed fall back to their cached status/amount — the one rule
  // in lib/calc collectedForJob, which every other surface calls too.
  const paidFromLedger = payments.reduce((s, p) => s + p.amount_cents, 0)
  const legacyPaid =
    payments.length === 0 ? collectedForJob(job, totals.total_charged_cents, 0, false) : 0
  /** Money actually collected on this job. It, and nothing else, pins the
   *  stage at done (owner, 2026-09-12). */
  const collectedCents = paidFromLedger + legacyPaid
  /** Marked paid in full before payment tracking, nothing in the ledger (J001):
   *  the bill was paid, but there is no date or method on record, and the
   *  record-payment form below never shows on a paid job. */
  const legacyUnrecorded = payments.length === 0 && job.payment_status === 'paid'
  /** What such a customer paid: the whole bill — the governing invoice or the
   *  job's charge, whichever is larger (the target syncJobPayment settles
   *  against) — or more, if more was noted at the time. */
  const legacyPaidCents = Math.max(
    legacyPaid,
    owedGrossCents(totals.total_charged_cents, govInvoice?.total_cents, 0),
  )
  // What the customer actually owes (owedGrossCents): an issued invoice can
  // add sales tax on top of the job's charge math, so the balance targets the
  // larger figure. The GOVERNING invoice, never the sum — every invoice
  // snapshots the WHOLE job, so two live invoices are revisions of one debt,
  // not two debts. (Same rule as syncJobPayment; summing here made the
  // quick-settle panel offer to collect double.)
  const balanceDue = owedGrossCents(totals.total_charged_cents, govInvoice?.total_cents, collectedCents)
  /** Cash taken beyond the bill (J011: $240.00 on a $231.00 invoice). Shown,
   *  never hidden behind "Paid in full". With NO invoice yet it is measured
   *  against the charge before tax, so it is not over any bill: it is cash
   *  paid ahead of the invoice, which will add sales tax on top — labelled as
   *  that below, never "over the invoice" (finances.ts: paidAheadOfInvoice). */
  const overCollected = overCollectedCents(totals.total_charged_cents, govInvoice?.total_cents, collectedCents)
  /** With no invoice yet: the invoice Create invoice would build right now, at
   *  Settings' rate (Juneau's 5% if Settings did not load) — billedTaxRateBp,
   *  the one rule createInvoice and the statement (0049) use too. Built by
   *  the same snapshot function, never total_charged × rate. An estimate:
   *  the rate on the draft can change. */
  const estimateRateBp = billedTaxRateBp(defaultTaxRateBp)
  const invoiceEstimate = govInvoice ? null : buildInvoiceSnapshot(job, lines, estimateRateBp)
  /** What an incoming payment is measured against before asking whether the
   *  extra is a tip: owedGrossCents against the governing invoice — or, with
   *  no invoice yet, against the invoice Create invoice would build (tax
   *  included), so sales tax paid ahead is never offered as a tip. */
  const owedWithTax = owedGrossCents(
    totals.total_charged_cents,
    govInvoice?.total_cents ?? invoiceEstimate?.total_cents,
    collectedCents,
  )
  const tipsTotal = tips.reduce((s, t) => s + t.amount_cents, 0)
  /** An invoice made before the job last changed: its pre-tax figure no longer
   *  matches the job's. The invoice still governs what the customer owes. */
  const invoicePreTax = govInvoice ? govInvoice.total_cents - govInvoice.tax_cents : null
  // Payments recorded here default onto the job's open invoice so it settles.
  const openInvoice = invoices.find((i) => i.status === 'draft' || i.status === 'sent')
  /** The job came from a quote: anything not on it goes past what the
   *  customer approved (Alaska allows no overage without their OK). */
  const quotedJob = linkedQuotes.some((q) => q.applied_at)
  /** A sent or paid invoice froze the customer's bill. */
  const lockedByInvoice = invoices.some((i) => i.status === 'sent' || i.status === 'paid')
  /** Approved parts still waiting for their cost, and what's charged on them —
   *  until they're costed the profit figure counts that charge as margin. */
  const awaitingLines = lines.filter((l) => l.awaiting_cost)
  const awaitingChargedCents = awaitingLines.reduce((s, l) => s + l.line_charge_total_cents, 0)
  const billedLines = lines.filter((l) => l.on_invoice !== false)
  const shopCostLines = lines.filter((l) => l.on_invoice === false)
  /** Uploaded but never saved: it can be finished instead of re-shot. */
  const receiptsWithLines = new Set(lines.map((l) => l.receipt_id).filter(Boolean))
  const isUnfinished = (r: Receipt) => !r.saved_at && !receiptsWithLines.has(r.id)

  /** First ledger entry on a legacy-partial job carries the old credit in, so it isn't erased. */
  async function ensureLegacyCredit() {
    if (payments.length > 0 || legacyPaid <= 0 || job!.payment_status === 'paid') return
    const { error } = await supabase.from('payments').insert({
      job_id: id,
      amount_cents: legacyPaid,
      method: 'other',
      date: job!.date,
      note: 'Balance recorded before payment tracking',
    })
    if (error) throw error
  }

  /**
   * Put a job marked paid before payment tracking (J001) on the record: one
   * payment for what was paid, on the day and by the method the owner gives.
   * The paid invoice's paid date moves to that day, as it would have if the
   * payment had been recorded then. Nothing on the bill changes.
   */
  async function recordLegacyPayment() {
    if (!legacyDate) {
      setLegacyMsg('Pick the day the customer paid.')
      return
    }
    setLegacyBusy(true)
    setLegacyMsg(null)
    try {
      await recordPayment({
        jobId: id,
        invoiceId: govInvoice?.id ?? null,
        amountCents: legacyPaidCents,
        method: legacyMethod,
        date: legacyDate,
      })
    } catch (e) {
      // The row may have landed before the job's figures failed to update:
      // reload so the card shows what is really on record.
      setLegacyMsg(dbErrorWords(e, 'record the payment'))
      await load()
      setLegacyBusy(false)
      return
    }
    // The payment landed: a paid date that fails to move is said, never
    // reported as the payment failing.
    if (govInvoice?.status === 'paid') {
      const { error } = await supabase
        .from('invoices')
        .update({ paid_at: `${legacyDate}T00:00:00Z` })
        .eq('id', govInvoice.id)
      if (error) {
        setLegacyMsg(
          `The payment is recorded, but ${govInvoice.invoice_number} still shows its old paid date. ${dbErrorWords(error, 'move it')}`,
        )
      }
    }
    await load()
    setLegacyBusy(false)
  }

  /**
   * Record money handed over on this job from the Payments card. The payment
   * is recorded first (it is what settles the job); a tip, when the owner
   * chose to split one off, is recorded after it on the same date and method.
   * A tip that fails to save after the payment landed is reported in the page
   * — the payment is not rolled back, and the tip can be added again.
   */
  async function recordPaymentAndTip(amountCents: number, method: PaymentMethod, date: string, tipCents: number) {
    setPayingBusy(true)
    setTipMsg(null)
    try {
      await ensureLegacyCredit()
      await recordPayment({
        jobId: id,
        invoiceId: openInvoice?.id ?? null,
        amountCents,
        method,
        date,
      })
      setPayAmount('')
      setOverPay(null)
      if (tipCents > 0) {
        try {
          await recordTip({ jobId: id, amountCents: tipCents, method, date })
        } catch (e) {
          setTipMsg(
            `The ${formatCents(amountCents)} payment is recorded, but the ${formatCents(tipCents)} tip did not save (${
              e instanceof Error ? e.message : String(e)
            }). Add it with “+ Add tip”.`,
          )
        }
      }
      await load()
    } catch (e) {
      setTipMsg(`The payment did not save: ${e instanceof Error ? e.message : String(e)}`)
    }
    setPayingBusy(false)
  }

  /** resyncPayments: money-changing edits must re-derive cached payment status from the ledger. */
  async function updateJob(patch: Partial<Job>, opts: { resyncPayments?: boolean } = {}) {
    const { error } = await supabase.from('jobs').update(patch).eq('id', id)
    if (error) {
      alert(error.message)
      return
    }
    if (opts.resyncPayments) {
      try {
        await syncJobPayment(id)
      } catch (e) {
        alert(`Saved, but payment status re-sync failed: ${e instanceof Error ? e.message : e}`)
      }
    }
    await load()
  }

  /** Where the job is in the shop (0043). A missing stage on a row read
   *  before the migration counts as done, the same as the books. */
  const stage: JobStage = job.stage ?? 'done'
  const notDone = stage !== 'done'
  /** Collected money pins a done job; paperwork alone never does. */
  const stageLocked = !notDone && collectedCents > 0

  /** Move the job to a stage and stamp when it moved. Leaving `done` is
   *  refused while a live invoice exists: the invoice is the record that the
   *  work was done, and moving the job back under it would pull the job out
   *  of billed/earned while its payments (and the tax inside them) stayed in
   *  cash — the ledger would then show a "timing" gap that never happened.
   *  Void the invoice first; then the job can go back on the lift. */
  async function setStage(next: JobStage) {
    if (stageBusy || next === stage) return
    // THE LOCK IS MONEY, NOT PAPERWORK (owner, 2026-09-12): "Once an invoice is
    // finalized on a job, it shouldn't be moveable. Up until the money is
    // collected, we should be able to move jobs to whatever state we want."
    //
    // So a draft, or an invoice sent and not yet paid, no longer blocks a stage
    // change: nothing has moved, and the books are untouched by it. A payment
    // does block it. Its money — and the sales tax prorated inside it — stays
    // in cash, while a job leaving 'done' drops out of billed and earned, so
    // the ledger's two identities break by exactly that tax.
    if (stage === 'done' && next !== 'done' && collectedCents > 0) {
      alert(
        `${job!.job_number} has ${formatCents(collectedCents)} collected against it, so it stays done. Take the payment off first if the work really is going back on the lift.`,
      )
      return
    }
    setStageBusy(true)
    await updateJob({ stage: next, stage_changed_at: new Date().toISOString() })
    setStageBusy(false)
  }

  /** The booked drop-off day IS the job's date (0043); saving it moves the
   *  job on the calendar and in every list. A date input reports '' while a
   *  field is half typed, so only a complete date is written; leaving the
   *  field (onBlur) drops the draft so a cleared input snaps back to job.date. */
  async function saveBooked(value: string) {
    setBookedDraft(value)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value === job!.date) return
    setStageBusy(true)
    await updateJob({ date: value })
    setStageBusy(false)
    setBookedDraft(null)
  }

  /** Half-hour steps: the unit a shop actually books time in. */
  function bumpHours(current: string, delta: number): string {
    const next = Math.max(0, (Number(current) || 0) + delta)
    return String(Number(next.toFixed(2)))
  }

  function openLaborEditor() {
    setLaborHoursInput(String(Number(job!.labor_hours)))
    setLaborRateInput(centsToInput(job!.labor_rate_cents))
    setEditingLabor(true)
  }

  async function saveLabor() {
    const hours = Number(laborHoursInput)
    const rate = parseMoney(laborRateInput)
    if (!Number.isFinite(hours) || hours < 0) {
      alert('Hours must be a number, like 1.5.')
      return
    }
    if (rate == null || rate < 0) {
      alert('Rate must be a dollar amount, like 90.')
      return
    }
    setSavingLabor(true)
    // Labor moves the amount owed, so the cached payment status has to follow.
    await updateJob({ labor_hours: hours, labor_rate_cents: rate }, { resyncPayments: true })
    setSavingLabor(false)
    setEditingLabor(false)
  }

  async function saveLine() {
    if (savingLine) return
    if (!draft.description.trim()) {
      setLineMsg('Description is required.')
      return
    }
    setLineMsg(null)
    setSavingLine(true)
    const editing = editingLineId ? (lines.find((l) => l.id === editingLineId) ?? null) : null
    // A part added by hand to a quoted job goes past what the customer
    // approved, so it's shop cost unless Jake ticks "bill the customer".
    // Editing keeps a line where it is; "Bill it" / "Off the bill" move it.
    // A core deposit NEVER starts on the customer's bill, on any job. Typed by
    // hand with the charge box blank it used to land on the invoice at cost
    // (the generated column bills coalesce(charge, cost)), while the cores
    // worklist went on calling it money the shop was owed — so the store's
    // refund and the customer both paid it. It reaches a bill only by being
    // denied, through the core writer.
    // By WORDING, not by the cost box: deciding from the cost made a core stop
    // being a core while the box was empty, and it inserted straight onto the
    // customer's bill at whatever cost was filled in afterwards.
    const draftIsCore = isCoreDescription(draft.description.trim())
    const newCore = !editing && draftIsCore
    // A sent or paid invoice freezes the bill: the scan screen and "Bill it"
    // both refuse to move money past it, and adding a part by hand was the one
    // way left to push what's owed past an invoice the customer already has.
    const offBill = editing
      ? editing.on_invoice === false
      : lockedByInvoice || newCore || (quotedJob && !billNewPart)
    const typedCharge = draft.unit_charge.trim() !== '' ? parseMoney(draft.unit_charge) : undefined
    const payload = {
      job_id: id,
      purchase_date: draft.purchase_date || null,
      store: draft.store.trim() || null,
      part_number: draft.part_number.trim() || null,
      description: draft.description.trim(),
      qty: draft.qty ? Number(draft.qty) : 1,
      unit_cost_cents: parseMoney(draft.unit_cost) ?? 0,
      // The worklist needs the deposit amount to survive the cost going to 0
      // when the store credits it back — and correcting a core's cost has to
      // move the deposit with it, or the next screen quotes the old figure.
      // Guarded on > 0 so editing an already-credited core (cost 0) can't wipe
      // the deposit it is still displaying.
      ...(draftIsCore && (parseMoney(draft.unit_cost) ?? 0) > 0
        ? { core_deposit_cents: parseMoney(draft.unit_cost) ?? 0 }
        : {}),
      on_invoice: !offBill,
      // Off the bill a line charges exactly 0 (the database refuses anything
      // else). On a NEW billed line a blank charge means "price it for me" and
      // the matrix fills it in. On an EDIT, blank keeps what was agreed: an
      // approved line keeps the price the customer approved, any other line
      // sells at cost — the box was pre-populated, so empty is the state that
      // was loaded, not a request to re-price. Without that split, correcting
      // a store name on an at-cost line silently multiplied what's owed.
      unit_charge_cents: offBill
        ? 0
        : typedCharge !== undefined
          ? typedCharge
          : editing
            ? editing.quote_line_id
              ? editing.unit_charge_cents
              : null
            : markedUpCharge(parseMoney(draft.unit_cost) ?? 0, markup, draft.description),
    }
    const result = editingLineId
      ? await supabase.from('part_lines').update(payload).eq('id', editingLineId)
      : await supabase.from('part_lines').insert(payload)
    if (result.error) {
      setLineMsg(result.error.message)
      setSavingLine(false)
      return
    }
    if (editingLineId) {
      setAddingPart(false)
      setEditingLineId(null)
      setDraft(emptyDraft)
    } else {
      // Adding stays open for the next part — a parts run is rarely one line.
      // Store and date carry over since they're usually the same receipt/trip.
      // "Bill the customer" does NOT: it's a per-part decision about work the
      // customer never approved, and leaving it ticked quietly billed every
      // following part on the same run.
      setDraft({ ...emptyDraft, store: draft.store, purchase_date: draft.purchase_date })
      setBillNewPart(false)
      setAddedFlash(draft.description.trim())
      setTimeout(() => setAddedFlash(null), 2500)
      descriptionRef.current?.focus()
    }
    // Parts change the amount owed — keep cached payment status honest.
    try {
      await syncJobPayment(id)
    } catch {}
    await load()
    setSavingLine(false)
  }

  async function deleteLine(lineId: string) {
    if (busyLineId === lineId) return
    if (!confirm('Delete this part line?')) return
    setBusyLineId(lineId)
    const { error } = await supabase.from('part_lines').delete().eq('id', lineId)
    if (error) {
      alert(error.message)
      setBusyLineId(null)
      return
    }
    try {
      await syncJobPayment(id)
    } catch {}
    await load()
    setBusyLineId(null)
  }

  /** The scan screen writes tax once, on the receipt it just created — so
   *  without this a fat-fingered figure would be frozen into job cost and the
   *  P&L forever. Negative is allowed: a return refunds the tax too. */
  async function saveReceiptTax(r: Receipt) {
    if (taxBusy) return
    setTaxBusy(true)
    const { error } = await supabase
      .from('receipts')
      .update({ tax_cents: parseMoney(taxInput) ?? 0 })
      .eq('id', r.id)
    setTaxBusy(false)
    if (error) {
      setLineMsg(error.message)
      return
    }
    setTaxEditId(null)
    await load()
  }

  /** Cost only: the approved charge never moves, so a paid job stays paid and
   *  the customer's bill can't change. The database clears the awaiting tag
   *  the moment a real cost lands (migration 0030). */
  async function saveLineCost(l: PartLine) {
    if (costBusy) return
    const cents = parseMoney(costInput)
    if (cents == null) {
      setLineMsg('Type what you paid for it, like 94.99.')
      return
    }
    setCostBusy(true)
    // $0 means it genuinely cost nothing (customer-supplied, a warranty swap):
    // say so, rather than leave it waiting forever.
    // A core's recorded deposit has to follow its cost, or the worklist goes on
    // quoting the very figure this correction replaced.
    const patch =
      cents === 0
        ? { awaiting_cost: false }
        : { unit_cost_cents: cents, ...(isCoreDeposit(l) ? { core_deposit_cents: cents } : {}) }
    const { error } = await supabase.from('part_lines').update(patch).eq('id', l.id)
    setCostBusy(false)
    if (error) {
      setLineMsg(error.message)
      return
    }
    setCostEditId(null)
    setCostInput('')
    await load()
  }

  /** Move a line on or off the customer's bill. Off the bill it charges
   *  exactly 0 (the database refuses anything else); back on, it's priced
   *  like any new part. */
  async function setOnInvoice(l: PartLine, on: boolean) {
    if (busyLineId === l.id) return
    if (l.is_adjustment) {
      alert(
        'This line is the record of billing the approved estimate. Change it through “Bill the approved amount”, not by taking it off the bill.',
      )
      return
    }
    if (lockedByInvoice) {
      alert(
        'This job’s invoice is already sent or paid, so the bill is frozen. Void and reissue the invoice to change what the customer pays.',
      )
      return
    }
    // A core's money belongs to the core lifecycle, not to this toggle: it is
    // 0 to the customer unless the store DENIED it, and it stops being a cost
    // once credited. Routing it through the one core writer keeps the bill, the
    // stamps and the worklist from ever disagreeing.
    if (isCoreDeposit(l)) {
      const deposit = coreDepositTotalCents(l)
      if (on && l.core_credited_at) {
        alert(
          `That core was already credited back by ${l.store ?? 'the store'}, so the deposit is not yours to recover — billing the customer for it would charge them a refund you already have. Undo the credit on the Follow-ups list first if that was wrong.`,
        )
        return
      }
      const ask = on
        ? `Bill the ${formatCents(deposit)} core to the customer? Only do that if the store DENIED the old unit — it goes on at cost.`
        : `Take the ${formatCents(deposit)} core off the bill? It goes back to being your deposit.`
      if (!confirm(ask)) return
      setBusyLineId(l.id)
      try {
        const state = coreState(l)
        const r = await setCoreOutcome(
          l,
          on
            ? 'denied_billed'
            : // Taking a DENIED core off the bill means "I'll eat it", not
              // "it might still come back" — erasing the denial would put a
              // refused core back on the chase-the-credit list for ever.
              state === 'denied'
              ? 'denied_absorbed'
              : state === 'credited'
                ? 'credited'
                : state === 'awaiting_credit'
                  ? 'awaiting_credit'
                  : 'out',
        )
        if (r.overApproval) {
          alert(
            'That puts the job over what the customer approved — record their OK before invoicing it.',
          )
        } else if (r.approvalUnknown) {
          alert(
            'The core was billed, but the approved-estimate check couldn’t be read just now. Reload and check this job before you invoice it.',
          )
        }
        if (r.draftBlocked) alert(r.draftBlocked)
      } catch (e) {
        setLineMsg(e instanceof Error ? e.message : String(e))
        setBusyLineId(null)
        return
      }
      setBusyLineId(null)
      await load()
      return
    }
    // The toggle can't remember a price: off the bill a line must charge
    // exactly 0, so whatever was agreed is gone and coming back it is priced
    // from the markup. Both directions now say so with the figure.
    const nextCharge = on
      ? (markedUpCharge(l.unit_cost_cents, markup, l.description) ?? l.unit_cost_cents)
      : 0
    if (on) {
      const priceNote = `It goes back on at ${formatCents(nextCharge)} — your markup on what it cost, not any price it carried before.`
      const ask = quotedJob
        ? `“${l.description}” isn’t on what the customer approved. Only bill it if they've OK'd the extra — Alaska law allows no charge over the approved estimate without it. ${priceNote}`
        : `Bill “${l.description}” to the customer? ${priceNote}`
      if (!confirm(ask)) return
    } else if ((l.unit_charge_cents ?? 0) > 0) {
      if (
        !confirm(
          `Take “${l.description}” off the bill? Its ${formatCents(l.unit_charge_cents ?? 0)} price is cleared, and putting it back later prices it from your markup instead.`,
        )
      ) {
        return
      }
    }
    setBusyLineId(l.id)
    const patch = on
      ? { on_invoice: true, unit_charge_cents: nextCharge }
      : { on_invoice: false, unit_charge_cents: 0 }
    const { error } = await supabase.from('part_lines').update(patch).eq('id', l.id)
    setBusyLineId(null)
    if (error) {
      setLineMsg(error.message)
      return
    }
    // What the customer owes just moved.
    try {
      await syncJobPayment(id)
    } catch {}
    await load()
  }

  async function deleteReceipt(r: Receipt) {
    // Post-0027 a receipt row carries recorded cost, so the old reassurance
    // ("part lines from it stay") is no longer the whole truth.
    const taxWarning =
      r.tax_cents > 0
        ? ` The ${formatCents(r.tax_cents)} of sales tax recorded on it is removed from this job's cost.`
        : ''
    if (!confirm(`Delete this receipt photo? Part lines from it stay.${taxWarning}`)) return
    await supabase.storage.from('receipts').remove([r.storage_path])
    const { error } = await supabase.from('receipts').delete().eq('id', r.id)
    if (error) alert(error.message)
    else await load()
  }

  async function softDeleteJob() {
    // Deleting a job pulls its payments out of every tile and report. That is
    // fine for an empty job, but a job carrying a deposit or other payments
    // holds real money the customer already handed over — hide it and the
    // books quietly lose that cash. Say so before it happens.
    const onLedger = payments.reduce((s, p) => s + p.amount_cents, 0)
    const warn =
      onLedger > 0
        ? ` This job has ${formatCents(onLedger)} in recorded payments — deleting it removes that money from your totals and reports. Refund the customer in Stripe (or your own records) if the work isn't happening.`
        : ''
    if (!confirm(`Delete job ${job!.job_number}?${warn} You can restore it from Settings.`)) return
    const { error } = await supabase
      .from('jobs')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) alert(error.message)
    else router.push('/jobs')
  }

  /** The header's invoice button. With ANY live (non-void) invoice — draft,
   *  sent or PAID — it reads "Open INV-xxx" for the governing one and only
   *  navigates: a job is billed once, and every invoice snapshots the whole
   *  job. Only a job with no live invoice (none yet, or every one voided)
   *  gets Create invoice. */
  function invoiceAction() {
    if (govInvoice) {
      router.push(`/invoices/${govInvoice.id}`)
      return
    }
    void createInvoice()
  }

  async function createInvoice() {
    // Re-read the job's live invoices first: this also runs from BillingCheck's
    // proceed path, and from a render that may predate an invoice made in
    // another tab. Never create against a list that could not be read.
    setInvoicing(true)
    const { data: liveRows, error: liveErr } = await supabase
      .from('invoices')
      .select('id, invoice_number, status, total_cents, created_at')
      .eq('job_id', id)
      .neq('status', 'void')
    setInvoicing(false)
    if (liveErr) {
      setActionMsg({
        text: `Couldn’t check this job’s invoices just now, so nothing was created. Reload and try again. (${liveErr.message})`,
        ok: false,
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const live = (liveRows ?? []) as Pick<Invoice, 'id' | 'invoice_number' | 'status' | 'total_cents' | 'created_at'>[]
    // A PAID invoice is the bill, settled. A second one would bill the same
    // work twice — syncJobPayment would mark it paid at once, and Reports'
    // sales-tax table (every sent/paid invoice) would count the sale and its
    // tax twice (J014: INV-016 void, INV-017 paid). Refuse, in plain words.
    // The Void button is hidden on a paid invoice, so say how to get there.
    const paidInvoice = live.find((i) => i.status === 'paid')
    if (paidInvoice) {
      const n = paidInvoice.invoice_number
      setActionMsg({
        text: `${n} is already paid in full. A second invoice would bill this work twice, so nothing was created. If the bill truly needs replacing, void ${n} first — a paid invoice offers Void only after the payment on it is removed in the Payments card below.`,
        ok: false,
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    // A draft or sent invoice already exists: open it — no dialog whose
    // Cancel secretly navigated anyway. Drafts have "Update from job" instead
    // of a second invoice.
    const existing = governingInvoice(live)
    if (existing) {
      router.push(`/invoices/${existing.id}`)
      return
    }
    // A job settled before payment tracking (J001) is marked paid with no
    // payments on record: its credit is the pre-tax charge. A new invoice
    // would put sales tax on top of that and leave a balance the customer
    // does not owe on a job that says "paid". Refuse, in plain words.
    if (job!.payment_status === 'paid' && payments.length === 0) {
      setActionMsg({
        text: `${job!.job_number} was marked paid before payments were tracked, so there is no payment on record to set an invoice against. A new invoice would add sales tax on top of what the customer already paid and show a balance they do not owe. Nothing was created. To give them a copy of the bill, use ⋯ More → Print this job.`,
        ok: false,
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setInvoicing(true)
    try {
      // An invoice bills DONE work (0043). On a scheduled or in-progress job
      // the button already reads "Mark done, then invoice", so the tap that
      // asks for the invoice marks the job done first — never silently. It
      // stays done even if a check below holds the invoice: the work is
      // finished either way, and the books should say so.
      if (notDone) {
        const { error: stageErr } = await supabase
          .from('jobs')
          .update({ stage: 'done', stage_changed_at: new Date().toISOString() })
          .eq('id', id)
        if (stageErr) throw stageErr
        await load()
      }
      // Fresh reads: the checks below may have just changed conditions or
      // prices, and this can run from a panel holding an older render.
      const [{ data: settings }, { data: freshLines }, freshAuth] = await Promise.all([
        supabase.from('settings').select('default_tax_rate_bp, default_invoice_terms_days').single(),
        supabase.from('part_lines').select('*').eq('job_id', id).order('created_at'),
        loadJobAuthorization(id),
      ])
      const current = (freshLines as PartLine[]) ?? []
      setAuth(freshAuth)
      // AS 45.45.140 / .170: never bill past what the customer approved. The
      // panel offers the two lawful ways out.
      if (isOverApproval(freshAuth)) {
        setBillingSheet('over')
        setInvoicing(false)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      // AS 45.45.190: every replaced part identified new / used / rebuilt /
      // reconditioned before it goes on the invoice.
      if (current.some((l) => l.on_invoice !== false && !l.is_adjustment && l.condition == null)) {
        setBillingSheet('conditions')
        setInvoicing(false)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      // Settings is the rate the shop actually charges, and it is the control
      // the owner turns — so it wins over any quote's rate. It stays editable
      // on the draft invoice for one-off cases. If settings did not load, the
      // fallback is Juneau's 5% (0041): an invoice must never go out untaxed
      // by accident. billedTaxRateBp: the same rule the statement (0049) uses
      // for a finished job not yet invoiced, so the two never disagree.
      const taxRateBp = billedTaxRateBp(settings?.default_tax_rate_bp)
      const snapshot = buildInvoiceSnapshot(job!, current, taxRateBp)
      // Terms from Settings: 0 = due on receipt (due date = issue date).
      const termsDays = settings?.default_invoice_terms_days ?? 0
      const due = new Date()
      due.setDate(due.getDate() + termsDays)
      const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`
      const { data, error } = await supabase
        .from('invoices')
        .insert({
          job_id: id,
          customer_id: customer!.id,
          customer_name: customer!.name,
          vehicle_label: vehicleLabel(vehicle),
          job_title: job!.title,
          work_performed: job!.work_performed,
          due_date: dueDate,
          // What was flagged on the job travels to the customer's copy, then
          // freezes with the rest of the invoice.
          memo: toMemo(recs),
          // The approvals behind this bill, frozen with it (AS 45.45.170(d)).
          authorizations: await buildAuthorizationTrail(id),
          ...snapshot,
        })
        .select('id')
        .single()
      if (error) throw error
      // A job already covered by a deposit means the new invoice is paid the
      // moment it exists — re-derive so it opens settled, not "unpaid".
      try {
        await syncJobPayment(id)
      } catch {}
      router.push(`/invoices/${data.id}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
      setInvoicing(false)
    }
  }

  function startEditLine(l: PartLine) {
    setEditingLineId(l.id)
    setAddingPart(true)
    setDraft({
      purchase_date: l.purchase_date ?? '',
      store: l.store ?? '',
      part_number: l.part_number ?? '',
      description: l.description,
      qty: String(l.qty),
      unit_cost: centsToInput(l.unit_cost_cents),
      unit_charge: l.unit_charge_cents != null ? centsToInput(l.unit_charge_cents) : '',
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div className="card space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold" style={{ color: 'var(--accent2)' }}>{job.job_number}</span>
              {/* The O'Reilly PO: the job number on every order puts it on the
                  ticket, so each receipt names the job it belongs to. */}
              <button
                type="button"
                className="chip"
                style={{ background: 'var(--bg3)', cursor: 'pointer' }}
                title="Copy — use it as the PO on your O'Reilly order"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(job.job_number)
                    setActionMsg({ text: `Copied ${job.job_number} — use it as the PO on the O’Reilly order.`, ok: true })
                    setTimeout(() => setActionMsg(null), 2500)
                  } catch {}
                }}
              >
                PO {job.job_number}
              </button>
              {/* Not done = not owed: the chip says where the job is, not
                  "unpaid". Done jobs carry the payment status. */}
              {stage === 'scheduled' ? (
                <span className="chip chip-booked">scheduled</span>
              ) : stage === 'in_progress' ? (
                <span className="chip chip-open">in progress</span>
              ) : (
                <span className={`chip chip-${job.payment_status}`}>{job.payment_status}</span>
              )}
              {job.promised_date && job.payment_status !== 'paid' && (
                <span
                  className="chip"
                  style={{
                    background: 'var(--bg3)',
                    color: job.promised_date < todayLocalIso() ? 'var(--red)' : 'var(--accent2)',
                  }}
                >
                  promised {formatDate(job.promised_date)}
                </span>
              )}
              {(job.warranty_months != null || job.warranty_miles != null) && (
                <span className="chip" style={{ background: 'var(--bg3)', color: 'var(--green)' }}>
                  warranty{' '}
                  {[
                    job.warranty_months != null ? `${job.warranty_months}mo` : null,
                    job.warranty_miles != null ? `${formatMiles(job.warranty_miles)}mi` : null,
                  ]
                    .filter(Boolean)
                    .join('/')}
                </span>
              )}
            </div>
            <h1 className="text-2xl">{job.title}</h1>
            <div className="text-sm" style={{ color: 'var(--text2)' }}>
              {customer && (
                <Link href={`/customers/${customer.id}`} style={{ color: 'var(--blue)' }}>
                  {customer.name}
                </Link>
              )}
              {' · '}
              {vehicle && (
                <Link href={`/vehicles/${vehicle.id}`} style={{ color: 'var(--blue)' }}>
                  {vehicleLabel(vehicle)}
                </Link>
              )}
              {' · '}{stage === 'scheduled' ? `booked ${formatDate(job.date)}` : formatDate(job.date)}
              {job.odometer_miles != null && ` · ${formatMiles(job.odometer_miles)} mi`}
            </div>
          </div>
          <Link href={`/jobs/${id}/edit`} className="btn btn-sm">Edit</Link>
        </div>

        {/* Stage (0043): scheduled = booked, not started · in progress = on
            the lift · done = ready to bill. Three 44px segments; a tap moves
            the job and stamps when. Only done jobs count as work in the books. */}
        <div className="flex flex-wrap items-start gap-2">
          <div
            role="group"
            aria-label="Job stage"
            className="grid min-w-0 flex-1 gap-2"
            style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', flexBasis: 260 }}
          >
            {STAGES.map((s) => (
              <button
                key={s.value}
                type="button"
                className="btn btn-sm !min-h-[44px]"
                aria-pressed={stage === s.value}
                disabled={stageBusy || (stageLocked && s.value !== stage)}
                style={stage === s.value ? { borderColor: 'var(--accent)', color: 'var(--accent2)' } : undefined}
                onClick={() => setStage(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {/* Booked for: the drop-off day, which is job.date. Saves on change
              through updateJob, the same path the stage buttons take. Only
              while the job is not done — a done job's date is the work's date. */}
          {notDone && (
            <div className="min-w-0" style={{ flex: '1 1 200px' }}>
              <label className="label" htmlFor="job-booked">
                Booked for
              </label>
              <input
                id="job-booked"
                className="input"
                type="date"
                value={bookedDraft ?? job.date}
                disabled={stageBusy}
                aria-describedby="job-booked-help"
                style={{ minHeight: 44, fontSize: 16 }}
                onChange={(e) => saveBooked(e.target.value)}
                onBlur={() => setBookedDraft(null)}
              />
              <p id="job-booked-help" className="text-xs" style={{ color: 'var(--text3)', marginTop: 4 }}>
                the day the car is dropped off; it is the job&apos;s date
              </p>
            </div>
          )}
        </div>
        {/* Why the control is fixed, where the control is. A draft or a sent
            invoice does not pin a job; collected money does. */}
        {stageLocked && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            {formatCents(collectedCents)} collected, so this job stays done. Take the payment off to move it.
          </p>
        )}
        {notDone && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            {stage === 'scheduled'
              ? 'Booked, not started — waiting for the car. Not in the books until it is done.'
              : 'On the lift. Not in the books until it is done.'}
            {/* A timestamptz, so it is formatted in LOCAL time — slicing the
                ISO string would print tomorrow's date after ~4 pm in Juneau. */}
            {job.stage_changed_at &&
              ` Moved ${new Date(job.stage_changed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Link href={`/jobs/${id}/scan`} className="btn btn-sm btn-primary">Scan receipt</Link>
          <button
            className="btn btn-sm"
            onClick={() => {
              setAddingPart(true)
              setEditingLineId(null)
              setDraft(emptyDraft)
              // The panel lives in the Parts card far below the fold — a tap
              // that visibly does nothing gets tapped twice.
              setTimeout(() => {
                descriptionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                descriptionRef.current?.focus({ preventScroll: true })
              }, 60)
            }}
          >
            + Add part manually
          </button>
          <button className="btn btn-sm" disabled={invoicing || !customer} onClick={invoiceAction}>
            {invoicing
              ? 'Creating…'
              : govInvoice
                ? `Open ${govInvoice.invoice_number}`
                : notDone
                  ? 'Mark done, then invoice'
                  : 'Create invoice'}
          </button>
          {job.payment_status !== 'paid' && balanceDue > 0 && (
            <button
              className="btn btn-sm"
              style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
              onClick={() => {
                setActionMsg(null)
                // Settling the whole balance while the job is past its
                // approval would collect the unapproved extra — offer the two
                // lawful ways out instead. Once an invoice is sent or paid,
                // though, THAT invoice is what's owed and nothing here can
                // change it, so holding the payment only dead-ends the screen.
                if (!lockedByInvoice && isOverApproval(auth)) {
                  setBillingSheet('over')
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                  return
                }
                setPayQuickOpen(!payQuickOpen)
              }}
            >
              Mark paid
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen}>
            {moreOpen ? '⋯ Less' : '⋯ More'}
          </button>
        </div>

        {moreOpen && (
          <div className="panel-in flex flex-wrap gap-2 pt-2">
            <Link href={`/report?job=${id}`} className="btn btn-sm">
              Print this job
            </Link>
            {customer && (
              <Link href={`/report?customer=${customer.id}`} className="btn btn-sm">
                Print full history
              </Link>
            )}
            <button
              className="btn btn-sm"
              onClick={() => {
                setTemplateName(job!.title)
                setActionMsg(null)
                setTemplateOpen(!templateOpen)
              }}
            >
              Save as template
            </button>
            <Link href={`/quotes/new?job=${id}`} className="btn btn-sm">
              + Quote extra work
            </Link>
          </div>
        )}

        {templateOpen && moreOpen && (
          <div className="panel-in space-y-2 pt-2">
            <label className="label !mb-0">Template name (what you’d call this job in a list)</label>
            <input
              className="input"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button
                className="btn btn-primary btn-sm"
                disabled={!templateName.trim() || savingTemplate}
                onClick={async () => {
                  setSavingTemplate(true)
                  setActionMsg(null)
                  try {
                    await saveJobAsTemplate(templateName, job!, lines)
                    setTemplateOpen(false)
                    setActionMsg({
                      text: `Saved — “${templateName.trim()}” is now a starting point on New Job.`,
                      ok: true,
                    })
                    setTimeout(() => setActionMsg(null), 4000)
                  } catch (e) {
                    setActionMsg({ text: e instanceof Error ? e.message : String(e), ok: false })
                  } finally {
                    setSavingTemplate(false)
                  }
                }}
              >
                {savingTemplate ? 'Saving…' : 'Save template'}
              </button>
              <button className="btn btn-sm" onClick={() => setTemplateOpen(false)}>Cancel</button>
            </div>
          </div>
        )}

        {payQuickOpen && job.payment_status !== 'paid' && (
          <div className="panel-in space-y-2 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label !mb-0">
                Settle {formatCents(balanceDue)}
                {govInvoice ? '' : ' before tax'} by
              </span>
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  className="btn btn-sm"
                  style={
                    payQuickMethod === m.value
                      ? { borderColor: 'var(--accent)', color: 'var(--accent2)' }
                      : undefined
                  }
                  onClick={() => setPayQuickMethod(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-primary btn-sm"
                disabled={payingBusy}
                onClick={async () => {
                  if (balanceDue <= 0) return
                  setPayingBusy(true)
                  try {
                    await ensureLegacyCredit()
                    await recordPayment({
                      jobId: id,
                      invoiceId: openInvoice?.id ?? null,
                      amountCents: balanceDue,
                      method: payQuickMethod,
                      date: todayIso(),
                    })
                    setPayQuickOpen(false)
                    await load()
                  } catch (e) {
                    setActionMsg({ text: e instanceof Error ? e.message : String(e), ok: false })
                  } finally {
                    setPayingBusy(false)
                  }
                }}
              >
                {payingBusy ? 'Recording…' : `Record ${formatCents(balanceDue)}`}
              </button>
              <button className="btn btn-sm" onClick={() => setPayQuickOpen(false)}>Cancel</button>
            </div>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              Partial payment or a different date? Use the Payments card below.
            </p>
          </div>
        )}

        {actionMsg && (
          <p
            className="flash-in pt-1 text-sm"
            style={{ color: actionMsg.ok ? 'var(--green)' : 'var(--red)' }}
          >
            {actionMsg.text}
          </p>
        )}
      </div>

      {/* Never bill past what the customer approved; part conditions before
          an invoice. Renders nothing while the job is within its approval. */}
      {authFailed && (
        <div className="card" style={{ borderLeft: '3px solid var(--status-wait-solid)' }}>
          <p className="text-sm" style={{ color: 'var(--status-wait-fg)' }}>
            Couldn&apos;t check this job against the approved estimate just now. Reload before you
            invoice — billing and &ldquo;Mark paid&rdquo; will refuse until the check reads again.
          </p>
        </div>
      )}
      <BillingCheck
        jobId={id}
        customer={customer}
        lines={lines}
        partsOverrideCents={job.parts_charged_override_cents}
        auth={auth}
        locked={lockedByInvoice}
        hasDraftInvoice={invoices.some((i) => i.status === 'draft')}
        sheet={billingSheet}
        setSheet={setBillingSheet}
        onChanged={load}
        onProceed={createInvoice}
      />

      {/* Work performed */}
      {job.work_performed && (
        <div className="card">
          <div className="label">Work performed</div>
          <p className="whitespace-pre-wrap">{job.work_performed}</p>
        </div>
      )}

      <JobPhotos jobId={id} />

      {/* Quotes tied to this job — the originating quote and any add-on
          authorizations for extra work found mid-job. */}
      {linkedQuotes.length > 0 && (
        <div className="card space-y-2">
          <span className="label !mb-0">Quotes on this job</span>
          {linkedQuotes.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <Link href={`/quotes/${q.id}`} style={{ color: 'var(--blue)' }}>
                  {q.quote_number}
                </Link>{' '}
                <span className="truncate" style={{ color: 'var(--text2)' }}>{q.title}</span>
              </div>
              <div className="flex flex-none items-center gap-2">
                {q.total_cents != null && <span className="money">{formatCents(q.total_cents)}</span>}
                <span className={statusChipClass(q.status)}>{q.status}</span>
                <span className="text-xs" style={{ color: q.applied_at ? 'var(--green)' : 'var(--text3)' }}>
                  {q.applied_at ? '✓ on job' : 'not applied'}
                </span>
              </div>
            </div>
          ))}
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            {/* The quoted label tracks the real button, which drops its emoji
                on desktop — so this prose has to as well. */}
            Found more while you&apos;re in there? “Quote
            extra work” sends the customer the usual approval link, and approved lines land on
            this job.
          </p>
        </div>
      )}

      {/* The OKs past the estimate (AS 45.45.170(d)) as the OWNER sees them,
          each correctable until an invoice goes out. The wrong time on one of
          these is what the owner could not fix (2026-09-14); the record has to
          be accurate, and a correction shows on the row rather than quietly
          replacing what was there. Not the customer's copy — that trail is
          built by buildAuthorizationTrail and frozen onto the invoice, and it
          carries the facts of the approval, never this app's edit history. */}
      <RecordedOks
        jobId={id}
        oks={oks}
        lines={lines}
        locked={lockedByInvoice}
        onChanged={load}
      />

      {/* Recommendations — trackable items that follow the vehicle and seed
          the invoice the customer receives. */}
      <div className="card space-y-2">
        <span className="label !mb-0">Recommendations</span>
        <RecommendationList
          jobId={id}
          vehicleId={job.vehicle_id}
          items={recs}
          onChanged={load}
        />
      </div>

      {/* Labor — adjusted right here, no trip through Edit job. */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <span className="label !mb-0">Labor</span>
          {!editingLabor && (
            <button className="btn btn-sm" onClick={openLaborEditor}>
              Adjust
            </button>
          )}
        </div>

        {editingLabor ? (
          <div className="panel-in space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="label">Hours</label>
                <div className="flex items-center gap-1">
                  <button
                    className="btn btn-sm !min-h-[44px] !px-3"
                    aria-label="Half an hour less"
                    onClick={() => setLaborHoursInput(bumpHours(laborHoursInput, -0.5))}
                  >
                    −
                  </button>
                  <input
                    className="input !min-h-[44px] text-center"
                    inputMode="decimal"
                    aria-label="Labor hours"
                    value={laborHoursInput}
                    onChange={(e) => setLaborHoursInput(e.target.value)}
                  />
                  <button
                    className="btn btn-sm !min-h-[44px] !px-3"
                    aria-label="Half an hour more"
                    onClick={() => setLaborHoursInput(bumpHours(laborHoursInput, 0.5))}
                  >
                    +
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Rate ($/hr)</label>
                <input
                  className="input !min-h-[44px]"
                  inputMode="decimal"
                  aria-label="Labor rate"
                  value={laborRateInput}
                  onChange={(e) => setLaborRateInput(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm" style={{ color: 'var(--text2)' }}>
                Labor charge{' '}
                <b className="money">
                  {formatCents(
                    Math.round((Number(laborHoursInput) || 0) * (parseMoney(laborRateInput) ?? 0)),
                  )}
                </b>
              </span>
              <div className="flex gap-2">
                <button className="btn btn-sm" onClick={() => setEditingLabor(false)}>
                  Cancel
                </button>
                <button className="btn btn-sm btn-primary" disabled={savingLabor} onClick={saveLabor}>
                  {savingLabor ? 'Saving…' : 'Save labor'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-lg px-1 py-1">
            <div className="min-w-0">
              <div className="font-semibold">Labor</div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>
                {Number(job.labor_hours) > 0
                  ? `${Number(job.labor_hours)} hr × ${formatCents(job.labor_rate_cents)}/hr`
                  : 'No labor booked yet'}
              </div>
            </div>
            <span className="money font-semibold">{formatCents(totals.labor_charge_cents)}</span>
          </div>
        )}
      </div>

      {/* Parts */}
      <div className="card space-y-2">
        <div className="label">Parts</div>
        {lines.length === 0 && !addingPart && (
          <p className="text-sm" style={{ color: 'var(--text3)' }}>
            No parts yet — scan a receipt or add one manually.
          </p>
        )}
        {/* Billed lines first, then the shop's own cost (never on the bill). */}
        {[...billedLines, ...shopCostLines].map((l, idx, all) => (
          <div
            key={l.id}
            className="border-b pb-2 last:border-b-0"
            style={{ borderColor: 'var(--border)' }}
          >
            {l.on_invoice === false && (idx === 0 || all[idx - 1].on_invoice !== false) && (
              <div className="label !mb-1 pt-1">Shop cost — not on the customer’s bill</div>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {l.description}
                  {l.part_number && (
                    <span className="ml-2 text-xs" style={{ color: 'var(--text3)' }}>#{l.part_number}</span>
                  )}
                </div>
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  {[
                    l.store,
                    l.purchase_date,
                    l.receipt_id ? 'receipt' : null,
                    l.substituted_from ? `quoted #${l.substituted_from}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {l.awaiting_cost && <span className="chip chip-open mt-1">awaiting cost</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  {l.on_invoice === false ? (
                    <>
                      <div className="money font-medium" style={{ color: 'var(--text2)' }}>
                        {formatCents(l.line_total_cents)}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text3)' }}>your cost</div>
                    </>
                  ) : (
                    <>
                      <div className="money font-medium">{formatCents(l.line_charge_total_cents)}</div>
                      <div className="text-xs" style={{ color: 'var(--text3)' }}>
                        {Number(l.qty)} × {formatCents(l.unit_charge_cents ?? l.unit_cost_cents)}
                      </div>
                      {!l.awaiting_cost &&
                        l.unit_charge_cents != null &&
                        l.unit_charge_cents !== l.unit_cost_cents && (
                          <div className="text-xs" style={{ color: 'var(--accent2)' }}>
                            cost {formatCents(l.line_total_cents)}
                          </div>
                        )}
                    </>
                  )}
                </div>
                <button className="btn btn-sm" aria-label="Edit part" onClick={() => startEditLine(l)}>✎</button>
                <button
                  className="btn btn-sm btn-danger"
                  aria-label="Delete part"
                  disabled={busyLineId === l.id}
                  onClick={() => deleteLine(l.id)}
                >
                  {busyLineId === l.id ? '…' : '✕'}
                </button>
              </div>
            </div>
            {l.awaiting_cost &&
              (costEditId === l.id ? (
                <div className="panel-in mt-1 flex items-center gap-1">
                  <input
                    className="input !min-h-[40px]"
                    inputMode="decimal"
                    autoFocus
                    aria-label={`What you paid for ${l.description}, per unit`}
                    placeholder="What you paid, per unit (0 if nothing)"
                    value={costInput}
                    onChange={(e) => setCostInput(e.target.value)}
                  />
                  <button className="btn btn-sm btn-primary !min-h-[40px]" disabled={costBusy} onClick={() => saveLineCost(l)}>
                    {costBusy ? '…' : '✓'}
                  </button>
                  <button className="btn btn-sm !min-h-[40px]" onClick={() => setCostEditId(null)}>✕</button>
                </div>
              ) : (
                <button
                  className="btn btn-sm mt-1"
                  onClick={() => {
                    setCostEditId(l.id)
                    setCostInput('')
                  }}
                >
                  Enter cost
                </button>
              ))}
            {/* Never on the adjustment line: it IS the record of billing the
                approved estimate, and one stray tap would undo that. */}
            {!lockedByInvoice &&
              !l.awaiting_cost &&
              !l.is_adjustment &&
              (l.on_invoice === false || (quotedJob && !l.quote_line_id)) && (
              <button
                className="mt-1 text-xs underline"
                style={{ color: 'var(--blue)' }}
                disabled={busyLineId === l.id}
                onClick={() => setOnInvoice(l, l.on_invoice === false)}
              >
                {l.on_invoice === false ? 'Bill it to the customer' : 'Take it off the bill'}
              </button>
            )}
          </div>
        ))}

        {addingPart && (
          <div className="panel-in space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border2)' }}>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="label">Description *</label>
                <input
                  ref={descriptionRef}
                  className="input"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Part #</label>
                <input
                  className="input"
                  value={draft.part_number}
                  onChange={(e) => setDraft({ ...draft, part_number: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Store</label>
                <input
                  className="input"
                  list="store-suggestions"
                  value={draft.store}
                  onChange={(e) => setDraft({ ...draft, store: e.target.value })}
                />
                <datalist id="store-suggestions">
                  {storeSuggestions.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <label className="label">Qty</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={draft.qty}
                  onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Unit cost ($)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="Negative for returns"
                  value={draft.unit_cost}
                  onChange={(e) => setDraft({ ...draft, unit_cost: e.target.value })}
                />
              </div>
              {(() => {
                const editingLine = editingLineId
                  ? (lines.find((l) => l.id === editingLineId) ?? null)
                  : null
                // Same rule as saveLine, or the form would promise one thing
                // and the save would do another.
                const newCore = !editingLine && isCoreDescription(draft.description.trim())
                const offBill = editingLine
                  ? editingLine.on_invoice === false
                  : lockedByInvoice || newCore || (quotedJob && !billNewPart)
                return (
                  <div className="col-span-2 space-y-1">
                    {!editingLine && quotedJob && !lockedByInvoice && (
                      <label className="flex min-h-[44px] items-center gap-2 text-sm" style={{ color: 'var(--text2)' }}>
                        <input
                          type="checkbox"
                          checked={billNewPart}
                          onChange={(e) => setBillNewPart(e.target.checked)}
                        />
                        Bill the customer for this part
                      </label>
                    )}
                    {offBill ? (
                      <p className="text-xs" style={{ color: 'var(--text3)' }}>
                        {editingLine
                          ? 'Off the bill — your cost only. “Bill it to the customer” on the part changes that.'
                          : newCore
                            ? 'A core deposit is your money, never the customer’s charge. It stops counting as a cost once the store credits it back, and only goes on a bill if they deny it — track that on Follow-ups.'
                            : lockedByInvoice
                              ? 'The invoice for this job is already out, so a part added now goes on your books as cost. To bill it, void that invoice and reissue.'
                              : 'Not on what the customer approved, so it goes on your books as shop cost. Tick the box only if they’ve OK’d it.'}
                      </p>
                    ) : (
                      <>
                        <label className="label">Charge customer ($ per unit)</label>
                        <input
                          className="input"
                          inputMode="decimal"
                          placeholder={
                            editingLine
                              ? editingLine.quote_line_id
                                ? 'Blank = keep the approved price'
                                : 'Blank = same as cost'
                              : markup.enabled
                                ? 'Blank = your markup matrix (tax and freight at cost)'
                                : 'Blank = same as cost'
                          }
                          value={draft.unit_charge}
                          onChange={(e) => setDraft({ ...draft, unit_charge: e.target.value })}
                        />
                      </>
                    )}
                  </div>
                )
              })()}
              <div className="col-span-2">
                <label className="label">Purchase date</label>
                <input
                  className="input"
                  type="date"
                  value={draft.purchase_date}
                  onChange={(e) => setDraft({ ...draft, purchase_date: e.target.value })}
                />
              </div>
            </div>
            {lineMsg && (
              <p className="text-sm" style={{ color: 'var(--red)' }}>{lineMsg}</p>
            )}
            <div className="flex items-center gap-2">
              <button className="btn btn-primary btn-sm" disabled={savingLine} onClick={saveLine}>
                {savingLine ? 'Adding…' : editingLineId ? 'Save part' : '+ Add this part'}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setAddingPart(false)
                  setEditingLineId(null)
                  setDraft(emptyDraft)
                }}
              >
                {editingLineId ? 'Cancel' : 'Done'}
              </button>
              {addedFlash && (
                <span className="flash-in text-sm" style={{ color: 'var(--green)' }}>
                  Added “{addedFlash}” ✓ — next part?
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Receipts */}
      {receipts.length > 0 && (
        <div className="card space-y-2">
          <div className="label">Receipts</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {receipts.map((r) => {
              const pdf = /\.pdf$/i.test(r.storage_path)
              const showImage = receiptUrls[r.id] && !pdf && !failedThumbs.has(r.id)
              return (
                <div key={r.id} className="relative">
                  <a href={receiptUrls[r.id]} target="_blank" rel="noreferrer">
                    {showImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={receiptUrls[r.id]}
                        alt=""
                        className="h-24 w-full rounded-t-lg border border-b-0 object-cover"
                        style={{ borderColor: 'var(--border)' }}
                        onError={() => setFailedThumbs((prev) => new Set(prev).add(r.id))}
                      />
                    ) : (
                      // PDFs and formats the browser can't render (e.g. HEIC
                      // photos) get a clean placeholder; the file still opens.
                      <div
                        className="flex h-24 items-center justify-center rounded-t-lg border border-b-0 text-xs"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg2)', color: 'var(--text3)' }}
                      >
                        {pdf ? 'PDF' : 'photo'}
                      </div>
                    )}
                    <div
                      className="rounded-b-lg border p-1.5"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
                    >
                      <div className="truncate text-sm font-semibold">
                        {r.store ?? (pdf ? 'PDF receipt' : 'Receipt')}
                      </div>
                      <div className="truncate text-xs" style={{ color: 'var(--text3)' }}>
                        {[
                          r.purchase_date,
                          formatCents(r.receipt_total_cents),
                          r.tax_cents ? `tax ${formatCents(r.tax_cents)}` : null,
                        ]
                          .filter((x) => x && x !== '—')
                          .join(' · ') || r.extraction_status}
                      </div>
                    </div>
                  </a>
                  {taxEditId === r.id ? (
                    <div className="mt-1 flex gap-1">
                      <input
                        className="input !min-h-[36px] !py-1 text-sm"
                        inputMode="decimal"
                        aria-label="Sales tax on this receipt"
                        value={taxInput}
                        onChange={(e) => setTaxInput(e.target.value)}
                      />
                      <button
                        className="btn btn-sm btn-primary !px-2"
                        disabled={taxBusy}
                        onClick={() => saveReceiptTax(r)}
                      >
                        ✓
                      </button>
                      <button className="btn btn-sm !px-2" onClick={() => setTaxEditId(null)}>
                        ✕
                      </button>
                    </div>
                  ) : isUnfinished(r) ? (
                    // Uploaded but never saved: finish it on the stored file
                    // instead of re-shooting it (and doubling the receipt).
                    <Link
                      href={`/jobs/${id}/scan?receipt=${r.id}`}
                      className="btn btn-sm btn-primary mt-1 w-full !py-1 !text-[0.7rem]"
                    >
                      Finish receipt
                    </Link>
                  ) : (
                    <button
                      className="btn btn-sm mt-1 w-full !py-1 !text-[0.7rem]"
                      onClick={() => {
                        setTaxEditId(r.id)
                        setTaxInput(r.tax_cents ? centsToInput(r.tax_cents) : '')
                      }}
                    >
                      {r.tax_cents ? 'Edit sales tax' : 'Add sales tax'}
                    </button>
                  )}
                  {/* 44px hit area kept clear of the open-receipt link's
                      corner — a ~22px ✕ overlapping the link was a coin flip
                      with gloves on. */}
                  <button
                    className="absolute -right-1 -top-1 flex min-h-[44px] min-w-[44px] items-center justify-center"
                    onClick={() => deleteReceipt(r)}
                    aria-label="Delete receipt"
                  >
                    <span
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{ background: 'rgba(0,0,0,0.7)', color: 'var(--red)' }}
                    >
                      ✕
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Money summary */}
      <div className="card space-y-1">
        <div className="label">Money</div>
        <Row label={`Labor (${Number(job.labor_hours)} hr × ${formatCents(job.labor_rate_cents)})`} value={totals.labor_charge_cents} />
        <Row label="Parts cost (what you paid)" value={totals.parts_cost_cents} />
        {receiptTaxCents > 0 && (
          // What the SHOP paid the parts store in tax: a cost inside the line
          // above. The customer's sales tax is further down, by the bill.
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text3)' }}>
            <span>— incl. tax you paid the parts store (your cost)</span>
            <span className="money">{formatCents(receiptTaxCents)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--text2)' }}>
            Parts charged{' '}
            {job.parts_charged_override_cents != null && (
              <span className="text-xs" style={{ color: 'var(--accent2)' }}>(override)</span>
            )}
            <button
              className="ml-2 text-xs underline"
              style={{ color: 'var(--blue)' }}
              onClick={() => {
                setEditingOverride(!editingOverride)
                setOverrideInput(centsToInput(job.parts_charged_override_cents))
              }}
            >
              edit
            </button>
          </span>
          <span className="money">{formatCents(totals.parts_charged_cents)}</span>
        </div>
        {editingOverride && (
          <div className="panel-in flex items-center gap-2 py-1">
            <input
              className="input !min-h-[38px]"
              inputMode="decimal"
              placeholder="Blank = sum of the line charges"
              value={overrideInput}
              onChange={(e) => setOverrideInput(e.target.value)}
            />
            <button
              className="btn btn-sm btn-primary"
              onClick={async () => {
                await updateJob(
                  { parts_charged_override_cents: overrideInput.trim() === '' ? null : parseMoney(overrideInput) },
                  { resyncPayments: true },
                )
                setEditingOverride(false)
              }}
            >
              Save
            </button>
          </div>
        )}
        {/* The customer's side: the charge before tax, the sales tax, and the
            bill. With an invoice, tax and bill are read off the governing
            invoice itself — never the charge × a rate, which would invent tax
            on the untaxed invoices. With none yet, the invoice Create invoice
            would build now, marked as an estimate. */}
        <div className="border-t pt-1" style={{ borderColor: 'var(--border2)' }}>
          <Row label="Charged before tax" value={totals.total_charged_cents} />
          {govInvoice ? (
            <>
              <Row
                label={
                  govInvoice.tax_cents > 0
                    ? `Sales tax (${formatTaxRate(govInvoice.tax_rate_bp)})`
                    : 'Sales tax (none on the invoice)'
                }
                value={govInvoice.tax_cents}
              />
              <Row
                label={
                  govInvoice.status === 'draft'
                    ? `To bill (${govInvoice.invoice_number}, draft)`
                    : `Billed to customer (${govInvoice.invoice_number})`
                }
                value={govInvoice.total_cents}
                bold
              />
            </>
          ) : (
            invoiceEstimate && (
              <>
                <Row
                  label={`Sales tax when invoiced (${formatTaxRate(estimateRateBp)}, estimate)`}
                  value={invoiceEstimate.tax_cents}
                />
                <Row label="Will bill" value={invoiceEstimate.total_cents} bold />
              </>
            )
          )}
        </div>
        {govInvoice && invoicePreTax !== null && invoicePreTax !== totals.total_charged_cents && (
          <p className="text-xs" style={{ color: 'var(--status-wait-fg)' }}>
            {govInvoice.invoice_number} was made when the job came to {formatCents(invoicePreTax)} before
            tax; it comes to {formatCents(totals.total_charged_cents)} now.{' '}
            {/* The balance targets the LARGER of the two (owedGrossCents), so
                the note names whichever one the balance below is using. */}
            {totals.total_charged_cents > govInvoice.total_cents
              ? `That is more than the invoice's whole ${formatCents(govInvoice.total_cents)}, so the balance below is measured against ${formatCents(totals.total_charged_cents)}, which is not on any invoice the customer has. Void and reissue the invoice so their paper matches.`
              : `The balance below is measured against the invoice's ${formatCents(govInvoice.total_cents)}, which is what the customer was billed.`}
          </p>
        )}
        <div
          className="mt-2 flex items-center justify-between rounded-lg px-3 py-2"
          style={{ background: 'var(--bg2)', border: '1px dashed var(--border2)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text3)' }}>
            Profit (never shown to customers)
          </span>
          <span className="money font-bold" style={{ color: totals.profit_cents >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {formatCents(totals.profit_cents)}
          </span>
        </div>
        {includedTaxCents > 0 && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            {govInvoice?.invoice_number ?? 'The invoice'} went out with no tax line, so the customer
            paid the price only. You still owe the state {formatCents(includedTaxCents)} sales tax on
            that price; it is taken off the profit above.
          </p>
        )}
        {awaitingLines.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--status-wait-fg)' }}>
            Not final: {formatCents(awaitingChargedCents)} is charged on {awaitingLines.length} part
            {awaitingLines.length === 1 ? '' : 's'} with no cost entered yet, so it counts as profit
            until you enter what you paid.
          </p>
        )}
      </div>

      {/* Invoices */}
      {invoices.length > 0 && (
        <div className="card space-y-1">
          <div className="label">Invoices</div>
          {invoices.map((inv) => (
            <Link
              key={inv.id}
              href={`/invoices/${inv.id}`}
              className="flex items-center justify-between rounded-lg px-3 py-2 hover:brightness-110"
              style={{ background: 'var(--bg2)' }}
            >
              <span className="font-semibold">{inv.invoice_number}</span>
              <span className="flex items-center gap-2">
                <span className="money">{formatCents(inv.total_cents)}</span>
                <span className={statusChipClass(inv.status)}>{inv.status}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Payments ledger */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <span className="label !mb-0">Payments</span>
          <span
            className="money text-sm font-bold"
            style={{ color: balanceDue > 0 ? 'var(--red)' : 'var(--green)' }}
          >
            {/* With no invoice the balance is measured against the charge
                BEFORE tax (the "Will bill" figure above adds the tax), so it
                says so, and cash above that charge is paid ahead of the
                invoice — never "over" a bill that does not exist yet. */}
            {govInvoice
              ? balanceDue > 0
                ? `Balance due ${formatCents(balanceDue)}`
                : overCollected > 0
                  ? `Paid in full ✓ · ${formatCents(overCollected)} over the invoice`
                  : 'Paid in full ✓'
              : balanceDue > 0
                ? `Balance due ${formatCents(balanceDue)} before tax`
                : overCollected > 0
                  ? `Paid before tax ✓ · ${formatCents(overCollected)} paid ahead of the invoice`
                  : 'Paid before tax ✓'}
          </span>
        </div>

        {payments.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
            style={{ background: 'var(--bg2)' }}
          >
            <span className="text-sm" style={{ color: 'var(--text2)' }}>
              {formatDate(p.date)} · {PAYMENT_METHODS.find((m) => m.value === p.method)?.label}
              {p.invoice_id && ' · invoiced'}
              {p.note && ` · ${p.note}`}
            </span>
            <span className="flex items-center gap-2">
              <span className="money font-semibold" style={{ color: 'var(--green)' }}>
                {formatCents(p.amount_cents)}
              </span>
              <button
                className="btn btn-sm btn-danger !px-1.5 text-xs"
                aria-label="Delete payment"
                onClick={async () => {
                  if (!confirm('Delete this payment record?')) return
                  try {
                    await deletePayment(p.id, id)
                    await load()
                  } catch (e) {
                    alert(e instanceof Error ? e.message : String(e))
                  }
                }}
              >
                ✕
              </button>
            </span>
          </div>
        ))}
        {payments.length === 0 && job.payment_status === 'partial' && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Marked partial before payment tracking existed — new payments recorded here will take
            over the math.
          </p>
        )}
        {legacyUnrecorded && (
          <div className="space-y-2 rounded-lg p-3" style={{ background: 'var(--bg2)' }}>
            <p className="text-sm" style={{ color: 'var(--text2)' }}>
              Marked paid before the app tracked payments, so there&apos;s no record of how or when
              the customer paid. Add it for your tax records — the {formatCents(legacyPaidCents)}{' '}
              bill doesn&apos;t change.
            </p>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              The job is dated {formatDate(job.date)}
              {govInvoice?.paid_at ? `; the invoice was marked paid ${formatDate(govInvoice.paid_at.slice(0, 10))}` : ''}.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <select
                className="select"
                aria-label="How the customer paid"
                value={legacyMethod}
                onChange={(e) => setLegacyMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <input
                className="input"
                type="date"
                aria-label="Day the customer paid"
                value={legacyDate}
                onChange={(e) => {
                  setLegacyDate(e.target.value)
                  setLegacyMsg(null)
                }}
              />
              <button
                className="btn btn-primary col-span-2 sm:col-span-1"
                disabled={legacyBusy || !legacyDate}
                onClick={recordLegacyPayment}
              >
                {legacyBusy ? 'Recording…' : <>Record {formatCents(legacyPaidCents)} paid</>}
              </button>
            </div>
          </div>
        )}
        {/* Outside the panel: a payment that landed hides the panel, and what
            went wrong after it must still be read. */}
        {legacyMsg && (
          <p className="text-sm" style={{ color: 'var(--red)' }} role="status">
            {legacyMsg}
          </p>
        )}
        {govInvoice && overCollected > 0 && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            {formatCents(overCollected)} more than the invoice was recorded as payment. If it was a
            tip, delete that payment and record it again — you&apos;ll be asked whether the extra is a
            tip. Otherwise it is owed back.
          </p>
        )}

        {/* Tips (0048): income on their own date — never a payment toward the
            job, never part of the sale, no sales tax. They change nothing
            owed above. */}
        {tips.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
            style={{ background: 'var(--bg2)' }}
          >
            {tipDeleteId === t.id ? (
              <>
                <span className="text-sm" style={{ color: 'var(--text2)' }} role="status">
                  Delete this {formatCents(t.amount_cents)} tip?
                </span>
                <span className="flex items-center gap-2">
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={tipBusy}
                    onClick={async () => {
                      setTipBusy(true)
                      setTipMsg(null)
                      try {
                        await deleteTip(t.id)
                        setTipDeleteId(null)
                        await load()
                      } catch (e) {
                        setTipMsg(`The tip was not deleted: ${e instanceof Error ? e.message : String(e)}`)
                      }
                      setTipBusy(false)
                    }}
                  >
                    Delete
                  </button>
                  <button className="btn btn-sm" disabled={tipBusy} onClick={() => setTipDeleteId(null)}>
                    Cancel
                  </button>
                </span>
              </>
            ) : (
              <>
                <span className="text-sm" style={{ color: 'var(--text2)' }}>
                  Tip {formatCents(t.amount_cents)} ·{' '}
                  {(PAYMENT_METHODS.find((m) => m.value === t.method)?.label ?? t.method).toLowerCase()} ·{' '}
                  {formatDate(t.date)}
                  {t.note && t.note !== 'Tip' && ` · ${t.note}`}
                </span>
                <span className="flex items-center gap-2">
                  <button
                    className="btn btn-sm btn-danger !px-1.5 text-xs"
                    aria-label="Delete tip"
                    onClick={() => {
                      setTipMsg(null)
                      setTipDeleteId(t.id)
                    }}
                  >
                    ✕
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
        {tips.length > 1 && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Tips on this job: <b className="money">{formatCents(tipsTotal)}</b> — yours, not part of the bill.
          </p>
        )}
        {tipsFailed && (
          <p className="text-xs" style={{ color: 'var(--red)' }}>
            Tips did not load — reload to see them. The balance above does not depend on them.
          </p>
        )}
        {tipMsg && (
          <p className="text-sm" style={{ color: 'var(--red)' }} role="status">
            {tipMsg}
          </p>
        )}

        {overPay && (
          <div
            className="panel-in space-y-2 rounded-lg p-3 text-sm"
            style={{ background: 'var(--status-wait-bg)', color: 'var(--status-wait-fg)' }}
            role="status"
          >
            {/* With no invoice yet the balance on the card is BEFORE tax, so
                the figure this is measured against is named: the invoice
                will add sales tax, and that is owed, not a tip. */}
            <p>
              {!govInvoice && invoiceEstimate ? (
                <>
                  That&apos;s {formatCents(overPay.amount - overPay.balance)} more than the{' '}
                  {formatCents(overPay.balance)} owed once sales tax is added (the invoice will bill{' '}
                  {formatCents(invoiceEstimate.total_cents)}:{' '}
                  {formatCents(invoiceEstimate.total_cents - invoiceEstimate.tax_cents)} +{' '}
                  {formatCents(invoiceEstimate.tax_cents)} sales tax). Record the extra{' '}
                  {formatCents(overPay.amount - overPay.balance)} as a tip?
                </>
              ) : (
                <>
                  That&apos;s {formatCents(overPay.amount - overPay.balance)} more than the balance. Record the
                  extra {formatCents(overPay.amount - overPay.balance)} as a tip?
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-sm btn-primary"
                disabled={payingBusy}
                onClick={() =>
                  recordPaymentAndTip(overPay.balance, overPay.method, overPay.date, overPay.amount - overPay.balance)
                }
              >
                Record as tip
              </button>
              <button
                className="btn btn-sm"
                disabled={payingBusy}
                onClick={() => recordPaymentAndTip(overPay.amount, overPay.method, overPay.date, 0)}
              >
                Keep it all as payment
              </button>
              <button className="btn btn-sm" disabled={payingBusy} onClick={() => setOverPay(null)}>
                Cancel
              </button>
            </div>
            <p className="text-xs">
              As a tip: a {formatCents(overPay.balance)} payment settles the balance and{' '}
              {formatCents(overPay.amount - overPay.balance)} is booked as a tip — income, no sales tax.
            </p>
          </div>
        )}

        {balanceDue > 0 && !overPay && (
          <div className="grid grid-cols-2 gap-2 border-t pt-2 sm:grid-cols-4" style={{ borderColor: 'var(--border)' }}>
            <input
              className="input"
              inputMode="decimal"
              placeholder={`Amount (${centsToInput(balanceDue)})`}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
            <select
              className="select"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <input className="input" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            <button
              className="btn btn-primary"
              disabled={payingBusy}
              onClick={async () => {
                const amount = payAmount.trim() === '' ? balanceDue : parseMoney(payAmount)
                if (!amount || amount === 0) {
                  alert('Enter a payment amount.')
                  return
                }
                // More than is owed (tax included, even before the invoice
                // exists): ask in the page whether the extra is a tip.
                if (owedWithTax > 0 && amount > owedWithTax) {
                  setOverPay({ amount, balance: owedWithTax, method: payMethod, date: payDate })
                  return
                }
                await recordPaymentAndTip(amount, payMethod, payDate, 0)
              }}
            >
              {payingBusy ? 'Recording…' : <>Record</>}
            </button>
          </div>
        )}

        {/* A tip handed over on its own, any time — before or after the bill
            is settled. */}
        {!tipOpen ? (
          <div className="flex justify-end">
            <button
              className="btn btn-sm"
              onClick={() => {
                setTipMsg(null)
                setTipAmount('')
                setTipOpen(true)
              }}
            >
              + Add tip
            </button>
          </div>
        ) : (
          <div
            className="panel-in grid grid-cols-2 gap-2 border-t pt-2 sm:grid-cols-4"
            style={{ borderColor: 'var(--border)' }}
          >
            <input
              className="input"
              inputMode="decimal"
              placeholder="Tip ($)"
              aria-label="Tip amount"
              value={tipAmount}
              onChange={(e) => setTipAmount(e.target.value)}
            />
            <select
              className="select"
              aria-label="Tip method"
              value={tipMethod}
              onChange={(e) => setTipMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <input
              className="input"
              type="date"
              aria-label="Tip date"
              value={tipDate}
              onChange={(e) => setTipDate(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="btn btn-primary flex-1"
                disabled={tipBusy || !(parseMoney(tipAmount) ?? 0)}
                onClick={async () => {
                  const cents = parseMoney(tipAmount) ?? 0
                  if (cents <= 0) {
                    setTipMsg('Enter the tip amount.')
                    return
                  }
                  setTipBusy(true)
                  setTipMsg(null)
                  try {
                    await recordTip({ jobId: id, amountCents: cents, method: tipMethod, date: tipDate })
                    setTipOpen(false)
                    setTipAmount('')
                    await load()
                  } catch (e) {
                    setTipMsg(e instanceof Error ? e.message : String(e))
                  }
                  setTipBusy(false)
                }}
              >
                {tipBusy ? 'Saving…' : 'Record tip'}
              </button>
              <button className="btn" onClick={() => setTipOpen(false)}>
                Cancel
              </button>
            </div>
            <p className="col-span-2 text-xs sm:col-span-4" style={{ color: 'var(--text3)' }}>
              A tip is yours on top of the bill: it counts as cash and income, never as a payment on the
              job, and carries no sales tax.
            </p>
          </div>
        )}
      </div>

      {/* Notes + danger zone */}
      {job.notes && (
        <div className="card">
          <div className="label">Private notes</div>
          <p className="whitespace-pre-wrap text-sm">{job.notes}</p>
        </div>
      )}
      <div className="pb-4 text-right">
        <button className="btn btn-sm btn-danger" onClick={softDeleteJob}>
          Delete job
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'var(--text2)' }} className={bold ? 'font-bold' : ''}>{label}</span>
      <span className={`money ${bold ? 'text-lg font-bold' : ''}`}>{formatCents(value)}</span>
    </div>
  )
}
