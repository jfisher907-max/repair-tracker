import { supabase } from './supabase'
import { refreshDraftInvoice } from './invoice-refresh'
import type { Customer, Job, PartLine, Vehicle } from './types'

/**
 * A core charge is a refundable deposit on the old unit — the shop's money
 * until the dirty part goes back AND the supplier accepts it.
 *
 * THE OWNER'S RULE (2026-09-11): "The core charge should be shown as 0 unless
 * the core gets denied." A core is a wash. It reaches the customer in exactly
 * one case — the store REFUSES the old unit — and then at face value, never
 * marked up.
 *
 * The first version of this file kept the lifecycle and the money as two
 * separate systems, and every writer touched only half: a core could be sitting
 * on the customer's invoice while this worklist called it "out", and settling
 * it refunded the shop without ever taking the charge off the bill. So the
 * money is DERIVED from the outcome here, in one writer, and nothing else
 * writes a core's cost or charge:
 *
 *   out / awaiting_credit : cost = deposit, off the bill   (money really is out)
 *   credited              : cost = 0,       off the bill   (it came back)
 *   denied + absorbed     : cost = deposit, off the bill   (the shop ate it)
 *   denied + billed       : cost = deposit, ON the bill at cost
 *
 * `core_deposit_cents` (0040) remembers the deposit so the cost can go to zero
 * and still come back on Undo.
 *
 * Detection is by description, the same rule the markup pass-through uses:
 * only a "core charge/deposit" phrase counts, so a Heater Core is never
 * mistaken for a deposit, and a "core return" line is money coming back.
 */
const CORE_DEPOSIT = new RegExp('\\bcore\\s*(charge|chg|deposit)\\b', 'i')
const CORE_CREDIT = new RegExp('\\b(return|refund|credit)\\b', 'i')

/** Supplier core windows typically run 30 days from the purchase. */
export const RETURN_WINDOW_DAYS = 30
/** Say something with this long left, not on the day the window shuts. */
export const RETURN_WARN_DAYS = 7
/**
 * Handed back and still unconfirmed this long: chase it — it was probably
 * refused. Short on purpose: the owner's credits "show up pretty quickly"
 * (2026-09-11), so a core still unverified after a few days is the signal,
 * not the norm. Long enough to ride out a weekend.
 */
export const CREDIT_CHASE_DAYS = 5

/**
 * Identify a core by what it IS, never by its live cost.
 *
 * A credited core's unit_cost_cents is 0 by design, and keying identity off the
 * cost meant the writer deleted the row from its own worklist the moment it was
 * credited: undo unreachable, the credited tally stuck at zero, the row simply
 * gone. The deposit amount and the lifecycle stamps are what make it a core.
 */
export function isCoreDeposit(
  line: Pick<PartLine, 'description' | 'unit_cost_cents'> &
    Partial<Pick<PartLine, 'core_deposit_cents' | 'core_returned_at' | 'core_credited_at' | 'core_denied_at'>>,
): boolean {
  if (!CORE_DEPOSIT.test(line.description) || CORE_CREDIT.test(line.description)) return false
  if ((line.core_deposit_cents ?? 0) > 0) return true
  if (line.core_returned_at || line.core_credited_at || line.core_denied_at) return true
  return line.unit_cost_cents > 0
}

/**
 * Does this wording name a core deposit? For a form draft, which has no row and
 * may have no cost typed yet — deciding from the cost box made a core stop being
 * a core while the box was empty, and it then inserted ON the customer's bill.
 */
export function isCoreDescription(description: string): boolean {
  return CORE_DEPOSIT.test(description) && !CORE_CREDIT.test(description)
}

/** A "Core Charge Return" line: the store's credit, already on the job. */
export function isCoreCredit(line: Pick<PartLine, 'description' | 'unit_cost_cents'>): boolean {
  return line.unit_cost_cents < 0 && CORE_DEPOSIT.test(line.description)
}

export type CoreState = 'out' | 'awaiting_credit' | 'credited' | 'denied'

/** Every outcome the worklist can put a core into. */
export type CoreOutcome = 'out' | 'awaiting_credit' | 'credited' | 'denied_billed' | 'denied_absorbed'

