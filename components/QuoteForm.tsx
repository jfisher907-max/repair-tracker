'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken, supabase } from '@/lib/supabase'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import { computeQuoteTotals, depositForRule, DEPOSIT_KINDS } from '@/lib/billing'
import { prepareUpload } from '@/lib/upload'
import type { MarkupTier } from '@/lib/markup'
import { splitPartNumber } from '@/lib/receipt-match'
import {
  proposePrice,
  walkInSearchUrl,
  type QuotePricing,
  type WalkInSample,
} from '@/lib/quote-pricing'
import VehicleFields, { emptyVehicleDraft, vehiclePayload } from '@/components/VehicleFields'
import {
  vehicleLabel,
  type Customer,
  type DepositKind,
  type Quote,
  type QuoteLine,
  type Vehicle,
} from '@/lib/types'

/** The only types the quote reader accepts (its path check mirrors this list). */
const EXTENSION_BY_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** The stored file's extension, decided by what the file IS — falling back to
 *  a name that already ends in an accepted one. Null means don't upload it. */
function extensionFor(file: File, kind: 'image' | 'pdf' | 'file'): string | null {
  if (kind === 'pdf') return 'pdf'
  const byType = EXTENSION_BY_TYPE[file.type.toLowerCase()]
  if (byType) return byType
  const byName = (file.name.split('.').pop() || '').toLowerCase()
  return Object.values(EXTENSION_BY_TYPE).includes(byName) || byName === 'jpeg' ? byName : null
}

interface LineDraft {
  description: string
  qty: string
  /** The customer's price per unit — the only figure the customer ever sees. */
  unit_charge: string
  /** Owner-only supplier figures (migration 0034). */
  part_number: string
  line_code: string
  unit_cost: string
  unit_list: string
  /** The walk-in price, when Jake checked it on oreillyauto.com. */
  unit_retail: string
  /** The price came from the shop's rule: keep it in step with the figures
   *  until Jake types his own. */
  auto: boolean
  /** How the price was set (quote_lines.price_basis). */
  basis: string
}

const blankLine = (): LineDraft => ({
  description: '',
  qty: '1',
  unit_charge: '',
  part_number: '',
  line_code: '',
  unit_cost: '',
  unit_list: '',
  unit_retail: '',
  auto: true,
  basis: '',
})

const moneyInput = (cents: number | null | undefined) => (cents == null ? '' : centsToInput(cents))

/** One line the supplier-quote reader returns (app/api/extract-quote). */
interface SupplierQuoteLine {
  line_code: string | null
  part_number: string | null
  description: string
  qty: number
  unit_cost: number | null
  unit_list: number | null
  unit_price: number | null
  kind: 'part' | 'core' | 'fee' | 'labor' | 'tax'
  confidence: 'high' | 'low'
}

/** "Hide my costs" survives reloads (for when a customer can see the phone). */
const SHOW_COST_KEY = 'wnt_quote_show_cost'

