// Decision sheet generator. The published page is ALWAYS generated from
// items.json — never hand-edit the HTML.
//
//   node docs/decision-sheet/build.mjs --out <dir>
//
// Writes <dir>/decision-sheet.html (the page to publish), <dir>/decision-sheet.test.html
// (same page plus a localStorage stand-in for the artifact db, for local testing
// only), and docs/decision-sheet-open.md (the open-question index agents read).
// Validation fails the build on any rule the sheet depends on.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const outArg = process.argv.indexOf('--out')
if (outArg < 0 || !process.argv[outArg + 1]) {
  console.error('usage: node build.mjs --out <dir>')
  process.exit(2)
}
const outDir = process.argv[outArg + 1]

const data = JSON.parse(readFileSync(join(here, 'items.json'), 'utf8'))
const css = readFileSync(join(here, 'sheet.css'), 'utf8')
const client = readFileSync(join(here, 'sheet.client.js'), 'utf8')
const mock = readFileSync(join(here, 'mockdb.js'), 'utf8')

// ---------- validate ----------
const problems = []
const ids = new Set()
const SEV = new Set(['stop', 'hold', ''])
const TAGS = new Set(['stop', 'chain', 'fact'])
for (const g of data.groups) {
  if (!g.id || !g.title) problems.push(`group missing id/title: ${JSON.stringify(g).slice(0, 60)}`)
  for (const it of g.items) {
    const where = it.id || '(no id)'
    if (!/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/.test(it.id || '')) problems.push(`${where}: id must be short, uppercase, like AUTH-2`)
    if (ids.has(it.id)) problems.push(`${where}: duplicate id`)
    ids.add(it.id)
    for (const k of ['q', 'blocks', 'lane', 'added']) if (!it[k]) problems.push(`${where}: missing ${k}`)
    if (!Array.isArray(it.opts) || it.opts.length < 2 || it.opts.length > 4) problems.push(`${where}: needs 2–4 answer buttons`)
    else {
      if (!it.opts.includes("Let's talk")) problems.push(`${where}: must include "Let's talk"`)
      if (new Set(it.opts).size !== it.opts.length) problems.push(`${where}: duplicate answer text`)
      for (const o of it.opts) if (/^option\s+[a-z0-9]$/i.test(o)) problems.push(`${where}: "${o}" is not a full answer`)
    }
    if (it.none) {
      if (it.rec) problems.push(`${where}: none:true items carry no recommendation`)
    } else {
      if (!it.rec) problems.push(`${where}: missing rec (or set none:true)`)
      if (typeof it.conf !== 'number' || it.conf < 0 || it.conf > 1) problems.push(`${where}: conf must be 0–1`)
      if (!Number.isInteger(it.recOpt) || !it.opts || it.recOpt < 0 || it.recOpt >= it.opts.length) problems.push(`${where}: recOpt must point at a button`)
    }
    if (!SEV.has(it.sev ?? '')) problems.push(`${where}: sev must be stop, hold or empty`)
    for (const t of it.f || []) if (!TAGS.has(t)) problems.push(`${where}: unknown tag ${t}`)
    it.edition = it.edition ?? data.edition
  }
}
for (const g of data.groups) for (const it of g.items) if (it.sup && !ids.has(it.sup)) problems.push(`${it.id}: replaced by unknown id ${it.sup}`)
if (problems.length) {
  console.error('decision sheet: fix these before publishing\n  ' + problems.join('\n  '))
  process.exit(1)
}

// ---------- page ----------
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)
const json = JSON.stringify({ ...data, url: undefined })
  .replace(/</g, '\\u003c')
  .split(LS).join('\\u2028')
  .split(PS).join('\\u2029')

function page({ withMock }) {
  return [
    // The published page gets its charset and viewport from the artifact
    // skeleton; the local test server sends neither, so only the test copy declares them.
    withMock ? '<meta charset="utf-8">' : '',
    withMock ? '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' : '',
    `<title>${data.title}</title>`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@600&display=swap">',
    `<style>\n${css}</style>`,
    '<main class="wrap" id="sheet"></main>',
    `<script type="application/json" id="sheet-data">${json}</script>`,
    withMock ? `<script>\n${mock}</script>` : '',
    `<script>\n${client}</script>`,
    '',
  ].join('\n')
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'decision-sheet.html'), page({ withMock: false }))
writeFileSync(join(outDir, 'decision-sheet.test.html'), page({ withMock: true }))

// ---------- open-question index (agents read this; the sheet itself is private) ----------
const open = []
for (const g of data.groups) for (const it of g.items) if (!it.answeredOn && !it.sup) open.push({ it, g })
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const index = [
  '# Decision sheet: open questions',
  '',
  `Generated from docs/decision-sheet/items.json on every publish. Do not edit by hand. Edition ${data.edition}, ${data.editionLabel}.`,
  data.url ? `The sheet (private to Jake): ${data.url}` : 'The sheet is not published yet.',
  '',
  'Before you ask Jake anything, check this list and docs/DECISIONS.md. If your question is already here, send an',
  'update to that ID, not a new item. To add a question, send the Repair Shop session one block per question with:',
  'ID, Question, Why it matters (with numbers), Recommendation, Confidence (0–1), Answer buttons (always include',
  '"Let\'s talk"), Urgency (act today / holding work / neither), Tags (stop / chain / fact), What it unblocks,',
  'Interacts with (other IDs), Already-ruled check (what you searched and found), Evidence (the query or file:line',
  'behind each number).',
  '',
  '| ID | Area | Question |',
  '|---|---|---|',
  ...open.map(({ it }) => `| ${it.id} | ${cell(it.lane)} | ${cell(it.q)} |`),
  '',
].join('\n')
writeFileSync(join(repo, 'docs', 'decision-sheet-open.md'), index)

console.log(`decision sheet: ${ids.size} items, ${open.length} open → ${outDir}`)