type CoreStamps = Pick<PartLine, 'core_returned_at' | 'core_credited_at' | 'core_denied_at'>
type CoreMoney = Pick<PartLine, 'unit_cost_cents' | 'unit_charge_cents' | 'on_invoice' | 'core_deposit_cents'>

/**
 * Read in priority order. A core handed back and THEN refused carries both
 * stamps — that is the ordinary way a core is denied — and denied is the state
 * that matters.
 */
export function coreState(line: CoreStamps): CoreState {
  if (line.core_denied_at) return 'denied'
  if (line.core_credited_at) return 'credited'
  if (line.core_returned_at) return 'awaiting_credit'
  return 'out'
}

/** What the deposit WAS per unit, whatever the live cost now says. */
export function coreDepositCents(line: Pick<PartLine, 'unit_cost_cents' | 'core_deposit_cents'>): number {
  return line.core_deposit_cents ?? line.unit_cost_cents
}

/**
 * The whole line's deposit — what is actually out, and what a denied core would
 * put on the bill. Everything the owner READS is this figure; only the
 * unit_cost / unit_charge columns take the per-unit one. A consolidated ticket
 * row ("CORE CHARGE 2 @ 30.00") is $60 of the shop's money, and quoting $30 in
 * the "bill it?" dialog asked him to approve half of what it would charge.
 */
export function coreDepositTotalCents(
  line: Pick<PartLine, 'unit_cost_cents' | 'core_deposit_cents' | 'qty'>,
): number {
  return Math.round((Number(line.qty) || 1) * coreDepositCents(line))
}

/**
 * Is this core on the customer's bill right now? A null charge is NOT zero:
 * the generated column bills `qty * coalesce(unit_charge_cents, unit_cost_cents)`,
 * so a core added by hand with a blank price lands on the invoice at cost.
 */
export function isBilledToCustomer(line: CoreMoney): boolean {
  return line.on_invoice !== false && (line.unit_charge_cents ?? line.unit_cost_cents) > 0
}

/**
 * A core that is charged to the customer without having been denied breaks the
 * owner's rule, however it got there. The worklist has to show it as something
 * to fix rather than counting it as money the shop is owed.
 *
 * `creditOnJob` is the exception that keeps history quiet: J002 bills two $45
 * cores AND carries a hand-entered -$90 "Core Charge Return" that already nets
 * them out, inside a PAID invoice. Flagging those forever would nag about
 * money that balanced a month ago, with no button that can legally act on it.
 */
export function isWronglyBilled(
  line: CoreStamps & CoreMoney & { creditOnJob?: boolean },
): boolean {
  if (line.creditOnJob) return false
  return !line.core_denied_at && isBilledToCustomer(line)
}

function daysSince(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 0
  return Math.max(0, Math.floor((nowMs - then) / 86_400_000))
}

export interface CoreWatch {
  state: CoreState
  /** What has to happen next, in the shop's words. */
  next: string
  /** Days spent waiting on that step. */
  days: number
  /** Past the point where this should be chased. */
  overdue: boolean
  /** On the customer's bill when it shouldn't be — fix this first. */
  wronglyBilled: boolean
}

/**
 * The reminder itself: what this core is waiting on, and for how long. A core
 * sitting near the end of the supplier's window, or handed back with no credit
 * confirmed, is money about to be lost quietly.
 */
