import { ImageResponse } from 'next/og'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

/** Home-screen icon: the Flight Bars wing mark, matching the document letterhead. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="512" height="512" viewBox="0 0 40 40">
          <rect width="40" height="40" rx="9" fill="#f59e0b" />
          <polygon fill="#1c1917" points="8,21.5 8,17.5 32,4.5 32,8.5" />
          <polygon fill="#1c1917" points="8,28 8,24 25.5,14.5 25.5,18.5" />
          <polygon fill="#1c1917" points="8,34.5 8,30.5 19,24.5 19,28.5" />
        </svg>
      </div>
    ),
    size,
  )
}
