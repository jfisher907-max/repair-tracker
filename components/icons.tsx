import type { ReactNode } from 'react'

/**
 * The app's own icons (owner, 2026-11-16: "create custom icons for it").
 *
 * They replace the emoji in the phone's bottom bar, which were the system's
 * drawings and looked different on every phone, and they label the Search
 * screen's rows and shortcuts.
 *
 * ONE HAND, so they read as a set:
 *  - a 24 x 24 grid, drawn inside a 2px margin;
 *  - a single 1.75 stroke with round ends, in `currentColor`, so an icon takes
 *    its colour from the text around it (gold on the lit tab, muted elsewhere);
 *  - one soft "tone" shape under the lines (class .icon-tone), the body of the
 *    thing drawn. It is what makes them sit on glass instead of floating as
 *    wire. Its strength is the CSS variable --icon-tone, which the lit tab
 *    turns up; nothing here hard-codes a colour.
 *
 * Decorative by default (aria-hidden): every use sits beside its own words.
 */

export type IconName =
  | 'home'
  | 'jobs'
  | 'people'
  | 'billing'
  | 'search'
  | 'plus'
  | 'followups'
  | 'requests'
  | 'expenses'
  | 'reports'
  | 'taxes'
  | 'hangar'
  | 'share'
  | 'settings'
  | 'vehicle'
  | 'person'
  | 'quote'
  | 'recent'

/** A filled shape under the lines. */
function Tone({ d }: { d: string }) {
  return <path className="icon-tone" d={d} fill="currentColor" stroke="none" />
}

const HOUSE = 'M3 10.6 12 4l9 6.6V20H3z'
const WRENCH_HEAD = 'M10.2 2.4a4.3 4.3 0 1 0 3.6 0v3.2h-3.6z'
const PERSON_BODY = 'M3.4 20a6.6 6.6 0 0 1 13.2 0z'
const RECEIPT = 'M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z'
const TRAY = 'M3.5 13 6.2 5.5h11.6L20.5 13v5.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z'
const CARD = 'M3.5 6.5h17a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z'
const BELL = 'M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5z'
const PLANE =
  'M12 2.5c.9 0 1.5 1.2 1.5 2.6V9l7 4.2v1.9l-7-2v4.4l2.2 1.8v1.4L12 19.8l-3.7.9v-1.4l2.2-1.8v-4.4l-7 2v-1.9l7-4.2V5.1c0-1.4.6-2.6 1.5-2.6z'
const CAR_BODY = 'M4.5 10.5h15a1 1 0 0 1 1 1v5h-17v-5a1 1 0 0 1 1-1z'
const PAGE = 'M7 3.5h7.5l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z'

