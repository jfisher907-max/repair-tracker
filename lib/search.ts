import type { IconName } from '@/components/icons'
import { supabase } from './supabase'
import { vehicleLabel, type Vehicle } from './types'

/**
 * Search everything (owner, 2026-11-16: "I find myself having to make several
 * selections in menus to get to the information I want").
 *
 * One field over the five kinds of record the shop keeps, plus every page of
 * the app by name. This file is the part with no pixels in it: what is read,
 * what a typed word is matched against, and which records were opened lately.
 *
 * The shop is small (tens of each kind), so the whole index is read when the
 * search opens and matched in the browser: no query per keystroke, and a plate
 * typed without its space still finds the car.
 */

export type RecordKind = 'job' | 'customer' | 'vehicle' | 'quote' | 'invoice'

export interface SearchRecord {
  kind: RecordKind
  id: string
  href: string
  /** The record's own number, shown in the id face: J016, Q013, INV-0031. */
  number?: string
  title: string
  sub: string
  /** A status word for the right-hand chip (lib/billing statusChipClass colours it). */
  status?: string
  /** What the chip says, when that is not the status word itself. */
  statusLabel?: string
  /** An aircraft rather than a car: it takes the aircraft icon. */
  aircraft?: boolean
  /** Everything a typed word may match, lower case. */
  hay: string
  /**
   * The id-like fields again (numbers, plate, VIN, tail, serial) with only
   * their letters and digits, one per word: "jxk482" finds "JXK 482" and
   * "n512kt" finds "N-512KT". A space between them so a match never spans two.
   */
  tight: string
}

/** One kind's records; null when its read failed. A failure is never an empty list. */
export type Loaded = SearchRecord[] | null
export type SearchIndex = Record<RecordKind, Loaded>

export const KIND_ORDER: RecordKind[] = ['job', 'customer', 'vehicle', 'quote', 'invoice']

export const KIND_WORDS: Record<RecordKind, { heading: string; plural: string }> = {
  job: { heading: 'Jobs', plural: 'jobs' },
  customer: { heading: 'People', plural: 'customers' },
  vehicle: { heading: 'Vehicles and aircraft', plural: 'vehicles' },
  quote: { heading: 'Quotes', plural: 'quotes' },
  invoice: { heading: 'Invoices', plural: 'invoices' },
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const words = (parts: (string | number | null | undefined)[]) =>
  parts
    .filter((p) => p != null && p !== '')
    .join(' ')
    .toLowerCase()
const tightWords = (parts: (string | null | undefined)[]) =>
  parts
    .map((p) => (p ? squash(p) : ''))
    .filter(Boolean)
    .join(' ')

type VehicleBits = Pick<Vehicle, 'year' | 'make' | 'model'> &
  Partial<Pick<Vehicle, 'id' | 'trim' | 'vin' | 'license_plate' | 'service_line' | 'registration' | 'serial_number'>>

/** PostgREST hands an embedded to-one row back as an object; be safe about an array. */
function one<T>(x: T | T[] | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null
  return x ?? null
}

const vehicleWords = (v: VehicleBits | null) =>
  v ? [vehicleLabel(v), v.license_plate, v.vin, v.registration, v.serial_number] : []
const vehicleTight = (v: VehicleBits | null) =>
  v ? [v.license_plate, v.vin, v.registration, v.serial_number] : []

/** A job that is not done wears its stage, in the jobs list's own colours and words (JobRow). */
const STAGE_CHIP: Record<string, { status: string; label: string }> = {
  scheduled: { status: 'booked', label: 'scheduled' },
  in_progress: { status: 'open', label: 'in progress' },
}

async function loadJobs(): Promise<SearchRecord[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, job_number, title, date, stage, payment_status, vehicle:vehicles(id, year, make, model, trim, vin, license_plate, service_line, registration, serial_number, customer:customers(id, name))',
    )
    .is('deleted_at', null)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  type Row = {
    id: string
    job_number: string
    title: string
    stage: string
    payment_status: string
    vehicle: (VehicleBits & { customer: { name: string } | { name: string }[] | null }) | null
  }
  return ((data ?? []) as unknown as Row[]).map((j) => {
    const v = one(j.vehicle)
    const who = one(v?.customer)?.name ?? ''
    return {
      kind: 'job',
      id: j.id,
      href: `/jobs/${j.id}`,
      number: j.job_number,
      title: j.title || 'Untitled job',
      sub: [who || 'Unknown customer', vehicleLabel(v)].join(' · '),
      // Work not finished says so; finished work says whether it is paid.
      status: STAGE_CHIP[j.stage]?.status ?? j.payment_status,
      statusLabel: STAGE_CHIP[j.stage]?.label,
      hay: words([j.job_number, j.title, who, ...vehicleWords(v)]),
      tight: tightWords([j.job_number, ...vehicleTight(v)]),
    }
  })
}

