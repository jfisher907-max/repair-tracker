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

export function SkeletonDashboard() {
  return (
    <div className="space-y-5">
      <div className="skeleton h-9 w-40" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-[76px]" />
        ))}
      </div>
      <SkeletonList rows={3} />
    </div>
  )
}
