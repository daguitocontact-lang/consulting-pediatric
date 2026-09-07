/**
 * The `transcription` consultation's only input: a recording.
 *
 * This mode has no microphone and no room — the doctor recorded the visit on
 * their phone and uploads it afterwards. The API stores the file in the private
 * bucket and runs the `pre-recorded-consultation` flow over it server-side
 * (lib/prerecorded.ts), which is why nothing here holds a socket: the upload
 * answers 202 and the screen polls the consultation until it is `finished`.
 *
 * The legacy app's equivalent is the same three states — nothing yet,
 * processing, done — plus the one that used to be missing everywhere: a run
 * that FAILED, with the reason and a retry that does not cost another upload.
 */
import { useEffect, useRef, useState } from 'react'
import { FileAudio, RotateCw, TriangleAlert, Upload } from '@tamagui/lucide-icons'
import { Text, XStack, YStack } from 'tamagui'
import {
  apiBlobUrl,
  apiDelete,
  apiPost,
  apiUpload,
  errorMessage,
  type MountProps,
} from '../../lib/api'
import type { translator } from '../../lib/i18n'
import type { Consultation } from '../../lib/consultations'
import { PanelEmpty } from './Panel'
import { Button, Spinner } from '../ui'

/** What the file picker offers. The API's whitelist is the one that decides. */
const ACCEPT = 'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/webm,audio/ogg,audio/flac'

export function AudioPanel({
  props,
  i18n,
  consultation,
  onChanged,
}: {
  props: MountProps
  i18n: ReturnType<typeof translator>
  consultation: Consultation
  onChanged: () => void
}) {
  const { t } = i18n
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [playback, setPlayback] = useState<string | null>(null)

  const processing = consultation.status === 'processing'

  // The recording, fetched with the token and handed to the player as a blob:
  // an `<audio src>` cannot carry an Authorization header and the bucket is
  // private. Revoked on unmount, or the file stays in memory for the life of
  // the page — and this one is an hour of audio.
  useEffect(() => {
    if (!consultation.audio_key) {
      setPlayback(null)
      return
    }
    let url: string | null = null
    let cancelled = false
    void apiBlobUrl(props, `/api/consultations/${consultation.id}/audio`)
      .then((blob) => {
        if (cancelled) {
          URL.revokeObjectURL(blob.url)
          return
        }
        url = blob.url
        setPlayback(blob.url)
      })
      .catch(() => setPlayback(null))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultation.id, consultation.audio_key])

  const upload = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      await apiUpload(props, `/api/consultations/${consultation.id}/audio`, file)
      onChanged()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  /** Re-run the flow over the recording already stored — not a second upload
   *  of an hour of audio over clinic wifi. */
  const retry = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiPost(props, `/api/consultations/${consultation.id}/audio/retry`)
      onChanged()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiDelete(props, `/api/consultations/${consultation.id}/audio`)
      onChanged()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <YStack flex={1} padding="$1.5" gap="$1">
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Cleared so choosing the SAME file twice fires the change again —
          // which is exactly what a doctor does after a failed upload.
          event.target.value = ''
          if (file) void upload(file)
        }}
      />

      {!consultation.audio_key ? (
        <YStack flex={1} alignItems="center" justifyContent="center" gap="$1">
          <PanelEmpty
            icon={<FileAudio size={22} color="$color10" />}
            label={t('workspace.audio.empty')}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            iconBefore={busy ? <Spinner size="sm" /> : <Upload size={14} />}
            onPress={() => input.current?.click()}
          >
            {t('workspace.audio.upload')}
          </Button>
        </YStack>
      ) : (
        <YStack gap="$1">
          {playback ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio src={playback} controls style={{ width: '100%' }} />
          ) : null}

          {processing ? (
            <XStack alignItems="center" gap="$0.75">
              <Spinner size="sm" />
              <Text fontSize={13} color="$color11">
                {t('workspace.audio.processing')}
              </Text>
            </XStack>
          ) : null}

          {consultation.transcription_error ? (
            <YStack
              gap="$0.5"
              padding="$1"
              borderRadius="$3"
              backgroundColor="$warning100"
              borderWidth={1}
              borderColor="$warning700"
            >
              <XStack alignItems="center" gap="$0.5">
                <TriangleAlert size={14} color="$warning700" />
                <Text fontSize={12} fontWeight="700" color="$warning700">
                  {t('workspace.audio.failed')}
                </Text>
              </XStack>
              {/* The flow's own words. A doctor cannot act on most of them, but
                  whoever they call can, and "algo salió mal" cannot be acted on
                  by anybody. */}
              <Text fontSize={12} color="$warning700">
                {consultation.transcription_error}
              </Text>
            </YStack>
          ) : null}

          <XStack gap="$0.5" flexWrap="wrap">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || processing}
              iconBefore={<RotateCw size={14} />}
              onPress={retry}
            >
              {t('workspace.audio.retry')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || processing}
              onPress={() => input.current?.click()}
            >
              {t('workspace.audio.replace')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || processing} onPress={remove}>
              {t('workspace.audio.remove')}
            </Button>
          </XStack>
        </YStack>
      )}

      {error ? (
        <Text fontSize={12} color="$error700">
          {errorMessage(error, i18n)}
        </Text>
      ) : null}
    </YStack>
  )
}
