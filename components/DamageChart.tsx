'use client'

import type { MouseEvent } from 'react'
import {
  CHART_H,
  CHART_W,
  GEOMETRY,
  VIEWS,
  WHEEL_Y,
  locate,
  type BodyStyle,
  type ChartView,
  type DamageMark,
} from '@/lib/damage-chart'

/**
 * The body damage chart's drawing: five views of the vehicle being inspected
 * with each damaged place highlighted and numbered. lib/damage-chart owns the
 * geometry and the words; this file draws to the same numbers.
 *
 * A model's own drawing where there is one (the 2011-2020 Toyota Sienna, in
 * both of its front ends), else one of four general types: car, SUV, minivan,
 * pickup.
 *
 * One drawing for both places it appears, so the highlights a customer sees
 * sit exactly where the owner put them: the inspection's own page (dark glass,
 * taps place one) and the printed report (white paper, read only). Lines take
 * the text colour around them; only the highlights carry a colour of their own.
 */

const PIN = '#d92d20'

interface SideArt {
  body: string
  glass: string
  lines: string
  lamps: string
  /** The door mirror, where the drawing has one. */
  mirror?: string
  /** Drawn on the left side only (the fuel door): the right side is the left's mirror image. */
  leftOnly?: string
  /** The wheel's rim, when the drawing shows one inside the tire. */
  rim?: number
}

/**
 * The 2011-2020 Toyota Sienna from the side, front at x = 0.
 *
 * To scale: 300 units for its 5,090 mm (about 17 mm a unit), so the 3,030 mm
 * wheelbase is 179 units, the 1,750 mm roof is 103 above the ground line
 * (y = 107), and a 235/60R17 tire is 42 across.
 *
 * Its outline was measured, point by point, off a side-on photograph of the
 * van (owner, 2026-11-27: "you're a bit off with the design and details"),
 * using the wheelbase as the ruler: the nose and the short hood that runs
 * straight into a long curved windshield; the roof; the raked liftgate under
 * its spoiler; the glass as one band from the small fixed pane ahead of the
 * front door to the point behind the last window, its lower edge rising to the
 * rear; the front door's leading edge and the sliding door's trailing edge,
 * each swept along its wheel arch; both handles either side of the centre
 * pillar; the mirror on the door; the slim headlight along the hood edge; the
 * tail light wrapped round the corner at the belt line; the fuel door (left
 * side only). The line under the last window is the sliding door's track.
 */
const SIENNA_SIDE: SideArt = {
  body: 'M22 80C21 74 22 68 26 62L34 56L57 46.8L85.5 34.5Q108 16 134.7 7.1Q144 5 153 4.6L190 3.5L280 4Q296 4.5 301.7 6.5L307.9 22.2L313.2 35.6L317 46Q319.5 54 319.5 62V69Q319 80 312 88L280.3 90A24.6 24.6 0 1 0 232.9 94.4H100.1A24.6 24.6 0 1 0 52.8 90.5H30Q24 88 22 80Z',
  glass: 'M86 40.6Q108 22 135 10.3L165 7.1L242 6L284 9Q290 10.5 291.5 15L295.6 26.5Q295 31.5 289 34L242 36L98 42.5Z',
  lines:
    // Fixed pane, front door edge, centre pillar, sliding door edge, its track, the two handles.
    'M98.5 31.5V42.4M97.6 42.6Q99 64 103.8 87L105 94.4M166.2 5.2V94.4M242.5 6V37Q241.5 60 234.2 80.3L231.4 89M244 38.2L291 36M148 46.2h14M168.5 45.6h14.5',
  lamps: 'M36.5 56.5L57.5 48L58.5 51.2L42 59.6ZM292.6 40.5L300 37L314.2 36.5L316.8 45L299 44.5Z',
  mirror: 'M104.5 28h6.5a2.2 2.2 0 0 1 2.2 2.2v3.6a2.2 2.2 0 0 1-2.2 2.2h-6.5Z',
  leftOnly: 'M253 40h10.4a1.6 1.6 0 0 1 1.6 1.6v7.8a1.6 1.6 0 0 1-1.6 1.6H253a1.6 1.6 0 0 1-1.6-1.6v-7.8A1.6 1.6 0 0 1 253 40Z',
  rim: 13.5,
}

