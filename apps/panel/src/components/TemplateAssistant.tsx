/**
 * The bot that edits a template with the doctor, in words.
 *
 * Its answers are NOT the template. It edits the row directly — through the
 * five tools in the API's `/agent/functions` — and the turn comes back with the
 * template as it now stands plus an `edited` flag. So when a turn edits, this
 * hands the new body up and the editor re-renders from it; it never tries to
 * reconstruct a document out of a description in prose, which is what makes the
 * legacy's version reliable and its tool contract worth copying exactly.
 *
 * The thread is NOT stored. It travels in the request and into the prompt, the
 * way the legacy's does (its history is the browser's too), so closing the
 * section ends the conversation and a template carries no chat log around.
 */
import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles } from '@tamagui/lucide-icons'
import { ScrollView, Text, XStack, YStack } from 'tamagui'
import { apiPost, errorMessage, type MountProps } from '../lib/api'
import type { translator } from '../lib/i18n'
import { Button, Spinner } from './ui'

export type AssistantMessage = { role: 'doctor' | 'assistant'; body: string }

type TurnResponse = {
  reply: string
  edited: boolean
  template: { body: string; title: string } | null
}

export function TemplateAssistant({
  props,
  i18n,
  templateId,
  /** Fired when a turn changed the row, with the body as it now stands. */
  onEdited,
}: {
  props: MountProps
  i18n: ReturnType<typeof translator>
  templateId: string
  onEdited: (body: string) => void
}) {
  const { t } = i18n
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement | null>(null)

  // A new template is a new conversation: carrying the thread across would let
  // the bot answer about a document it is no longer looking at.
  useEffect(() => {
    setMessages([])
    setDraft('')
  }, [templateId])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, sending])

  const send = async () => {
    const body = draft.trim()
    if (!body || sending) return

    // The doctor's message goes up immediately: a turn takes seconds, and a
    // composer that empties with nothing to show for it reads as a lost message.
    const history = messages
    setMessages([...history, { role: 'doctor', body }])
    setDraft('')
    setSending(true)
    try {
      const turn = await apiPost<TurnResponse>(
        props,
        `/api/consultation-templates/${templateId}/assistant`,
        { message: body, history },
      )
      if (turn.edited && turn.template) onEdited(turn.template.body)
      setMessages((current) => [
        ...current,
        { role: 'assistant', body: turn.reply || t('template.bot.silent') },
      ])
    } catch (err) {
      setMessages((current) => [
        ...current,
        { role: 'assistant', body: errorMessage(err, i18n) },
      ])
    } finally {
      setSending(false)
    }
  }

  return (
    <YStack
      flex={1}
      minHeight={320}
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$4"
      overflow="hidden"
    >
      <XStack
        alignItems="center"
        gap="$0.5"
        padding="$1"
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
        backgroundColor="$color2"
      >
        <Sparkles size={14} color="$actionText" />
        <Text fontSize={13} fontWeight="700" color="$color">
          {t('template.bot.title')}
        </Text>
      </XStack>

      <ScrollView flex={1}>
        {messages.length === 0 ? (
          <YStack padding="$1.5" gap="$0.75">
            <Text fontSize={13} color="$color11" lineHeight={19}>
              {t('template.bot.intro')}
            </Text>
            {/* Examples, because "ask me anything" produces nothing. These are
                the three shapes the tools cover: create, insert, change. */}
            <YStack gap="$0.5">
              {['template.bot.eg1', 'template.bot.eg2', 'template.bot.eg3'].map((key) => (
                <Text
                  key={key}
                  fontSize={12}
                  color="$color10"
                  fontStyle="italic"
                  cursor="pointer"
                  onPress={() => setDraft(t(key as never))}
                >
                  «{t(key as never)}»
                </Text>
              ))}
            </YStack>
          </YStack>
        ) : (
          <YStack padding="$1.5" gap="$1">
            {messages.map((message, index) => {
              const mine = message.role === 'doctor'
              return (
                <YStack
                  key={index}
                  alignSelf={mine ? 'flex-end' : 'flex-start'}
                  maxWidth="90%"
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
            {sending ? (
              <XStack alignItems="center" gap="$0.5" alignSelf="flex-start">
                <Spinner size="sm" />
                <Text fontSize={11} color="$color11">
                  {t('template.bot.thinking')}
                </Text>
              </XStack>
            ) : null}
            <div ref={bottom} />
          </YStack>
        )}
      </ScrollView>

      <XStack
        gap="$0.5"
        alignItems="center"
        padding="$1"
        borderTopWidth={1}
        borderTopColor="$borderColor"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter is a newline.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          placeholder={t('template.bot.placeholder')}
          aria-label={t('template.bot.placeholder')}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'inherit',
            font: '13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          }}
        />
        <Button
          size="sm"
          variant="primary"
          disabled={sending || !draft.trim()}
          iconBefore={<Send size={14} />}
          onPress={send}
        >
          {t('template.bot.send')}
        </Button>
      </XStack>
    </YStack>
  )
}
