// The action palette — the colors the panel's buttons paint with, one set per
// theme.
//
// The vendored Button (src/ui/components/Button.tsx) reads a FIXED teal ramp:
// `$teal600` fills primary and inks secondary, `$teal50`/`$teal100` are
// secondary's hover and press. Tokens are global in Tamagui — one value for
// both themes — so those two tints stayed near-white (#F0FDFA / #CCFBF1) on a
// black panel: hovering a secondary button flashed a white pill. And a single
// `$teal600` cannot do both of its jobs on a dark surface: dark enough to carry
// white text (needs ≤4.5:1 against white) and bright enough to read as ink on
// near-black (needs ≥4.5:1 against #0a0a0a) are mutually exclusive.
//
// So the colors move into the THEME, where light and dark each get their own,
// and the composed Button (components/Button.tsx) reads these keys. Nothing
// under src/ui/ is touched — those are Daguito's copies and sync-ui.sh
// overwrites them.
//
// Every pair below is checked against WCAG AA (4.5:1 for the label on its fill,
// 3:1 for the fill against the page it sits on):
//
//   light  #0F766E fill + #FFFFFF label = 5.5:1 · fill on #fafafa = 5.3:1
//   dark   #2DD4BF fill + #06211E label = 10.4:1 · fill on #0a0a0a = 10.6:1
//   dark   #5EEAD4 ink on #0a0a0a = 13.3:1 (the muted teal was 3.6:1)
//
// Dark inverts on purpose: a saturated accent reads as the primary action on a
// light page, and a BRIGHT accent with dark ink does the same job on a black
// one. Hover brightens on dark and deepens on light — both move away from the
// page, which is what makes a hover feel like a lift.
import { themes as daguitoThemes } from '../ui/themes'

const lightActions = {
  actionFill: '#0F766E',
  actionFillHover: '#115E59',
  actionFillPress: '#134E4A',
  /** The label ON the fill. */
  actionInk: '#FFFFFF',
  /** Secondary's text and border — the accent as ink rather than as a surface. */
  actionText: '#0F766E',
  /** Secondary's hover/press wash. Alpha, so it works on the page and on cards
   *  alike instead of assuming one background underneath. */
  actionSurfaceHover: 'rgba(15,118,110,0.08)',
  actionSurfacePress: 'rgba(15,118,110,0.16)',
  actionRing: '#14B8A6',
} as const

const darkActions = {
  actionFill: '#2DD4BF',
  actionFillHover: '#5EEAD4',
  actionFillPress: '#14B8A6',
  actionInk: '#06211E',
  actionText: '#5EEAD4',
  actionSurfaceHover: 'rgba(94,234,212,0.12)',
  actionSurfacePress: 'rgba(94,234,212,0.22)',
  actionRing: '#5EEAD4',
} as const

/**
 * Daguito's themes with the action palette folded in.
 *
 * Only `light` and `dark` gain the keys: the sub-themes (`*_accent`,
 * `*_error`, …) inherit from their base in Tamagui, so re-listing them would
 * be four more places to keep in step for no change in what renders.
 */
export const themes = {
  ...daguitoThemes,
  light: { ...daguitoThemes.light, ...lightActions },
  dark: { ...daguitoThemes.dark, ...darkActions },
} as const

export type PanelThemes = typeof themes