/**
 * Each drawing's side view, front at x = 0. The general four are drawn to a
 * type's proportions: about three times as long as tall, a car longer and
 * lower than that.
 */
const SIDE: Record<BodyStyle, SideArt> = {
  // Three boxes: hood, cabin, trunk. Long and low.
  sedan: {
    body: 'M14 84V70Q16 62 34 59L96 54L134 26Q140 22 152 22H212Q230 22 246 38L258 50L312 54Q320 56 322 66V84H284A26 26 0 0 0 232 84H110A26 26 0 0 0 58 84Z',
    glass: 'M106 53L136 28L212 27Q228 29 240 44L246 53Z',
    lines: 'M172 27V80M112 54V62M234 52V60M160 60h8M180 60h8',
    lamps: 'M16 66L32 62V68L16 71ZM312 58L321 62V67L312 65Z',
  },
  // Tall and square: a long flat hood, an upright liftgate, more air under it.
  suv: {
    body: 'M22 80V56Q23 48 38 46L104 42L130 12Q134 8 144 8H288Q298 8 300 18L306 46L308 54V80H284A26 26 0 0 0 232 80H110A26 26 0 0 0 58 80Z',
    glass: 'M112 41L134 15L284 14Q292 16 296 38V41Z',
    lines: 'M170 14V76M238 14V60M116 42V58M158 50h8M178 50h8',
    lamps: 'M24 52L38 48V54L24 57ZM298 22L304 40H299L295 26Z',
  },
  // One tall box: a short hood running into a long raked windshield, sliding doors.
  minivan: {
    body: 'M20 84V62Q21 54 34 50L72 44L116 9Q120 6 130 6H282Q300 6 306 20L312 52L314 84H284A26 26 0 0 0 232 84H110A26 26 0 0 0 58 84Z',
    glass: 'M82 43L120 13L280 12Q294 14 300 34V43Z',
    lines: 'M158 12V80M236 12V60M110 44V58M148 52h8M166 52h8M166 62H230',
    lamps: 'M22 58L34 54V60L22 63ZM304 26L310 46H305L301 30Z',
  },
  // A cab and a bed.
  pickup: {
    body: 'M8 82V56Q9 48 26 46L92 42L114 10Q118 6 128 6H206Q216 6 218 16L220 44H330Q334 44 334 50V82H284A26 26 0 0 0 232 82H110A26 26 0 0 0 58 82Z',
    glass: 'M100 41L118 13L204 12Q210 14 212 41Z',
    lines: 'M160 12V78M220 44V60M112 42V58M148 50h8M170 50h8',
    lamps: 'M10 52L26 48V54L10 57ZM327 48H333V62H327Z',
  },
  sienna11: SIENNA_SIDE,
  sienna18: SIENNA_SIDE,
}

/**
 * Each drawing from above: where the body starts and ends, the windshield and
 * rear window from x to x, the roof between them, where the mirrors sit, a bed
 * on the pickup.
 */
const TOP: Record<BodyStyle, { body: [number, number]; ws: [number, number]; rw: [number, number]; mirror: number; bed?: [number, number] }> = {
  sedan: { body: [14, 322], ws: [104, 136], rw: [228, 256], mirror: 106 },
  suv: { body: [22, 308], ws: [108, 134], rw: [286, 298], mirror: 110 },
  minivan: { body: [20, 314], ws: [80, 118], rw: [284, 302], mirror: 82 },
  pickup: { body: [8, 334], ws: [98, 120], rw: [206, 218], mirror: 100, bed: [226, 326] },
  // The same stations as its side view: cowl, windshield top, liftgate glass.
  sienna11: { body: [21, 320], ws: [86, 135], rw: [302, 314], mirror: 100 },
  sienna18: { body: [21, 320], ws: [86, 135], rw: [302, 314], mirror: 100 },
}

