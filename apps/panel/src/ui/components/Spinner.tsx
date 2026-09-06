import { useEffect } from 'react'
import { styled, Stack, useTheme } from '@tamagui/core'
import type { GetProps } from '@tamagui/core'
import { ensureKeyframes } from '../lib/keyframes'

// Minimalist spinner — a circular outline with an animated arc. Theme-aware:
// defaults the stroke to `$color` so it reads on both light and dark
// surfaces. Callers can pass an explicit `color` (useful for spinners over
// a branded button).

const KEYFRAMES_ID = 'dag-spinner-keyframes'
const KEYFRAMES_CSS = `
@keyframes dag-spinner-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.dag-spinner-svg { animation: dag-spinner-rotate 0.8s linear infinite; }
`

const SpinnerFrame = styled(Stack, {
  name: 'Spinner',
  alignItems: 'center',
  justifyContent: 'center',

  variants: {
    size: {
      sm: { width: 16, height: 16 },
      md: { width: 24, height: 24 },
      lg: { width: 40, height: 40 },
    },
  } as const,

  defaultVariants: {
    size: 'md',
  },
})

type SpinnerProps = GetProps<typeof SpinnerFrame> & {
  color?: string
}

type ThemeColorLike = { get?: () => unknown } | string | undefined

function readThemeColor(value: ThemeColorLike): string {
  if (typeof value === 'string') return value
  const v = value?.get?.()
  return typeof v === 'string' ? v : '#0F172A'
}

function Spinner({ size = 'md', color, ...rest }: SpinnerProps) {
  useEffect(() => {
    ensureKeyframes(KEYFRAMES_ID, KEYFRAMES_CSS)
  }, [])
  const theme = useTheme()
  const stroke = color ?? readThemeColor(theme.color as ThemeColorLike)
  const pixels = size === 'sm' ? 16 : size === 'lg' ? 40 : 24
  const strokeWidth = pixels * 0.12
  const radius = (pixels - strokeWidth) / 2
  return (
    <SpinnerFrame size={size} {...rest}>
      <svg
        className="dag-spinner-svg"
        width={pixels}
        height={pixels}
        viewBox={`0 0 ${pixels} ${pixels}`}
      >
        <circle
          cx={pixels / 2}
          cy={pixels / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeOpacity="0.15"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={pixels / 2}
          cy={pixels / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${radius * Math.PI} ${radius * Math.PI * 2}`}
          strokeDashoffset="0"
        />
      </svg>
    </SpinnerFrame>
  )
}

Spinner.displayName = 'Spinner'

export { Spinner, SpinnerFrame }
export type { SpinnerProps }
