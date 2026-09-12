/** Shimmer placeholders shown while data loads — shaped like the content they replace. */

export function SkeletonList({ rows = 3, height = 68 }: { rows?: number; height?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  )
}

/** The shop board's shape: head, the action lane, the drop-off calendar, two rows of tiles, the chart, recent jobs. */
export function SkeletonDashboard() {
  return (
    <div className="board" aria-busy="true" aria-label="Loading the dashboard">
      <div className="board-head">
        <div className="skeleton h-[46px] w-44" />
        <div className="skeleton h-11 w-28" />
      </div>
      <div className="lane">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-11" />
        ))}
      </div>
      {/* .cal carries the calendar's board slot (full width, right after the lane). */}
      <div className="skeleton cal h-[300px]" />
      <div className="board-tiles">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={`skeleton h-[136px]${i >= 5 ? ' tile--wide' : ''}`} />
        ))}
      </div>
      <div className="skeleton board-chart h-[220px]" />
      <div className="recent">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-[72px]" />
        ))}
      </div>
    </div>
  )
}