export function watchCore(
  line: Pick<PartLine, 'purchase_date' | 'created_at'> & CoreStamps & CoreMoney & { creditOnJob?: boolean },
  nowMs: number = Date.now(),
): CoreWatch {
  const state = coreState(line)
  const wronglyBilled = isWronglyBilled(line)
  if (state === 'out') {
    // The supplier's clock runs from the PURCHASE, not from when the receipt
    // was typed in — that can be weeks later.
    const from = line.purchase_date ? `${line.purchase_date}T12:00:00` : line.created_at
    const days = daysSince(from, nowMs)
    const left = RETURN_WINDOW_DAYS - days
    return {
      state,
      next:
        left <= 0
          ? 'Take the old unit back — the return window has closed'
          : left <= RETURN_WARN_DAYS
            ? `Take the old unit back — about ${left} day${left === 1 ? '' : 's'} left`
            : 'Take the old unit back',
      days,
      // Warn with time left to act, not on the day it is already too late.
      overdue: left <= RETURN_WARN_DAYS,
      wronglyBilled,
    }
  }
  if (state === 'awaiting_credit') {
    const days = daysSince(line.core_returned_at, nowMs)
    return {
      state,
      next: 'Check the credit landed',
      days,
      overdue: days >= CREDIT_CHASE_DAYS,
      wronglyBilled,
    }
  }
  if (state === 'denied') {
    return {
      state,
      next: 'Denied',
      days: daysSince(line.core_denied_at, nowMs),
      overdue: false,
      wronglyBilled: false,
    }
  }
  // Credited: nothing to do, but the clock still has to run — reporting 0 days
  // kept every core ever credited inside the worklist's 14-day undo window.
  return {
    state,
    next: '',
    days: daysSince(line.core_credited_at, nowMs),
    overdue: false,
    wronglyBilled,
  }
}

export interface CoreOut extends PartLine {
  job: (Job & { vehicle: (Vehicle & { customer: Customer | null }) | null }) | null
  /** The job already carries a "core return" credit line that nets deposits out. */
  creditOnJob: boolean
}

/** Every core deposit on a live job, oldest first — all four states. */
export async function listCores(): Promise<CoreOut[]> {
  const { data, error } = await supabase
    .from('part_lines')
    .select('*, job:jobs!inner(*, vehicle:vehicles(*, customer:customers(*)))')
    .ilike('description', '%core%')
    .is('job.deleted_at', null)
    .order('created_at')
  if (error) throw error
  const rows = (data as CoreOut[]) ?? []
  // The store's own credit slips, entered as their own lines. A job that has
  // one is already square, so its deposits are history, not a violation.
  const jobsWithCredit = new Set(rows.filter(isCoreCredit).map((r) => r.job_id))
  return rows
    .filter(isCoreDeposit)
    .map((r) => ({ ...r, creditOnJob: jobsWithCredit.has(r.job_id) }))
}

export interface CoreTally {
  count: number
  cents: number
}

export interface CoreLedger {
  out: CoreTally
  awaitingCredit: CoreTally
  credited: CoreTally
  /** Denied and charged to the job — recovered from the customer. */
  deniedBilled: CoreTally
  /** Denied and absorbed — what cores have actually cost the shop. */
  deniedAbsorbed: CoreTally
  /** On the customer's bill without a denial: the rule is being broken. */
  wronglyBilled: CoreTally
}

/** The running score: what's out, what's unverified, and what cores have cost. */
export function summarizeCores(
  lines: (CoreStamps & CoreMoney & Pick<PartLine, 'qty'> & { creditOnJob?: boolean })[],
): CoreLedger {
  const empty = (): CoreTally => ({ count: 0, cents: 0 })
  const led: CoreLedger = {
    out: empty(),
    awaitingCredit: empty(),
    credited: empty(),
    deniedBilled: empty(),
    deniedAbsorbed: empty(),
    wronglyBilled: empty(),
  }
  for (const l of lines) {
    const deposit = coreDepositTotalCents(l)
    // A core the customer is being charged for is never "money the shop is
    // owed" — it is a mistake, and it gets its own bucket so the header can't
    // quietly count it as outstanding.
    if (isWronglyBilled(l)) {
      led.wronglyBilled.count += 1
      led.wronglyBilled.cents += deposit
      continue
    }
    const state = coreState(l)
    const bucket =
      state === 'out'
        ? led.out
        : state === 'awaiting_credit'
          ? led.awaitingCredit
          : state === 'credited'
            ? led.credited
            : l.on_invoice === false
              ? led.deniedAbsorbed
              : led.deniedBilled
    bucket.count += 1
    bucket.cents += deposit
  }
  return led
}

type CoreLine = Pick<PartLine, 'id' | 'job_id' | 'qty'> & CoreStamps & CoreMoney

