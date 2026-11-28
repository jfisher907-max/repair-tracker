/**
 * The body damage chart's geometry (owner, 2026-11-27: "a chart to locate and
 * acknowledge body damage", then "a diagram that adds a visual representation
 * of the type of car that's being inspected and allows me to highlight any
 * body damage found", then "look up front, rear, left side and right side
 * views of this model year sienna to build your diagram").
 *
 * Two kinds of drawing:
 *  - a model's own, drawn to its real size and shape. Today one model: the
 *    2011-2020 Toyota Sienna (the two Airlift Northwest vans), in its two
 *    front ends, 2011-2017 and 2018-2020. Figures from its published
 *    dimensions: 5,090 mm long on a 3,030 mm wheelbase, 1,990 mm wide,
 *    1,750 mm tall; the shapes from photographs of the van, redrawn as plain
 *    line art (nothing traced, nobody's drawing copied).
 *  - four general ones for everything else: car, SUV, minivan, pickup.
 * A vehicle starts on its model's drawing when there is one, else on the type
 * its model name suggests; one tap changes it.
 *
 * Each drawing is five views on a 360 x 546 canvas: left side, right side,
 * front, rear, top. A mark is a point on that canvas plus the words for where
 * it is ("Left sliding door"), worked out HERE when the mark is placed and
 * stored with it. So the words on a finished report never depend on this file
 * staying the same; only the picture under the highlights does, and the
 * drawing's id is stored with the marks ("sienna18-1") so an old report keeps
 * its own drawing if one is ever replaced (a new drawing gets a new id,
 * "sienna18-2", and the old one stays).
 *
 * No React, no database: the drawing is components/DamageChart.tsx.
 */

export const CHART_W = 360
export const CHART_H = 546

export type BodyStyle = 'sedan' | 'suv' | 'minivan' | 'pickup' | 'sienna11' | 'sienna18'

/** The four general drawings, offered for every vehicle. */
export const BODY_STYLES: { value: BodyStyle; label: string }[] = [
  { value: 'sedan', label: 'Car' },
  { value: 'suv', label: 'SUV' },
  { value: 'minivan', label: 'Minivan' },
  { value: 'pickup', label: 'Pickup' },
]

type VehicleWords = { year?: number | null; make?: string | null; model?: string | null; trim?: string | null }

/**
 * A model's own drawing and the vehicles it fits. The third-generation Sienna
 * kept one body from 2011 to 2020 and changed its front end for 2018.
 */
const MODEL_STYLES: { value: BodyStyle; label: string; fits: (v: VehicleWords) => boolean }[] = [
  { value: 'sienna18', label: 'Sienna', fits: (v) => isSienna(v) && (v.year ?? 0) >= 2018 && (v.year ?? 0) <= 2020 },
  { value: 'sienna11', label: 'Sienna', fits: (v) => isSienna(v) && (v.year ?? 0) >= 2011 && (v.year ?? 0) <= 2017 },
]

function isSienna(v: VehicleWords): boolean {
  return /\btoyota\b/.test((v.make ?? '').toLowerCase()) && /\bsienna\b/.test((v.model ?? '').toLowerCase())
}

const ALL_STYLES: BodyStyle[] = ['sedan', 'suv', 'minivan', 'pickup', 'sienna11', 'sienna18']

/** The drawings offered for one vehicle: its model's own first, when there is one, then the four general ones. */
export function stylesFor(v: VehicleWords | null | undefined): { value: BodyStyle; label: string }[] {
  const own = v ? MODEL_STYLES.filter((m) => m.fits(v)).map(({ value, label }) => ({ value, label })) : []
  return [...own, ...BODY_STYLES]
}

/** The id stored with a report's marks: which drawing they were placed on. */
export function chartId(style: BodyStyle): string {
  return `${style}-1`
}

/** The drawing a stored chart id names; null when it names none this build has. */
export function styleOf(chart: string | null | undefined): BodyStyle | null {
  const name = (chart ?? '').split('-')[0] as BodyStyle
  return ALL_STYLES.includes(name) ? name : null
}

