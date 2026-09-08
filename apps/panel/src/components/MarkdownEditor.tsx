/**
 * A textarea that writes markdown, with the three buttons that produce it.
 *
 * Still a plain `<textarea>` and not a rich editor, for the reason the note and
 * the template editors already carried: the text IS markdown, the flow reads it
 * back as markdown, and a contenteditable would fight the `[[huecos]]` the
 * engine parses. What was missing was only the shortcut — the doctor could see
 * bold once `Markdown.tsx` rendered it, but had to type the asterisks.
 *
 * Every rule about what the buttons do lives in `lib/markdown.ts` as a pure
 * function over (value, selectionStart, selectionEnd); this component only
 * hands the textarea its result and puts the selection back where the function
 * said, because a caret that jumps to the end after ⌘B is worse than no ⌘B.
 */
import { useRef } from 'react'
import { Bold, Italic, List } from '@tamagui/lucide-icons'
import { XStack } from 'tamagui'
import type { translator } from '../lib/i18n'
import { toggleLinePrefix, toggleWrap, type WrapResult } from '../lib/markdown'

export function MarkdownEditor({
  i18n,
  value,
  onChange,
  style,
  minHeight = 160,
  autoFocus,
  placeholder,
}: {
  i18n: ReturnType<typeof translator>
  value: string
  onChange: (next: string) => void
  style?: React.CSSProperties
  minHeight?: number
  autoFocus?: boolean
  placeholder?: string
}) {
  const { t } = i18n
  const area = useRef<HTMLTextAreaElement | null>(null)

  const apply = (transform: (text: string, start: number, end: number) => WrapResult) => {
    const el = area.current
    if (!el) return
    const result = transform(el.value, el.selectionStart, el.selectionEnd)
    onChange(result.text)
    // React re-renders with the new value; the selection has to be restored
    // after that, or the browser drops the caret at the end of the field.
    requestAnimationFrame(() => {
      const current = area.current
      if (!current) return
      current.focus()
      current.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  return (
    <>
      <XStack gap="$0.25" alignItems="center">
        <ToolButton
          label={t('editor.bold')}
          onPress={() => apply((text, start, end) => toggleWrap(text, start, end, '**'))}
        >
          <Bold size={13} color="$color11" />
        </ToolButton>
        <ToolButton
          label={t('editor.italic')}
          onPress={() => apply((text, start, end) => toggleWrap(text, start, end, '*'))}
        >
          <Italic size={13} color="$color11" />
        </ToolButton>
        <ToolButton
          label={t('editor.list')}
          onPress={() => apply((text, start, end) => toggleLinePrefix(text, start, end, '- '))}
        >
          <List size={13} color="$color11" />
        </ToolButton>
      </XStack>

      <textarea
        ref={area}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // ⌘B / ⌃B and ⌘I / ⌃I: the two every editor has, on both platforms.
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return
          const key = event.key.toLowerCase()
          if (key !== 'b' && key !== 'i') return
          event.preventDefault()
          apply((text, start, end) => toggleWrap(text, start, end, key === 'b' ? '**' : '*'))
        }}
        spellCheck
        style={{
          flex: 1,
          minHeight,
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          fontSize: 13,
          lineHeight: 1.5,
          ...style,
        }}
      />
    </>
  )
}

function ToolButton({
  label,
  onPress,
  children,
}: {
  label: string
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <XStack
      role="button"
      tabIndex={0}
      aria-label={label}
      width={26}
      height={26}
      borderRadius="$2"
      alignItems="center"
      justifyContent="center"
      cursor="pointer"
      hoverStyle={{ backgroundColor: '$color3' }}
      // The press must not steal the selection: the textarea has to still know
      // what was highlighted when the transform runs.
      onMouseDown={(event: { preventDefault: () => void }) => event.preventDefault()}
      onPress={onPress}
    >
      {children}
    </XStack>
  )
}
