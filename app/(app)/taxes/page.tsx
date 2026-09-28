'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SkeletonList } from '@/components/Skeleton'
import { loadFinanceRows, type FinanceRows } from '@/lib/finances'
import {
  CBJ_FILING_URL,
  cbjDueDates,
  computeBothReturns,
  daysBetween,
  dbErrorWords,
  filingStatus,
  isMissingSchema,
  lateCost,
  loadTaxFilings,
  localIso,
  longDate,
  quarterFromKey,
  quarterKey,
  quarterShort,
  quarterToShow,
  quarterWords,
  readiness,
  returnQuarters,
  taxToPlanFor,
  type Quarter,
  type ReadyItem,
  type ReturnInvoice,
  type SalesTaxReturn,
} from '@/lib/sales-tax'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import { formatDate, formatDateShort } from '@/lib/date'
import { supabase } from '@/lib/supabase'
import type { TaxBasis, TaxFiling, TaxObligation, TaxPaymentMethod } from '@/lib/types'

/** Money with a true minus sign, the dashboard's style. */
const money = (c: number) => (c < 0 ? `−${formatCents(-c)}` : formatCents(c))

const BASIS_WORDS: Record<TaxBasis, string> = {
  cash: 'Cash basis',
  accrual: 'Accrual basis',
}
const BASIS_HOW: Record<TaxBasis, string> = {
  cash: 'by the day you were paid',
  accrual: 'by the day the invoice was sent',
}
const OBLIGATION_WORDS: Record<TaxObligation, string> = {
  cbj_sales_tax: 'Juneau sales tax',
  federal_estimate: 'Federal estimated tax',
  cbj_property: 'Juneau business property',
  other: 'Other',
}
const METHOD_WORDS: Record<TaxPaymentMethod, string> = {
  ach: 'Bank transfer (ACH)',
  card: 'Card',
  check: 'Check',
  cash: 'Cash',
  other: 'Other',
}

/** The fields a recorded filing is described by (a saved row, or the one just inserted). */
type FilingFacts = Pick<
  TaxFiling,
  'obligation' | 'period_start' | 'period_end' | 'filed_on' | 'paid_on' | 'amount_cents' | 'method' | 'confirmation' | 'settles_return'
>

