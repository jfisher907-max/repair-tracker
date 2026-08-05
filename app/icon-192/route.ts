import { createElement } from 'react'
import { ImageResponse } from 'next/og'

export const dynamic = 'force-static'

// Route handlers are .ts (no JSX), so the icon markup is built with
// createElement. Flight Bars wing mark, matching app/icon.tsx.
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
        },
      },
      createElement(
        'svg',
        { width: 192, height: 192, viewBox: '0 0 40 40' },
        createElement('rect', { width: 40, height: 40, rx: 9, fill: '#f59e0b' }),
        createElement('polygon', { fill: '#1c1917', points: '8,21.5 8,17.5 32,4.5 32,8.5' }),
        createElement('polygon', { fill: '#1c1917', points: '8,28 8,24 25.5,14.5 25.5,18.5' }),
        createElement('polygon', { fill: '#1c1917', points: '8,34.5 8,30.5 19,24.5 19,28.5' }),
      ),
    ),
    { width: 192, height: 192 },
  )
}