/**
 * The stamps and the money that define each outcome — one source of truth,
 * exported so the money model itself can be tested without a database.
 */
export function coreOutcomeFields(outcome: CoreOutcome, line: CoreLine, nowIso: string) {
  const deposit = coreDepositCents(line)
  const base = { core_deposit_cents: deposit }
  switch (outcome) {
    case 'out':
      return {
        ...base,
        core_returned_at: null,
        core_credited_at: null,
        core_denied_at: null,
        unit_cost_cents: deposit,
        on_invoice: false,
        unit_charge_cents: 0,
      }
    case 'awaiting_credit':
      return {
        ...base,
        core_returned_at: line.core_returned_at ?? nowIso,
        core_credited_at: null,
        core_denied_at: null,
        unit_cost_cents: deposit,
        on_invoice: false,
        unit_charge_cents: 0,
      }
    case 'credited':
      return {
        ...base,
        // Confirming one that was never marked handed-back stamps both; one
        // already handed back keeps the day it went over the counter.
        core_returned_at: line.core_returned_at ?? nowIso,
        core_credited_at: nowIso,
        core_denied_at: null,
        // The deposit came back, so it stops being a cost on the job.
        unit_cost_cents: 0,
        on_invoice: false,
        unit_charge_cents: 0,
      }
    case 'denied_absorbed':
      return {
        ...base,
        core_denied_at: nowIso,
        core_credited_at: null,
        unit_cost_cents: deposit,
        on_invoice: false,
        unit_charge_cents: 0,
      }
    case 'denied_billed':
      return {
        ...base,
        core_denied_at: nowIso,
        core_credited_at: null,
        unit_cost_cents: deposit,
        on_invoice: true,
        // Pass-through: billed, a core goes on at exactly what it cost.
        unit_charge_cents: deposit,
      }
  }
}

export interface CoreWriteResult {
  /** Billing it pushed the job past what the customer approved. */
  overApproval: boolean
  /** The approval check itself could not be read — not the same as "it's fine". */
  approvalUnknown: boolean
  /** A draft invoice was brought back in step; its number. */
  draftInvoice: string | null
  /** The draft could NOT be refreshed, and why — the owner has to act. */
  draftBlocked: string | null
  /** The store's credit slip already covers this deposit, so the cost was left alone. */
  creditAlreadyBooked: boolean
}

/**
 * The ONLY writer of a core's state and money.
 *
 * The guard is keyed on what the CUSTOMER is billed, not on the raw cost
 * columns. Those are different questions: crediting a core changes the shop's
 * cost and nothing the customer sees, so it must not be refused just because
 * the job carries an invoice — while a stamp change on a frozen job rewrites
 * what that invoice's money MEANS (a real supplier credit becoming a recorded
 * denial), so that is not a free "stamps only" write either.
 */
