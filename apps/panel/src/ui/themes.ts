// ---------------------------------------------------------------------------
// Reservia theme definitions
//
// Tamagui resolves sub-themes by name convention:
//   light_accent  -> <Theme name="accent"> inside <Theme name="light">
//   dark_surface  -> <Theme name="surface"> inside <Theme name="dark">
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Light base
// ---------------------------------------------------------------------------
const light = {
  brand: '#0a0a0a',
  brandText: '#fafafa',

  background: '#fafafa',
  backgroundHover: '#f5f5f5',
  backgroundPress: '#ebebeb',
  backgroundFocus: '#f5f5f5',
  backgroundStrong: '#ffffff',
  backgroundTransparent: 'rgba(250,250,250,0)',

  color: '#0a0a0a',
  colorHover: '#1a1a1a',
  colorPress: '#262626',
  colorFocus: '#0a0a0a',
  colorTransparent: 'rgba(10,10,10,0)',

  borderColor: 'rgba(0,0,0,0.05)',
  borderColorHover: 'rgba(0,0,0,0.1)',
  borderColorPress: 'rgba(0,0,0,0.2)',
  borderColorFocus: '#0a0a0a',

  placeholderColor: 'rgba(0,0,0,0.4)',
  outlineColor: 'rgba(10,10,10,0.4)',
  selectionColor: '#0a0a0a',
  selectionBackground: 'rgba(59,130,246,0.3)',
  shadowColor: 'rgba(0,0,0,0.06)',
  shadowColorHover: 'rgba(0,0,0,0.1)',
  shadowColorPress: 'rgba(0,0,0,0.04)',
  shadowColorFocus: 'rgba(10,10,10,0.16)',

  color1: '#f5f5f5',
  color2: '#ebebeb',
  color3: '#e0e0e0',
  color4: '#d4d4d4',
  color5: '#bfbfbf',
  color6: '#a3a3a3',
  color7: '#737373',
  color8: '#525252',
  color9: '#3a3a3a',
  color10: '#262626',
  color11: 'rgba(0,0,0,0.4)',
  color12: '#0a0a0a',
} as const

// ---------------------------------------------------------------------------
// Dark base — WCAG AA/AAA accessibility redesign.
//
// Design principles:
// • Base bg #0a0a0a (brand core) — softened from pure black to reduce halation/
//   eye strain in low-light viewing while keeping the premium "near-black" feel.
// • Clear 4-step surface elevation (bg → card → popover → input) so the
//   cognitive "where am I" hierarchy survives without heavy borders.
// • Text contrast: primary #fafafa ≈16:1 (AAA), secondary rgba(255,255,255,0.72)
//   ≈10:1 (AAA), tertiary rgba(255,255,255,0.56) ≈6:1 (AA). No secondary
//   label ever goes below 4.5:1.
// • Focus ring: brand white on any surface so keyboard nav stays visible.
// • Borders: subtle resting (0.08), bump to 0.16 on hover, and solid white
//   on focus — never invisible on any surface.
// ---------------------------------------------------------------------------
const dark = {
  brand: '#fafafa',
  brandText: '#0a0a0a',

  background: '#0a0a0a',
  backgroundHover: '#141414',
  backgroundPress: '#1a1a1a',
  backgroundFocus: '#141414',
  backgroundStrong: '#000000',
  backgroundTransparent: 'rgba(10,10,10,0)',

  color: '#fafafa',
  colorHover: '#ffffff',
  colorPress: '#ffffff',
  colorFocus: '#fafafa',
  colorTransparent: 'rgba(250,250,250,0)',

  borderColor: 'rgba(255,255,255,0.08)',
  borderColorHover: 'rgba(255,255,255,0.16)',
  borderColorPress: 'rgba(255,255,255,0.28)',
  borderColorFocus: '#fafafa',

  placeholderColor: 'rgba(255,255,255,0.5)',
  outlineColor: '#fafafa',
  selectionColor: '#fafafa',
  selectionBackground: 'rgba(59,130,246,0.5)',
  shadowColor: 'rgba(0,0,0,0.6)',
  shadowColorHover: 'rgba(0,0,0,0.75)',
  shadowColorPress: 'rgba(0,0,0,0.45)',
  shadowColorFocus: 'rgba(255,255,255,0.25)',

  color1: '#121212',
  color2: '#171717',
  color3: '#1f1f1f',
  color4: '#262626',
  color5: '#3a3a3a',
  color6: '#525252',
  color7: '#737373',
  color8: '#a3a3a3',
  color9: '#d4d4d4',
  color10: '#ebebeb',
  color11: 'rgba(255,255,255,0.72)',
  color12: '#fafafa',
} as const