function Side({ style, left }: { style: BodyStyle; left: boolean }) {
  const s = SIDE[style]
  const [front, rear] = GEOMETRY[style].wheels
  return (
    <>
      <path className="dmg-body" d={s.body} />
      <path className="dmg-glass" d={s.glass} />
      <path className="dmg-line" d={s.lines} />
      <path className="dmg-lamp" d={s.lamps} />
      {s.mirror && <path className="dmg-body" d={s.mirror} />}
      {left && s.leftOnly && <path className="dmg-line" d={s.leftOnly} />}
      <circle className="dmg-tire" cx={front} cy={WHEEL_Y} r="21" />
      <circle className="dmg-tire" cx={rear} cy={WHEEL_Y} r="21" />
      <circle className="dmg-hub" cx={front} cy={WHEEL_Y} r={s.rim ?? 9} />
      <circle className="dmg-hub" cx={rear} cy={WHEEL_Y} r={s.rim ?? 9} />
      {s.rim && (
        <>
          <circle className="dmg-hub" cx={front} cy={WHEEL_Y} r="3.5" />
          <circle className="dmg-hub" cx={rear} cy={WHEEL_Y} r="3.5" />
        </>
      )}
    </>
  )
}

const TIRES = 'M18 82h22v10a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2ZM120 82h22v10a2 2 0 0 1-2 2H122a2 2 0 0 1-2-2Z'
const BODY_END_ON = 'M30 14Q80 6 130 14L142 46L146 50V80Q146 84 142 84H18Q14 84 14 80V50L18 46Z'

function Front() {
  return (
    <>
      <path className="dmg-tire" d={TIRES} />
      <path className="dmg-body" d={BODY_END_ON} />
      <path className="dmg-glass" d="M36 18Q80 12 124 18L134 44H26Z" />
      <path className="dmg-line" d="M16 50H144M16 70H144" />
      <rect className="dmg-line" x="58" y="56" width="44" height="10" rx="3" />
      <rect className="dmg-lamp" x="20" y="54" width="30" height="10" rx="4" />
      <rect className="dmg-lamp" x="110" y="54" width="30" height="10" rx="4" />
      <rect className="dmg-line" x="50" y="73" width="60" height="6" rx="2" />
      <rect className="dmg-body" x="3" y="40" width="11" height="8" rx="2" />
      <rect className="dmg-body" x="146" y="40" width="11" height="8" rx="2" />
    </>
  )
}

function Rear() {
  return (
    <>
      <path className="dmg-tire" d={TIRES} />
      <path className="dmg-body" d={BODY_END_ON} />
      <path className="dmg-glass" d="M38 18Q80 12 122 18L130 42H30Z" />
      <path className="dmg-line" d="M16 70H144M30 46H130" />
      <rect className="dmg-lamp" x="16" y="46" width="12" height="20" rx="3" />
      <rect className="dmg-lamp" x="132" y="46" width="12" height="20" rx="3" />
      <rect className="dmg-line" x="64" y="54" width="32" height="12" rx="2" />
    </>
  )
}

/**
 * The Sienna end on, to scale: 110 units for its 1,990 mm (about 18 mm a
 * unit), so the roof is 97 above the ground line (y = 99). Heights and widths
 * were measured off front-on and rear-on photographs of the van and checked
 * against the side view's own stations: windshield from 8 to 34, hood down to
 * 50, the rear window down to 33 with the tail lights under its corners, the
 * bumper top at 57. Narrower at the roof than at the belt line, as the van is.
 */
const SIENNA_END_ON = 'M44 5.5Q80 1.5 116 5.5L128 33Q133.5 36.5 135 42V78Q135 84 129 84H31Q25 84 25 78V42Q26.5 36.5 32 33Z'
const SIENNA_TIRES = 'M26 80h13v16a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3ZM121 80h13v16a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3Z'
const SIENNA_MIRRORS = 'M26 28.5h-9a2 2 0 0 0-2 2v4.5a2 2 0 0 0 2 2h10ZM134 28.5h9a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2h-10Z'

/**
 * The Sienna's front. Both years: a tall, wide windshield over a short hood
 * with two creases, headlights swept back from the grille.
 * 2018-2020: slim headlights joined by a narrow slot with the badge; below it
 * one large barred grille that widens toward the road and carries the plate,
 * with an upright pocket at each corner.
 * 2011-2017: a barred grille between the headlights, wider at the top, with
 * the badge on its upper edge; the plate on the bumper below it; a low barred
 * intake with a round fog light at each end.
 */