export async function setCoreOutcome(
  line: CoreLine,
  outcome: CoreOutcome,
): Promise<CoreWriteResult> {
  const nowIso = new Date().toISOString()
  const patch = coreOutcomeFields(outcome, line, nowIso)
  const qty = Number(line.qty) || 1

  const billedNow =
    line.on_invoice === false ? 0 : Math.round(qty * (line.unit_charge_cents ?? line.unit_cost_cents))
  const billedNext =
    patch.on_invoice === false ? 0 : Math.round(qty * (patch.unit_charge_cents ?? patch.unit_cost_cents))
  const changesBill = billedNow !== billedNext
  // A stamp change matters to a FROZEN invoice only when this core is, or is
  // about to be, money on that customer's bill — the case where calling a real
  // credit a "denial" rewrites what the invoice means. An off-bill core carries
  // nothing of the customer's, and gating it made the ordinary order of business
  // impossible: invoice the job, take payment, THEN hand the core back and
  // record the credit. Nearly every job here is invoiced and paid.
  const changesStamps =
    ((patch.core_denied_at ?? null) !== (line.core_denied_at ?? null) ||
      (patch.core_credited_at ?? null) !== (line.core_credited_at ?? null)) &&
    (billedNow > 0 || billedNext > 0)

  if (changesBill || changesStamps) {
    const { data: invoices, error: invErr } = await supabase
      .from('invoices')
      .select('status, invoice_number')
      .eq('job_id', line.job_id)
      .neq('status', 'void')
    if (invErr) throw invErr
    const frozen = ((invoices ?? []) as { status: string; invoice_number: string }[]).find(
      (i) => i.status === 'sent' || i.status === 'paid',
    )
    if (frozen) {
      throw new Error(
        `${frozen.invoice_number} is already sent or paid, so this job is closed to changes. Void and reissue it if the core has to move.`,
      )
    }
  }

  // A job whose parts total is set by hand pins what the customer pays, so
  // putting a core on the bill changes the line and NOTHING the customer sees —
  // while the screen would report the deposit as recovered from them.
  if (outcome === 'denied_billed') {
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('parts_charged_override_cents')
      .eq('id', line.job_id)
      .single()
    if (jobErr) throw jobErr
    const override = (job as { parts_charged_override_cents: number | null } | null)
      ?.parts_charged_override_cents
    if (override != null) {
      throw new Error(
        "This job's parts total is set by hand in the Money card, so billing the core would not change what the customer pays. Clear that override (or raise it by the core) first.",
      )
    }
  }

  // If the store's credit slip is already a line on this job and it covers
  // this deposit, zeroing the cost as well would credit the same refund twice.
  let creditAlreadyBooked = false
  if (outcome === 'credited') {
    const { data: siblings, error: sibErr } = await supabase
      .from('part_lines')
      .select('id, description, qty, unit_cost_cents, core_deposit_cents, core_credited_at')
      .eq('job_id', line.job_id)
    if (sibErr) throw sibErr
    type Sibling = Pick<
      PartLine,
      'id' | 'description' | 'qty' | 'unit_cost_cents' | 'core_deposit_cents' | 'core_credited_at'
    >
    const rows = (siblings ?? []) as Sibling[]
    const creditTotal = rows
      .filter(isCoreCredit)
      .reduce((s, r) => s + Math.abs(Math.round((Number(r.qty) || 1) * r.unit_cost_cents)), 0)
    // A credit slip is consumed by the deposits still sitting AT COST — they are
    // the ones it is paying for. A deposit already zeroed is not leaning on it.
    // Counted the other way round, one slip excused every core on the job.
    const leaningOnCredit = rows
      .filter((r) => r.id !== line.id && isCoreDeposit(r) && r.core_credited_at && r.unit_cost_cents !== 0)
      .reduce((s, r) => s + coreDepositTotalCents(r), 0)
    creditAlreadyBooked = creditTotal >= leaningOnCredit + coreDepositTotalCents(line)
    if (creditAlreadyBooked) patch.unit_cost_cents = line.unit_cost_cents
  }

  const { error } = await supabase.from('part_lines').update(patch).eq('id', line.id)
  if (error) throw error

  let draftInvoice: string | null = null
  let draftBlocked: string | null = null
  // Only a change to the BILL can leave a draft invoice stale; a cost-only
  // change never reaches the customer-facing snapshot.
  if (changesBill) {
    try {
      const res = await refreshDraftInvoice(line.job_id)
      draftInvoice = res.invoiceNumber
      draftBlocked = res.blocked
    } catch (e) {
      draftBlocked = e instanceof Error ? e.message : String(e)
    }
  }

  // Reported, never thrown: the write has already landed, and claiming it
  // failed would send the owner to undo something that actually succeeded.
  let overApproval = false
  let approvalUnknown = false
  if (outcome === 'denied_billed') {
    const { data: auth, error: authErr } = await supabase
      .from('job_authorized_totals')
      .select('checked, over_cents')
      .eq('job_id', line.job_id)
      .maybeSingle()
    if (authErr) {
      approvalUnknown = true
    } else {
      const a = auth as { checked: boolean; over_cents: number } | null
      overApproval = !!a && a.checked && a.over_cents > 0
    }
  }

  return { overApproval, approvalUnknown, draftInvoice, draftBlocked, creditAlreadyBooked }
}
