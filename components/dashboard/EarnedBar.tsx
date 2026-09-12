'use client'

import type { CSSProperties } from 'react'
import { money } from './format'

/**
 * The gap bar inside the Cash profit tile: earned on the work, split into the
 * part that is cash in hand and the part still owed. It is the one picture
 * that answers "why is profit so small" without reading a caption.
 */
export default function EarnedBar({
  earned,
  cashProfit,
  unpaid,
}: {
  earned: number
  cashProfit: number
  unpaid: number
}) {
  if (earned <= 0) {
    return <div className="gap-legend">nothing earned on the work yet</div>
  }
  const inHand = Math.max(0, Math.min(1, cashProfit / earned))
  const owed = Math.max(0, Math.min(1 - inHand, unpaid / earned))
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`
  return (
    <>
      <div
        className="gap-bar"
        role="img"
        aria-label={`Earned ${money(earned)}: cash profit ${money(cashProfit)} in hand, ${money(unpaid)} still owed`}
      >
        {inHand > 0 && <i className="gap-in" style={{ '--w': pct(inHand), '--i': 0 } as CSSProperties} />}
        {owed > 0 && <i className="gap-owed" style={{ '--w': pct(owed), '--i': 1 } as CSSProperties} />}
      </div>
      <div className="gap-legend" aria-hidden="true">
        <span>
          <i className="legend-sw sw-in" />
          in hand <b>{money(cashProfit)}</b>
        </span>
        <span>
          <i className="legend-sw sw-owed" />
          owed <b>{money(unpaid)}</b>
        </span>
      </div>
    </>
  )
}