// Model names, matched as whole words in lower case. A guess only: it picks
// the drawing a new chart starts on, and one tap changes it.
// Vans come first: a cargo van is nearer the minivan's shape than any other,
// and "Ram ProMaster" must not read as a Ram pickup.
const MINIVANS = /\b(sienna|odyssey|caravan|pacifica|voyager|town (and|&) country|sedona|carnival|quest|venture|uplander|montana|freestar|windstar|transit|promaster|metris|sprinter|express|savana|econoline|e-?[1-3]50|van)\b/
const PICKUPS = /\b(f-?[1-4]50|silverado|sierra|ram|tacoma|tundra|ranger|colorado|canyon|frontier|titan|ridgeline|maverick|gladiator|dakota|s-?10|avalanche|santa cruz|pickup|truck)\b/
const SUVS = /\b(rav4|cr-?v|hr-?v|pilot|passport|highlander|4runner|sequoia|land cruiser|fj cruiser|venza|outback|forester|crosstrek|ascent|tribeca|explorer|escape|edge|expedition|bronco|excursion|flex|tahoe|suburban|yukon|equinox|traverse|blazer|trailblazer|terrain|acadia|envoy|cherokee|wrangler|compass|renegade|liberty|patriot|commander|durango|journey|rogue|pathfinder|murano|armada|xterra|kicks|cx-?[3-9]0?|santa fe|tucson|palisade|kona|sorento|sportage|telluride|seltos|tiguan|atlas|touareg|mdx|rdx|escalade|navigator|aviator|tracker|rodeo|trooper|montero|outlander|element|suv)\b/

/**
 * The drawing a vehicle starts on: its model's own when there is one, else
 * the type its model name suggests, else a car.
 */
export function guessBodyStyle(v: VehicleWords | null | undefined): BodyStyle {
  const own = v ? MODEL_STYLES.find((m) => m.fits(v)) : undefined
  if (own) return own.value
  // The make too: "Ram 1500" is stored as make Ram, model 1500.
  const words = `${v?.make ?? ''} ${v?.model ?? ''} ${v?.trim ?? ''}`.toLowerCase()
  if (MINIVANS.test(words)) return 'minivan'
  if (PICKUPS.test(words)) return 'pickup'
  if (SUVS.test(words)) return 'suv'
  return 'sedan'
}

export type DamageKind = 'dent' | 'scratch' | 'chip' | 'crack' | 'rust' | 'broken' | 'other'

export const DAMAGE_KINDS: { value: DamageKind; label: string }[] = [
  { value: 'dent', label: 'Dent' },
  { value: 'scratch', label: 'Scratch' },
  { value: 'chip', label: 'Chip' },
  { value: 'crack', label: 'Crack' },
  { value: 'rust', label: 'Rust' },
  { value: 'broken', label: 'Broken or missing' },
  { value: 'other', label: 'Other' },
]
export const DAMAGE_KIND_LABEL: Record<DamageKind, string> = Object.fromEntries(
  DAMAGE_KINDS.map((k) => [k.value, k.label]),
) as Record<DamageKind, string>

/** One highlighted place on the vehicle. x and y are on the 360 x 546 canvas. */
export interface DamageMark {
  id: string
  x: number
  y: number
  kind: DamageKind
  /** Where it is, in words, fixed when it was placed. */
  where: string
  note?: string | null
}

export type ChartView = 'left' | 'right' | 'front' | 'rear' | 'top'

/** Each view's box on the canvas, and the label printed over it. The same for every drawing. */
export const VIEWS: Record<ChartView, { x: number; y: number; w: number; h: number; label: string }> = {
  left: { x: 10, y: 20, w: 340, h: 110, label: 'Left side' },
  right: { x: 10, y: 156, w: 340, h: 110, label: 'Right side' },
  front: { x: 10, y: 292, w: 160, h: 100, label: 'Front' },
  rear: { x: 190, y: 292, w: 160, h: 100, label: 'Rear' },
  top: { x: 10, y: 418, w: 340, h: 120, label: 'Top' },
}

/** [where this part ends, its name], front to rear; the last one runs to the end. */
type Cuts = [number, string][]

/**
 * What differs between the drawings: where the wheels are, where each part
 * ends along the side and from above, where the roof edge is, how the front
 * and rear divide, and what the panel between the tail lights is called.
 * components/DamageChart draws to the same numbers.
 */