/** "filed Nov 1 · paid $242.70 on Nov 1 by bank transfer (ach) · confirmation 123" */
function filingWords(f: FilingFacts): string {
  return [
    f.filed_on ? `filed ${formatDateShort(f.filed_on)}` : 'not filed',
    f.paid_on
      ? `paid ${formatCents(f.amount_cents)} on ${formatDateShort(f.paid_on)}${f.method ? ` by ${METHOD_WORDS[f.method].toLowerCase()}` : ''}${
          f.settles_return ? ' (marked as the full amount)' : ''
        }`
      : 'not paid',
    f.confirmation ? `confirmation ${f.confirmation}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

type LineKey = 'gross' | 'exempt' | 'taxable' | 'tax'
const LINES: { key: LineKey; label: string; cap: string }[] = [
  { key: 'gross', label: 'Gross sales', cap: 'each invoice’s price, before any tax line' },
  { key: 'exempt', label: 'Exempt sales', cap: 'invoices that record the customer’s exemption' },
  { key: 'taxable', label: 'Taxable sales', cap: 'gross less exempt' },
  { key: 'tax', label: 'Sales tax due', cap: '5%: the tax lines, plus what you owe on untaxed invoices' },
]

/** The invoices behind one line of the return, and each one's figure on it. */
function lineInvoices(r: SalesTaxReturn, key: LineKey): { inv: ReturnInvoice; cents: number }[] {
  return r.invoices
    .filter((i) => (key === 'exempt' ? i.exempt : key === 'taxable' ? !i.exempt : key === 'tax' ? i.taxLine + i.included > 0 : true))
    .map((inv) => ({ inv, cents: key === 'tax' ? inv.taxLine + inv.included : inv.sale }))
}

/** Same invoices, same figures: one list covers both bases. */
function sameList(a: { inv: ReturnInvoice; cents: number }[], b: { inv: ReturnInvoice; cents: number }[]): boolean {
  if (a.length !== b.length) return false
  const m = new Map(a.map((x) => [x.inv.invoiceId, x.cents]))
  return b.every((x) => m.get(x.inv.invoiceId) === x.cents)
}

/**
 * Taxes: the Juneau sales-tax return for a quarter, from the books. It shows
 * the four numbers the city's form asks for (each opens to the invoices
 * behind it), the due date in plain words, a readiness checklist, what filing
 * late would cost, the city's filing link, and a record of what was filed and
 * paid (tax_filings, 0053). It never files or pays anything and gives no tax
 * advice; where his situation decides, it says to confirm with his preparer.
 * All the arithmetic is lib/sales-tax.ts.
 */
export default function TaxesPage() {
  // One clock for the page (React 19: never read the time during render).
  const [now] = useState(() => new Date())
  const today = localIso(now)
  const [rows, setRows] = useState<FinanceRows | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filings, setFilings] = useState<TaxFiling[] | null>(null)
  /** missing = migration 0053 not applied (by error code); words = what to tell him. */
  const [filingsError, setFilingsError] = useState<{ missing: boolean; words: string } | null>(null)
  /** The first read answered (either way): until then "not filed" would be a guess. */
  const [filingsLoaded, setFilingsLoaded] = useState(false)
  const [basis, setBasis] = useState<TaxBasis | null>(null)
  /** false until settings answered; the column may not exist before 0053. */
  const [basisReady, setBasisReady] = useState(false)
  const [basisError, setBasisError] = useState<string | null>(null)
  const [changingBasis, setChangingBasis] = useState(false)
  const [hangar, setHangar] = useState<{ entry: string; exit: string | null; hangar: string }[] | null>(null)
  const [hangarFailed, setHangarFailed] = useState(false)
  /** The Airlift Northwest customer id; null = none; undefined = the read failed. */
  const [alnwId, setAlnwId] = useState<string | null | undefined>(undefined)
  const [alnwReady, setAlnwReady] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  /** "Recorded ✓" lives here, outside the keyed form, so a remount never loses it. */
  const [saved, setSaved] = useState<string | null>(null)

  const reloadFilings = useCallback(async () => {
    try {
      setFilings(await loadTaxFilings())
      setFilingsError(null)
    } catch (e) {
      setFilings(null)
      setFilingsError({ missing: isMissingSchema(e), words: dbErrorWords(e, 'read the filings you recorded') })
    }
  }, [])

  useEffect(() => {
    loadFinanceRows()
      .then(setRows)
      .catch((e) => setError(String(e?.message ?? e)))
    loadTaxFilings()
      .then((f) => {
        setFilings(f)
        setFilingsLoaded(true)
      })
      .catch((e) => {
        setFilingsError({ missing: isMissingSchema(e), words: dbErrorWords(e, 'read the filings you recorded') })
        setFilingsLoaded(true)
      })
    supabase
      .from('settings')
      .select('*')
      .single()
      .then(({ data, error: e }) => {
        if (e) setBasisError(dbErrorWords(e, 'read the basis you chose'))
        const b = data?.sales_tax_basis
        setBasis(b === 'cash' || b === 'accrual' ? b : null)
        setBasisReady(true)
      })
    supabase
      .from('hangar_sessions')
      .select('entry, exit, hangar')
      .then(({ data, error: e }) => {
        if (e) setHangarFailed(true)
        else setHangar((data as { entry: string; exit: string | null; hangar: string }[]) ?? [])
      })
    supabase
      .from('customers')
      .select('id, name')
      .ilike('name', '%airlift northwest%')
      .is('deleted_at', null)
      .limit(1)
      .then(({ data, error: e }) => {
        // A failed read stays undefined: the checklist says it could not tell,
        // never "no invoices".
        setAlnwId(e ? undefined : ((data as { id: string }[] | null)?.[0]?.id ?? null))
        setAlnwReady(true)
      })
  }, [])

  const quarters = useMemo(() => (rows ? returnQuarters(rows, today) : []), [rows, today])
  const defaultQ = useMemo(
    () => (rows ? quarterToShow(rows, filings, basis, today) : null),
    [rows, filings, basis, today],
  )
  // Keyed by string so the memo below does not re-run on a new-but-equal object.
  const qtKey = pick ?? (defaultQ ? quarterKey(defaultQ) : null)
  const qt: Quarter | null = useMemo(() => (qtKey ? quarterFromKey(qtKey) : null), [qtKey])
  const both = useMemo(() => (rows && qt ? computeBothReturns(rows, qt) : null), [rows, qt])

  if (error) return <p style={{ color: 'var(--red)' }}>Couldn&apos;t load the books: {error}</p>
  if (!rows || !qt || !both || !basisReady || !filingsLoaded || !alnwReady || (!hangar && !hangarFailed)) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl">Taxes</h1>
        <SkeletonList rows={4} />
      </div>
    )
  }

  const due = cbjDueDates(qt)
  const planTax = taxToPlanFor(both, basis)
  const status = filingStatus(filings, qt, planTax)
  // Wings Hangar sessions overlapping the quarter, by local calendar date. Only
  // Wings Hangar has billing meaning: an ALNW-hangar row is an assignment to
  // their own hangar, not Airlift Northwest occupying Wings (lib/hangar-stats).
  const hangarInQuarter =
    hangarFailed || !hangar
      ? null
      : hangar.filter((h) => {
          if (h.hangar !== 'Wings Hangar') return false
          const inDay = localIso(new Date(h.entry))
          const outDay = h.exit ? localIso(new Date(h.exit)) : null
          return inDay <= qt.end && (outDay === null || outDay >= qt.start)
        }).length
  const items = readiness({
    rows,
    quarter: qt,
    both,
    basis,
    status,
    hangarSessions: hangarInQuarter,
    alnwCustomerId: alnwId,
    today,
  })
  const identical = both.cash.gross === both.accrual.gross && both.cash.exempt === both.accrual.exempt && both.cash.tax === both.accrual.tax
  const shown: TaxBasis[] = basis ? [basis] : ['cash', 'accrual']
  const open = qt.end >= today
  const daysLeft = daysBetween(today, due.official)
  const late = lateCost(planTax)
  const edge = status.done ? 'edge-ok' : open ? 'edge-idle' : daysLeft <= 7 ? 'edge-stop' : daysLeft <= 30 ? 'edge-wait' : 'edge-idle'

  async function chooseBasis(next: TaxBasis | null) {
    setBasisError(null)
    const { error: e } = await supabase.from('settings').update({ sales_tax_basis: next }).eq('id', 1)
    if (e) {
      setBasisError(
        isMissingSchema(e)
          ? 'The basis can’t be saved until the database update (migration 0053) is applied.'
          : dbErrorWords(e, 'save the basis'),
      )
      return
    }
    setBasis(next)
    setChangingBasis(false)
  }

  // The due date, in plain words.
  let dueWords: ReactNode
  if (status.done) {
    dueWords = (
      <>
        Filed {formatDate(status.filedOn)}
        {status.paidOn ? (
          <>
            {' '}
            and paid {money(status.paidCents)} on {formatDate(status.paidOn)}
            {status.settled && status.paidCents < status.taxDue && (
              <>, which you marked as the full amount the city asked for (this page figured {money(status.taxDue)})</>
            )}
          </>
        ) : (
          <> with nothing to pay</>
        )}
        . Nothing more to do for this quarter.
      </>
    )
  } else if (open) {
    dueWords = (
      <>
        This quarter is still open: it closes {longDate(qt.end)}. The return is due <b>{longDate(due.official)}</b>
        {due.moved && <>; because that is a weekend, the city accepts it through {longDate(due.effective)}</>}.
      </>
    )
  } else if (daysLeft > 0) {
    dueWords = (
      <>
        Due <b>{longDate(due.official)}</b>, in {daysLeft} day{daysLeft === 1 ? '' : 's'}
        {due.moved && <>. Because that is a weekend, the city accepts it through {longDate(due.effective)}</>}.
      </>
    )
  } else if (daysLeft === 0) {
    dueWords = (
      <>
        Due <b>today</b>, {longDate(due.official)}
        {due.moved && <>. Because it is a weekend, the city accepts it through {longDate(due.effective)}</>}.
      </>
    )
  } else {
    dueWords = (
      <>
        <b>
          {-daysLeft} day{daysLeft === -1 ? '' : 's'} past the due date
        </b>{' '}
        ({longDate(due.official)})
        {due.moved && today <= due.effective ? (
          <>; the city still accepts it through {longDate(due.effective)}</>
        ) : (
          <>. File as soon as you can; the cost of being late is below</>
        )}
        .
      </>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl">Taxes</h1>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Juneau sales tax: the numbers for your return, when it is due, and a record of what you filed and paid.
        </p>
      </div>

      {filingsError && (
        <p className="card text-sm" style={{ color: 'var(--red)' }}>
          {filingsError.missing
            ? 'The place to record filings isn’t set up in the database yet (migration 0053). The figures below are right; recording a filing will work once it is.'
            : `${filingsError.words} The figures below are right, but this page can’t tell yet whether this quarter was filed.`}
        </p>
      )}

      {/* The return */}
      <section className={`card ${edge} space-y-3`} aria-labelledby="return-heading">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="label !mb-0">City and Borough of Juneau sales tax</span>
            <h2 id="return-heading" className="text-xl font-semibold">
              {quarterShort(qt)} · {quarterWords(qt)}
            </h2>
          </div>
          {quarters.length > 1 && (
            <>
              <label className="sr-only" htmlFor="tax-quarter">
                Quarter
              </label>
              <select
                id="tax-quarter"
                className="select !w-auto"
                value={quarterKey(qt)}
                onChange={(e) => {
                  setPick(e.target.value)
                  setSaved(null)
                }}
              >
                {[...quarters].reverse().map((q) => (
                  <option key={quarterKey(q)} value={quarterKey(q)}>
                    {quarterShort(q)}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <p>{dueWords}</p>
        {!status.done && status.paidCents > 0 && (
          <p className="font-semibold">
            {status.balance > 0 ? (
              <>
                Balance still owed: <span className="money">{money(status.balance)}</span>{' '}
                <span className="text-sm font-normal" style={{ color: 'var(--text2)' }}>
                  ({money(status.taxDue)} tax, less {money(status.paidCents)} recorded paid)
                </span>
              </>
            ) : (
              <>Paid in full ({money(status.paidCents)}); record the day you filed to finish this quarter.</>
            )}
          </p>
        )}
        {status.overpaidCents > 0 && (
          <p className="text-sm" style={{ color: 'var(--red)' }}>
            {money(status.paidCents)} is recorded paid for this quarter, {money(status.overpaidCents)} more than its{' '}
            {money(status.taxDue)} tax. If a payment was recorded twice, remove one under “Filings recorded”.
          </p>
        )}
        {!status.done && (
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            The city counts the day it <i>receives</i> the return, not the postmark, so aim for{' '}
            {formatDate(due.official)}. A city holiday can also move a due date; if one falls near it, check the
            city’s due-date list.
          </p>
        )}

        {/* The four numbers */}
        <div>
          <div
            className="grid items-end gap-x-3 border-b pb-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ gridTemplateColumns: `1fr repeat(${shown.length}, minmax(5.5rem, auto))`, color: 'var(--text3)', borderColor: 'var(--border)' }}
          >
            <span>For the city’s form</span>
            {shown.map((b) => (
              <span key={b} className="text-right">
                {basis ? 'Amount' : b === 'cash' ? 'Cash' : 'Accrual'}
              </span>
            ))}
          </div>
          {LINES.map((line) => {
            const lists = shown.map((b) => lineInvoices(both[b], line.key))
            const one = shown.length === 1 || sameList(lists[0], lists[1])
            return (
              <details key={line.key} className="border-b" style={{ borderColor: 'var(--border)' }}>
                <summary
                  className="grid min-h-[44px] cursor-pointer items-center gap-x-3 py-1.5"
                  style={{ gridTemplateColumns: `1fr repeat(${shown.length}, minmax(5.5rem, auto))` }}
                >
                  <span className="min-w-0">
                    <span className="font-semibold">{line.label}</span>
                    <small className="block text-xs" style={{ color: 'var(--text3)' }}>
                      {line.cap} · tap to see the invoices
                    </small>
                  </span>
                  {shown.map((b) => (
                    <span key={b} className={`money text-right ${line.key === 'tax' ? 'font-bold' : ''}`}>
                      {money(both[b][line.key])}
                    </span>
                  ))}
                </summary>
                <div className="space-y-2 pb-3 pt-1">
                  {one ? (
                    <InvoiceList
                      list={lists[0]}
                      basis={shown[0]}
                      heading={shown.length === 2 ? 'Same on both bases' : null}
                      lineKey={line.key}
                    />
                  ) : (
                    shown.map((b, i) => (
                      <InvoiceList key={b} list={lists[i]} basis={b} heading={BASIS_WORDS[b]} lineKey={line.key} />
                    ))
                  )}
                </div>
              </details>
            )
          })}
          {shown.map((b) => {
            const r = both[b]
            if (r.tax === 0) return null
            return (
              <p key={b} className="mt-2 text-sm" style={{ color: 'var(--text2)' }}>
                {shown.length === 2 && !identical && <b>{BASIS_WORDS[b]}: </b>}
                {money(r.tax)} is {money(r.taxLines)} charged on tax lines
                {r.taxIncluded > 0 && (
                  <>
                    {' '}
                    + {money(r.taxIncluded)} you owe on {r.includedInvoices} invoice{r.includedInvoices === 1 ? '' : 's'}{' '}
                    sent with no tax line (5% of the full price, which the city does not let you back out of it — confirm
                    with your tax preparer)
                  </>
                )}
                .{shown.length === 2 && identical && ' Both bases agree this quarter.'}
              </p>
            )
          })}
        </div>

        {/* Basis */}
        <div className="rounded-md p-3" style={{ background: 'var(--bg3)' }}>
          {basis && !changingBasis ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <b>{BASIS_WORDS[basis]}</b>: sales counted {BASIS_HOW[basis]}.
              </p>
              <button className="btn btn-sm" onClick={() => setChangingBasis(true)}>
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">
                {basis
                  ? 'Change the basis? '
                  : `You haven’t chosen cash or accrual yet, so both are shown${identical ? ' (they agree this quarter)' : ''}. `}
                The city requires the same basis as your federal return: confirm with your tax preparer, then set it
                here once.
              </p>
              <div className="flex flex-wrap gap-2">
                <button className={`btn btn-sm ${basis === 'cash' ? 'btn-primary' : ''}`} onClick={() => chooseBasis('cash')}>
                  Cash (by payment date)
                </button>
                <button
                  className={`btn btn-sm ${basis === 'accrual' ? 'btn-primary' : ''}`}
                  onClick={() => chooseBasis('accrual')}
                >
                  Accrual (by invoice date)
                </button>
                {basis && (
                  <>
                    <button className="btn btn-sm" onClick={() => chooseBasis(null)}>
                      Not sure yet: show both
                    </button>
                    <button className="btn btn-sm" onClick={() => setChangingBasis(false)}>
                      Keep {basis}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {basisError && (
            <p className="mt-2 text-sm" style={{ color: 'var(--red)' }}>
              {basisError}
            </p>
          )}
        </div>
      </section>

      {/* Readiness */}
      <section className="card space-y-2" aria-labelledby="ready-heading">
        <h2 id="ready-heading" className="label !mb-0">
          Ready to file?
        </h2>
        <ul className="space-y-2">
          {items.map((it) => (
            <ReadyRow key={it.key} item={it} />
          ))}
        </ul>
      </section>

      {/* File and pay: only once the quarter has closed — a return filed early
          misses the last days' sales and would switch its reminder off. */}
      {!status.done && !open && (
        <section className="card space-y-2" aria-labelledby="file-heading">
          <h2 id="file-heading" className="label !mb-0">
            File and pay
          </h2>
          <p className="text-sm">
            You file and pay on the city’s site; this app never files or pays anything. Paying by{' '}
            <b>bank transfer (ACH) is free there</b>. Then record it below with the confirmation number.
          </p>
          <a href={CBJ_FILING_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
            Open the city’s online filing ↗
          </a>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            <b>If it’s late:</b>{' '}
            {planTax > 0 ? (
              <>
                a {money(late.fee)} fee, plus {money(late.penaltyPerMonth)} for each month it’s late (up to{' '}
                {money(late.penaltyCap)}), plus about {money(late.interestPerMonth)} a month in interest. One month late
                on {money(planTax)} would cost about {money(late.fee + late.penaltyPerMonth + late.interestPerMonth)}.
              </>
            ) : (
              <>a {money(late.fee)} fee. A return is required even when there were no sales.</>
            )}
          </p>
        </section>
      )}

      {/* Record */}
      <section className="card space-y-2" aria-labelledby="record-heading">
        <h2 id="record-heading" className="label !mb-0">
          Record filing and payment
        </h2>
        {open && (
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            {quarterShort(qt)} is still open: it closes {longDate(qt.end)}. File its return on the city’s site after
            that, then record it here. (The form below still takes other taxes, like a federal estimate.)
          </p>
        )}
        {status.rows.length > 0 && (
          <div className="text-sm">
            <span className="font-semibold">Already recorded for {quarterShort(qt)}:</span>
            <ul className="mt-1 space-y-0.5" style={{ color: 'var(--text2)' }}>
              {status.rows.map((f) => (
                <li key={f.id}>{filingWords(f)}</li>
              ))}
            </ul>
          </div>
        )}
        {saved && (
          <p className="flash-in text-sm font-semibold" role="status">
            {saved}
          </p>
        )}
        <RecordForm
          // Remounts with fresh defaults whenever the quarter, the basis or
          // what is recorded for it changes, so it never offers the whole tax
          // again after a payment; the confirmation above survives that.
          key={`${quarterKey(qt)}-${basis ?? 'both'}-${status.rows.length}-${status.balance}`}
          qt={qt}
          dueOfficial={due.official}
          prefill={
            open || status.done
              ? { filedOn: '', paidOn: '', cents: null }
              : {
                  filedOn: status.filedOn ? '' : today,
                  paidOn: status.balance > 0 ? today : '',
                  cents: status.balance > 0 && (basis || identical) ? status.balance : null,
                }
          }
          balanceCents={basis || identical ? status.balance : null}
          filings={filings ?? []}
          disabled={!!filingsError?.missing}
          onSaved={async (f) => {
            // Stay on the quarter just recorded, so the page shows what was
            // saved instead of jumping to the next one.
            const savedQ = quarterFromKey(
              `${f.period_start.slice(0, 4)}-Q${Math.floor((Number(f.period_start.slice(5, 7)) - 1) / 3) + 1}`,
            )
            const isQuarter = !!savedQ && savedQ.start === f.period_start && savedQ.end === f.period_end
            setPick(isQuarter && f.obligation === 'cbj_sales_tax' ? quarterKey(savedQ) : quarterKey(qt))
            setSaved(`Recorded ✓ ${OBLIGATION_WORDS[f.obligation]}: ${filingWords(f)}.`)
            await reloadFilings()
          }}
          onEdit={() => setSaved(null)}
        />
      </section>

      {/* Past filings */}
      <section className="card space-y-2" aria-labelledby="past-heading">
        <h2 id="past-heading" className="label !mb-0">
          Filings recorded
        </h2>
        <PastFilings filings={filings} onChanged={reloadFilings} />
      </section>

      <p className="text-xs" style={{ color: 'var(--text3)' }}>
        These figures come from your invoices and payments; they are not tax advice. Where your situation decides — cash
        or accrual, whether Airlift Northwest’s hangar work is taxable, the 5% on invoices sent with no tax line —
        confirm with your tax preparer. The quarter table on{' '}
        <Link href="/reports" className="underline">
          Reports
        </Link>{' '}
        shows the tax billed by issue date for the whole year.
      </p>
    </div>
  )
}

function InvoiceList({
  list,
  basis,
  heading,
  lineKey,
}: {
  list: { inv: ReturnInvoice; cents: number }[]
  basis: TaxBasis
  heading: string | null
  lineKey: LineKey
}) {
  return (
    <div>
      {heading && (
        <div className="label !mb-1" style={{ fontSize: 10 }}>
          {heading}
        </div>
      )}
      {list.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          No invoices on this line.
        </p>
      ) : (
        <ul className="space-y-1">
          {list.map(({ inv, cents }) => (
            <li key={inv.invoiceId}>
              <Link
                href={`/invoices/${inv.invoiceId}`}
                className="flex min-h-[44px] items-center justify-between gap-3 rounded-md px-2 py-1"
                style={{ background: 'var(--bg3)' }}
              >
                <span className="min-w-0">
                  <span className="wnt-id text-xs">{inv.invoiceNumber}</span>{' '}
                  <span className="wnt-id text-xs">{inv.jobNumber}</span>{' '}
                  <span className="text-sm">{inv.customer}</span>
                  <small className="block text-xs" style={{ color: 'var(--text3)' }}>
                    {basis === 'accrual'
                      ? `sent ${formatDateShort(inv.issueDate)}`
                      : `paid ${money(inv.received)} on ${inv.dates.map((d) => formatDateShort(d)).join(', ')}${
                          inv.preLedger ? ' (no payment on record; job date used)' : ''
                        }`}
                    {lineKey === 'tax' && inv.included > 0 && inv.taxLine === 0 && ' · no tax line; 5% owed by you'}
                    {lineKey === 'tax' && inv.included > 0 && inv.taxLine > 0 && ' · tax line below 5%; you owe the rest'}
                    {inv.exempt && inv.exemptNote && ` · exempt: ${inv.exemptNote}`}
                  </small>
                </span>
                <span className="money shrink-0 text-sm font-semibold">{money(cents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReadyRow({ item }: { item: ReadyItem }) {
  const chip =
    item.ok === true ? (
      <span className="chip chip-paid">done</span>
    ) : item.ok === false ? (
      <span className="chip chip-unpaid">to do</span>
    ) : (
      <span className="chip chip-open">check</span>
    )
  return (
    <li className="flex items-start gap-2">
      <span className="shrink-0 pt-0.5">{chip}</span>
      <span className="min-w-0 text-sm">
        <span className="font-semibold">{item.title}</span>
        {item.detail && (
          <span className="block" style={{ color: 'var(--text2)' }}>
            {item.detail}
          </span>
        )}
        {item.refs && item.refs.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-2">
            {item.refs.map((r) => (
              <Link key={r.href + r.label} href={r.href} className="btn btn-sm">
                {r.label}
              </Link>
            ))}
          </span>
        )}
      </span>
    </li>
  )
}

function RecordForm({
  qt,
  dueOfficial,
  prefill,
  balanceCents,
  filings,
  disabled,
  onSaved,
  onEdit,
}: {
  qt: Quarter
  dueOfficial: string
  /**
   * The starting dates and amount: blank while the quarter is open or once it
   * is done; otherwise today, and the BALANCE still owed (not the whole tax).
   * cents null = he types it (the bases differ and none is chosen).
   */
  prefill: { filedOn: string; paidOn: string; cents: number | null }
  /** The tax still owed for `qt` after recorded payments; null = not known (bases differ, none chosen). */
  balanceCents: number | null
  /** Everything recorded, to warn before a second payment for the same period. */
  filings: readonly TaxFiling[]
  disabled: boolean
  onSaved: (saved: FilingFacts) => Promise<void>
  /** Any edit clears the page's last "Recorded ✓". */
  onEdit: () => void
}) {
  const [form, setForm] = useState({
    obligation: 'cbj_sales_tax' as TaxObligation,
    period_start: qt.start,
    period_end: qt.end,
    due_date: dueOfficial,
    filed_on: prefill.filedOn,
    paid_on: prefill.paidOn,
    amount: prefill.cents === null ? '' : centsToInput(prefill.cents),
    method: 'ach' as TaxPaymentMethod,
    settles: false,
    confirmation: '',
    note: '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  /** A second payment for the same period was flagged; the next tap records it anyway. */
  const [dupArmed, setDupArmed] = useState(false)
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }))
    setMsg(null)
    setDupArmed(false)
    onEdit()
  }

  const isCbj = form.obligation === 'cbj_sales_tax'
  // The balance only speaks to the quarter this page is showing.
  const thisQuarter = isCbj && form.period_start === qt.start && form.period_end === qt.end
  const typed = form.amount.trim() === '' ? null : parseMoney(form.amount)
  const short =
    thisQuarter && !!form.paid_on && balanceCents !== null && typed !== null && typed > 0 && typed < balanceCents
  const over =
    thisQuarter && !!form.paid_on && balanceCents !== null && balanceCents > 0 && typed !== null && typed > balanceCents
  const samePeriodPaid = filings.filter(
    (f) =>
      f.obligation === form.obligation &&
      f.period_start === form.period_start &&
      f.period_end === form.period_end &&
      !!f.paid_on,
  )

  async function save() {
    // Validate here, in words, before the database ever has to refuse it.
    if (!form.period_start || !form.period_end || form.period_end < form.period_start) {
      setMsg('The period’s last day has to be on or after its first day.')
      return
    }
    if (!form.filed_on && !form.paid_on) {
      setMsg('Enter the day you filed, the day you paid, or both.')
      return
    }
    // A sales-tax return can only be filed once its period has closed; one
    // recorded early would switch the reminder off and miss the last days.
    if (isCbj && ((form.filed_on && form.filed_on <= form.period_end) || (form.paid_on && form.paid_on <= form.period_end))) {
      setMsg(
        `This period closes ${formatDate(form.period_end)}. File and pay its return after that, then record it here.`,
      )
      return
    }
    const amount = form.amount.trim() === '' ? 0 : parseMoney(form.amount)
    if (amount === null || amount < 0) {
      setMsg('The amount paid should be a dollar figure like 242.70.')
      return
    }
    if (form.paid_on && amount === 0) {
      setMsg(
        form.amount.trim() === ''
          ? 'Enter how much you paid, or clear the paid date if you haven’t paid yet.'
          : 'A $0 payment isn’t a payment. For a return with nothing to pay, clear “Paid on” and record the day you filed.',
      )
      return
    }
    if (form.paid_on && samePeriodPaid.length > 0 && !dupArmed) {
      const already = samePeriodPaid.reduce((s, f) => s + f.amount_cents, 0)
      setMsg(
        `${money(already)} is already recorded as paid for this period (${samePeriodPaid
          .map((f) => formatDateShort(f.paid_on as string))
          .join(', ')}). If this is a second, separate payment, tap “Record it anyway”; if not, it’s already recorded.`,
      )
      setDupArmed(true)
      return
    }
    const row: FilingFacts & { due_date: string | null; note: string | null } = {
      obligation: form.obligation,
      period_start: form.period_start,
      period_end: form.period_end,
      due_date: form.due_date || null,
      filed_on: form.filed_on || null,
      paid_on: form.paid_on || null,
      amount_cents: form.paid_on ? amount : 0,
      // Only a short payment on this quarter can be marked as the city's full amount.
      settles_return: short && form.settles,
      method: form.paid_on ? form.method : null,
      confirmation: form.confirmation.trim() || null,
      note: form.note.trim() || null,
    }
    setBusy(true)
    const { error } = await supabase.from('tax_filings').insert(row)
    setBusy(false)
    setDupArmed(false)
    if (error) {
      setMsg(dbErrorWords(error, 'save'))
      return
    }
    // Empty the form so a second tap cannot record the same thing again.
    setForm((f) => ({ ...f, filed_on: '', paid_on: '', amount: '', settles: false, confirmation: '', note: '' }))
    await onSaved(row)
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div className="col-span-2 sm:col-span-3">
        <label className="label" htmlFor="tf-obligation">
          What
        </label>
        <select
          id="tf-obligation"
          className="select"
          value={form.obligation}
          onChange={(e) => set({ obligation: e.target.value as TaxObligation })}
        >
          {(Object.keys(OBLIGATION_WORDS) as TaxObligation[]).map((o) => (
            <option key={o} value={o}>
              {OBLIGATION_WORDS[o]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tf-start">
          Period from
        </label>
        <input id="tf-start" className="input" type="date" value={form.period_start} onChange={(e) => set({ period_start: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="tf-end">
          Period to
        </label>
        <input id="tf-end" className="input" type="date" value={form.period_end} onChange={(e) => set({ period_end: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="tf-due">
          Due date
        </label>
        <input id="tf-due" className="input" type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="tf-filed">
          Filed on
        </label>
        <input id="tf-filed" className="input" type="date" value={form.filed_on} onChange={(e) => set({ filed_on: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="tf-paid">
          Paid on
        </label>
        <input id="tf-paid" className="input" type="date" value={form.paid_on} onChange={(e) => set({ paid_on: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="tf-amount">
          Tax paid ($)
        </label>
        <input
          id="tf-amount"
          className="input"
          inputMode="decimal"
          placeholder="0.00"
          value={form.amount}
          onChange={(e) => set({ amount: e.target.value })}
        />
      </div>
      <div>
        <label className="label" htmlFor="tf-method">
          Paid by
        </label>
        <select id="tf-method" className="select" value={form.method} onChange={(e) => set({ method: e.target.value as TaxPaymentMethod })}>
          {(Object.keys(METHOD_WORDS) as TaxPaymentMethod[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_WORDS[m]}
            </option>
          ))}
        </select>
      </div>
      <div className="col-span-2">
        <label className="label" htmlFor="tf-conf">
          Confirmation number
        </label>
        <input id="tf-conf" className="input" value={form.confirmation} onChange={(e) => set({ confirmation: e.target.value })} />
      </div>
      <div className="col-span-2 sm:col-span-3">
        <label className="label" htmlFor="tf-note">
          Note
        </label>
        <input
          id="tf-note"
          className="input"
          placeholder="e.g. a late fee paid with it (keep it out of the tax paid)"
          value={form.note}
          onChange={(e) => set({ note: e.target.value })}
        />
      </div>
      {(short || over) && balanceCents !== null && (
        <div className="col-span-2 space-y-1 text-sm sm:col-span-3">
          {short ? (
            <>
              <p style={{ color: 'var(--text2)' }}>
                That’s {money(balanceCents - (typed ?? 0))} less than the {money(balanceCents)} still owed on this
                return, so the quarter stays open and the reminder stays up until the rest is recorded.
              </p>
              <label className="flex min-h-[44px] items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={form.settles}
                  onChange={(e) => set({ settles: e.target.checked })}
                />
                <span>This was the full amount the city asked for</span>
              </label>
            </>
          ) : (
            <p style={{ color: 'var(--red)' }}>
              That’s more than the {money(balanceCents)} still owed on this return. Check it isn’t a payment already
              recorded, or a late fee (which goes in the note).
            </p>
          )}
        </div>
      )}
      <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-3">
        <button className="btn btn-primary" disabled={busy || disabled} onClick={save}>
          {busy ? 'Saving…' : dupArmed ? 'Record it anyway' : 'Record filing and payment'}
        </button>
        {msg && (
          <span className="flash-in text-sm" role="alert" style={{ color: 'var(--red)' }}>
            {msg}
          </span>
        )}
        {!msg && (
          <span className="text-xs" style={{ color: 'var(--text3)' }}>
            Clear “Paid on” if you filed but haven’t paid yet; record the payment when you do.
          </span>
        )}
      </div>
    </div>
  )
}

function PastFilings({ filings, onChanged }: { filings: TaxFiling[] | null; onChanged: () => Promise<void> }) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  if (filings === null) {
    return (
      <p className="text-sm" style={{ color: 'var(--text3)' }}>
        Not available until the filings can be read.
      </p>
    )
  }
  if (filings.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text3)' }}>
        Nothing recorded yet. Each return you file and pay goes here, and comes off “sales tax held” on the dashboard.
      </p>
    )
  }
  async function remove(id: string) {
    setErr(null)
    const { error } = await supabase.from('tax_filings').delete().eq('id', id)
    if (error) {
      setErr(dbErrorWords(error, 'remove it'))
      return
    }
    setConfirmId(null)
    await onChanged()
  }
  const periodWords = (f: TaxFiling) => {
    const q = quarterFromKey(`${f.period_start.slice(0, 4)}-Q${Math.floor((Number(f.period_start.slice(5, 7)) - 1) / 3) + 1}`)
    return q && q.start === f.period_start && q.end === f.period_end
      ? quarterShort(q)
      : `${formatDateShort(f.period_start)} – ${formatDateShort(f.period_end)}`
  }
  return (
    <ul className="space-y-2">
      {filings.map((f) => (
        <li key={f.id} className="rounded-md p-2" style={{ background: 'var(--bg3)' }}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 text-sm">
              <div className="font-semibold">
                {OBLIGATION_WORDS[f.obligation]} · {periodWords(f)}
              </div>
              <div style={{ color: 'var(--text2)' }}>{filingWords(f)}</div>
              {f.note && (
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  {f.note}
                </div>
              )}
            </div>
            {confirmId === f.id ? (
              <span className="flex gap-2">
                <button className="btn btn-sm btn-danger" onClick={() => remove(f.id)}>
                  Remove for good
                </button>
                <button className="btn btn-sm" onClick={() => setConfirmId(null)}>
                  Keep
                </button>
              </span>
            ) : (
              <button className="btn btn-sm" onClick={() => setConfirmId(f.id)}>
                Remove
              </button>
            )}
          </div>
        </li>
      ))}
      {err && (
        <li className="text-sm" style={{ color: 'var(--red)' }}>
          {err}
        </li>
      )}
    </ul>
  )
}
