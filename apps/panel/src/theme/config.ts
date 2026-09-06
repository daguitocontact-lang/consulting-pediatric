// The panel's Tamagui config: Daguito's tokens, themes and fonts, wired the same
// way the core wires them (packages/ui/src/tamagui.config.ts).
//
// Animations come along because the vendored Button declares `animation="quick"`:
// without the driver the component would not compile, and editing vendored source
// is exactly what breaks the sync script.
import { createTamagui } from '@tamagui/core'
import { shorthands } from '@tamagui/shorthands'
import { tokens } from '../ui/tokens'
import { themes } from './actions'
import { fonts } from '../ui/fonts'
import { animations } from '../ui/animations'

// The FULL media set from the core (packages/ui/src/tamagui.config.ts). It has
// to match: the vendored components use props like `$pointerCoarse`, and a media
// key this config does not declare is not a media query — Tamagui forwards it to
// the DOM, which React then rejects as an invalid attribute name.
const media = {
  xs: { maxWidth: 660 },
  sm: { maxWidth: 860 },
  md: { maxWidth: 980 },
  lg: { maxWidth: 1120 },
  xl: { maxWidth: 1280 },
  xxl: { maxWidth: 1440 },
  gtXs: { minWidth: 661 },
  gtSm: { minWidth: 861 },
  gtMd: { minWidth: 981 },
  gtLg: { minWidth: 1121 },
  gtXl: { minWidth: 1281 },
  short: { maxHeight: 820 },
  tall: { minHeight: 820 },
  hoverNone: { hover: 'none' },
  pointerCoarse: { pointer: 'coarse' },
} as const

export const tamaguiConfig = createTamagui({
  tokens,
  themes,
  fonts,
  animations,
  shorthands,
  media,
  defaultFont: 'body',
  settings: {
    // Same setting as the core (packages/ui/src/tamagui.config.ts): the vendored
    // components are typed against it, so drifting here would break the copies.
    allowedStyleValues: 'somewhat-strict-web',
    autocomplete: 'complete',
  },
})

export type AppConfig = typeof tamaguiConfig

// No `declare module '@tamagui/core'` augmentation on purpose. The core does not
// declare one either, and its components are typed against Tamagui's permissive
// defaults; augmenting here would make the VENDORED components stop compiling
// over token names that are perfectly valid at runtime.

export default tamaguiConfig
