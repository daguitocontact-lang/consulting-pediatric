// Confirmation before something irreversible. Separate from CreateForm because
// the shape is different: no fields, and the primary action is the destructive
// one — so it is `danger`, never `primary`, and the safe choice keeps focus.
//
// The error stays inside the dialog: a delete the server refused (a service a
// product sells, say) has to be readable right where the operator clicked, not as
// a banner behind a modal that just closed.
import { useState } from 'react'
import { Text, XStack, YStack } from 'tamagui'
import { errorMessage } from '../lib/api'
import type { translator } from '../lib/i18n'
import { ErrorNote } from './PageShell'
import { Button, Modal } from './ui'

export function ConfirmDialog({
  i18n,
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  i18n: ReturnType<typeof translator>
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const { t } = i18n
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  function close() {
    setError(null)
    onClose()
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (err) {
      // Kept open on failure: closing would hide the reason the delete was
      // refused, and the operator would just click it again.
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title={title} size="sm" closeOnBackdrop={false}>
      <YStack gap="$1">
        <Text fontSize={14} color="$color11">
          {body}
        </Text>
        {error ? <ErrorNote>{errorMessage(error, i18n)}</ErrorNote> : null}
        <XStack gap="$0.75" justifyContent="flex-end" paddingTop="$0.5">
          <Button size="sm" variant="ghost" disabled={busy} onPress={close}>
            {t('form.cancel')}
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onPress={() => void confirm()}>
            {busy ? t('form.saving') : confirmLabel}
          </Button>
        </XStack>
      </YStack>
    </Modal>
  )
}