async function loadCustomers(): Promise<SearchRecord[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, phone, email')
    .is('deleted_at', null)
    .order('name')
  if (error) throw error
  type Row = { id: string; name: string; phone: string | null; email: string | null }
  return ((data ?? []) as Row[]).map((c) => ({
    kind: 'customer',
    id: c.id,
    href: `/customers/${c.id}`,
    title: c.name || 'No name',
    sub: [c.phone, c.email].filter(Boolean).join(' · '),
    hay: words([c.name, c.phone, c.email]),
    // A phone number typed without its dashes.
    tight: tightWords([c.phone]),
  }))
}

async function loadVehicles(): Promise<SearchRecord[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select(
      'id, customer_id, year, make, model, trim, vin, license_plate, service_line, registration, serial_number, customer:customers(id, name)',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  type Row = VehicleBits & { id: string; customer_id: string; customer: { name: string } | { name: string }[] | null }
  return ((data ?? []) as unknown as Row[]).map((v) => {
    const who = one(v.customer)?.name ?? ''
    const aircraft = v.service_line === 'aviation'
    // The tail is already in an aircraft's label; a car's plate is not.
    const mark = aircraft ? v.serial_number && `S/N ${v.serial_number}` : v.license_plate
    return {
      kind: 'vehicle',
      id: v.id,
      href: `/vehicles/${v.id}`,
      title: vehicleLabel(v),
      sub: [who || 'Unknown customer', mark].filter(Boolean).join(' · '),
      aircraft,
      hay: words([who, ...vehicleWords(v)]),
      tight: tightWords(vehicleTight(v)),
    }
  })
}

async function loadQuotes(): Promise<SearchRecord[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select(
      'id, quote_number, title, status, created_at, customer:customers(id, name), vehicle:vehicles(id, year, make, model, trim, vin, license_plate, service_line, registration, serial_number)',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  type Row = {
    id: string
    quote_number: string
    title: string
    status: string
    customer: { name: string } | { name: string }[] | null
    vehicle: VehicleBits | VehicleBits[] | null
  }
  return ((data ?? []) as unknown as Row[]).map((x) => {
    const who = one(x.customer)?.name ?? ''
    const v = one(x.vehicle)
    return {
      kind: 'quote',
      id: x.id,
      href: `/quotes/${x.id}`,
      number: x.quote_number,
      title: x.title || 'Untitled quote',
      sub: [who || 'Unknown customer', v ? vehicleLabel(v) : null].filter(Boolean).join(' · '),
      status: x.status,
      hay: words([x.quote_number, x.title, who, ...vehicleWords(v)]),
      tight: tightWords([x.quote_number, ...vehicleTight(v)]),
    }
  })
}

async function loadInvoices(): Promise<SearchRecord[]> {
  // An invoice is a frozen paper: it is searched by what is printed on it.
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, customer_name, vehicle_label, job_title, status, issue_date')
    .order('issue_date', { ascending: false })
    .order('invoice_number', { ascending: false })
  if (error) throw error
  type Row = {
    id: string
    invoice_number: string
    customer_name: string
    vehicle_label: string
    job_title: string
    status: string
  }
  return ((data ?? []) as Row[]).map((i) => ({
    kind: 'invoice',
    id: i.id,
    href: `/invoices/${i.id}`,
    number: i.invoice_number,
    title: i.customer_name || 'Unknown customer',
    sub: [i.job_title, i.vehicle_label].filter(Boolean).join(' · '),
    status: i.status,
    hay: words([i.invoice_number, i.customer_name, i.vehicle_label, i.job_title]),
    tight: tightWords([i.invoice_number]),
  }))
}

const LOADERS: Record<RecordKind, () => Promise<SearchRecord[]>> = {
  job: loadJobs,
  customer: loadCustomers,
  vehicle: loadVehicles,
  quote: loadQuotes,
  invoice: loadInvoices,
}

/**
 * Reads all five kinds side by side. One that fails comes back null and the
 * other four still search: the screen names what it could not read instead of
 * saying nothing matched.
 */
export async function loadSearchIndex(): Promise<SearchIndex> {
  const lists = await Promise.all(
    KIND_ORDER.map((k) =>
      LOADERS[k]().then(
        (rows): Loaded => rows,
        (): Loaded => null,
      ),
    ),
  )
  return Object.fromEntries(KIND_ORDER.map((k, i) => [k, lists[i]])) as SearchIndex
}

/** The typed text as the words it is matched by. */
export function queryTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

function tokenHits(hay: string, tight: string, token: string): boolean {
  if (hay.includes(token)) return true
  const t = squash(token)
  // One squashed character would match half the shop.
  return t.length >= 2 && tight.includes(t)
}

/**
 * The records every typed word is found in, best first: the record whose own
 * number was typed, then one whose title starts with the first word, then the
 * rest in the order they were read (newest first).
 */
export function matchRecords(records: SearchRecord[], query: string): SearchRecord[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return []
  const whole = squash(query)
  const first = tokens[0]
  const rank = (r: SearchRecord) => {
    if (r.number && whole.length >= 2 && squash(r.number).endsWith(whole)) return 0
    if (r.title.toLowerCase().startsWith(first)) return 1
    return 2
  }
  return records
    .filter((r) => tokens.every((t) => tokenHits(r.hay, r.tight, t)))
    .map((r, i) => ({ r, i, k: rank(r) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.r)
}

/* ------------------------------------------------------------------ */
/* Places: every page of the app, by name                              */
/* ------------------------------------------------------------------ */

export interface Place {
  href: string
  label: string
  icon: IconName
  /** Other words a person might type for it. */
  words: string
  /**
   * Shown before anything is typed. These are the pages the phone's bottom
   * bar does not reach; the four that have a tab only come up when typed.
   */
  pinned: boolean
}

export const PLACES: Place[] = [
  { href: '/requests', label: 'Requests', icon: 'requests', words: 'request inbox form aog asked wrote in', pinned: true },
  { href: '/share', label: 'Share form', icon: 'share', words: 'share qr code link request form', pinned: true },
  { href: '/followups', label: 'Follow-ups', icon: 'followups', words: 'followups follow ups recommendations cores reminders due for service', pinned: true },
  { href: '/jobs?tab=quotes', label: 'Quotes', icon: 'quote', words: 'quotes estimates', pinned: true },
  { href: '/expenses', label: 'Expenses', icon: 'expenses', words: 'expense overhead spending receipts', pinned: true },
  { href: '/reports', label: 'Reports', icon: 'reports', words: 'report profit loss cash receivables', pinned: true },
  { href: '/taxes', label: 'Taxes', icon: 'taxes', words: 'tax sales tax return', pinned: true },
  { href: '/hangar', label: 'Hangar', icon: 'hangar', words: 'hangar board aircraft jets', pinned: true },
  { href: '/hangar/history', label: 'Hangar history', icon: 'recent', words: 'hangar history sessions', pinned: true },
  { href: '/hangar/reports', label: 'Hangar reports', icon: 'reports', words: 'hangar reports billing', pinned: true },
  { href: '/settings', label: 'Settings', icon: 'settings', words: 'settings rates alerts documents restore deleted', pinned: true },
  { href: '/dashboard', label: 'Home', icon: 'home', words: 'home dashboard today', pinned: false },
  { href: '/dashboard?view=money', label: 'Money', icon: 'reports', words: 'money figures profit collected billed tiles', pinned: false },
  { href: '/jobs', label: 'Jobs', icon: 'jobs', words: 'jobs work', pinned: false },
  { href: '/customers', label: 'People', icon: 'people', words: 'people customers', pinned: false },
  { href: '/billing', label: 'Billing', icon: 'billing', words: 'billing invoices unpaid owed', pinned: false },
]

/** Something to start. `#new` opens that page's own add form. */
export const STARTS: Place[] = [
  { href: '/jobs/new', label: 'Job', icon: 'jobs', words: 'new job add job start', pinned: true },
  { href: '/quotes/new', label: 'Quote', icon: 'quote', words: 'new quote add quote estimate', pinned: true },
  { href: '/expenses#new', label: 'Expense', icon: 'expenses', words: 'new expense add expense', pinned: true },
  { href: '/customers#new', label: 'Customer', icon: 'person', words: 'new customer add customer person', pinned: true },
]

/**
 * Places named by what was typed: every typed word has to START a word of the
 * place's name or its other words ("exp" is Expenses, "qr" is Share form). The
 * start of a word, not anywhere in it, and never on one letter: a page list
 * that answers to "a" is seventeen rows above the records he was typing for.
 * One whose own name starts with what was typed goes first: "billing" is the
 * Billing page before it is Hangar reports.
 */
export function matchPlaces(places: Place[], query: string): Place[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0 || tokens.some((t) => t.length < 2)) return []
  const named = (p: Place) => (p.label.toLowerCase().startsWith(tokens[0]) ? 0 : 1)
  // "follow-ups" is typed with its dash, without it, or as two words.
  const starts = (word: string, t: string) => word.startsWith(t) || (squash(t) !== '' && squash(word).startsWith(squash(t)))
  return places
    .filter((p) => {
      const names = `${p.label} ${p.words}`.toLowerCase().split(/\s+/)
      return tokens.every((t) => names.some((w) => starts(w, t)))
    })
    .map((p, i) => ({ p, i, k: named(p) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.p)
}

/* ------------------------------------------------------------------ */
/* Recent: the records opened lately, on this device                   */
/* ------------------------------------------------------------------ */

export interface Visit {
  k: RecordKind
  id: string
}

const RECENT_KEY = 'wnt-recent-v1'
const RECENT_KEPT = 8

/**
 * The record a route is showing, if it is one. A job's edit and scan pages
 * count as the job.
 */
export function visitFor(pathname: string): Visit | null {
  const seg = pathname.split('/').filter(Boolean)
  const id = seg[1]
  if (!id || id === 'new') return null
  switch (seg[0]) {
    case 'jobs':
      return { k: 'job', id }
    case 'quotes':
      return { k: 'quote', id }
    case 'invoices':
      return { k: 'invoice', id }
    case 'customers':
      return { k: 'customer', id }
    case 'vehicles':
      return { k: 'vehicle', id }
    default:
      return null
  }
}

/**
 * Only a kind and an id are kept: no name, no plate, nothing a person could
 * read off the phone's storage. The words come from the index when the search
 * opens, so a renamed job is never shown under its old name and a deleted one
 * simply drops out.
 */
export function readVisits(): Visit[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (v): v is Visit =>
        !!v && typeof v.id === 'string' && (KIND_ORDER as string[]).includes(v.k),
    )
  } catch {
    return []
  }
}

export function noteVisit(v: Visit): void {
  try {
    const rest = readVisits().filter((x) => !(x.k === v.k && x.id === v.id))
    localStorage.setItem(RECENT_KEY, JSON.stringify([v, ...rest].slice(0, RECENT_KEPT)))
  } catch {
    // A device that refuses storage has no Recent list; search still works.
  }
}

/** The visits that still exist, as their records, newest first. */
export function recentRecords(index: SearchIndex, visits: Visit[]): SearchRecord[] {
  const out: SearchRecord[] = []
  for (const v of visits) {
    const hit = index[v.k]?.find((r) => r.id === v.id)
    if (hit) out.push(hit)
  }
  return out
}
