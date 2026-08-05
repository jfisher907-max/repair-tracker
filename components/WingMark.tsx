/**
 * The Wings N Things mark — "Flight Bars": three swept bars, black on an
 * amber tile. Single source of truth for the brand; used on the document
 * letterhead, the app chrome, and mirrored by the PWA icons (app/icon.tsx).
 */
export default function WingMark({
  size = 38,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-hidden="true"
      className={className}
    >
      <rect width="40" height="40" rx="9" fill="#f59e0b" />
      <polygon fill="#1c1917" points="8,21.5 8,17.5 32,4.5 32,8.5" />
      <polygon fill="#1c1917" points="8,28 8,24 25.5,14.5 25.5,18.5" />
      <polygon fill="#1c1917" points="8,34.5 8,30.5 19,24.5 19,28.5" />
    </svg>
  )
}