// ---------------------------------------------------------------------------
// Sub-themes -- accent (primary teal CTA)
// ---------------------------------------------------------------------------
const light_accent = {
  background: '#0a0a0a',
  backgroundHover: '#1a1a1a',
  backgroundPress: '#262626',
  backgroundFocus: '#0a0a0a',
  backgroundStrong: '#000000',
  backgroundTransparent: 'rgba(10,10,10,0)',

  color: '#FFFFFF',
  colorHover: '#fafafa',
  colorPress: '#f5f5f5',
  colorFocus: '#FFFFFF',
  colorTransparent: 'rgba(255,255,255,0)',

  borderColor: '#1a1a1a',
  borderColorHover: '#262626',
  borderColorPress: '#3a3a3a',
  borderColorFocus: '#0a0a0a',

  placeholderColor: 'rgba(255,255,255,0.55)',
  outlineColor: 'rgba(10,10,10,0.5)',
  selectionColor: '#fafafa',
  selectionBackground: 'rgba(59,130,246,0.5)',
  shadowColor: 'rgba(10,10,10,0.25)',
  shadowColorHover: 'rgba(10,10,10,0.35)',
  shadowColorPress: 'rgba(10,10,10,0.15)',
  shadowColorFocus: 'rgba(10,10,10,0.4)',

  color1: '#fafafa',
  color2: '#f5f5f5',
  color3: '#e5e5e5',
  color4: '#d4d4d4',
  color5: '#a3a3a3',
  color6: '#737373',
  color7: '#525252',
  color8: '#3a3a3a',
  color9: '#262626',
  color10: '#1a1a1a',
  color11: '#FFFFFF',
  color12: '#FFFFFF',
} as const

const dark_accent = {
  background: '#fafafa',
  backgroundHover: '#f5f5f5',
  backgroundPress: '#e5e5e5',
  backgroundFocus: '#fafafa',
  backgroundStrong: '#FFFFFF',
  backgroundTransparent: 'rgba(255,255,255,0)',

  color: '#0a0a0a',
  colorHover: '#1a1a1a',
  colorPress: '#262626',
  colorFocus: '#0a0a0a',
  colorTransparent: 'rgba(10,10,10,0)',

  borderColor: '#e5e5e5',
  borderColorHover: '#d4d4d4',
  borderColorPress: '#a3a3a3',
  borderColorFocus: '#fafafa',

  placeholderColor: 'rgba(10,10,10,0.55)',
  outlineColor: 'rgba(255,255,255,0.5)',
  selectionColor: '#0a0a0a',
  selectionBackground: 'rgba(59,130,246,0.3)',
  shadowColor: 'rgba(0,0,0,0.25)',
  shadowColorHover: 'rgba(0,0,0,0.35)',
  shadowColorPress: 'rgba(0,0,0,0.15)',
  shadowColorFocus: 'rgba(255,255,255,0.4)',

  color1: '#1a1a1a',
  color2: '#262626',
  color3: '#3a3a3a',
  color4: '#525252',
  color5: '#737373',
  color6: '#a3a3a3',
  color7: '#d4d4d4',
  color8: '#e5e5e5',
  color9: '#f5f5f5',
  color10: '#fafafa',
  color11: '#0a0a0a',
  color12: '#0a0a0a',
} as const