function SiennaFront({ late }: { late: boolean }) {
  return (
    <>
      <path className="dmg-tire" d={SIENNA_TIRES} />
      <path className="dmg-body" d={SIENNA_END_ON} />
      <path className="dmg-glass" d="M46.5 8Q80 5 113.5 8L126 34.5Q80 31.5 34 34.5Z" />
      {/* The hood's leading edge and its two creases. */}
      <path className="dmg-line" d="M29.5 46Q80 51.5 130.5 46M57 34L61 49.6M103 34L99 49.6" />
      {late ? (
        <>
          <path className="dmg-lamp" d="M27.5 46L55 50L56.5 54.5L33 54.5Q28.5 52 27.5 46ZM132.5 46L105 50L103.5 54.5L127 54.5Q131.5 52 132.5 46Z" />
          <path className="dmg-line" d="M57.5 51.2H102.5V54.2H57.5Z" />
          <path className="dmg-lamp" d="M58 59H102L114 81.5H46Z" />
          <path className="dmg-line" d="M55.6 63.5H104.4M53.2 68H106.8M50.8 72.5H109.2M48.4 77H111.6" />
          <rect className="dmg-body" x="69" y="62" width="22" height="7.5" rx="1" />
          <path className="dmg-line" d="M28.5 63L38.5 61L41 77L30.5 78ZM131.5 63L121.5 61L119 77L129.5 78Z" />
          <circle className="dmg-body" cx="80" cy="52.7" r="2.8" />
        </>
      ) : (
        <>
          <path className="dmg-lamp" d="M27.5 45L52 48.5L54 57L33 56Q28 53 27.5 45ZM132.5 45L108 48.5L106 57L127 56Q132 53 132.5 45Z" />
          <path className="dmg-lamp" d="M51 50H109L102 61H58Z" />
          <path className="dmg-line" d="M52.9 53H107.1M54.8 56H105.2M56.7 59H103.3M50.5 75H109.5L107 82.5H53ZM51.4 77.5H108.6M52.2 80H107.8" />
          <rect className="dmg-body" x="67.5" y="65.5" width="25" height="8" rx="1" />
          <circle className="dmg-line" cx="34.3" cy="78" r="3.8" />
          <circle className="dmg-line" cx="125.7" cy="78" r="3.8" />
          <circle className="dmg-body" cx="80" cy="50.3" r="3" />
        </>
      )}
      <path className="dmg-body" d={SIENNA_MIRRORS} />
    </>
  )
}

/**
 * The Sienna's rear: a wide window under the roof spoiler, its lower edge
 * dipping in the middle, with the wiper; a tail light under each lower corner
 * of the glass, running in from the body side to a point; the badge between
 * the points; a trim bar over the plate; the bumper's step; a reflector low at
 * each side.
 */
function SiennaRear() {
  return (
    <>
      <path className="dmg-tire" d={SIENNA_TIRES} />
      <path className="dmg-body" d={SIENNA_END_ON} />
      <path className="dmg-glass" d="M46 8.5Q80 6 114 8.5L123.5 31Q80 36 36.5 31Z" />
      <path className="dmg-lamp" d="M26 32.5L47 32L52 37.5L46 43L27 43.5ZM134 32.5L113 32L108 37.5L114 43L133 43.5Z" />
      <path
        className="dmg-line"
        d="M46 5.7Q80 2.7 114 5.7M80 33L98 28.5M56 42.5H104V45H56ZM37.5 43.5L36 57M122.5 43.5L124 57M26 57H134M48 60H112"
      />
      <rect className="dmg-line" x="66" y="46.2" width="28" height="8.6" rx="1.5" />
      <rect className="dmg-lamp" x="30" y="73.5" width="11" height="3" rx="1" />
      <rect className="dmg-lamp" x="119" y="73.5" width="11" height="3" rx="1" />
      <circle className="dmg-body" cx="80" cy="38.4" r="2.6" />
      <path className="dmg-body" d={SIENNA_MIRRORS} />
    </>
  )
}