const ICONS: Record<IconName, ReactNode> = {
  // The shop itself: a pitched roof over a roll-up bay door.
  home: (
    <>
      <Tone d={HOUSE} />
      <path d={HOUSE} />
      <path d="M8 20v-6.5h8V20M8 16.7h8" />
    </>
  ),
  // An open-end wrench, drawn upright and turned to the classic angle.
  jobs: (
    <g transform="rotate(45 12 12)">
      <Tone d={WRENCH_HEAD} />
      <path d={WRENCH_HEAD} />
      <path d="M10.6 10.3v9.3a1.4 1.4 0 0 0 2.8 0v-9.3" />
    </g>
  ),
  // A customer, with a second one behind: the People list.
  people: (
    <>
      <Tone d={PERSON_BODY} />
      <circle className="icon-tone" cx="10" cy="8" r="3.4" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r="3.4" />
      <path d={PERSON_BODY} />
      <path d="M16.2 4.9a3.1 3.1 0 0 1 0 6M18.6 14.1a6 6 0 0 1 2.4 4.9" />
    </>
  ),
  // A torn-off receipt.
  billing: (
    <>
      <Tone d={RECEIPT} />
      <path d={RECEIPT} />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </>
  ),
  search: (
    <>
      <circle className="icon-tone" cx="10.8" cy="10.8" r="6.3" fill="currentColor" stroke="none" />
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.6 15.6 4.9 4.9" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" strokeWidth={2.2} />,
  followups: (
    <>
      <Tone d={BELL} />
      <path d={BELL} />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  // An in-tray: what the public form drops into.
  requests: (
    <>
      <Tone d={TRAY} />
      <path d={TRAY} />
      <path d="M3.5 13h5a3.5 3.5 0 0 0 7 0h5" />
    </>
  ),
  expenses: (
    <>
      <Tone d={CARD} />
      <path d={CARD} />
      <path d="M2.5 10.5h19M6.5 14.5H10" />
    </>
  ),
  reports: (
    <>
      <Tone d="M6 13h3v7H6zM10.5 8h3v12h-3zM15 4.5h3V20h-3z" />
      <path d="M6 13h3v7H6zM10.5 8h3v12h-3zM15 4.5h3V20h-3zM3.5 20h17" />
    </>
  ),
  taxes: (
    <>
      <circle className="icon-tone" cx="12" cy="12" r="8.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.8 15.2 6.4-6.4" />
      <circle cx="9" cy="9" r="1.1" />
      <circle cx="15" cy="15" r="1.1" />
    </>
  ),
  // An aircraft seen from above: the hangar board, and aircraft in a search.
  hangar: (
    <>
      <Tone d={PLANE} />
      <path d={PLANE} />
    </>
  ),
  // The corner of a QR code: the Share form page.
  share: (
    <>
      <Tone d="M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6z" />
      <path d="M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h2.5V16h-2.5zM19.5 13.5v2.2M16.6 19.5h2.9M13.5 19v.5" />
    </>
  ),
  // Sliders, not a cog: three settings, each set to something.
  settings: (
    <>
      <path d="M4 7h2.6M11.4 7H20M4 12h8.6M17.4 12H20M4 17h1.6M10.4 17H20" />
      <circle className="icon-tone" cx="9" cy="7" r="2.4" fill="currentColor" stroke="none" />
      <circle className="icon-tone" cx="15" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <circle className="icon-tone" cx="8" cy="17" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="7" r="2.4" />
      <circle cx="15" cy="12" r="2.4" />
      <circle cx="8" cy="17" r="2.4" />
    </>
  ),
  // A car, head on.
  vehicle: (
    <>
      <Tone d={CAR_BODY} />
      <path d="M6.2 10.5 7.8 6.4a1.5 1.5 0 0 1 1.4-.9h5.6a1.5 1.5 0 0 1 1.4.9l1.6 4.1" />
      <path d={CAR_BODY} />
      <path d="M5.5 16.5v1.8a.9.9 0 0 0 .9.9h1.7a.9.9 0 0 0 .9-.9v-1.8M15 16.5v1.8a.9.9 0 0 0 .9.9h1.7a.9.9 0 0 0 .9-.9v-1.8" />
      <circle cx="7.3" cy="13.5" r=".9" />
      <circle cx="16.7" cy="13.5" r=".9" />
    </>
  ),
  person: (
    <>
      <Tone d="M4.8 20a7.2 7.2 0 0 1 14.4 0z" />
      <circle className="icon-tone" cx="12" cy="8" r="3.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0z" />
    </>
  ),
  // A page with a tick: an estimate waiting on a yes.
  quote: (
    <>
      <Tone d={PAGE} />
      <path d={PAGE} />
      <path d="M14.5 3.5v4h4M9 12h6M9.2 16.2l1.7 1.7 3.6-3.9" />
    </>
  ),
  recent: (
    <>
      <circle className="icon-tone" cx="12" cy="12" r="8.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
}

export default function Icon({
  name,
  size = 22,
  className,
}: {
  name: IconName
  /** Rendered width and height in px. The drawing is always the 24-unit grid. */
  size?: number
  className?: string
}) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}

/** Every icon, for the sheet that shows them side by side. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[]