// ---------------------------------------------------------------------------
// Sub-themes -- surface (cards / elevated containers)
// ---------------------------------------------------------------------------
const light_surface = {
  ...light,
  background: '#ffffff',
  backgroundHover: '#fafafa',
  backgroundPress: '#f5f5f5',
  backgroundFocus: '#fafafa',
  backgroundStrong: '#fafafa',

  borderColor: 'rgba(0,0,0,0.05)',
  borderColorHover: 'rgba(0,0,0,0.1)',

  shadowColor: 'rgba(0,0,0,0.06)',
  shadowColorHover: 'rgba(0,0,0,0.1)',
} as const

const dark_surface = {
  ...dark,
  background: '#141414',
  backgroundHover: '#1a1a1a',
  backgroundPress: '#1f1f1f',
  backgroundFocus: '#1a1a1a',
  backgroundStrong: '#0a0a0a',

  borderColor: 'rgba(255,255,255,0.08)',
  borderColorHover: 'rgba(255,255,255,0.16)',

  shadowColor: 'rgba(0,0,0,0.6)',
  shadowColorHover: 'rgba(0,0,0,0.75)',
} as const

// ---------------------------------------------------------------------------
// Sub-themes -- success
// ---------------------------------------------------------------------------
const light_success = {
  background: '#F0FDF4',
  backgroundHover: '#DCFCE7',
  backgroundPress: '#BBF7D0',
  backgroundFocus: '#F0FDF4',
  backgroundStrong: '#BBF7D0',
  backgroundTransparent: 'rgba(240,253,244,0)',

  color: '#15803D',
  colorHover: '#16A34A',
  colorPress: '#166534',
  colorFocus: '#15803D',
  colorTransparent: 'rgba(21,128,61,0)',

  borderColor: '#BBF7D0',
  borderColorHover: '#86EFAC',
  borderColorPress: '#4ADE80',
  borderColorFocus: '#22C55E',

  placeholderColor: '#86EFAC',
  outlineColor: 'rgba(34,197,94,0.4)',
  selectionColor: '#0a0a0a',
  selectionBackground: 'rgba(59,130,246,0.3)',
  shadowColor: 'rgba(34,197,94,0.1)',
  shadowColorHover: 'rgba(34,197,94,0.15)',
  shadowColorPress: 'rgba(34,197,94,0.05)',
  shadowColorFocus: 'rgba(34,197,94,0.2)',

  color1: '#F0FDF4',
  color2: '#DCFCE7',
  color3: '#BBF7D0',
  color4: '#86EFAC',
  color5: '#4ADE80',
  color6: '#22C55E',
  color7: '#16A34A',
  color8: '#15803D',
  color9: '#166534',
  color10: '#14532D',
  color11: '#15803D',
  color12: '#14532D',
} as const

// Dark success — subtle green tint over brand-black, not a filled green badge.
// The only chromatic exception allowed (#22c55e). Text uses #86efac which
// reads ≈9.8:1 on the #0a0a0a base — AAA compliant.
const dark_success = {
  background: 'rgba(34,197,94,0.1)',
  backgroundHover: 'rgba(34,197,94,0.16)',
  backgroundPress: 'rgba(34,197,94,0.22)',
  backgroundFocus: 'rgba(34,197,94,0.16)',
  backgroundStrong: 'rgba(34,197,94,0.2)',
  backgroundTransparent: 'rgba(34,197,94,0)',

  color: '#86EFAC',
  colorHover: '#BBF7D0',
  colorPress: '#4ADE80',
  colorFocus: '#86EFAC',
  colorTransparent: 'rgba(134,239,172,0)',

  borderColor: 'rgba(34,197,94,0.28)',
  borderColorHover: 'rgba(34,197,94,0.4)',
  borderColorPress: 'rgba(34,197,94,0.55)',
  borderColorFocus: '#22C55E',

  placeholderColor: 'rgba(134,239,172,0.6)',
  outlineColor: 'rgba(34,197,94,0.45)',
  selectionColor: '#fafafa',
  selectionBackground: 'rgba(59,130,246,0.5)',
  shadowColor: 'rgba(0,0,0,0.5)',
  shadowColorHover: 'rgba(0,0,0,0.6)',
  shadowColorPress: 'rgba(0,0,0,0.35)',
  shadowColorFocus: 'rgba(34,197,94,0.35)',

  color1: 'rgba(34,197,94,0.08)',
  color2: 'rgba(34,197,94,0.12)',
  color3: 'rgba(34,197,94,0.18)',
  color4: 'rgba(34,197,94,0.26)',
  color5: '#22C55E',
  color6: '#4ADE80',
  color7: '#86EFAC',
  color8: '#BBF7D0',
  color9: '#DCFCE7',
  color10: '#F0FDF4',
  color11: '#86EFAC',
  color12: '#F0FDF4',
} as const

