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
}

/**
 * The 2011-2020 Toyota Sienna from the side, front at x = 0, to scale: 300
 * units for its 5,090 mm (about 17 mm a unit), so the 3,030 mm wheelbase is
 * 179 units, the 1,750 mm roof is 103 above the ground line (y = 107), and a
 * 235/60R17 tire is 42 across. Its shape, from photographs of the van: a short
 * steep hood running straight into a long raked windshield, a small fixed
 * glass ahead of the front door, the door mirror on the door, one band of
 * glass that tapers up behind the sliding door, the sliding door's track under
 * that last window, tail lights that wrap round at the belt line, roof rails.
 */
const SIENNA_SIDE: SideArt = {
  body: 'M22 90V70Q22 63 30 61L79 45L135 8Q140 5 150 5H296Q306 5 309 12L317 44L320 62V90Q320 95 315 95H280.4A26 26 0 1 0 231.6 95H101.4A26 26 0 1 0 52.6 95H27Q22 95 22 90Z',
  glass: 'M88 44L139 11H292Q302 11 306 22L302 31L240 41Z',
  lines: 'M108 44V31M106 46V95M165 10V95M236 10V69M240 48L306 41M150 53h9M170 53h9M158 2.5H292',
  lamps: 'M24 68L46 58L51 60L30 70ZM298 43L318 45L319 53L300 51Z',
  mirror: 'M109 39h9a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-9z',
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
  sienna11: { body: [20, 320], ws: [79, 135], rw: [300, 314], mirror: 108 },
  sienna18: { body: [20, 320], ws: [79, 135], rw: [300, 314], mirror: 108 },
}

function Side({ style }: { style: BodyStyle }) {
  const s = SIDE[style]
  const [front, rear] = GEOMETRY[style].wheels
  return (
    <>
      <path className="dmg-body" d={s.body} />
      <path className="dmg-glass" d={s.glass} />
      <path className="dmg-line" d={s.lines} />
      <path className="dmg-lamp" d={s.lamps} />
      {s.mirror && <path className="dmg-body" d={s.mirror} />}
      <circle className="dmg-tire" cx={front} cy={WHEEL_Y} r="21" />
      <circle className="dmg-tire" cx={rear} cy={WHEEL_Y} r="21" />
      <circle className="dmg-hub" cx={front} cy={WHEEL_Y} r="9" />
      <circle className="dmg-hub" cx={rear} cy={WHEEL_Y} r="9" />
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
 * unit), so the roof is 97 above the ground line (y = 99). Narrower at the
 * roof than at the belt line, as the van is.
 */
const SIENNA_END_ON = 'M46 4Q80 0 114 4L128 40L135 46V84Q135 89 130 89H30Q25 89 25 84V46L32 40Z'
const SIENNA_TIRES = 'M27 82h14v14a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3ZM119 82h14v14a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3Z'

/**
 * The Sienna's front. 2018-2020: a slim upper grille with the badge and a
 * large lower grille that widens toward the road, fog lights in upright
 * pockets at the corners. 2011-2017: the grille sits between the headlights,
 * wider at the top, over a low slot with round fog lights.
 */
function SiennaFront({ late }: { late: boolean }) {
  return (
    <>
      <path className="dmg-tire" d={SIENNA_TIRES} />
      <path className="dmg-body" d={SIENNA_END_ON} />
      <path className="dmg-glass" d="M49 8Q80 5 111 8L123 40H37Z" />
      <path className="dmg-line" d="M27 50Q80 44 133 50" />
      <path className="dmg-lamp" d="M28 52L52 55L50 60L28 59ZM132 52L108 55L110 60L132 59Z" />
      {late ? (
        <>
          <path className="dmg-line" d="M56 55H104L102 59H58Z" />
          <path className="dmg-lamp" d="M50 64H110L118 82H42Z" />
          <path className="dmg-line" d="M30 68h7v10h-7zM123 68h7v10h-7z" />
        </>
      ) : (
        <>
          <path className="dmg-lamp" d="M54 52H106L101 62H59Z" />
          <path className="dmg-line" d="M57 55.5H103M58.5 59H101.5M46 70H114V77H46Z" />
          <circle className="dmg-line" cx="34" cy="73" r="3.5" />
          <circle className="dmg-line" cx="126" cy="73" r="3.5" />
        </>
      )}
      <circle className="dmg-hub" cx="80" cy={late ? 53 : 57} r="2.6" />
      <path className="dmg-body" d="M17 36h8a2 2 0 0 1 2 2v6h-8a2 2 0 0 1-2-2ZM143 36h-8a2 2 0 0 0-2 2v6h8a2 2 0 0 0 2-2Z" />
    </>
  )
}

/** The Sienna's rear: a wide window under a roof spoiler, tail lights that run across at the belt line. */
function SiennaRear() {
  return (
    <>
      <path className="dmg-tire" d={SIENNA_TIRES} />
      <path className="dmg-body" d={SIENNA_END_ON} />
      <path className="dmg-glass" d="M49 9Q80 6 111 9L122 38H38Z" />
      <path className="dmg-lamp" d="M26 42L52 44V50H27ZM134 42L108 44V50H133Z" />
      <path className="dmg-line" d="M52 46H108M26 66H134M47 6.5Q80 3 113 6.5" />
      <rect className="dmg-line" x="66" y="52" width="28" height="11" rx="2" />
      <rect className="dmg-line" x="32" y="74" width="11" height="4" rx="1" />
      <rect className="dmg-line" x="117" y="74" width="11" height="4" rx="1" />
      <circle className="dmg-hub" cx="80" cy="42" r="2.6" />
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
  if (view === 'left' || view === 'right') return <Side style={style} />
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
