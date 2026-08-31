'use client'

// Shared scrim + card wrapper for the Hangar section's dialogs, following the
// house pattern of inline fixed-position overlays (see ReceiptPreview).

export default function HangarModal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--scrim-overlay)' }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card panel-in w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="section-title mb-3">{title}</div>
        {children}
      </div>
    </div>
  )
}