// ---------------------------------------------------------------------------
// Sub-themes -- error
// ---------------------------------------------------------------------------
const light_error = {
  background: '#FEF2F2',
  backgroundHover: '#FEE2E2',
  backgroundPress: '#FECACA',
  backgroundFocus: '#FEF2F2',
  backgroundStrong: '#FECACA',
  backgroundTransparent: 'rgba(254,242,242,0)',

  color: '#B91C1C',
  colorHover: '#DC2626',
  colorPress: '#991B1B',
  colorFocus: '#B91C1C',
  colorTransparent: 'rgba(185,28,28,0)',

  borderColor: '#FECACA',
  borderColorHover: '#FCA5A5',
  borderColorPress: '#F87171',
  borderColorFocus: '#EF4444',

  placeholderColor: '#FCA5A5',
  outlineColor: 'rgba(239,68,68,0.4)',
  selectionColor: '#0a0a0a',
  selectionBackground: 'rgba(59,130,246,0.3)',
  shadowColor: 'rgba(239,68,68,0.1)',
  shadowColorHover: 'rgba(239,68,68,0.15)',
  shadowColorPress: 'rgba(239,68,68,0.05)',
  shadowColorFocus: 'rgba(239,68,68,0.2)',

  color1: '#FEF2F2',
  color2: '#FEE2E2',
  color3: '#FECACA',
  color4: '#FCA5A5',
  color5: '#F87171',
  color6: '#EF4444',
  color7: '#DC2626',
  color8: '#B91C1C',
  color9: '#991B1B',
  color10: '#7F1D1D',
  color11: '#B91C1C',
  color12: '#7F1D1D',
} as const

// Dark error — tint-on-black pattern. #fca5a5 reads ≈8.7:1 on #0a0a0a (AAA).
// Borders/backgrounds as alpha overlays so the error state works regardless of
// the surface it's dropped onto (card, popover, input).
const dark_error = {
  background: 'rgba(239,68,68,0.1)',
  backgroundHover: 'rgba(239,68,68,0.16)',
  backgroundPress: 'rgba(239,68,68,0.22)',
  backgroundFocus: 'rgba(239,68,68,0.16)',
  backgroundStrong: 'rgba(239,68,68,0.2)',
  backgroundTransparent: 'rgba(239,68,68,0)',

  color: '#FCA5A5',
  colorHover: '#FECACA',
  colorPress: '#F87171',
  colorFocus: '#FCA5A5',
  colorTransparent: 'rgba(252,165,165,0)',

  borderColor: 'rgba(239,68,68,0.28)',
  borderColorHover: 'rgba(239,68,68,0.4)',
  borderColorPress: 'rgba(239,68,68,0.55)',
  borderColorFocus: '#EF4444',

  placeholderColor: 'rgba(252,165,165,0.6)',
  outlineColor: 'rgba(239,68,68,0.45)',
  selectionColor: '#fafafa',
  selectionBackground: 'rgba(59,130,246,0.5)',
  shadowColor: 'rgba(0,0,0,0.5)',
  shadowColorHover: 'rgba(0,0,0,0.6)',
  shadowColorPress: 'rgba(0,0,0,0.35)',
  shadowColorFocus: 'rgba(239,68,68,0.35)',

  color1: 'rgba(239,68,68,0.08)',
  color2: 'rgba(239,68,68,0.12)',
  color3: 'rgba(239,68,68,0.18)',
  color4: 'rgba(239,68,68,0.26)',
  color5: '#EF4444',
  color6: '#F87171',
  color7: '#FCA5A5',
  color8: '#FECACA',
  color9: '#FEE2E2',
  color10: '#FEF2F2',
  color11: '#FCA5A5',
  color12: '#FEF2F2',
} as const

