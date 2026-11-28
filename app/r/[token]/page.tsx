'use client'

import { use, useEffect, useState } from 'react'
import DocBrand, { type DocBusiness } from '@/components/DocBrand'
import { BRAND_NAME } from '@/lib/brand'
import { useDocumentTitle } from '@/lib/title'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/date'
import DamageChart from '@/components/DamageChart'
import WheelGauges from '@/components/WheelGauges'
import { cleanMarks, markWords, styleOf } from '@/lib/damage-chart'
import { templateFor, type InspectionPackage, type MeasureKind } from '@/lib/inspection-templates'
import {
  disclaimerFor,
  findings,
  RATING_LABEL,
  snapshotLabel,
  verdictLabel,
  type ItemMeasure,
  type Rating,
  type Verdict,
  type VehicleSnapshot,
} from '@/lib/inspections'

interface PublicItem {
  section: string
  label: string
  rating: Rating | null
  note: string | null
  measure_kind: MeasureKind | null
  measure: ItemMeasure | null
  cost_low_cents: number | null
  cost_high_cents: number | null
}

interface PublicInspection {
  report_number: string
  package: InspectionPackage
  prepared_for: string | null
  seller_name: string | null
  odometer_miles: number | null
  inspected_on: string
  road_test_done: boolean | null
  road_test_reason: string | null
  recalls_note: string | null
  verdict: Verdict
  summary_note: string | null
  show_costs: boolean
  vehicle: VehicleSnapshot | null
  signed_by_name: string | null
  items: PublicItem[]
  business: DocBusiness
}

const PILL: Record<Rating, { bg: string; fg: string }> = {
  attention: { bg: '#fdecea', fg: '#b42318' },
  watch: { bg: '#fff3dc', fg: '#8a5a00' },
  ok: { bg: '#e7f4ec', fg: '#1f7a4a' },
  not_checked: { bg: '#eceef2', fg: '#586072' },
  na: { bg: '#eceef2', fg: '#586072' },
}

function Pill({ rating }: { rating: Rating }) {
  return (
    <span
      style={{
        background: PILL[rating].bg,
        color: PILL[rating].fg,
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 6,
        whiteSpace: 'nowrap',
        // A saved PDF keeps the colours: the rating IS the pill.
        printColorAdjust: 'exact',
        WebkitPrintColorAdjust: 'exact',
      }}
    >
      {RATING_LABEL[rating]}
    </span>
  )
}

function measureText(it: PublicItem): string | null {
  const m = it.measure
  if (!m) return null
  if (it.measure_kind === 'tread') {
    const parts = (['lf', 'rf', 'lr', 'rr', 'spare'] as const)
      .filter((k) => typeof m[k] === 'number')
      .map((k) => `${k === 'spare' ? 'Spare' : k.toUpperCase()} ${m[k]}/32`)
    return parts.length ? parts.join(' · ') : null
  }
  if (it.measure_kind === 'pads') {
    const parts = (['lf', 'rf', 'lr', 'rr'] as const)
      .filter((k) => typeof m[k] === 'number')
      .map((k) => `${k.toUpperCase()} ${m[k]} mm`)
    return parts.length ? parts.join(' · ') : null
  }
  if (it.measure_kind === 'battery' && m.rated_cca && m.measured_cca != null) {
    return `${m.measured_cca} CCA measured vs ${m.rated_cca} rated (${Math.round((m.measured_cca / m.rated_cca) * 100)}%)`
  }
  return null
}

function costText(it: PublicItem): string | null {
  if (it.cost_low_cents == null && it.cost_high_cents == null) return null
  if (it.cost_low_cents != null && it.cost_high_cents != null && it.cost_high_cents !== it.cost_low_cents)
    return `${formatCents(it.cost_low_cents)}–${formatCents(it.cost_high_cents)}`
  return formatCents((it.cost_low_cents ?? it.cost_high_cents)!)
}

/**
 * PUBLIC inspection report (0067) — token-keyed, read through
 * get_public_inspection, which returns a report only while it is final and
 * its link is on. Same letterhead as quotes and invoices.
 *
 * Two kinds, by the report's package. The pre-purchase Quick Check prints as
 * it always has. The Vehicle Inspection (0073) leads with the three things it
 * was asked for: the body damage chart with who acknowledged it, brake pad
 * life and tire life, each drawn; then the findings and the full checklist.
 * Everything here arrives in the fields 0067's function already returns
 * (package, and each item's measure), so the public function is unchanged.
 */
