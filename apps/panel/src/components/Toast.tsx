// Toasts — what tells the operator a write landed.
//
// The panel used to answer every save the same way: close the dialog and reload
// the list. On a fast connection that reads as nothing happening at all, and on
// a slow one the row changes under the cursor with no explanation. A toast says
// what happened, where the eye already is, and gets out of the way.
//
// Portalled to the body like the core's Modal: the container Daguito hands the
// panel is `overflow: hidden` in places, and a fixed element inside it would be
// clipped at the panel's edge instead of the window's.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Text, XStack } from 'tamagui'
import { Check, TriangleAlert, X } from '@tamagui/lucide-icons'
import { ensureKeyframes } from '../ui/lib/keyframes'

export type ToastVariant = 'success' | 'error'

type Toast = {
  id: number
  message: string
  variant: ToastVariant
  /** Shown as a button on the toast; used for undo. */
  action?: { label: string; run: () => void }
}

type ToastApi = {
  success: (message: string, action?: Toast['action']) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/**
 * Toasts are a convenience, never a requirement: a page rendered outside the
 * provider (a test, a story) keeps working and simply says nothing.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP
}

const NOOP: ToastApi = { success: () => {}, error: () => {} }

const STYLE_ID = 'pediatric-toast'
const CSS = `
@keyframes pediatric-toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.pediatric-toast { animation: pediatric-toast-in 140ms ease-out both; }
`

/** How long a toast stays. Long enough to read, short enough to forget. */
const LIFETIME_MS = 4000
/** With an action to click, it has to outlive a moment of hesitation. */
const LIFETIME_WITH_ACTION_MS = 8000

export function ToastProvider({ children }: { children: ReactNode }) {
  ensureKeyframes(STYLE_ID, CSS)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback(
    (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)),
    [],
  )

  const push = useCallback(
    (message: string, variant: ToastVariant, action?: Toast['action']) => {
      const id = nextId.current++
      setToasts((current) => [...current, { id, message, variant, action }])
      setTimeout(() => dismiss(id), action ? LIFETIME_WITH_ACTION_MS : LIFETIME_MS)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, action) => push(message, 'success', action),
      // Errors carry no auto-action: the page still shows the failure in place.
      error: (message) => push(message, 'error'),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document === 'undefined'
        ? null
        : createPortal(
            // A plain div for the stack: it has to be `position: fixed` (pinned
            // to the viewport, not to the end of a long document), and that is
            // the one value Tamagui's web style types do not accept.
            <div
              style={{
                position: 'fixed',
                right: 20,
                bottom: 20,
                zIndex: 100_000,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxWidth: 380,
                // The stack must not eat clicks on the page behind it; each
                // toast turns pointer events back on for itself.
                pointerEvents: 'none',
              }}
            >
              {toasts.map((toast) => (
                <ToastRow key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
              ))}
            </div>,
            document.body,
          )}
    </ToastContext.Provider>
  )
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const error = toast.variant === 'error'
  const Icon = error ? TriangleAlert : Check
  return (
    <XStack
      className="pediatric-toast"
      pointerEvents="auto"
      alignItems="center"
      gap="$0.75"
      paddingVertical="$1"
      paddingHorizontal="$1.5"
      borderRadius="$4"
      borderWidth={1}
      borderColor={error ? '$error500' : '$borderColor'}
      backgroundColor={error ? '$error100' : '$backgroundStrong'}
      shadowColor="rgba(0,0,0,0.35)"
      shadowRadius={16}
      shadowOffset={{ width: 0, height: 4 }}
    >
      <Icon size={15} color={error ? '$error700' : '$success600'} />
      <Text flex={1} fontSize={14} color={error ? '$error700' : '$color'}>
        {toast.message}
      </Text>
      {toast.action ? (
        <Text
          fontSize={14}
          fontWeight="700"
          color={error ? '$error700' : '$color'}
          textDecorationLine="underline"
          cursor="pointer"
          onPress={() => {
            toast.action?.run()
            onDismiss()
          }}
        >
          {toast.action.label}
        </Text>
      ) : null}
      <X size={14} color="$color11" cursor="pointer" onPress={onDismiss} />
    </XStack>
  )
}
