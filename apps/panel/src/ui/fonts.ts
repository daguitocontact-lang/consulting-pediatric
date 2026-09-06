import { createFont } from '@tamagui/core'

// ---------------------------------------------------------------------------
// Shared size scale used by both fonts
// ---------------------------------------------------------------------------
const size = {
  1: 11,
  2: 12,
  3: 13,
  4: 14,
  true: 14,
  5: 16,
  6: 18,
  7: 20,
  8: 24,
  9: 30,
  10: 36,
  11: 44,
  12: 52,
  13: 62,
  14: 72,
  15: 84,
  16: 96,
} as const

// ---------------------------------------------------------------------------
// Heading font -- Lexend
// ---------------------------------------------------------------------------
export const headingFont = createFont({
  family: 'Lexend',
  face: {
    400: { normal: 'Lexend_400Regular' },
    500: { normal: 'Lexend_500Medium' },
    600: { normal: 'Lexend_600SemiBold' },
    700: { normal: 'Lexend_700Bold' },
    800: { normal: 'Lexend_800ExtraBold' },
    900: { normal: 'Lexend_900Black' },
  },
  size,
  lineHeight: {
    1: 16,
    2: 18,
    3: 20,
    4: 22,
    true: 22,
    5: 26,
    6: 28,
    7: 32,
    8: 36,
    9: 42,
    10: 48,
    11: 56,
    12: 64,
    13: 74,
    14: 84,
    15: 96,
    16: 110,
  },
  weight: {
    4: '400',
    true: '400',
    5: '500',
    6: '600',
    7: '700',
    8: '800',
    9: '900',
  },
  letterSpacing: {
    4: 0,
    true: 0,
    5: 0,
    6: -0.2,
    7: -0.3,
    8: -0.4,
    9: -0.5,
    10: -0.6,
  },
})

// ---------------------------------------------------------------------------
// Body font -- Lexend
// ---------------------------------------------------------------------------
export const bodyFont = createFont({
  family: 'Lexend',
  face: {
    300: { normal: 'Lexend_300Light' },
    400: { normal: 'Lexend_400Regular' },
    500: { normal: 'Lexend_500Medium' },
    600: { normal: 'Lexend_600SemiBold' },
    700: { normal: 'Lexend_700Bold' },
  },
  size,
  lineHeight: {
    1: 16,
    2: 18,
    3: 20,
    4: 22,
    true: 22,
    5: 26,
    6: 28,
    7: 32,
    8: 36,
    9: 42,
    10: 48,
    11: 56,
    12: 64,
    13: 74,
    14: 84,
    15: 96,
    16: 110,
  },
  weight: {
    1: '300',
    4: '400',
    true: '400',
    5: '500',
    6: '600',
    7: '700',
  },
  letterSpacing: {
    4: 0,
    true: 0,
    5: -0.1,
    6: -0.2,
    7: -0.3,
  },
})

export const fonts = {
  heading: headingFont,
  body: bodyFont,
} as const
