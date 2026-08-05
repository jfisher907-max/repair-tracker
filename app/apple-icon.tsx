import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

/** iOS home-screen icon — iOS rounds the corners itself, so the tile fills the square. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f59e0b',
        }}
      >
        <svg width="180" height="180" viewBox="0 0 40 40">
          <polygon fill="#1c1917" points="8,21.5 8,17.5 32,4.5 32,8.5" />
          <polygon fill="#1c1917" points="8,28 8,24 25.5,14.5 25.5,18.5" />
          <polygon fill="#1c1917" points="8,34.5 8,30.5 19,24.5 19,28.5" />
        </svg>
      </div>
    ),
    size,
  )
}
