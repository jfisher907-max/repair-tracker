'use client'

// Shared scrim + card wrapper for the Hangar section's dialogs.
//
// Portalled to <body> (components/Overlay.tsx): these dialogs are opened from
// inside a JetCard, and a glass card is a backdrop-filter, which would make
// itself the containing block for this fixed element and leave the dialog
// measuring the card instead of the screen.

import Overlay from '@/components/Overlay'

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
    <Overlay>
      <div
        className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="glass-dialog panel-in max-h-[90dvh] w-full max-w-md overflow-y-auto p-4">
          <div className="section-title mb-3">{title}</div>
          {children}
        </div>
      </div>
    </Overlay>
  )
}
