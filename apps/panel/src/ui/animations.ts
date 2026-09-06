import { createAnimations } from '@tamagui/animations-css'

export const animations = createAnimations({
  fast: 'ease-in-out 150ms',
  medium: 'ease-in-out 250ms',
  slow: 'ease-in-out 450ms',
  bouncy: 'cubic-bezier(0.34, 1.56, 0.64, 1) 300ms',
  tooltip: 'ease-out 100ms',
  chat: 'cubic-bezier(0.2, 0, 0, 1) 180ms',
})
