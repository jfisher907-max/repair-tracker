// Report builders for the Hangar section (ported from the retired standalone
// Hangar Tracker): a 2-page printable HTML report, a plain-text version for
// pasting into email, and CSV. These are the usage evidence behind billing
// Airlift Northwest for Wings Hangar management — deliberately time-only.

import type { HangarSession, HangarUnavail } from './hangar'
import {
  HANGARS,
  clipSessionsToRange,
  clipUnavailToRange,
  completedHangarMs,
  fmtDT,
  fmtDur,
  getAcStats,
  getPresetLabel,
  getUnavailStats,
  type AcStats,
  type HangarDateFilter,
} from './hangar-stats'

// Aggregates come from range-CLIPPED spans (open ones counted up to now) so
// the report's hour totals match the Reports page; the row listings keep the
// original records — real timestamps, 'Ongoing' where still open — filtered
// to those overlapping the range.
function filtered(sessions: HangarSession[], unavail: HangarUnavail[], filter: HangarDateFilter) {
  const now = new Date()
  const fSess = clipSessionsToRange(sessions, filter, now)
  const fUnavail = clipUnavailToRange(unavail, filter, now)
  const sessIds = new Set(fSess.map((s) => s.id))
  const unavailIds = new Set(fUnavail.map((u) => u.id))
  return {
    fSess,
    fUnavail,
    logSess: sessions.filter((s) => sessIds.has(s.id)),
    logUnavail: unavail.filter((u) => unavailIds.has(u.id)),
  }
}

