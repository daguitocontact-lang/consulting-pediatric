/**
 * The three data panels of the consultation screen: recommendations, the
 * clinical note, and the transcript. (The chatbot is its own file — it owns a
 * composer and a send loop.)
 *
 * Each one is a pure view over what the workspace endpoint returned plus the
 * callbacks that write back, so the screen holds the state and these hold none.
 */
import { useState } from 'react'
import { FileText, Stethoscope } from '@tamagui/lucide-icons'
import { ScrollView, Text, XStack, YStack } from 'tamagui'
import type { translator } from '../../lib/i18n'
import { formatDuration } from '../../lib/consultations'
import type { ClinicalNote, Recommendation, TranscriptSegment } from '../../lib/workspace'
import type { PartialLine } from '../../lib/useConsultationStream'
import { PanelEmpty } from './Panel'
import { Markdown } from '../Markdown'
import { MarkdownEditor } from '../MarkdownEditor'
import { Badge, Button } from '../ui'

// ── Recomendaciones ───────────────────────────────────────────────────

export function RecommendationsPanel({
  i18n,
  recommendations,
  onSetStatus,
}: {
  i18n: ReturnType<typeof translator>
  recommendations: Recommendation[]
  onSetStatus: (id: string, status: 'featured' | 'removed' | null) => void
}) {
  const { t } = i18n
  if (!recommendations.length) {
    return (
      <PanelEmpty
        icon={<Stethoscope size={20} color="$color10" />}
        label={t('workspace.recommendations.empty')}
        hint={t('workspace.recommendations.emptyHint')}
      />
    )
  }

  return (
    <ScrollView flex={1}>
      <YStack padding="$1.5" gap="$1">
        {recommendations.map((item) => (
          <YStack
            key={item.id}
            gap="$0.5"
            padding="$1"
            borderRadius="$3"
            borderWidth={1}
            borderColor={item.status === 'featured' ? '$actionText' : '$borderColor'}
            backgroundColor={item.status === 'featured' ? '$actionSurfaceHover' : '$background'}
          >
            <XStack alignItems="center" gap="$0.5" flexWrap="wrap">
              <Badge variant={item.status === 'featured' ? 'info' : 'neutral'} size="sm">
                {item.category}
              </Badge>
              {item.priority !== null ? (
                <Text fontSize={11} color="$color11">
                  #{item.priority}
                </Text>
              ) : null}
            </XStack>
            <Text
              fontSize={13}
              color={item.status === 'removed' ? '$color10' : '$color'}
              // A discarded suggestion is struck through rather than deleted:
              // the doctor may want to see what was proposed and rejected.
              textDecorationLine={item.status === 'removed' ? 'line-through' : 'none'}
            >
              {item.value}
            </Text>
            <XStack gap="$0.5">
              <Button
                size="sm"
                variant={item.status === 'featured' ? 'primary' : 'ghost'}
                onPress={() => onSetStatus(item.id, item.status === 'featured' ? null : 'featured')}
              >
                {t('workspace.recommendations.feature')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => onSetStatus(item.id, item.status === 'removed' ? null : 'removed')}
              >
                {t('workspace.recommendations.discard')}
              </Button>
            </XStack>
          </YStack>
        ))}
      </YStack>
    </ScrollView>
  )
}

// ── SOAP / nota clínica ───────────────────────────────────────────────