function subscribeStorage(onChange: () => void) {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

function readShowCost(): string | null {
  try {
    return window.localStorage.getItem(SHOW_COST_KEY)
  } catch {
    return null
  }
}

function plusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** An open recommendation offered as a one-tap quote line. */
export interface QuoteSuggestion {
  description: string
  estimate_cents: number | null
}

/** The job an add-on quote authorizes extra work for. */
export interface AddOnJobContext {
  id: string
  job_number: string
  labor_rate_cents: number
  customer_id: string
  customer_name: string
  vehicle_id: string
  vehicle_label: string
}

/**
 * New/edit quote editor. The customer sees only description, qty and price.
 * Beside each line Jake can keep his O'Reilly figures — cost, list, the
 * walk-in price — and the shop's pricing rule (Settings) proposes the
 * customer price once, here. Nothing re-prices it after approval.
 */
export default function QuoteForm({
  quote,
  existingLines,
  onSaved,
  addOnJob,
  suggestions,
}: {
  quote?: Quote
  existingLines?: QuoteLine[]
  /** Embedded-edit mode: called after save instead of navigating (pushing the
      current route is a no-op, which would leave the button stuck on "Saving…"). */
  onSaved?: (quoteId: string) => void
  /** Present = this quote authorizes EXTRA work on an existing job: customer,
      vehicle, and labor rate come from the job, and approval applies lines to
      that job instead of creating a new one. */
  addOnJob?: AddOnJobContext
  /** Open recommendations for the vehicle — tappable prefill lines. */
  suggestions?: QuoteSuggestion[]
}) {
  const router = useRouter()
  const editing = !!quote

  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [customerId, setCustomerId] = useState<string>(
    quote?.customer_id ?? addOnJob?.customer_id ?? '',
  )
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [newVehicle, setNewVehicle] = useState(emptyVehicleDraft)
  const [vehicleId, setVehicleId] = useState<string>(quote?.vehicle_id ?? addOnJob?.vehicle_id ?? '')

  const [title, setTitle] = useState(quote?.title ?? '')
  const [description, setDescription] = useState(quote?.description ?? '')
  const [laborHours, setLaborHours] = useState(quote ? String(quote.labor_hours) : '')
  const [laborRate, setLaborRate] = useState(
    quote
      ? centsToInput(quote.labor_rate_cents)
      : addOnJob
        ? centsToInput(addOnJob.labor_rate_cents)
        : '',
  )
  // A new quote starts at Juneau's 5% until settings load (0041): never untaxed by accident.
  const [taxRate, setTaxRate] = useState(quote ? String(quote.tax_rate_bp / 100) : '5')
  const [validUntil, setValidUntil] = useState(quote?.valid_until ?? plusDays(30))
  const [notes, setNotes] = useState(quote?.notes ?? '')
  // The deposit is a RULE (parts / 50% / fixed), resolved against whatever the
  // customer actually approves — so unticking a line can never leave a
  // deposit bigger than the job.
  const [depositKind, setDepositKind] = useState<DepositKind>(quote?.deposit_kind ?? 'none')
  const [depositFixed, setDepositFixed] = useState(
    quote?.deposit_kind === 'fixed' && quote.deposit_value != null ? centsToInput(quote.deposit_value) : '',
  )
  const [lines, setLines] = useState<LineDraft[]>(
    existingLines?.length
      ? existingLines.map((l) => ({
          description: l.description,
          qty: String(l.qty),
          unit_charge: centsToInput(l.unit_charge_cents),
          part_number: l.part_number ?? '',
          line_code: l.line_code ?? '',
          unit_cost: moneyInput(l.unit_cost_cents),
          unit_list: moneyInput(l.unit_list_cents),
          unit_retail: moneyInput(l.unit_retail_cents),
          // A saved price is never re-derived behind Jake's back.
          auto: false,
          basis: l.price_basis ?? 'manual',
        }))
      : [blankLine()],
  )

  /** The shop's quoting rule and what it learns from (Settings, migration 0034). */
  const [pricing, setPricing] = useState<{ rule: QuotePricing; pct: number; tiers: MarkupTier[] }>({
    rule: 'walkin',
    pct: 0,
    tiers: [],
  })
  const [samples, setSamples] = useState<WalkInSample[]>([])
  // Read through useSyncExternalStore so the server render (no localStorage)
  // and the first client render agree; a tap overrides it for this visit.
  const storedShowCost = useSyncExternalStore(subscribeStorage, readShowCost, () => null)
  const [showCostOverride, setShowCostOverride] = useState<boolean | null>(null)
  const showCost = showCostOverride ?? storedShowCost !== '0'
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  /** The supplier quote file this quote was read from, if any. */
  const sourcePath = useRef<string | null>(quote?.source_path ?? null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Retry safety: if the save fails after the customer (or vehicle) landed,
  // resubmitting must reuse them instead of creating twins. Same pattern as
  // JobForm.
  const createdCustomerId = useRef<string | null>(null)
  const createdVehicleId = useRef<string | null>(null)

  useEffect(() => {
    supabase
      .from('customers')
      .select('*')
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => setCustomers((data as Customer[]) ?? []))
    supabase
      .from('vehicles')
      .select('*')
      .is('deleted_at', null)
      .then(({ data }) => setVehicles((data as Vehicle[]) ?? []))
    supabase
      .from('settings')
      .select('default_labor_rate_cents, default_tax_rate_bp, quote_pricing, quote_markup_pct, parts_markup_tiers')
      .single()
      .then(({ data }) => {
        if (!data) return
        setPricing({
          rule: (data.quote_pricing as QuotePricing) ?? 'walkin',
          pct: Number(data.quote_markup_pct) || 0,
          tiers: (data.parts_markup_tiers as MarkupTier[]) ?? [],
        })
        if (!editing) {
          // An add-on bills at ITS JOB's rate, not the shop default — the
          // quoted total must match what lands on the job.
          if (!addOnJob) setLaborRate(centsToInput(data.default_labor_rate_cents))
          setTaxRate(String((data.default_tax_rate_bp ?? 500) / 100))
        }
      })
    // Every walk-in price Jake has checked teaches the estimate.
    supabase
      .from('quote_lines')
      .select('line_code, unit_cost_cents, unit_list_cents, unit_retail_cents')
      .not('unit_retail_cents', 'is', null)
      .then(({ data }) => setSamples((data as WalkInSample[]) ?? []))
  }, [editing, addOnJob])

  const customerVehicles = vehicles.filter((v) => v.customer_id === customerId)

  const depositValue =
    depositKind === 'percent' ? 5000 : depositKind === 'fixed' ? (parseMoney(depositFixed) ?? 0) : null

  const taxRateBp = Math.round((Number(taxRate) || 0) * 100)
  const totals = useMemo(
    () =>
      computeQuoteTotals(
        {
          labor_hours: Number(laborHours) || 0,
          labor_rate_cents: parseMoney(laborRate) ?? 0,
          tax_rate_bp: taxRateBp,
        },
        lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            line_total_cents: Math.round((Number(l.qty) || 0) * (parseMoney(l.unit_charge) ?? 0)),
          })),
      ),
    [laborHours, laborRate, taxRateBp, lines],
  )

  /** Owner-only: what the parts earn, before and after O'Reilly's counter tax. */
  const margin = useMemo(() => {
    const valid = lines.filter((l) => l.description.trim())
    const costed = valid.filter((l) => parseMoney(l.unit_cost) != null)
    const cost = costed.reduce((s, l) => s + Math.round((Number(l.qty) || 0) * (parseMoney(l.unit_cost) ?? 0)), 0)
    const price = costed.reduce((s, l) => s + Math.round((Number(l.qty) || 0) * (parseMoney(l.unit_charge) ?? 0)), 0)
    return {
      costedLines: costed.length,
      uncosted: valid.length - costed.length,
      cents: price - cost,
      // The counter charges the same city tax the shop bills; unless parts are
      // bought for resale, it is a cost that comes out of the margin.
      afterTaxCents: price - cost - Math.round((cost * taxRateBp) / 10000),
    }
  }, [lines, taxRateBp])

  function proposalFor(l: LineDraft) {
    // Walk-in prices checked on THIS quote count as samples straight away.
    // Reading only saved rows meant the three prices Jake had just looked up
    // taught the estimate nothing until after he saved it.
    const live: WalkInSample[] = lines
      .filter((x) => x !== l)
      .map((x) => ({
        line_code: x.line_code.trim() || null,
        unit_cost_cents: parseMoney(x.unit_cost),
        unit_list_cents: parseMoney(x.unit_list),
        unit_retail_cents: parseMoney(x.unit_retail) ?? 0,
      }))
      .filter((x) => x.unit_retail_cents > 0)
    return proposePrice(
      pricing.rule,
      pricing.pct,
      {
        description: l.description,
        line_code: l.line_code.trim() || null,
        unit_cost_cents: parseMoney(l.unit_cost),
        unit_list_cents: parseMoney(l.unit_list),
        unit_retail_cents: parseMoney(l.unit_retail),
      },
      [...samples, ...live],
      pricing.tiers,
    )
  }

  /** Typing a figure re-prices a rule-priced line; typing the price makes it Jake's. */
  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines(
      lines.map((l, idx) => {
        if (idx !== i) return l
        let next = { ...l, ...patch }
        if ('unit_charge' in patch) {
          next = { ...next, auto: false, basis: 'manual' }
        } else if (
          next.auto &&
          ('unit_cost' in patch || 'unit_list' in patch || 'unit_retail' in patch || 'line_code' in patch || 'description' in patch)
        ) {
          const p = proposalFor(next)
          if (p.cents != null) next = { ...next, unit_charge: centsToInput(p.cents), basis: pricing.rule }
        }
        return next
      }),
    )
  }

  function toggleShowCost() {
    const next = !showCost
    setShowCostOverride(next)
    try {
      window.localStorage.setItem(SHOW_COST_KEY, next ? '1' : '0')
    } catch {}
  }

  /** Read an O'Reilly quote (screenshot, photo or PDF) into lines. */
  async function importSupplierQuote(picked: File) {
    setImportMsg(null)
    setImporting(true)
    try {
      const { file, kind } = await prepareUpload(picked)
      // The reader checks the stored PATH's extension, so it has to come from
      // what the file IS: a PDF saved without ".pdf", or a HEIC the browser
      // couldn't convert, uploaded happily and was then refused as unreadable.
      const ext = extensionFor(file, kind)
      if (!ext) {
        setImportMsg('That file type can’t be read — use a screenshot, a photo or a PDF.')
        return
      }
      const path = `quotes/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('receipts').upload(path, file, {
        contentType: file.type || 'application/octet-stream',
      })
      if (upErr) throw upErr
      sourcePath.current = path
      const token = await getAccessToken()
      const res = await fetch('/api/extract-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path }),
      })
      if (res.status === 501) {
        setImportMsg(
          'Reading O’Reilly quotes needs the receipt reader switched on (Settings). The file is kept with this quote — type the lines for now.',
        )
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as { lines: SupplierQuoteLine[] }
      const fresh: LineDraft[] = []
      let cores = 0
      /** Prices the reader found under a column it couldn't name as cost or list. */
      const unnamed: string[] = []
      for (const x of body.lines) {
        if (x.kind === 'labor' || x.kind === 'tax') continue
        if (x.kind === 'core') {
          cores++
          continue
        }
        // Only a column the reader could actually name becomes cost or list.
        // An unnamed price used to be filed as list, and on the walk-in rule
        // (list × the learned ratio) an O'Reilly NET figure then proposed a
        // customer price BELOW cost — and poisoned the ratio every later
        // estimate learns from. Left blank, Jake assigns it himself.
        if (x.unit_list == null && x.unit_cost == null && x.unit_price != null) {
          unnamed.push(`${x.description} ${x.unit_price.toFixed(2)}`)
        }
        const draft: LineDraft = {
          ...blankLine(),
          description: x.description,
          qty: String(x.qty || 1),
          part_number: x.part_number ?? '',
          line_code: x.line_code ?? '',
          unit_cost: x.unit_cost != null ? x.unit_cost.toFixed(2) : '',
          unit_list: x.unit_list != null ? x.unit_list.toFixed(2) : '',
        }
        const p = proposalFor(draft)
        fresh.push(p.cents != null ? { ...draft, unit_charge: centsToInput(p.cents), basis: pricing.rule } : draft)
      }
      const isBlank = (l: LineDraft) => !l.description.trim() && !l.unit_charge.trim()
      // Functional form: reading a quote takes seconds, and anything typed
      // while it ran was being thrown away by a stale `lines`.
      setLines((prev) => [...prev.filter((l) => !isBlank(l)), ...fresh])
      const unpriced = fresh.filter((l) => !l.unit_charge).length
      setImportMsg(
        [
          `Read ${fresh.length} part${fresh.length === 1 ? '' : 's'} — check each against the O’Reilly screen.`,
          unpriced
            ? `${unpriced} still need${unpriced === 1 ? 's' : ''} a price: tap “Check walk-in” to see it, and the app learns from it.`
            : null,
          unnamed.length
            ? `${unnamed.length} price${unnamed.length === 1 ? '' : 's'} sat under a column I couldn’t name (${unnamed.slice(0, 3).join('; ')}${unnamed.length > 3 ? `; +${unnamed.length - 3} more` : ''}) — left blank on purpose. Filed as list it could price a part under your cost; put each one in Cost or List yourself.`
            : null,
          cores
            ? `${cores} core charge${cores === 1 ? '' : 's'} left off — a core is your money until the old part goes back.`
            : null,
        ]
          .filter(Boolean)
          .join(' '),
      )
    } catch (e) {
      setImportMsg(`Couldn’t read that quote: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImporting(false)
    }
  }

  async function save() {
    setError(null)
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    if (!customerId && !newCustomerName.trim()) {
      setError('Pick a customer or enter a new one.')
      return
    }
    // A blank price used to save as $0, and once that quote is approved the $0
    // becomes the ceiling this job can ever be billed at. Imported lines start
    // unpriced on purpose, so this is the common case, not an edge one.
    const unpriced = lines.filter((l) => l.description.trim() && !l.unit_charge.trim())
    if (unpriced.length) {
      setError(
        `${unpriced.length === 1 ? 'One line has' : `${unpriced.length} lines have`} no price: ${unpriced
          .slice(0, 3)
          .map((l) => l.description.trim())
          .join('; ')}${unpriced.length > 3 ? '; …' : ''}. Type a price — 0 if it’s no charge — or clear the line.`,
      )
      return
    }
    setBusy(true)
    try {
      let cid = customerId
      let vid = vehicleId || null
      if (!cid) {
        if (createdCustomerId.current) {
          cid = createdCustomerId.current
        } else {
          const { data, error } = await supabase
            .from('customers')
            .insert({
              name: newCustomerName.trim(),
              phone: newCustomerPhone.trim() || null,
            })
            .select('id')
            .single()
          if (error) throw error
          createdCustomerId.current = data.id
          cid = data.id
        }
        // A quote without a vehicle can never convert to a job, and editing
        // later to add one resets an approved quote to draft — so a new
        // customer's vehicle comes along right here, like the job form does.
        if (Object.values(newVehicle).some((v) => v.trim() !== '')) {
          if (createdVehicleId.current) {
            vid = createdVehicleId.current
          } else {
            const { data: veh, error: vehErr } = await supabase
              .from('vehicles')
              .insert({ customer_id: cid, ...vehiclePayload(newVehicle) })
              .select('id')
              .single()
            if (vehErr) throw vehErr
            createdVehicleId.current = veh.id
            vid = veh.id
          }
        }
      }

      const payload = {
        customer_id: cid,
        vehicle_id: vid,
        // Born linked: an add-on quote carries its job from creation, which is
        // what makes "convert" become "apply to that job" on approval.
        ...(addOnJob && !editing ? { job_id: addOnJob.id } : {}),
        title: title.trim(),
        description: description.trim() || null,
        labor_hours: Number(laborHours) || 0,
        labor_rate_cents: parseMoney(laborRate) ?? 0,
        tax_rate_bp: taxRateBp,
        valid_until: validUntil || null,
        notes: notes.trim() || null,
        deposit_kind: depositKind,
        deposit_value: depositValue,
        source_path: sourcePath.current,
      }

      let quoteId = quote?.id
      if (editing) {
        // Editing a sent/decided quote invalidates what the customer saw —
        // drop it back to draft so it must be re-sent.
        // The authorization details go with it: they describe a document that
        // no longer exists, and leaving them would let the record card caption
        // the new version — or relabel a decline as an approval. The permanent
        // copy lives in quote_approvals, which is append-only.
        const resetStatus =
          quote.status !== 'draft'
            ? {
                status: 'draft' as const,
                decided_at: null,
                approved_by_name: null,
                approval_consent: null,
                approval_ip: null,
                approval_user_agent: null,
                approved_snapshot: null,
                // A resolved deposit belongs to an approval that no longer
                // stands; it is re-resolved at the next approval.
                deposit_cents: null,
              }
            : {}
        // The Edit button read applied_at when the page loaded. If the quote
        // has been converted since — from another device, or by the deposit
        // webhook — this update would wipe the approval (snapshot, consent,
        // frozen deposit) and the line delete right after would be refused by
        // the freeze trigger, leaving the job with no approved total at all and
        // reading as over its approval. So the guard is part of the write.
        const { data: touched, error } = await supabase
          .from('quotes')
          .update({ ...payload, ...resetStatus })
          .eq('id', quote.id)
          .is('applied_at', null)
          .select('id')
        if (error) throw error
        if (!touched?.length) {
          throw new Error(
            'This quote has already been turned into a job, so it can’t be edited. Reload the page and change the job instead.',
          )
        }
        // Simplest reliable line sync: replace the set.
        const { error: delErr } = await supabase.from('quote_lines').delete().eq('quote_id', quote.id)
        if (delErr) throw delErr
      } else {
        const { data, error } = await supabase.from('quotes').insert(payload).select('id').single()
        if (error) throw error
        quoteId = data.id
      }

      const validLines = lines.filter((l) => l.description.trim())
      if (validLines.length) {
        const { error: lineErr } = await supabase.from('quote_lines').insert(
          validLines.map((l) => {
            // A pasted O'Reilly number carries the store's line code ("BBR
            // 19B2682B"). There is no box to type it in on its own, so split it
            // here — the walk-in pricing learns per line code and otherwise
            // never sees one on a hand-typed line.
            const split = splitPartNumber(l.part_number)
            return {
            quote_id: quoteId,
            description: l.description.trim(),
            qty: Number(l.qty) || 1,
            unit_charge_cents: parseMoney(l.unit_charge) ?? 0,
            // Owner-only figures — get_public_quote never returns them.
            part_number: split.part_number || null,
            line_code: l.line_code.trim() || split.line_code,
            unit_cost_cents: parseMoney(l.unit_cost),
            unit_list_cents: parseMoney(l.unit_list),
            unit_retail_cents: parseMoney(l.unit_retail),
            price_basis: l.basis || (l.unit_charge.trim() ? 'manual' : null),
            }
          }),
        )
        if (lineErr) throw lineErr
      }
      if (onSaved) {
        setBusy(false)
        onSaved(quoteId!)
      } else {
        router.push(`/quotes/${quoteId}`)
        router.refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl">
        {editing
          ? `Edit ${quote.quote_number}`
          : addOnJob
            ? `Extra work on ${addOnJob.job_number}`
            : 'New Quote'}
      </h1>

      {addOnJob && !editing && (
        <div className="card !py-2 text-sm" style={{ color: 'var(--text2)' }}>
          <b>{addOnJob.customer_name}</b> · {addOnJob.vehicle_label} — when the customer
          approves, the approved lines and labor go onto <b>{addOnJob.job_number}</b>, not a
          new job. Labor bills at the job&apos;s rate.
        </div>
      )}
      {editing && quote.job_id && (
        <div className="card !py-2 text-sm" style={{ color: 'var(--text2)' }}>
          This quote is linked to a job, so the customer and vehicle are fixed.
        </div>
      )}

      {/* A job-linked quote must never be repointed at another customer or
          vehicle — the job it lands on wouldn't follow. */}
      {!(addOnJob || quote?.job_id) && (
      <div className="card space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Customer *</label>
            <select
              className="select"
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value)
                setVehicleId('')
              }}
            >
              <option value="">+ New customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Vehicle (optional)</label>
            <select
              className="select"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              disabled={!customerId}
            >
              <option value="">{customerId ? 'No specific vehicle' : 'Pick customer first'}</option>
              {customerVehicles.map((v) => (
                <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>
              ))}
            </select>
          </div>
          {!customerId && (
            <>
              <div>
                <label className="label">New customer name *</label>
                <input className="input" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" type="tel" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <div className="label">Vehicle (optional, but a quote needs one to become a job)</div>
                <VehicleFields value={newVehicle} onChange={setNewVehicle} />
              </div>
            </>
          )}
        </div>
      </div>
      )}

      <div className="card grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Title *</label>
          <input
            className="input"
            placeholder="Front brake job — pads & rotors"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Scope of work (customer sees this)</label>
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="label">Est. labor hours</label>
          <input className="input" inputMode="decimal" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} />
        </div>
        <div>
          <label className="label">Labor rate ($/hr)</label>
          <input className="input" inputMode="decimal" value={laborRate} onChange={(e) => setLaborRate(e.target.value)} />
        </div>
        <div>
          <label className="label">Sales tax (%)</label>
          <input className="input" inputMode="decimal" placeholder="0" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
        </div>
        <div>
          <label className="label">Valid until</label>
          <input className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
      </div>

      <div className="card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label !mb-0">Deposit on approval</span>
          {depositKind !== 'none' && (
            <span className="text-sm" style={{ color: 'var(--text2)' }}>
              ≈ {formatCents(depositForRule(depositKind, depositValue, totals) ?? 0)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {DEPOSIT_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              className="chip"
              style={{
                background: depositKind === k.value ? 'var(--accent)' : 'var(--bg3)',
                color: depositKind === k.value ? '#111' : undefined,
                cursor: 'pointer',
              }}
              onClick={() => setDepositKind(k.value)}
            >
              {k.label}
            </button>
          ))}
        </div>
        {depositKind === 'fixed' && (
          <input
            className="input"
            inputMode="decimal"
            placeholder="Amount, e.g. 200"
            value={depositFixed}
            onChange={(e) => setDepositFixed(e.target.value)}
          />
        )}
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          Figured on what the customer actually approves — if they skip a line, the deposit
          follows. Paying it books the job.
        </p>
      </div>

      <div className="card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="label !mb-0">Parts & materials (customer prices)</div>
          <button type="button" className="text-xs underline" style={{ color: 'var(--blue)' }} onClick={toggleShowCost}>
            {showCost ? 'Hide my costs' : 'Show my costs'}
          </button>
        </div>

        <label className="btn btn-sm w-full cursor-pointer">
          {importing ? 'Reading…' : 'Read an O’Reilly quote (screenshot, photo or PDF)'}
          <input
            type="file"
            accept="image/*,application/pdf,.pdf,.heic,.heif"
            className="hidden"
            disabled={importing}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) importSupplierQuote(f)
            }}
          />
        </label>
        {importMsg && (
          <p className="text-xs" style={{ color: 'var(--accent2)' }} role="status">{importMsg}</p>
        )}

        {!editing && (suggestions?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1">
            {suggestions!.map((s, i) => (
              <button
                key={i}
                type="button"
                className="chip"
                style={{ background: 'var(--bg3)', cursor: 'pointer' }}
                title="From this vehicle's open recommendations — tap to add as a line"
                onClick={() => {
                  const newLine: LineDraft = {
                    ...blankLine(),
                    description: s.description,
                    unit_charge: s.estimate_cents != null ? centsToInput(s.estimate_cents) : '',
                    auto: s.estimate_cents == null,
                    basis: s.estimate_cents != null ? 'manual' : '',
                  }
                  // Replace the single untouched starter line instead of
                  // stacking under it.
                  const isBlank = (l: LineDraft) => !l.description.trim() && !l.unit_charge.trim()
                  setLines(lines.length === 1 && isBlank(lines[0]) ? [newLine] : [...lines, newLine])
                }}
              >
                {s.description.length > 42 ? `${s.description.slice(0, 42)}…` : s.description}
                {s.estimate_cents != null && ` · ${formatCents(s.estimate_cents)}`}
              </button>
            ))}
          </div>
        )}

        {lines.map((l, i) => {
          const p = showCost ? proposalFor(l) : null
          const priceCents = parseMoney(l.unit_charge)
          const costCents = parseMoney(l.unit_cost)
          return (
            <div key={i} className="space-y-1.5 rounded-lg" style={showCost ? { padding: '6px', background: 'var(--bg2)' } : undefined}>
              <div className="grid grid-cols-[1fr_64px_96px_44px] items-center gap-1.5">
                <input
                  className="input !min-h-[40px]"
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
                <input
                  className="input !min-h-[40px]"
                  inputMode="decimal"
                  aria-label="Qty"
                  value={l.qty}
                  onChange={(e) => setLine(i, { qty: e.target.value })}
                />
                <input
                  className="input !min-h-[40px]"
                  inputMode="decimal"
                  aria-label="Customer price ($)"
                  placeholder="$"
                  value={l.unit_charge}
                  onChange={(e) => setLine(i, { unit_charge: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-danger !min-h-[40px] !px-2"
                  onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                  aria-label="Remove line"
                >
                  ✕
                </button>
              </div>
              {showCost && (
                <>
                  <div className="grid grid-cols-3 gap-1.5">
                    <input
                      className="input !min-h-[40px]"
                      placeholder="Part #"
                      aria-label="O'Reilly part number"
                      value={l.part_number}
                      onChange={(e) => setLine(i, { part_number: e.target.value })}
                    />
                    <input
                      className="input !min-h-[40px]"
                      inputMode="decimal"
                      placeholder="Your cost"
                      aria-label="Your O'Reilly cost per unit"
                      value={l.unit_cost}
                      onChange={(e) => setLine(i, { unit_cost: e.target.value })}
                    />
                    <input
                      className="input !min-h-[40px]"
                      inputMode="decimal"
                      placeholder="Walk-in $"
                      aria-label="O'Reilly walk-in price per unit"
                      value={l.unit_retail}
                      onChange={(e) => setLine(i, { unit_retail: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--text3)' }}>
                    <span className="min-w-0">
                      {p?.basis ? `Suggested${p.cents != null ? ` ${formatCents(p.cents)}` : ''}: ${p.basis}` : 'Only you see these'}
                      {costCents != null && priceCents != null && ` · margin ${formatCents(priceCents - costCents)}/ea`}
                    </span>
                    <span className="flex flex-none items-center gap-3">
                      {p?.cents != null && priceCents !== p.cents && (
                        <button
                          type="button"
                          className="underline"
                          style={{ color: 'var(--blue)' }}
                          onClick={() =>
                            setLines(
                              lines.map((x, idx) =>
                                idx === i
                                  ? { ...x, unit_charge: centsToInput(p.cents!), auto: true, basis: pricing.rule }
                                  : x,
                              ),
                            )
                          }
                        >
                          Use {formatCents(p.cents)}
                        </button>
                      )}
                      {l.part_number.trim() && (
                        <a
                          href={walkInSearchUrl(l.part_number)}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                          style={{ color: 'var(--blue)' }}
                        >
                          Check walk-in ↗
                        </a>
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>
          )
        })}
        <button
          type="button"
          className="btn btn-sm w-full"
          onClick={() => setLines([...lines, blankLine()])}
        >
          + Add line
        </button>
        <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: 'var(--bg2)' }}>
          <span className="text-sm" style={{ color: 'var(--text2)' }}>
            Parts {formatCents(totals.lines_cents)} · Labor {formatCents(totals.labor_cents)}
            {totals.tax_cents > 0 && <> · Tax {formatCents(totals.tax_cents)}</>}
          </span>
          <span className="money font-bold">{formatCents(totals.total_cents)}</span>
        </div>
        {showCost && margin.costedLines > 0 && (
          <p className="text-xs" style={{ color: margin.afterTaxCents < 0 ? 'var(--status-stop-fg)' : 'var(--text3)' }}>
            Parts margin {formatCents(margin.cents)}
            {taxRateBp > 0 && <> · about {formatCents(margin.afterTaxCents)} after O’Reilly’s counter tax</>}
            {margin.uncosted > 0 && <> · cost unknown on {margin.uncosted} line{margin.uncosted === 1 ? '' : 's'}</>}
          </p>
        )}
      </div>

      <div className="card">
        <label className="label">Private notes (never shown to customer)</label>
        <textarea className="textarea !min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p style={{ color: 'var(--red)' }}>{error}</p>}
      <div className="flex gap-2 pb-4">
        <button className="btn btn-primary flex-1" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create quote'}
        </button>
        <button className="btn" onClick={() => router.back()}>Cancel</button>
      </div>
    </div>
  )
}