// ---------------------------------------------------------------------------
// Sub-themes -- warning
// ---------------------------------------------------------------------------
const light_warning = {
  background: '#FFFBEB',
  backgroundHover: '#FEF3C7',
  backgroundPress: '#FDE68A',
  backgroundFocus: '#FFFBEB',
  backgroundStrong: '#FDE68A',
  backgroundTransparent: 'rgba(255,251,235,0)',

  color: '#B45309',
  colorHover: '#D97706',
  colorPress: '#92400E',
  colorFocus: '#B45309',
  colorTransparent: 'rgba(180,83,9,0)',

  borderColor: '#FDE68A',
  borderColorHover: '#FCD34D',
  borderColorPress: '#FBBF24',
  borderColorFocus: '#F59E0B',

  placeholderColor: '#FCD34D',
  outlineColor: 'rgba(245,158,11,0.4)',
  selectionColor: '#0a0a0a',
  selectionBackground: 'rgba(59,130,246,0.3)',
  shadowColor: 'rgba(245,158,11,0.1)',
  shadowColorHover: 'rgba(245,158,11,0.15)',
  shadowColorPress: 'rgba(245,158,11,0.05)',
  shadowColorFocus: 'rgba(245,158,11,0.2)',

  color1: '#FFFBEB',
  color2: '#FEF3C7',
  color3: '#FDE68A',
  color4: '#FCD34D',
  color5: '#FBBF24',
  color6: '#F59E0B',
  color7: '#D97706',
  color8: '#B45309',
  color9: '#92400E',
  color10: '#78350F',
  color11: '#B45309',
  color12: '#78350F',
} as const

// Dark warning — tint-on-black. #fcd34d reads ≈13:1 on #0a0a0a (AAA).
const dark_warning = {
  background: 'rgba(245,158,11,0.1)',
  backgroundHover: 'rgba(245,158,11,0.16)',
  backgroundPress: 'rgba(245,158,11,0.22)',
  backgroundFocus: 'rgba(245,158,11,0.16)',
  backgroundStrong: 'rgba(245,158,11,0.2)',
  backgroundTransparent: 'rgba(245,158,11,0)',

  color: '#FCD34D',
  colorHover: '#FDE68A',
  colorPress: '#FBBF24',
  colorFocus: '#FCD34D',
  colorTransparent: 'rgba(252,211,77,0)',

  borderColor: 'rgba(245,158,11,0.28)',
  borderColorHover: 'rgba(245,158,11,0.4)',
  borderColorPress: 'rgba(245,158,11,0.55)',
  borderColorFocus: '#F59E0B',

  placeholderColor: 'rgba(252,211,77,0.6)',
  outlineColor: 'rgba(245,158,11,0.45)',
  selectionColor: '#fafafa',
  selectionBackground: 'rgba(59,130,246,0.5)',
  shadowColor: 'rgba(0,0,0,0.5)',
  shadowColorHover: 'rgba(0,0,0,0.6)',
  shadowColorPress: 'rgba(0,0,0,0.35)',
  shadowColorFocus: 'rgba(245,158,11,0.35)',

  color1: 'rgba(245,158,11,0.08)',
  color2: 'rgba(245,158,11,0.12)',
  color3: 'rgba(245,158,11,0.18)',
  color4: 'rgba(245,158,11,0.26)',
  color5: '#F59E0B',
  color6: '#FBBF24',
  color7: '#FCD34D',
  color8: '#FDE68A',
  color9: '#FEF3C7',
  color10: '#FFFBEB',
  color11: '#FCD34D',
  color12: '#FFFBEB',
} as const

// ---------------------------------------------------------------------------
// Export all themes
// ---------------------------------------------------------------------------
export const themes = {
  light,
  dark,
  light_accent,
  dark_accent,
  light_surface,
  dark_surface,
  light_success,
  dark_success,
  light_error,
  dark_error,
  light_warning,
  dark_warning,
} as const

export type ReserviaThemes = typeof themes
