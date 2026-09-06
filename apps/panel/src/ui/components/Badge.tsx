import { styled, Stack, Text, GetProps } from '@tamagui/core'

// ---------------------------------------------------------------------------
// BadgeFrame -- pill-shaped status indicator
// ---------------------------------------------------------------------------
const BadgeFrame = styled(Stack, {
  name: 'Badge',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  alignSelf: 'flex-start',
  borderRadius: '$12',

  variants: {
    variant: {
      success: {
        backgroundColor: '$success100',
      },
      warning: {
        backgroundColor: '$warning100',
      },
      error: {
        backgroundColor: '$error100',
      },
      info: {
        backgroundColor: '$info100',
      },
      neutral: {
        // Theme-aware: $color3 is a near-border surface in both themes.
        backgroundColor: '$color3',
      },
    },

    size: {
      sm: {
        paddingHorizontal: '$0.5',
        paddingVertical: '$0.25',
      },
      md: {
        paddingHorizontal: '$0.75',
        paddingVertical: '$0.25',
      },
    },
  } as const,

  defaultVariants: {
    variant: 'neutral',
    size: 'md',
  },
})

// ---------------------------------------------------------------------------
// BadgeText
// ---------------------------------------------------------------------------
const BadgeText = styled(Text, {
  name: 'BadgeText',
  fontFamily: '$body',
  fontWeight: '600',

  variants: {
    variant: {
      success: {
        color: '$success700',
      },
      warning: {
        color: '$warning700',
      },
      error: {
        color: '$error700',
      },
      info: {
        color: '$info700',
      },
      neutral: {
        // Uses the active foreground so the label stays legible over
        // $color3 in both themes.
        color: '$color',
      },
    },

    size: {
      sm: {
        fontSize: '$1',
      },
      md: {
        fontSize: '$2',
      },
    },
  } as const,

  defaultVariants: {
    variant: 'neutral',
    size: 'md',
  },
})

// ---------------------------------------------------------------------------
// Badge -- composite component
// ---------------------------------------------------------------------------
type BadgeFrameProps = GetProps<typeof BadgeFrame>

interface BadgeProps extends BadgeFrameProps {
  label?: string
  children?: React.ReactNode
}

function Badge({
  label,
  children,
  variant = 'neutral',
  size = 'md',
  ...rest
}: BadgeProps): React.ReactElement {
  return (
    <BadgeFrame variant={variant} size={size} {...rest}>
      <BadgeText variant={variant} size={size}>
        {label ?? children}
      </BadgeText>
    </BadgeFrame>
  )
}

Badge.displayName = 'Badge'

export { Badge, BadgeFrame, BadgeText }
export type { BadgeProps }
