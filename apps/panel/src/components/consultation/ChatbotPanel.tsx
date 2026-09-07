/**
 * The assistant thread of a consultation.
 *
 * One request is one turn: the route persists the doctor's message, runs the
 * agent flow and persists its answer, so the thread on screen is exactly the
 * thread in the database. The wait is real (an agent turn takes seconds), which
 * is why the composer says so instead of freezing.
 *
 * When no engine is configured the message is still saved and the panel says
 * plainly that nobody answered — a question in the record with no reply beats a
 * spinner that never ends.
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
  /**
   * The doctor's message while the turn is in flight.
   *
   * `messages` is the DATABASE's copy and only arrives on the refresh the turn
   * triggers — seconds later, because an agent turn is seconds. Without this
   * the message sat in the composer with nothing happening, which reads as a
   * send that did not go through, and doctors press the button again.
   */
  const [pending, setPending] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement | null>(null)

  // Follow the conversation the way a chat does: the newest message is the one
  // being read.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, pending, sending])

  // The optimistic bubble goes away when the real one arrives — matched by
  // text, because the row that comes back has an id this side never saw.
  useEffect(() => {
    if (pending && messages.some((m) => m.role === 'doctor' && m.body === pending)) {
      setPending(null)
    }
  }, [messages, pending])

  const send = async () => {
    const body = draft.trim()
    if (!body || sending) return
    // Cleared and shown FIRST: the composer emptying is the acknowledgement,
    // and the bubble is where the doctor looks next.
    setDraft('')
    setPending(body)
    setSending(true)
    try {
      await onSend(body)
    } catch {
      // The turn failed, so the message is not in the record. Give it back
      // rather than losing what they typed — it may be a long question.
      setPending(null)
      setDraft(body)
    } finally {
      setSending(false)
    }
  }

  return (
    <YStack flex={1}>
      <ScrollView flex={1}>
        {messages.length === 0 && !pending && !sending ? (
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
                  maxWidth="78%"
                  paddingHorizontal={14}
                  paddingVertical={10}
                  borderRadius={12}
                  // The doctor's own bubble has its corner squared off on the
                  // side it points from — the tail every chat has, without
                  // drawing one.
                  borderBottomRightRadius={mine ? 3 : 12}
                  borderBottomLeftRadius={mine ? 12 : 3}
                  backgroundColor={mine ? '$actionSurfacePress' : '$color3'}
                >
                  <Text
                    fontSize={14}
                    color={mine ? '$actionText' : '$color'}
                    lineHeight={21}
                    whiteSpace="pre-wrap"
                  >
                    {message.body}
                  </Text>
                </YStack>
              )
            })}
            {pending ? (
              <YStack
                alignSelf="flex-end"
                maxWidth="78%"
                paddingHorizontal={14}
                paddingVertical={10}
                borderRadius={12}
                borderBottomRightRadius={3}
                backgroundColor="$actionSurfacePress"
                // Dimmed until the API confirms it: it is on screen, and it is
                // not in the record yet.
                opacity={0.6}
              >
                <Text fontSize={14} color="$actionText" lineHeight={21} whiteSpace="pre-wrap">
                  {pending}
                </Text>
              </YStack>
            ) : null}
            {sending ? (
              <XStack alignItems="center" gap="$0.75" alignSelf="flex-start">
                <ThinkingDots />
                <Text fontSize={13} color="$color10">
                  {t('workspace.chat.thinking')}
                </Text>
              </XStack>
            ) : !assistantConnected && messages.some((m) => m.role === 'doctor') ? (
              <Text fontSize={11} color="$color11" alignSelf="flex-start">
                {t('workspace.chat.pending')}
              </Text>
            ) : null}
            <div ref={bottom} />
          </YStack>
        )}
      </ScrollView>

      <YStack
        paddingHorizontal={14}
        paddingVertical={12}
        gap="$0.75"
        borderTopWidth={1}
        borderTopColor="$borderColor"
      >
        <XStack gap="$0.75" alignItems="center">
          <XStack
            flex={1}
            backgroundColor="$background"
            borderWidth={1}
            borderColor="$borderColor"
            borderRadius={20}
            paddingHorizontal={16}
            paddingVertical={2}
          >
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
                fontSize: 13.5,
                padding: '10px 0',
              }}
            />
          </XStack>
          {/* Circular, accent-filled, and the only filled thing in the panel:
              it is the one action here. */}
          <YStack
            role="button"
            tabIndex={0}
            aria-label={t('workspace.chat.send')}
            width={34}
            height={34}
            borderRadius={17}
            alignItems="center"
            justifyContent="center"
            backgroundColor="$actionText"
            opacity={sending || !draft.trim() ? 0.4 : 1}
            cursor={sending || !draft.trim() ? 'default' : 'pointer'}
            onPress={send}
          >
            <Send size={14} color="$background" />
          </YStack>
        </XStack>
        <Text fontSize={11} color="$color10">
          {t('workspace.chat.disclaimer')}
        </Text>
      </YStack>
    </YStack>
  )
}

/**
 * Three dots, bouncing out of phase.
 *
 * A spinner says "loading"; this says "writing", which is what an agent turn
 * actually is and what every chat the doctor already uses shows.
 */
function ThinkingDots() {
  return (
    <XStack gap={4} alignItems="center" height={12}>
      {[0, 1, 2].map((index) => (
        <YStack
          key={index}
          width={5}
          height={5}
          borderRadius={3}
          backgroundColor="$color10"
          animation="bouncy"
          // Staggered so the row reads as movement rather than a blink.
          opacity={0.35}
          enterStyle={{ opacity: 0.35 }}
          style={{
            animation: `pediatric-dot 1.2s ${index * 0.15}s infinite`,
          }}
        />
      ))}
    </XStack>
  )
}