/** From above, front at x = 0. */
function Top({ style }: { style: BodyStyle }) {
  const { body, ws, rw, mirror, bed } = TOP[style]
  const roofFrom = ws[1] + 6
  const roofTo = rw[0] - 4
  return (
    <>
      <rect className="dmg-body" x={mirror} y="1" width="12" height="11" rx="3" />
      <rect className="dmg-body" x={mirror} y="108" width="12" height="11" rx="3" />
      <rect className="dmg-body" x={body[0]} y="10" width={body[1] - body[0]} height="100" rx="30" />
      <path className="dmg-glass" d={`M${ws[0]} 18Q${ws[0] - 8} 60 ${ws[0]} 102L${ws[1]} 94Q${ws[1] - 6} 60 ${ws[1]} 26Z`} />
      <path className="dmg-glass" d={`M${rw[1]} 22Q${rw[1] + 6} 60 ${rw[1]} 98L${rw[0]} 92Q${rw[0] + 4} 60 ${rw[0]} 28Z`} />
      <rect className="dmg-line" x={roofFrom} y="24" width={roofTo - roofFrom} height="72" rx="8" />
      {bed && <rect className="dmg-line" x={bed[0]} y="18" width={bed[1] - bed[0]} height="84" rx="4" />}
      <path className="dmg-line" d={`M${body[0] + 26} 16Q${body[0] + 16} 60 ${body[0] + 26} 104`} />
    </>
  )
}

function View({ view, style }: { view: ChartView; style: BodyStyle }) {
  const sienna = style === 'sienna11' || style === 'sienna18'
  if (view === 'left' || view === 'right') return <Side style={style} left={view === 'left'} />
  if (view === 'front') return sienna ? <SiennaFront late={style === 'sienna18'} /> : <Front />
  if (view === 'rear') return sienna ? <SiennaRear /> : <Rear />
  return <Top style={style} />
}

export default function DamageChart({
  body: style,
  marks,
  pending,
  onPlace,
  className,
}: {
  /** Which drawing: a model's own, or one of the four general types. */
  body: BodyStyle
  marks: DamageMark[]
  /** A place tapped and not yet named: drawn hollow. */
  pending?: { x: number; y: number } | null
  /** Given: taps place a highlight. Absent: the chart is read only. */
  onPlace?: (x: number, y: number, where: string) => void
  className?: string
}) {
  function tap(e: MouseEvent<SVGSVGElement>) {
    if (!onPlace) return
    const box = e.currentTarget.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    const x = Math.round(((e.clientX - box.left) / box.width) * CHART_W * 10) / 10
    const y = Math.round(((e.clientY - box.top) / box.height) * CHART_H * 10) / 10
    const where = locate(style, x, y)
    // A tap in the gap between two drawings is on no part of the vehicle.
    if (where) onPlace(x, y, where)
  }

  return (
    <svg
      className={`dmg-chart${onPlace ? ' is-live' : ''}${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      data-style={style}
      role="img"
      aria-label={
        marks.length === 0
          ? 'Vehicle diagram: left side, right side, front, rear and top. No damage marked.'
          : `Vehicle diagram with ${marks.length} place${marks.length === 1 ? '' : 's'} highlighted, listed below.`
      }
      onClick={onPlace ? tap : undefined}
    >
      {(Object.keys(VIEWS) as ChartView[]).map((key) => {
        const v = VIEWS[key]
        return (
          <g key={key}>
            <text className="dmg-label" x={v.x} y={v.y - 6}>
              {v.label}
            </text>
            {/* The right side is the left side's drawing, mirrored. */}
            <g transform={key === 'right' ? `translate(${v.x + v.w} ${v.y}) scale(-1 1)` : `translate(${v.x} ${v.y})`}>
              <View view={key} style={style} />
            </g>
          </g>
        )
      })}

      {/* Each damaged place: a soft highlight over the panel, and its number. */}
      {marks.map((m, i) => (
        <g key={m.id} className="dmg-pin">
          <circle cx={m.x} cy={m.y} r="16" fill={PIN} fillOpacity="0.24" />
          <circle cx={m.x} cy={m.y} r="9" fill={PIN} stroke="#ffffff" strokeWidth="1.5" />
          <text x={m.x} y={m.y + 3.6} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#ffffff">
            {i + 1}
          </text>
        </g>
      ))}
      {pending && (
        <circle
          className="dmg-pending"
          cx={pending.x}
          cy={pending.y}
          r="12"
          fill={PIN}
          fillOpacity="0.2"
          stroke={PIN}
          strokeWidth="2.5"
          strokeDasharray="4 3"
        />
      )}
    </svg>
  )
}
