/**
 * The consent gate, before the first recording of a consultation.
 *
 * A port of the legacy app's `PatientConsentModal`, and the reason it is a
 * blocking modal rather than a checkbox in a form: the doctor has to say the
 * words out loud before the microphone opens, and the script is there so they
 * say the same words every time. What is stamped afterwards
 * (`patient_consent_at`, via POST /consent) is the thing a clinic is audited
 * on — a transcript with no consent behind it is a recording of a child's
 * medical visit that nobody agreed to.
 *
 * Shown once per consultation, for all three modes. A consultation that already
 * carries the stamp starts straight away: a doctor who paused for lunch should
 * not have to ask a parent for permission twice.
 */
import { useState } from 'react'
import { Text, YStack } from 'tamagui'
import type { translator } from '../../lib/i18n'
import { Button, Modal, Spinner } from '../ui'

export function ConsentModal({
  i18n,
  open,
  onAccept,
  onClose,
}: {
  i18n: ReturnType<typeof translator>
  open: boolean
  /** Persists the consent and then begins the consultation. */
  onAccept: () => Promise<void>
  onClose: () => void
}) {
  const { t } = i18n
  const [saving, setSaving] = useState(false)

  return (
    <Modal
      open={open}
      // Not closeable mid-save: the recording must not begin from a half-written
      // stamp, and the doctor must not be able to dismiss their way past it.
      onClose={() => {
        if (!saving) onClose()
      }}
      closeOnBackdrop={!saving}
      size="sm"
      title={t('consent.title')}
    >
      <YStack gap="$1.5" padding="$1">
        {/* The reminder, kept prominent — it is the whole point of the gate. */}
        <YStack borderLeftWidth={3} borderLeftColor="$actionText" paddingLeft="$1">
          <Text fontSize={14} fontWeight="600" color="$color" lineHeight={20}>
            {t('consent.doctorNote')}
          </Text>
        </YStack>

        {/* The script, so every parent is asked the same thing. */}
        <YStack gap="$0.5">
          <Text fontSize={11} fontWeight="700" color="$color10" textTransform="uppercase">
            {t('consent.scriptLabel')}
          </Text>
          <Text fontSize={14} fontStyle="italic" color="$color11" lineHeight={20}>
            {t('consent.script')}
          </Text>
        </YStack>

        <Button
          size="md"
          variant="primary"
          disabled={saving}
          iconBefore={saving ? <Spinner size="sm" /> : undefined}
          onPress={async () => {
            if (saving) return
            setSaving(true)
            try {
              await onAccept()
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? t('consent.saving') : t('consent.accept')}
        </Button>
      </YStack>
    </Modal>
  )
}