export function buildReportHTML(
  sessions: HangarSession[],
  unavail: HangarUnavail[],
  filter: HangarDateFilter,
): string {
  const now = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
  const { fSess, fUnavail, logSess, logUnavail } = filtered(sessions, unavail, filter)
  const s1 = getAcStats('N254AL', fSess)
  const s2 = getAcStats('N253AL', fSess)
  const us = getUnavailStats(fUnavail)
  const label = getPresetLabel(filter.preset)
  const cwMs = completedHangarMs(fSess, 'Wings Hangar')
  const caMs = completedHangarMs(fSess, 'ALNW')
  const sorted = [...logSess].sort((a, b) => new Date(b.entry).getTime() - new Date(a.entry).getTime())
  const sortedU = [...logUnavail].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
  )

  const acSection = (name: string, st: AcStats) => {
    const reasonRows = Object.entries(st.reasons)
      .map(
        ([r, d]) =>
          `<tr><td>${r}</td><td>${(d.ms / 3600000).toFixed(1)} hrs</td><td>${(d.ms / 86400000).toFixed(2)} days</td><td>${d.count} session${d.count !== 1 ? 's' : ''}</td></tr>`,
      )
      .join('')
    return `
    <div class="rpt-ac-block">
      <div class="rpt-ac-title">${name}</div>
      <table class="rpt-table">
        <tr><th>Metric</th><th>Hours</th><th>Days (24h)</th></tr>
        <tr><td>Total Time in Hangar</td><td>${st.totalHours} hrs</td><td>${st.totalDays} days</td></tr>
        <tr><td>Wings Hangar</td><td>${st.byHangar['Wings Hangar'].hours} hrs</td><td>${st.byHangar['Wings Hangar'].days} days &nbsp;<span class="rpt-sub">(${st.byHangar['Wings Hangar'].count} session${st.byHangar['Wings Hangar'].count !== 1 ? 's' : ''})</span></td></tr>
        <tr><td>ALNW</td><td>${st.byHangar['ALNW'].hours} hrs</td><td>${st.byHangar['ALNW'].days} days &nbsp;<span class="rpt-sub">(${st.byHangar['ALNW'].count} session${st.byHangar['ALNW'].count !== 1 ? 's' : ''})</span></td></tr>
        <tr><td>Total Sessions</td><td colspan="2">${st.count} &nbsp;<span class="rpt-sub">(${st.uniqueDays} day${st.uniqueDays !== 1 ? 's' : ''} with activity)</span></td></tr>
      </table>
      ${
        Object.keys(st.reasons).length
          ? `
      <div class="rpt-sub-title">Reason Breakdown</div>
      <table class="rpt-table">
        <tr><th>Reason</th><th>Hours</th><th>Days (24h)</th><th>Sessions</th></tr>
        ${reasonRows}
      </table>`
          : ''
      }
    </div>`
  }

  const sessionRows = sorted
    .map((s, i) => {
      const dur = s.exit ? fmtDur(new Date(s.exit).getTime() - new Date(s.entry).getTime()) : 'Ongoing'
      const reason = s.exit_reason || s.reason || ''
      const note = s.exit_note || s.note || ''
      return `<tr>
      <td>${i + 1}</td>
      <td><strong>${s.aircraft}</strong></td>
      <td>${s.hangar}</td>
      <td>${fmtDT(s.entry)}</td>
      <td>${s.exit ? fmtDT(s.exit) : '<em>In hangar</em>'}</td>
      <td>${dur}</td>
      <td>${reason}${note ? `<br><span class="rpt-sub">${note}</span>` : ''}</td>
    </tr>`
    })
    .join('')

  const unavailRows = sortedU
    .map((u, i) => {
      const dur = u.end_time
        ? fmtDur(new Date(u.end_time).getTime() - new Date(u.start_time).getTime())
        : 'Ongoing'
      return `<tr>
      <td>${i + 1}</td>
      <td>${fmtDT(u.start_time)}</td>
      <td>${u.end_time ? fmtDT(u.end_time) : '<em>Still unavailable</em>'}</td>
      <td>${dur}</td>
      <td>${u.note || '—'}</td>
    </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#1a2535;background:#fff;padding:20px 28px;}
  .rpt-header{border-bottom:3px solid #1a2535;padding-bottom:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;}
  .rpt-company{font-size:20px;font-weight:800;letter-spacing:0.04em;color:#1a2535;}
  .rpt-meta{text-align:right;font-size:11px;color:#4a6080;line-height:1.8;}
  .rpt-meta strong{color:#1a2535;}
  .rpt-section-title{font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#fff;background:#1a2535;padding:6px 12px;margin-bottom:10px;}
  .rpt-section-title.red{background:#c84040;}
  .rpt-ac-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;}
  .rpt-ac-block{border:1px solid #d0dce8;border-radius:4px;overflow:hidden;page-break-inside:avoid;}
  .rpt-ac-title{background:#2a3f5a;color:#fff;padding:8px 12px;font-size:11px;font-weight:700;letter-spacing:0.06em;}
  .rpt-sub-title{padding:7px 12px 3px;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#4a6080;background:#f8fafc;border-top:1px solid #e8eff6;}
  .rpt-table{width:100%;border-collapse:collapse;font-size:11px;}
  .rpt-table th{background:#f0f4f8;padding:6px 10px;text-align:left;font-size:9px;letter-spacing:0.08em;text-transform:uppercase;color:#4a6080;font-weight:700;border-bottom:1px solid #d0dce8;}
  .rpt-table td{padding:6px 10px;border-top:1px solid #eef2f7;color:#1a2535;vertical-align:top;}
  .rpt-table tr:nth-child(even) td{background:#fafcff;}
  .rpt-sub{color:#6a8aaa;font-size:10px;}
  .rpt-stat-row{display:grid;gap:10px;margin-bottom:14px;page-break-inside:avoid;}
  .rpt-stat-row.three{grid-template-columns:1fr 1fr 1fr;}
  .rpt-stat-row.four{grid-template-columns:1fr 1fr 1fr 1fr;}
  .rpt-stat-box{border-radius:4px;padding:11px 12px;text-align:center;border:1px solid #d0dce8;}
  .rpt-stat-box.green{background:#f0faf4;border-color:#b0dfc0;}
  .rpt-stat-box.orange{background:#fff8f0;border-color:#f0c890;}
  .rpt-stat-box.red{background:#fff0f0;border-color:#f0c0c0;}
  .rpt-stat-val{font-size:20px;font-weight:800;line-height:1.1;margin-bottom:3px;}
  .rpt-stat-val.green{color:#1a7a48;}
  .rpt-stat-val.orange{color:#8a4810;}
  .rpt-stat-val.red{color:#c84040;}
  .rpt-stat-label{font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6a8aaa;}
  .rpt-block{border:1px solid #d0dce8;border-radius:4px;overflow:hidden;margin-bottom:14px;page-break-inside:avoid;}
  .rpt-block.red-border{border-color:#f0c0c0;border-left:4px solid #c84040;}
  .rpt-block-header{padding:7px 12px;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;}
  .rpt-block-header.red{background:#c84040;color:#fff;}
  .rpt-block-footer{padding:7px 12px;font-size:10px;font-weight:700;border-top:1px solid #f0c0c0;background:#fff8f8;color:#c84040;}
  .page-break{page-break-before:always;padding-top:16px;}
  .no-break{page-break-inside:avoid;}
  .session-table{width:100%;border-collapse:collapse;font-size:11px;}
  .session-table th{background:#1a2535;color:#fff;padding:7px 10px;text-align:left;font-size:9px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;}
  .session-table td{padding:6px 10px;border-top:1px solid #eef2f7;vertical-align:top;}
  .session-table tr:nth-child(even) td{background:#fafcff;}
  .page2-header{border-bottom:2px solid #d0dce8;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;}
  .page2-title{font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#1a2535;}
  .page2-meta{font-size:10px;color:#8aaccc;}
  .rpt-footer{border-top:1px solid #d0dce8;padding-top:10px;margin-top:16px;font-size:10px;color:#8aaccc;display:flex;justify-content:space-between;}
  @media print{
    body{padding:14px 20px;}
    @page{margin:12mm;size:A4;}
    html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .page-break{page-break-before:always;padding-top:14px;}
    .no-break{page-break-inside:avoid;}
    .session-table tr{page-break-inside:avoid;}
  }
</style>
</head>
<body>
<div class="rpt-header">
  <div class="rpt-company">&#9992; Wings N Things &#8212; Hangar Usage Report</div>
  <div class="rpt-meta">
    <div><strong>Period:</strong> ${label}</div>
    <div><strong>Generated:</strong> ${now}</div>
  </div>
</div>

<div class="no-break"><div class="rpt-section-title">Aircraft Summary</div></div>
<div class="rpt-ac-grid">
  ${acSection('N254AL', s1)}
  ${acSection('N253AL', s2)}
</div>

<div class="no-break"><div class="rpt-section-title">Combined Hangar Totals</div></div>
<div class="rpt-stat-row four">
  <div class="rpt-stat-box green"><div class="rpt-stat-val green">${(cwMs / 3600000).toFixed(1)}h</div><div class="rpt-stat-label">Wings Hangar &#8212; Hours</div></div>
  <div class="rpt-stat-box green"><div class="rpt-stat-val green">${(cwMs / 86400000).toFixed(2)}d</div><div class="rpt-stat-label">Wings Hangar &#8212; Days</div></div>
  <div class="rpt-stat-box orange"><div class="rpt-stat-val orange">${(caMs / 3600000).toFixed(1)}h</div><div class="rpt-stat-label">ALNW &#8212; Hours</div></div>
  <div class="rpt-stat-box orange"><div class="rpt-stat-val orange">${(caMs / 86400000).toFixed(2)}d</div><div class="rpt-stat-label">ALNW &#8212; Days</div></div>
</div>

<div class="no-break"><div class="rpt-section-title red">Wings Hangar Unavailability</div></div>
<div class="rpt-stat-row three">
  <div class="rpt-stat-box red"><div class="rpt-stat-val red">${us.count}</div><div class="rpt-stat-label">Periods Logged</div></div>
  <div class="rpt-stat-box red"><div class="rpt-stat-val red">${us.totalHours}h</div><div class="rpt-stat-label">Total Hours Unavailable</div></div>
  <div class="rpt-stat-box red"><div class="rpt-stat-val red">${us.totalDays}d</div><div class="rpt-stat-label">Total Days (24h)</div></div>
</div>

<div class="rpt-block red-border no-break">
  <div class="rpt-block-header red">Unavailability Periods &#8212; ${label}</div>
  <table class="rpt-table">
    <tr><th>#</th><th>Start</th><th>End</th><th>Duration</th><th>Note</th></tr>
    ${unavailRows || `<tr><td colspan="5" style="color:#8aaccc;font-style:italic;text-align:center;padding:12px;">No unavailability periods in this range.</td></tr>`}
  </table>
  <div class="rpt-block-footer">Total Unavailable: ${us.totalHours} hrs / ${us.totalDays} days</div>
</div>

<div class="rpt-footer">
  <span>Wings N Things Hangar Tracker &#8212; Page 1 of 2</span>
  <span>${now}</span>
</div>

<div class="page-break">
  <div class="page2-header">
    <div class="page2-title">Full Session Log</div>
    <div class="page2-meta">Period: ${label} &nbsp;&#183;&nbsp; ${sorted.length} session${sorted.length !== 1 ? 's' : ''}</div>
  </div>
  <table class="session-table">
    <thead>
      <tr><th>#</th><th>Aircraft</th><th>Hangar</th><th>Entry</th><th>Exit</th><th>Duration</th><th>Reason / Note</th></tr>
    </thead>
    <tbody>
      ${sessionRows || `<tr><td colspan="7" style="color:#8aaccc;font-style:italic;text-align:center;padding:20px;">No sessions in this range.</td></tr>`}
    </tbody>
  </table>
  <div class="rpt-footer">
    <span>Wings N Things Hangar Tracker &#8212; Page 2 of 2</span>
    <span>${now}</span>
  </div>
</div>
</body>
</html>`
}

export function buildEmailText(
  sessions: HangarSession[],
  unavail: HangarUnavail[],
  filter: HangarDateFilter,
): string {
  const now = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
  const { fSess, fUnavail, logSess, logUnavail } = filtered(sessions, unavail, filter)
  const s1 = getAcStats('N254AL', fSess)
  const s2 = getAcStats('N253AL', fSess)
  const us = getUnavailStats(fUnavail)
  const label = getPresetLabel(filter.preset)
  const L: string[] = []
  const SEP = '='.repeat(56)
  const SEP2 = '-'.repeat(56)
  L.push('WINGS N THINGS — HANGAR USAGE REPORT')
  L.push(`Period:    ${label}`)
  L.push(`Generated: ${now}`)
  L.push(SEP)
  L.push('')
  L.push('AIRCRAFT SUMMARY')
  L.push(SEP2)
  L.push('')
  ;(
    [
      ['N254AL', s1],
      ['N253AL', s2],
    ] as [string, AcStats][]
  ).forEach(([name, st]) => {
    L.push(`Aircraft:               ${name}`)
    L.push(`  Total Sessions:       ${st.count}`)
    L.push(`  Total Hours:          ${st.totalHours} hrs`)
    L.push(`  Total Days (24h):     ${st.totalDays} days`)
    L.push(`  Days w/ Activity:     ${st.uniqueDays}`)
    L.push('')
    L.push(`  By Hangar:`)
    HANGARS.forEach((h) =>
      L.push(
        `    ${h.padEnd(16)} ${st.byHangar[h].hours} hrs  (${st.byHangar[h].count} session${st.byHangar[h].count !== 1 ? 's' : ''})`,
      ),
    )
    if (Object.keys(st.reasons).length) {
      L.push('')
      L.push(`  By Reason:`)
      Object.entries(st.reasons).forEach(([r, d]) =>
        L.push(
          `    ${r.padEnd(34)} ${(d.ms / 3600000).toFixed(1)} hrs  (${d.count} session${d.count !== 1 ? 's' : ''})`,
        ),
      )
    }
    L.push('')
  })
  const cwMs = completedHangarMs(fSess, 'Wings Hangar')
  const caMs = completedHangarMs(fSess, 'ALNW')
  L.push('COMBINED TOTALS')
  L.push(SEP2)
  L.push(`  Wings Hangar (both aircraft): ${(cwMs / 3600000).toFixed(1)} hrs`)
  L.push(`  ALNW (both aircraft):         ${(caMs / 3600000).toFixed(1)} hrs`)
  L.push(`  Total Sessions:               ${s1.count + s2.count}`)
  L.push('')
  L.push(SEP)
  L.push('WINGS HANGAR UNAVAILABILITY')
  L.push(SEP2)
  L.push(`  Periods Logged:   ${us.count}`)
  L.push(`  Total Hours:      ${us.totalHours} hrs`)
  L.push(`  Total Days (24h): ${us.totalDays} days`)
  L.push('')
  const sortedU = [...logUnavail].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
  )
  if (sortedU.length) {
    sortedU.forEach((u, i) => {
      const dur = u.end_time
        ? fmtDur(new Date(u.end_time).getTime() - new Date(u.start_time).getTime())
        : 'Ongoing'
      L.push(`  #${String(i + 1).padStart(2, '0')}  Start:    ${fmtDT(u.start_time)}`)
      L.push(`        End:      ${u.end_time ? fmtDT(u.end_time) : 'Still unavailable'}`)
      L.push(`        Duration: ${dur}`)
      if (u.note) L.push(`        Note:     ${u.note}`)
      L.push('')
    })
  } else {
    L.push('  No unavailability periods in this range.')
    L.push('')
  }
  L.push(SEP)
  L.push('FULL SESSION LOG')
  L.push(SEP2)
  L.push('')
  const sorted = [...logSess].sort((a, b) => new Date(b.entry).getTime() - new Date(a.entry).getTime())
  if (!sorted.length) {
    L.push('  No sessions in this range.')
  } else {
    sorted.forEach((s, i) => {
      const dur = s.exit ? fmtDur(new Date(s.exit).getTime() - new Date(s.entry).getTime()) : 'Ongoing'
      const reason = s.exit_reason || s.reason || ''
      const note = s.exit_note || s.note || ''
      L.push(`#${String(i + 1).padStart(2, '0')}  ${s.aircraft}  →  ${s.hangar}`)
      L.push(`      In:        ${fmtDT(s.entry)}`)
      L.push(`      Out:       ${s.exit ? fmtDT(s.exit) : 'Still in hangar'}`)
      L.push(`      Duration:  ${dur}`)
      if (reason) L.push(`      Reason:    ${reason}`)
      if (note) L.push(`      Note:      ${note}`)
      L.push('')
    })
  }
  L.push(SEP)
  L.push('Wings N Things Hangar Tracker')
  return L.join('\n')
}

export function buildCSV(sessions: HangarSession[], filter: HangarDateFilter): string {
  const ids = new Set(clipSessionsToRange(sessions, filter, new Date()).map((s) => s.id))
  const fSess = sessions.filter((s) => ids.has(s.id))
  const rows: string[][] = [['Aircraft', 'Hangar', 'Entry', 'Exit', 'Duration (hrs)', 'Reason', 'Note']]
  ;[...fSess]
    .sort((a, b) => new Date(b.entry).getTime() - new Date(a.entry).getTime())
    .forEach((s) => {
      const ms = s.exit ? new Date(s.exit).getTime() - new Date(s.entry).getTime() : 0
      rows.push([
        s.aircraft,
        s.hangar,
        fmtDT(s.entry),
        s.exit ? fmtDT(s.exit) : '',
        s.exit ? (ms / 3600000).toFixed(2) : '',
        s.exit_reason || s.reason || '',
        s.exit_note || s.note || '',
      ])
    })
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
}

export function downloadText(content: string, filename: string, mime: string) {
  const b = new Blob([content], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(b)
  a.download = filename
  a.click()
}

export function printHTML(html: string) {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return
  win.document.write(html)
  win.document.title = ''
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 600)
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