export interface StyleGeometry {
  /** Side view, front at x = 0: the two wheel centres. */
  wheels: [number, number]
  side: Cuts
  /** The roof edge on a side view: from x, to x, above y. */
  roof: [number, number, number]
  /** Front view, top to bottom: where the windshield, the hood and the lamp row end;
   *  the lamp row's middle (the grille) from x to x; the mirrors' y range and how far in they reach. */
  front: { glass: number; hood: number; lamps: number; grille: [number, number]; mirror: [number, number, number, number] }
  /** Rear view: where the window and the panel end; the tail lights reach in to these x, down to this y. */
  rear: { glass: number; panel: number; lamps: [number, number, number]; name: string }
  /** Top view, front at x = 0. */
  top: Cuts
  /** Top view: where the mirrors sit along the body. */
  mirrorX: number
}

/** The side view's wheel height: the same on every drawing. */
export const WHEEL_Y = 86

const GENERAL_FRONT = { glass: 46, hood: 53, lamps: 68, grille: [54, 106] as [number, number], mirror: [36, 52, 16, 144] as [number, number, number, number] }
const generalRear = (name: string) => ({ glass: 44, panel: 68, lamps: [32, 128, 68] as [number, number, number], name })

/** The 2011-2020 Sienna: one body for both front ends. */
const SIENNA: StyleGeometry = {
  wheels: [77, 256],
  side: [[34, 'front bumper'], [106, 'front fender'], [165, 'front door'], [236, 'sliding door'], [310, 'quarter panel'], [Infinity, 'rear bumper']],
  roof: [140, 300, 9],
  front: { glass: 41, hood: 50, lamps: 62, grille: [54, 106], mirror: [34, 46, 27, 133] },
  rear: { glass: 40, panel: 66, lamps: [54, 106, 52], name: 'Liftgate' },
  top: [[30, 'Front bumper'], [79, 'Hood'], [137, 'Windshield'], [298, 'Roof'], [316, 'Rear window'], [Infinity, 'Rear bumper']],
  mirrorX: 106,
}

export const GEOMETRY: Record<BodyStyle, StyleGeometry> = {
  // Long and low, with a trunk.
  sedan: {
    wheels: [84, 258],
    side: [[34, 'front bumper'], [112, 'front fender'], [172, 'front door'], [236, 'rear door'], [312, 'quarter panel'], [Infinity, 'rear bumper']],
    roof: [134, 248, 27],
    front: GENERAL_FRONT,
    rear: generalRear('Trunk lid'),
    top: [[34, 'Front bumper'], [104, 'Hood'], [138, 'Windshield'], [228, 'Roof'], [258, 'Rear window'], [312, 'Trunk lid'], [Infinity, 'Rear bumper']],
    mirrorX: 104,
  },
  // Tall and square, an upright liftgate.
  suv: {
    wheels: [84, 258],
    side: [[38, 'front bumper'], [116, 'front fender'], [170, 'front door'], [238, 'rear door'], [300, 'quarter panel'], [Infinity, 'rear bumper']],
    roof: [132, 296, 13],
    front: GENERAL_FRONT,
    rear: generalRear('Liftgate'),
    top: [[38, 'Front bumper'], [108, 'Hood'], [136, 'Windshield'], [286, 'Roof'], [300, 'Rear window'], [Infinity, 'Rear bumper']],
    mirrorX: 108,
  },
  // One tall box: a short hood, sliding rear doors.
  minivan: {
    wheels: [84, 258],
    side: [[34, 'front bumper'], [110, 'front fender'], [158, 'front door'], [236, 'rear door'], [306, 'quarter panel'], [Infinity, 'rear bumper']],
    roof: [118, 300, 11],
    front: GENERAL_FRONT,
    rear: generalRear('Liftgate'),
    top: [[34, 'Front bumper'], [80, 'Hood'], [120, 'Windshield'], [284, 'Roof'], [304, 'Rear window'], [Infinity, 'Rear bumper']],
    mirrorX: 80,
  },
  // A cab and a bed.
  pickup: {
    wheels: [84, 258],
    side: [[30, 'front bumper'], [112, 'front fender'], [160, 'front door'], [220, 'rear door'], [318, 'bed side'], [Infinity, 'rear bumper']],
    roof: [116, 216, 11],
    front: GENERAL_FRONT,
    rear: generalRear('Tailgate'),
    top: [[30, 'Front bumper'], [98, 'Hood'], [122, 'Windshield'], [206, 'Roof'], [220, 'Rear window'], [326, 'Bed'], [Infinity, 'Rear bumper']],
    mirrorX: 98,
  },
  sienna11: SIENNA,
  sienna18: SIENNA,
}

