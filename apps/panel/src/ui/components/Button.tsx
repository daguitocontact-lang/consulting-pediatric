import { styled, Stack, Text, GetProps } from '@tamagui/core'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// ButtonFrame -- the outer pressable container
//
// Theme-aware variants:
//  - primary   → brand teal (identical in both themes)
//  - secondary → outlined teal (identical in both themes)
//  - danger    → brand error red (identical in both themes)
//  - ghost     → transparent with `$backgroundHover`/`$backgroundPress`
//                surfaces, so the hover/press fill flips automatically
//                between light and dark.
//  - neutral   → primary-looking black/white pill using the inverted
//                `$color`/`$background` pair. Ideal for "Save" / "Continue"
//                actions that need to match the brand monochrome palette.
// ---------------------------------------------------------------------------
const ButtonFrame = styled(Stack, {
  name: 'Button',
  tag: 'button',
  role: 'button',
  focusable: true,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$0.75',
  cursor: 'pointer',
  borderWidth: 1,
  borderColor: 'transparent',
  animation: 'fast',

  variants: {
    variant: {
      primary: {
        backgroundColor: '$teal600',
        borderColor: '$teal600',
        hoverStyle: {
          backgroundColor: '$teal700',
          borderColor: '$teal700',
        },
        pressStyle: {
          backgroundColor: '$teal800',
          borderColor: '$teal800',
        },
        focusStyle: {
          outlineColor: '$teal400',
          outlineWidth: 2,
          outlineStyle: 'solid',
          outlineOffset: 2,
        },
      },
      secondary: {
        backgroundColor: 'transparent',
        borderColor: '$teal600',
        hoverStyle: {
          backgroundColor: '$teal50',
          borderColor: '$teal700',
        },
        pressStyle: {
          backgroundColor: '$teal100',
          borderColor: '$teal800',
        },
        focusStyle: {
          outlineColor: '$teal400',
          outlineWidth: 2,
          outlineStyle: 'solid',
          outlineOffset: 2,
        },
      },
      danger: {
        backgroundColor: '$error600',
        borderColor: '$error600',
        hoverStyle: {
          backgroundColor: '$error700',
          borderColor: '$error700',
        },
        pressStyle: {
          backgroundColor: '$error700',
          borderColor: '$error700',
        },
        focusStyle: {
          outlineColor: '$error400',
          outlineWidth: 2,
          outlineStyle: 'solid',
          outlineOffset: 2,
        },
      },
      ghost: {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        hoverStyle: {
          backgroundColor: '$backgroundHover',
        },
        pressStyle: {
          backgroundColor: '$backgroundPress',
        },
        focusStyle: {
          outlineColor: '$borderColorFocus',
          outlineWidth: 2,
          outlineStyle: 'solid',
          outlineOffset: 2,
        },
      },
      neutral: {
        backgroundColor: '$color',
        borderColor: '$color',
        hoverStyle: {
          backgroundColor: '$colorHover',
          borderColor: '$colorHover',
        },
        pressStyle: {
          backgroundColor: '$colorPress',
          borderColor: '$colorPress',
        },
        focusStyle: {
          outlineColor: '$borderColorFocus',
          outlineWidth: 2,
          outlineStyle: 'solid',
          outlineOffset: 2,
        },
      },
    },

    // Sizes follow the Knowledge PagerButton scale — compact pills that read
    // as actions, not as page sections. Heights are expressed in pixels (not
    // tokens) because Tamagui's size scale jumps from 36→44→52, which is too
    // coarse for a button system.
    size: {
      xs: {
        height: 24,
        paddingHorizontal: 8,
        borderRadius: 999,
      },
      sm: {
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 999,
      },
      md: {
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 999,
      },
      lg: {
        height: 40,
        paddingHorizontal: 16,
        borderRadius: 999,
      },
      xl: {
        height: 48,
        paddingHorizontal: 20,
        borderRadius: 999,
      },
    },

    // `pill` overrides the size's borderRadius. Applied after size.
    shape: {
      default: {},
      pill: {
        borderRadius: 100,
      },
    },

    fullWidth: {
      true: {
        width: '100%',
        alignSelf: 'stretch',
      },
    },

    disabled: {
      true: {
        opacity: 0.5,
        cursor: 'not-allowed',
        pointerEvents: 'none',
      },
    },
  } as const,

  defaultVariants: {
    variant: 'primary',
    size: 'md',
    shape: 'default',
  },
})

// ---------------------------------------------------------------------------
// ButtonText -- label inside the button
// ---------------------------------------------------------------------------
const ButtonText = styled(Text, {
  name: 'ButtonText',
  fontFamily: '$body',
  fontWeight: '600',
  userSelect: 'none',

  variants: {
    variant: {
      primary: {
        color: '$white',
      },
      secondary: {
        color: '$teal600',
      },
      danger: {
        color: '$white',
      },
      ghost: {
        // Theme-aware: uses the active foreground so the label stays legible
        // against the themed `$backgroundHover` fill.
        color: '$color',
      },
      neutral: {
        // Inverted foreground: renders the background color of the current
        // theme against the `$color` fill (white text in light, black text
        // in dark).
        color: '$background',
      },
    },

    size: {
      xs: {
        fontSize: '$1',
        fontWeight: '700',
      },
      sm: {
        fontSize: '$2',
        fontWeight: '700',
      },
      md: {
        fontSize: '$2',
        fontWeight: '700',
      },
      lg: {
        fontSize: '$3',
        fontWeight: '700',
      },
      xl: {
        fontSize: '$4',
        fontWeight: '700',
      },
    },
  } as const,

  defaultVariants: {
    variant: 'primary',
    size: 'md',
  },
})

// ---------------------------------------------------------------------------
// Button -- composite component
// ---------------------------------------------------------------------------
type ButtonFrameProps = GetProps<typeof ButtonFrame>

interface ButtonProps extends ButtonFrameProps {
  label?: string
  loading?: boolean
  loadingText?: string
  iconBefore?: ReactNode
  iconAfter?: ReactNode
  children?: ReactNode
}

function Button({
  label,
  loading = false,
  loadingText = 'Loading...',
  variant = 'primary',
  size = 'md',
  shape = 'default',
  fullWidth,
  disabled,
  iconBefore,
  iconAfter,
  children,
  ...rest
}: ButtonProps): React.ReactElement {
  const isDisabled = disabled || loading
  const content = loading ? loadingText : (label ?? children)

  return (
    <ButtonFrame
      variant={variant}
      size={size}
      shape={shape}
      fullWidth={fullWidth}
      disabled={isDisabled}
      aria-busy={loading}
      aria-disabled={isDisabled}
      {...rest}
    >
      {iconBefore}
      <ButtonText variant={variant} size={size}>
        {content}
      </ButtonText>
      {iconAfter}
    </ButtonFrame>
  )
}

Button.displayName = 'Button'

export { Button, ButtonFrame, ButtonText }
export type { ButtonProps }
