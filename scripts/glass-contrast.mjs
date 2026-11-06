#!/usr/bin/env node
/**
 * Liquid Glass contrast gate.
 *
 * Composites the owner shell's lit ground, then the glass fill, then the
 * sheen, then any nested tint — and reports the WCAG ratio of every text
 * token that lands on the result. Everything is measured at the LIGHTEST
 * spot the glass can produce (the amber light's peak with blue bleeding in),
 * never an average, because that is where the glass is hardest to read on.
 *
 * Run it before changing any fill, light or text token:
 *     node scripts/glass-contrast.mjs
 * Exits 1 if anything that must clear 4.5:1 does not.
 *
 * The values below must match app/globals.css. Prose version of the output:
 * docs/design-system/glass.md.
 */

// ---------------------------------------------------------------- colour --

const hex = (h) => {
  const s = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
}
/** `src` at alpha `a` composited over `dst` (both opaque rgb triples). */
const over = (src, a, dst) => dst.map((d, i) => src[i] * a + d * (1 - a))
const channel = (v) => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const luminance = (rgb) =>
  0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
const ratio = (a, b) => {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const fmt = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

// ----------------------------------------------------------- the tokens --

const GROUND = hex('#0b0e13') // --surface-page / --night-950

// .app-lit — the three radial lights, at their peak alpha
const LIGHTS = {
  amber: [hex('#f0a832'), 0.17],
  blue: [hex('#4a90d9'), 0.14],
  violet: [hex('#8a6ee0'), 0.11],
}

// .app-frame — the surface contract, glass binding
const FILL = {
  card: [hex('#141922'), 0.55], // --gs-fill
  raised: [hex('#1a202c'), 0.58], // --gs-fill-raised
  chrome: [hex('#10141c'), 0.68], // --gs-fill-chrome
}
const SHEEN = 0.1 // --gs-image, at the top of the panel where labels sit
const SHEEN_CHROME = 0.12 // --gs-image-chrome

// Nested fills set inline across the pages (--bg1/2/3). Any text token can
// land in one of these, so each is checked against the whole ramp.
const NESTED = {
  '--bg2  dark .20': [hex('#06080c'), 0.2],
  '--bg3  dark .32': [hex('#06080c'), 0.32],
  '--bg1  dark .44': [hex('#06080c'), 0.44],
}

// The lit lozenge is a CLOSED set: a selected tab, segment, sidebar item or
// hangar switch, and the only colours any of them carries. Checking it
// against the whole ramp would flag ink-350, which never lands on one.
const LOZENGE = [
  ['selected tab / segment  white .14 / gold-400', [255, 255, 255], 0.14, hex('#ffc35c')],
  ['segment "Out"           white .14 / ink-100', [255, 255, 255], 0.14, hex('#f2f4f8')],
  ['segment Wings           mint .18 / mint-400', hex('#4cd97b'), 0.18, hex('#6fe398')],
  ['segment ALNW            gold .20 / gold-400', hex('#f0a832'), 0.2, hex('#ffc35c')],
  ['calendar day selected   gold .18 / ink-200', hex('#f0a832'), 0.18, hex('#d7dce5')],
  ['hover row               white .07 / ink-100', [255, 255, 255], 0.07, hex('#f2f4f8')],
]

const TEXT = {
  '--text-heading  ink-100': hex('#f2f4f8'),
  '--text-body     ink-200': hex('#d7dce5'),
  '--text-muted    ink-300': hex('#aeb6c4'),
  '--text-faint    ink-350': hex('#9da5b6'),
  '--accent        gold-500': hex('#f0a832'),
  '--accent2       gold-400': hex('#ffc35c'),
  '--green         mint-500': hex('#4cd97b'),
  '--status-ok-fg  mint-400': hex('#6fe398'),
  '--red           ember-400': hex('#f58e8b'),
  '--status-stop   ember-300': hex('#f8a19e'),
  '--blue          sky-400': hex('#8cc3ea'),
  '--orange': hex('#f8a05a'),
}

// Chips paint their own tint on the glass, then text on that.
const CHIPS = [
  ['paid      mint .12 / mint-400', hex('#4cd97b'), 0.12, hex('#6fe398')],
  ['partial   gold .12 / gold-400', hex('#f0a832'), 0.12, hex('#ffc35c')],
  ['unpaid    ember .12 / ember-300', hex('#ef6f6c'), 0.12, hex('#f8a19e')],
  ['scheduled sky .12 / sky-400', hex('#5ca8de'), 0.12, hex('#8cc3ea')],
  ['draft     white .06 / ink-300', [255, 255, 255], 0.06, hex('#aeb6c4')],
  ['tab/seg   white .14 / gold-400', [255, 255, 255], 0.14, hex('#ffc35c')],
  ['danger    ember .12 / ember-300', hex('#ef6f6c'), 0.12, hex('#f8a19e')],
]

// Solid accents carry their own ink.
const SOLID = [
  ['gold button  gold-500 / --gold-ink', hex('#f0a832'), hex('#201503')],
  ['New Job      gold .88 over amber light / --gold-ink', null, hex('#201503')],
  ['swipe delete --red / #2b0d0d', hex('#f58e8b'), hex('#2b0d0d')],
  ['offline bar  --red / #2b0d0d', hex('#f58e8b'), hex('#2b0d0d')],
]

const AA = 4.5 // body and anything under 24px / 19px bold
const AA_LARGE = 3.0

// ------------------------------------------------------------- compositing --

/** The lit ground at a named spot. */
function ground(spot) {
  let bg = GROUND
  for (const [name, a] of Object.entries(spot)) {
    const [rgb, peak] = LIGHTS[name]
    bg = over(rgb, peak * a, bg)
  }
  return bg
}

/** A pane of glass at a spot: ground -> fill -> sheen. */
function pane(spot, which = 'card') {
  const [rgb, a] = FILL[which]
  const sheen = which === 'chrome' ? SHEEN_CHROME : SHEEN
  return over([255, 255, 255], sheen, over(rgb, a, ground(spot)))
}

// The worst case: the amber light at full strength with blue bleeding in.
const WORST = { amber: 1, blue: 0.5 }

// -------------------------------------------------------------- reporting --

let failures = 0
const mark = (r, min) => {
  if (r >= min) return 'pass'
  failures += 1
  return `FAIL (needs ${min})`
}
const line = (label, r, min) =>
  `  ${label.padEnd(34)}${r.toFixed(2).padStart(6)}  ${mark(r, min)}`

console.log('Liquid Glass — contrast at the lightest spot behind the glass\n')

console.log('The lit ground, by spot:')
for (const [name, spot] of Object.entries({
  'dark corner': {},
  'violet peak': { violet: 1 },
  'blue peak': { blue: 1 },
  'amber peak': { amber: 1 },
  'amber + blue (worst)': WORST,
})) {
  console.log(`  ${name.padEnd(24)}${fmt(ground(spot))}   card -> ${fmt(pane(spot))}`)
}

const card = pane(WORST)
const chrome = pane(WORST, 'chrome')

console.log(`\nText on the worst-case card ${fmt(card)}:`)
for (const [name, rgb] of Object.entries(TEXT)) {
  console.log(line(name, ratio(rgb, card), AA))
}

console.log(`\nText on the floating chrome ${fmt(chrome)}:`)
for (const name of ['--text-heading  ink-100', '--text-muted    ink-300', '--accent2       gold-400']) {
  console.log(line(name, ratio(TEXT[name], chrome), AA))
}

console.log(`\nChips and lozenges, on the card:`)
for (const [name, bgRgb, bgA, fg] of CHIPS) {
  console.log(line(name, ratio(fg, over(bgRgb, bgA, card)), AA))
}

console.log(`\nNested panels (--bg1/2/3), worst text in each:`)
for (const [name, [rgb, a]] of Object.entries(NESTED)) {
  const bg = over(rgb, a, card)
  const worst = Object.entries(TEXT)
    .map(([t, c]) => [t, ratio(c, bg)])
    .sort((x, y) => x[1] - y[1])[0]
  console.log(line(`${name} -> ${fmt(bg)}  (${worst[0].trim()})`, worst[1], AA))
}

console.log(`\nSolid accents:`)
for (const [name, bg, ink] of SOLID) {
  // the New Job button is the accent at 88% over the amber light
  const surface = bg ?? over(hex('#f0a832'), 0.88, ground({ amber: 1 }))
  console.log(line(name, ratio(ink, surface), AA))
}

console.log(`\nThe lit lozenge (selected tab, segment, row):`)
for (const [name, bgRgb, bgA, fg] of LOZENGE) {
  console.log(line(name, ratio(fg, over(bgRgb, bgA, chrome)), AA))
}

console.log(`\nNon-text (3:1): status edges, dots and bars on the card:`)
for (const [name, c] of Object.entries({
  'mint-500 edge': hex('#4cd97b'),
  'ember-500 edge': hex('#ef6f6c'),
  'sky-500 edge': hex('#5ca8de'),
  'gold-500 edge': hex('#f0a832'),
})) {
  console.log(line(name, ratio(c, card), AA_LARGE))
}

// The focus ring IS required by 1.4.11 — it is the only indicator of where
// the keyboard is — so it is gated.
console.log(`\nFocus ring (required, 3:1):`)
{
  const outside = ground(WORST)
  const ring = over(hex('#f0a832'), 0.7, card)
  console.log(line('gold .7 vs the card it rings', ratio(ring, card), AA_LARGE))
  console.log(line('gold .7 vs the ground beside it', ratio(ring, outside), AA_LARGE))
}

// Reported, NOT gated, and deliberately so. A card's own boundary is
// decoration under 1.4.11 — the content is what identifies the card — and
// most of what separates a pane from the ground is its drop shadow, which a
// flat two-colour ratio cannot express at all. Inventing a threshold here
// and then tuning until it is met would only hide that. The honest version
// is the raw number, with the figure a human should look at: at the amber
// light's peak the pane itself is barely above the ground, and the hairline
// is doing the work.
console.log(`\nPane edges (reported, not gated — decoration, and the shadow is not in these numbers):`)
{
  const outside = ground(WORST)
  const dark = ground({})
  const darkCard = pane({})
  const hairline = over([255, 255, 255], 0.18, card)
  const say = (l, r) => console.log(`  ${l.padEnd(44)}${r.toFixed(2).padStart(6)}`)
  say('card vs ground, amber peak', ratio(card, outside))
  say('card vs ground, dark corner', ratio(darkCard, dark))
  say('hairline white .18 vs ground, amber peak', ratio(hairline, outside))
  say('hairline white .18 vs ground, dark corner', ratio(over([255, 255, 255], 0.18, darkCard), dark))
  say('lit top edge white .26 vs its card', ratio(over([255, 255, 255], 0.26, card), card))
}

console.log(
  failures === 0
    ? '\nEvery gated pair clears its minimum.'
    : `\n${failures} gated pair(s) below the minimum.`,
)
process.exit(failures === 0 ? 0 : 1)