export default function PublicInspectionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [report, setReport] = useState<PublicInspection | null | 'missing'>(null)

  useEffect(() => {
    supabase.rpc('get_public_inspection', { token }).then(({ data, error }) => {
      if (error || !data) setReport('missing')
      else setReport(data as PublicInspection)
    })
  }, [token])

  const loaded = report && report !== 'missing' ? report : null
  useDocumentTitle(
    // The title is the saved PDF's filename, which may be emailed on:
    // "R001 Pre-Purchase Inspection — 2014 Subaru Outback".
    loaded
      ? `${loaded.report_number} ${templateFor(loaded.package).docType} — ${snapshotLabel(loaded.vehicle) || loaded.business.name || BRAND_NAME}`
      : null,
  )

  // ?pdf=1 (the shop's "Save as PDF" button) opens the print screen once the
  // report has loaded; the title above is set by then, so the file is named.
  useEffect(() => {
    if (!loaded) return
    if (new URLSearchParams(window.location.search).get('pdf') !== '1') return
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [loaded])

  if (report === null) {
    return <div className="p-8 text-center" style={{ color: 'var(--text3)' }}>Loading report…</div>
  }
  if (report === 'missing') {
    return (
      <div className="p-8 text-center" style={{ color: 'var(--text2)' }}>
        This inspection report isn&apos;t available. Please contact the shop.
      </div>
    )
  }

  const template = templateFor(report.package)
  /** The Vehicle Inspection; anything else prints as the pre-buy always has. */
  const fleet = report.package === 'fleet'
  // The damage chart is not a finding: it has its own part of the report.
  const items = findings(report.items).filter((i) => i.rating && i.rating !== 'na')
  const chart = report.items.find((i) => i.measure_kind === 'damage' && i.rating && i.rating !== 'na') ?? null
  const marks = cleanMarks(chart?.measure?.marks)
  const pads = items.find((i) => i.measure_kind === 'pads' && i.rating !== 'not_checked') ?? null
  const tread = items.find((i) => i.measure_kind === 'tread' && i.rating !== 'not_checked') ?? null
  const attention = items.filter((i) => i.rating === 'attention')
  const watch = items.filter((i) => i.rating === 'watch')
  const notChecked = items.filter((i) => i.rating === 'not_checked')
  const low = [...attention].reduce((s, i) => s + (i.cost_low_cents ?? 0), 0)
  const high = [...attention].reduce((s, i) => s + (i.cost_high_cents ?? i.cost_low_cents ?? 0), 0)
  const sections: { section: string; items: PublicItem[] }[] = []
  for (const it of items) {
    const last = sections[sections.length - 1]
    if (last && last.section === it.section) last.items.push(it)
    else sections.push({ section: it.section, items: [it] })
  }
  const v = report.vehicle
  const damageLine =
    !chart || chart.rating === 'not_checked'
      ? ''
      : marks.length === 0
        ? ' No body damage was found.'
        : ` Body damage is marked in ${marks.length} place${marks.length === 1 ? '' : 's'} on the chart.`

  const counts = [
    `${attention.length} item${attention.length === 1 ? '' : 's'} that need${attention.length === 1 ? 's' : ''} attention`,
    `${watch.length} to watch`,
    `${notChecked.length} not checked`,
  ].join(', ')

  return (
    <div className="min-h-dvh" style={{ background: '#e9ebef' }}>
      <div className="no-print flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-3" style={{ background: '#f4f5f8' }}>
        <button className="btn btn-sm" onClick={() => window.print()}>
          Save as PDF
        </button>
        <span className="text-xs" style={{ color: '#586072' }}>
          Opens your print screen: choose “Save as PDF”.
        </span>
      </div>
      <div className="doc-wrap insp-doc px-0 py-0 sm:px-4 sm:py-8">
      <div className="doc-root">
        {/* The badge names the package; the Vehicle Inspection's name IS its
            document title, so a badge would only say it twice. */}
        <DocBrand
          business={report.business}
          docType={template.docType}
          docRef={report.report_number}
          badge={template.name === template.docType ? null : template.name}
        />
        <div className="doc-body">
          <dl className="doc-meta">
            {report.prepared_for && (
              <div>
                <dt>Prepared for</dt>
                <dd>{report.prepared_for}</dd>
              </div>
            )}
            {report.seller_name && (
              <div>
                <dt>Seller</dt>
                <dd>{report.seller_name}</dd>
              </div>
            )}
            <div>
              <dt>Vehicle</dt>
              <dd>{snapshotLabel(v) || '—'}</dd>
            </div>
            {v?.vin && (
              <div>
                <dt>VIN</dt>
                {/* One line: a VIN broken in two is easy to misread back. */}
                <dd style={{ fontFamily: 'var(--font-mono, ui-monospace)', fontSize: '0.85em', whiteSpace: 'nowrap' }}>{v.vin}</dd>
              </div>
            )}
            {/* A fleet knows its vehicles by plate. */}
            {fleet && v?.plate && (
              <div>
                <dt>Plate</dt>
                <dd>{v.plate}</dd>
              </div>
            )}
            {report.odometer_miles != null && (
              <div>
                <dt>Odometer</dt>
                <dd>{report.odometer_miles.toLocaleString('en-US')} mi</dd>
              </div>
            )}
            <div>
              <dt>Inspected</dt>
              <dd>{formatDate(report.inspected_on)}</dd>
            </div>
            <div>
              <dt>Road test</dt>
              <dd>{report.road_test_done ? 'Yes' : report.road_test_done === false ? `No${report.road_test_reason ? ` (${report.road_test_reason})` : ''}` : '—'}</dd>
            </div>
          </dl>

          <div className="doc-totals-solo" style={{ width: '100%', marginTop: 24 }}>
            <div className="doc-due-card" style={{ display: 'block' }}>
              <span className="doc-due-label">Overall</span>
              <div className="doc-due-amt" style={{ fontSize: 24, textAlign: 'left', marginTop: 4 }}>
                {verdictLabel(report.package, report.verdict)}
              </div>
              <span className="doc-due-sub" style={{ fontSize: 13, lineHeight: 1.5 }}>
                {report.odometer_miles != null
                  ? `At ${report.odometer_miles.toLocaleString('en-US')} miles we found ${counts}.`
                  : `We found ${counts}.`}
                {fleet && damageLine}
                {report.show_costs && low > 0 && ` Rough cost to fix the attention items: ${low === high ? formatCents(low) : `${formatCents(low)}–${formatCents(high)}`}.`}
                {report.recalls_note && ` Open recalls: ${report.recalls_note}.`}
              </span>
            </div>
          </div>

          {report.summary_note && (
            <div className="doc-section">
              <p className="doc-section-body">{report.summary_note}</p>
            </div>
          )}

          {/* THE VEHICLE INSPECTION'S THREE ASKED-FOR PIECES (owner, 2026-11-27),
              ahead of the checklist: the body damage chart on a drawing of the
              vehicle's type, with who was shown it; brake pad life; tire life. */}
          {fleet && chart && (
            <div className="doc-section dmg-doc">
              <h2 style={{ fontSize: 15, fontWeight: 700 }}>Body damage</h2>
              {chart.rating === 'not_checked' ? (
                <p className="doc-section-body">Not checked this visit{chart.note ? `: ${chart.note}` : '.'}</p>
              ) : (
                <>
                  <p className="doc-section-sub">
                    {marks.length === 0
                      ? 'We looked the vehicle over and found no body damage.'
                      : 'Each numbered highlight is a place where damage was found when we looked the vehicle over.'}
                  </p>
                  <div className="dmg-doc-grid">
                    <DamageChart body={styleOf(chart.measure?.chart) ?? 'sedan'} marks={marks} />
                    <div className="dmg-doc-side">
                      {marks.length > 0 && (
                        <ol className="dmg-doc-list">
                          {marks.map((m, i) => (
                            <li key={m.id}>
                              <span className="dmg-doc-num">{i + 1}</span>
                              <span>
                                <b>{markWords(m)}</b>
                                {m.note && <span className="doc-dim"> · {m.note}</span>}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {/* Acknowledged in person and typed in by the shop, or a
                          line to sign on the printed copy. */}
                      {chart.measure?.ack_name ? (
                        <p className="dmg-doc-ack">
                          Shown to and acknowledged by <b>{chart.measure.ack_name}</b>
                          {chart.measure.ack_at
                            ? ` on ${new Date(chart.measure.ack_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
                            : ''}
                          .
                        </p>
                      ) : (
                        <div className="dmg-doc-sign">
                          <span>Acknowledged by</span>
                          <span>Date</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {fleet && (pads || tread) && (
            <div className="doc-section">
              <div className="wg-doc-pair">
                {pads && (
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 700 }}>Brake pad life</h2>
                    <WheelGauges kind="pads" measure={pads.measure} paper />
                  </div>
                )}
                {tread && (
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 700 }}>Tire life</h2>
                    <WheelGauges kind="tread" measure={tread.measure} paper />
                  </div>
                )}
              </div>
            </div>
          )}

          {[...attention, ...watch].length > 0 && (
            <div className="doc-section">
              <h2 className="doc-section-title" style={{ fontSize: 15, fontWeight: 700 }}>What we found</h2>
              <table className="doc-table doc-table--tight" style={{ marginTop: 8 }}>
                <tbody>
                  {[...attention, ...watch].map((it, i) => (
                    // On a phone the pill and the cost each took a column, leaving
                    // the finding a strip three words wide. There they stack in
                    // the finding's own cell: pill above, cost below. Wider
                    // screens and the PDF keep the three columns.
                    <tr key={i}>
                      <td className="hidden sm:table-cell" style={{ width: 1 }}>
                        <Pill rating={it.rating!} />
                      </td>
                      <td className="doc-desc">
                        <span className="mb-1 block sm:hidden">
                          <Pill rating={it.rating!} />
                        </span>
                        <b>{it.label}</b>
                        {it.note && <span className="doc-dim"> · {it.note}</span>}
                        {measureText(it) && <span className="doc-dim" style={{ display: 'block', fontSize: '0.88em' }}>{measureText(it)}</span>}
                        {report.show_costs && costText(it) && (
                          <span className="mt-1 block font-semibold sm:hidden">{costText(it)}</span>
                        )}
                      </td>
                      {report.show_costs && <td className="doc-n hidden sm:table-cell">{costText(it) ?? ''}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.show_costs && (
                <p className="doc-section-sub">
                  {fleet
                    ? 'Rough ranges for planning, not a repair estimate.'
                    : 'Rough ranges for planning and negotiating, not a repair estimate.'}
                </p>
              )}
            </div>
          )}

          {sections.map((s) => (
            <div key={s.section} className="doc-section">
              <h2 style={{ fontSize: 14, fontWeight: 700 }}>{s.section}</h2>
              <table className="doc-table doc-table--tight" style={{ marginTop: 6 }}>
                <tbody>
                  {s.items.map((it, i) => (
                    <tr key={i}>
                      <td className="doc-desc">
                        {it.label}
                        {(measureText(it) || (it.note && it.rating === 'ok')) && (
                          <span className="doc-dim" style={{ display: 'block', fontSize: '0.88em' }}>
                            {[measureText(it), it.rating === 'ok' ? it.note : null].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="doc-n" style={{ width: 1 }}>
                        <Pill rating={it.rating!} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div className="doc-section">
            <h2 style={{ fontSize: 14, fontWeight: 700 }}>Not checked</h2>
            <ul className="doc-section-body" style={{ paddingLeft: 18, margin: '6px 0 0' }}>
              {notChecked.map((it, i) => (
                <li key={i}>
                  {it.label}
                  {it.note ? ` — ${it.note}` : ''}
                </li>
              ))}
              <li>Not part of a {template.name}: {template.notIncluded.join('; ').toLowerCase()}.</li>
            </ul>
          </div>

          <footer className="doc-foot">
            <p>{disclaimerFor(report.package)}</p>
            <p>
              {report.signed_by_name ? `Inspected by ${report.signed_by_name} · ` : ''}
              {formatDate(report.inspected_on)}
              {report.business.phone ? ` · Questions? Call ${report.business.phone}` : ''}
            </p>
          </footer>
        </div>
      </div>
      </div>
    </div>
  )
}