function cut(cuts: Cuts, x: number): string {
  for (const [end, name] of cuts) if (x < end) return name
  return cuts[cuts.length - 1][1]
}

/** A side view, drawn with the front at x = 0. */
function sideZone(g: StyleGeometry, x: number, y: number): string {
  const near = (cx: number, cy: number, r: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  if (near(g.wheels[0], WHEEL_Y, 23)) return 'front wheel'
  if (near(g.wheels[1], WHEEL_Y, 23)) return 'rear wheel'
  if (y < g.roof[2] && x > g.roof[0] && x < g.roof[1]) return 'roof edge'
  return cut(g.side, x)
}

function sideWords(side: 'Left' | 'Right', zone: string): string {
  // "Front bumper, left side" reads better than "Left front bumper": the
  // bumper is one part, seen here from one side.
  if (zone === 'front bumper' || zone === 'rear bumper')
    return `${zone[0].toUpperCase()}${zone.slice(1)}, ${side.toLowerCase()} side`
  return `${side} ${zone}`
}

/** Facing the vehicle from the front, its right side is on the viewer's left. */
function frontZone(g: StyleGeometry, x: number, y: number): string {
  const f = g.front
  if (y > f.mirror[0] && y < f.mirror[1] && x < f.mirror[2]) return 'Right mirror'
  if (y > f.mirror[0] && y < f.mirror[1] && x > f.mirror[3]) return 'Left mirror'
  if (y < f.glass) return 'Windshield'
  if (y < f.hood) return 'Hood'
  if (y < f.lamps) return x < f.grille[0] ? 'Right headlight' : x > f.grille[1] ? 'Left headlight' : 'Grille'
  return 'Front bumper'
}

/** From behind, left is left. */
function rearZone(g: StyleGeometry, x: number, y: number): string {
  const r = g.rear
  if (y < r.glass) return 'Rear window'
  if (y < r.panel) {
    if (y < r.lamps[2] && x < r.lamps[0]) return 'Left tail light'
    if (y < r.lamps[2] && x > r.lamps[1]) return 'Right tail light'
    return r.name
  }
  return 'Rear bumper'
}

/** From above with the front at x = 0, the vehicle's left side is at the bottom. */
function topZone(g: StyleGeometry, x: number, y: number): string {
  if (x > g.mirrorX - 6 && x < g.mirrorX + 18 && y < 12) return 'Right mirror'
  if (x > g.mirrorX - 6 && x < g.mirrorX + 18 && y > 108) return 'Left mirror'
  return cut(g.top, x)
}

/** Which view a canvas point is in; null between or outside them. */
export function viewAt(x: number, y: number): ChartView | null {
  for (const key of Object.keys(VIEWS) as ChartView[]) {
    const v = VIEWS[key]
    if (x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h) return key
  }
  return null
}

/**
 * The words for a canvas point on one drawing: "Left front door",
 * "Windshield", "Bed". Null when the point is on none of the five views, so a
 * tap in the gap between two of them places nothing.
 */
export function locate(style: BodyStyle, x: number, y: number): string | null {
  const key = viewAt(x, y)
  if (!key) return null
  const g = GEOMETRY[style]
  const v = VIEWS[key]
  const lx = x - v.x
  const ly = y - v.y
  switch (key) {
    case 'left':
      return sideWords('Left', sideZone(g, lx, ly))
    case 'right':
      // The right side is the left side's drawing mirrored: its front is at the right.
      return sideWords('Right', sideZone(g, v.w - lx, ly))
    case 'front':
      return frontZone(g, lx, ly)
    case 'rear':
      return rearZone(g, lx, ly)
    case 'top':
      return topZone(g, lx, ly)
  }
}

/** A mark's line on the report: "Dent · Left front door" (+ the note). */
export function markWords(m: DamageMark): string {
  return `${DAMAGE_KIND_LABEL[m.kind] ?? 'Damage'} · ${m.where}`
}

/** Marks as stored may be anything (jsonb): keep only real ones. */
export function cleanMarks(raw: unknown): DamageMark[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (m): m is DamageMark =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as DamageMark).id === 'string' &&
      Number.isFinite((m as DamageMark).x) &&
      Number.isFinite((m as DamageMark).y) &&
      typeof (m as DamageMark).where === 'string',
  )
}