export function NotePanel({
  i18n,
  note,
  onSave,
}: {
  i18n: ReturnType<typeof translator>
  note: ClinicalNote
  onSave: (body: string) => Promise<void>
}) {
  const { t } = i18n
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  if (!editing && !note?.body) {
    return (
      <YStack flex={1}>
        <PanelEmpty label={t('workspace.note.empty')} />
        <XStack padding="$1" justifyContent="center">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              setDraft('')
              setEditing(true)
            }}
          >
            {t('workspace.note.write')}
          </Button>
        </XStack>
      </YStack>
    )
  }

  if (editing) {
    return (
      <YStack flex={1} padding="$1" gap="$1">
        {/* A plain textarea, not a rich editor: the note is markdown, the
            doctor edits it as text, and the flow writes the same field. The
            toolbar and ⌘B only write the markers the doctor would type. */}
        <MarkdownEditor i18n={i18n} value={draft} onChange={setDraft} />
        <XStack gap="$0.5" justifyContent="flex-end">
          <Button size="sm" variant="ghost" onPress={() => setEditing(false)}>
            {t('form.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={saving}
            onPress={async () => {
              setSaving(true)
              try {
                await onSave(draft)
                setEditing(false)
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? t('form.saving') : t('form.save')}
          </Button>
        </XStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1}>
      <ScrollView flex={1}>
        {/* The note IS markdown — `c_soap` fills a template whose sections are
            `##` headings — so it is rendered, not shown with its punctuation.
            The doctor reads this before signing it. */}
        <YStack padding="$1.5">
          <Markdown text={note?.body ?? ''} />
        </YStack>
      </ScrollView>
      <XStack padding="$1" gap="$0.5" justifyContent="space-between" alignItems="center">
        <Text fontSize={11} color="$color11">
          {note?.edited_at ? t('workspace.note.edited') : t('workspace.note.draft')}
        </Text>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            setDraft(note?.body ?? '')
            setEditing(true)
          }}
        >
          {t('form.edit')}
        </Button>
      </XStack>
    </YStack>
  )
}

// ── Transcripción ─────────────────────────────────────────────────────

export function TranscriptionPanel({
  i18n,
  segments,
  partials = [],
}: {
  i18n: ReturnType<typeof translator>
  segments: TranscriptSegment[]
  /**
   * What is being said right now, before the sentence is finished.
   *
   * Shown greyed and italic, never stored. Without it the panel sits blank for
   * whole sentences at a time while the flow waits for a pause, and a doctor
   * cannot tell that from a microphone that is not working — which is the
   * failure the level meter in the header was added to compensate for. The
   * legacy app shows the same thing from the same `node.token` events.
   */
  partials?: PartialLine[]
}) {
  const { t } = i18n
  if (!segments.length && !partials.length) {
    return (
      <PanelEmpty
        icon={<FileText size={20} color="$color10" />}
        label={t('workspace.transcript.empty')}
        hint={t('workspace.transcript.emptyHint')}
      />
    )
  }

  const speakerLabel = (speaker: string | null) =>
    speaker === 'doctor'
      ? t('workspace.transcript.doctor')
      : speaker === 'patient'
        ? t('workspace.transcript.patient')
        : (speaker ?? '')

  return (
    <ScrollView flex={1}>
      <YStack padding="$1.5" gap="$0.75">
        {segments.map((segment) => (
          <XStack key={segment.id} gap="$0.75" alignItems="flex-start">
            <Text fontSize={11} color="$color10" width={44} fontVariant={['tabular-nums']}>
              {formatDuration(segment.at_seconds)}
            </Text>
            <YStack flex={1} gap="$0.25">
              {segment.speaker ? (
                <Text fontSize={11} fontWeight="700" color="$color11">
                  {speakerLabel(segment.speaker)}
                </Text>
              ) : null}
              <Text fontSize={13} color="$color" lineHeight={19}>
                {segment.text}
              </Text>
            </YStack>
          </XStack>
        ))}

        {partials.map((line, index) => (
          <XStack key={`partial-${index}`} gap="$0.75" alignItems="flex-start">
            <Text fontSize={11} color="$color10" width={44}>
              …
            </Text>
            <YStack flex={1} gap="$0.25">
              {line.speaker ? (
                <Text fontSize={11} fontWeight="700" color="$color10">
                  {speakerLabel(line.speaker)}
                </Text>
              ) : null}
              <Text fontSize={13} color="$color10" lineHeight={19} fontStyle="italic">
                {line.text}
              </Text>
            </YStack>
          </XStack>
        ))}
      </YStack>
    </ScrollView>
  )
}
