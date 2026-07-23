import { createElement } from 'react'
import { ImageResponse } from 'next/og'

export const dynamic = 'force-static'

// Route handlers are .ts (no JSX), so the icon markup is built with createElement.
export async function GET() {
  return new ImageResponse(
    createElement(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(160deg, #1a212c 0%, #0b0e13 100%)',
          fontSize: 112,
        },
      },
      '🔧',
    ),
    { width: 192, height: 192 },
  )
}
