import { styled, Stack, Text, GetProps } from '@tamagui/core'
import { Button } from './Button'

// ---------------------------------------------------------------------------
// EmptyStateFrame
// ---------------------------------------------------------------------------
const EmptyStateFrame = styled(Stack, {
  name: 'EmptyState',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '$4',
  gap: '$1',
})

// ---------------------------------------------------------------------------
// EmptyStateIcon -- container for the icon element
// ---------------------------------------------------------------------------
const EmptyStateIcon = styled(Stack, {
  name: 'EmptyStateIcon',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '$0.5',
})

// ---------------------------------------------------------------------------
// EmptyStateTitle
// ---------------------------------------------------------------------------
const EmptyStateTitle = styled(Text, {
  name: 'EmptyStateTitle',
  fontFamily: '$heading',
  fontSize: '$7',
  fontWeight: '600',
  color: '$color',
  textAlign: 'center',
})

// ---------------------------------------------------------------------------
// EmptyStateDescription
// ---------------------------------------------------------------------------
const EmptyStateDescription = styled(Text, {
  name: 'EmptyStateDescription',
  fontFamily: '$body',
  fontSize: '$4',
  // Theme-aware muted text: $color11 maps to a softer foreground in both
  // light (#0F172A) and dark (rgba(255,255,255,0.65)) themes.
  color: '$color11',
  textAlign: 'center',
  maxWidth: 320,
})

// ---------------------------------------------------------------------------
// EmptyState -- composite component
// ---------------------------------------------------------------------------
type EmptyStateFrameProps = GetProps<typeof EmptyStateFrame>

interface EmptyStateProps extends EmptyStateFrameProps {
  icon?: React.ReactNode
  title?: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  children?: React.ReactNode
}

function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  children,
  ...rest
}: EmptyStateProps): React.ReactElement {
  if (children) {
    return <EmptyStateFrame {...rest}>{children}</EmptyStateFrame>
  }
  return (
    <EmptyStateFrame {...rest}>
      {icon ? <EmptyStateIcon>{icon}</EmptyStateIcon> : null}
      {title ? <EmptyStateTitle>{title}</EmptyStateTitle> : null}
      {description ? <EmptyStateDescription>{description}</EmptyStateDescription> : null}
      {actionLabel ? (
        <Button label={actionLabel} onPress={onAction} variant="primary" size="md" marginTop="$1" />
      ) : null}
    </EmptyStateFrame>
  )
}

EmptyState.displayName = 'EmptyState'

export { EmptyState, EmptyStateFrame, EmptyStateIcon, EmptyStateTitle, EmptyStateDescription }
export type { EmptyStateProps }
