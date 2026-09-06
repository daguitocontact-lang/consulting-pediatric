/**
 * The assistant thread of a consultation.
 *
 * The thread is PERSISTED here and answered elsewhere: the doctor's message is
 * written to `/api/consultations/:id/chat` immediately, and the assistant's
 * reply lands in the same thread when the flow answers. That split is what
 * makes the panel honest while the AI side is still being wired — a question
 * typed today is in the record, and the panel says plainly that nobody has
 * answered yet instead of spinning forever.
 */
import { useEffect, useRef, useState } from 'react'
import { Send, Stethoscope } from '@tamagui/lucide-icons'
import { ScrollView, Text, XStack, YStack } from 'tamagui'
import type { translator } from '../../lib/i18n'
import type { ChatMessage } from '../../lib/workspace'
import { Button } from '../ui'
import { PanelEmpty } from './Panel'

export function ChatbotPanel({
  i18n,
  messages,
  onSend,
  assistantConnected,
}: {
  i18n: ReturnType<typeof translator>
  messages: ChatMessage[]
  onSend: (body: string) => Promise<void>
  /** False while no flow is wired: the panel says so rather than pretending. */
  assistantConnected: boolean
}) {
  const { t } = i18n
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement | null>(null)

  // Follow the conversation the way a chat does: the newest message is the one
  // being read.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const send = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    try {
      await onSend(body)
      setDraft('')
    } finally {
      setSending(false)
    }
  }

  return (
    <YStack flex={1}>
      <ScrollView flex={1}>
        {messages.length === 0 ? (
          <YStack minHeight={140} flex={1}>
            <PanelEmpty
              icon={<Stethoscope size={22} color="$color10" />}
              label={`${t('workspace.chat.title')} · ${t('workspace.chat.intro')}`}
            />
          </YStack>
        ) : (
          <YStack padding="$1.5" gap="$1">
            {messages.map((message) => {
              const mine = message.role === 'doctor'
              return (
                <YStack
                  key={message.id}
                  alignSelf={mine ? 'flex-end' : 'flex-start'}
                  maxWidth="88%"
                  paddingHorizontal="$1"
                  paddingVertical="$0.75"
                  borderRadius="$4"
                  backgroundColor={mine ? '$actionSurfaceHover' : '$color3'}
                >
                  <Text fontSize={13} color="$color" lineHeight={19} whiteSpace="pre-wrap">
                    {message.body}
                  </Text>
                </YStack>
              )
            })}
            {!assistantConnected && messages.some((m) => m.role === 'doctor') ? (
              <Text fontSize={11} color="$color11" alignSelf="flex-start">
                {t('workspace.chat.pending')}
              </Text>
            ) : null}
            <div ref={bottom} />
          </YStack>
        )}
      </ScrollView>

      <YStack padding="$1" gap="$0.5" borderTopWidth={1} borderTopColor="$borderColor">
        <XStack gap="$0.5" alignItems="center">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter is a newline — what every chat does,
              // and what a doctor typing between two sentences expects.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder={t('workspace.chat.placeholder')}
            aria-label={t('workspace.chat.placeholder')}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              fontSize: 13,
              padding: '8px 4px',
            }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={sending || draft.trim().length === 0}
            iconBefore={<Send size={14} />}
            onPress={send}
            aria-label={t('workspace.chat.send')}
          />
        </XStack>
        <Text fontSize={10} color="$color10">
          {t('workspace.chat.disclaimer')}
        </Text>
      </YStack>
    </YStack>
  )
}
