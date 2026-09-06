import { styled, Stack, GetProps } from '@tamagui/core'

// ---------------------------------------------------------------------------
// Card -- container with background, border, and optional shadow
// ---------------------------------------------------------------------------
const Card = styled(Stack, {
  name: 'Card',
  backgroundColor: '$background',
  borderRadius: '$6',
  overflow: 'hidden',

  variants: {
    variant: {
      elevated: {
        shadowColor: '$shadowColor',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
        borderWidth: 1,
        borderColor: '$borderColor',
      },
      outlined: {
        borderWidth: 1,
        borderColor: '$borderColor',
      },
      flat: {
        backgroundColor: '$backgroundStrong',
      },
    },

    size: {
      sm: {
        padding: '$1',
      },
      md: {
        padding: '$2',
      },
      lg: {
        padding: '$3',
      },
    },
  } as const,

  defaultVariants: {
    variant: 'elevated',
    size: 'md',
  },
})

// ---------------------------------------------------------------------------
// CardHeader
// ---------------------------------------------------------------------------
const CardHeader = styled(Stack, {
  name: 'CardHeader',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingBottom: '$1',
  borderBottomWidth: 1,
  borderBottomColor: '$borderColor',
  marginBottom: '$1',
})

// ---------------------------------------------------------------------------
// CardBody
// ---------------------------------------------------------------------------
const CardBody = styled(Stack, {
  name: 'CardBody',
  flexDirection: 'column',
})

// ---------------------------------------------------------------------------
// CardFooter
// ---------------------------------------------------------------------------
const CardFooter = styled(Stack, {
  name: 'CardFooter',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'flex-end',
  paddingTop: '$1',
  borderTopWidth: 1,
  borderTopColor: '$borderColor',
  marginTop: '$1',
  gap: '$0.75',
})

type CardProps = GetProps<typeof Card>
type CardHeaderProps = GetProps<typeof CardHeader>
type CardBodyProps = GetProps<typeof CardBody>
type CardFooterProps = GetProps<typeof CardFooter>

export { Card, CardHeader, CardBody, CardFooter }
export type { CardProps, CardHeaderProps, CardBodyProps, CardFooterProps }
