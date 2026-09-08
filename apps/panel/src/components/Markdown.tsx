/**
 * Renders the markdown that `lib/markdown.ts` parsed.
 *
 * The two writers on the consultation screen both emit markdown — the note
 * comes out of `c_soap` filling a template whose headings are `##`, and the
 * assistant answers in `**bold**` and dash lists like every chat model. This
 * is the component that stops the doctor reading the punctuation.
 *
 * Block level is Tamagui, so it inherits the theme (`$color`, `$borderColor`)
 * and works in a 300 px dock tab as well as in a wide one. Inline level is the
 * browser's own `<strong>`/`<em>`/`<code>`/`<a>` inside a single Tamagui
 * `Text`: emphasis has to WRAP with the sentence it is in, and a nested box
 * would break the line where the bold starts.
 */
import { useMemo } from 'react'
import { Text, XStack, YStack } from 'tamagui'
import { parseMarkdown, type Block, type Inline } from '../lib/markdown'

export function Markdown({
  text,
  fontSize = 13,
  lineHeight = 20,
  color = '$color',
}: {
  text: string
  fontSize?: number
  lineHeight?: number
  /** The bubble the assistant writes in has its own foreground colour. */
  color?: string
}) {
  const blocks = useMemo(() => parseMarkdown(text ?? ''), [text])
  if (!blocks.length) return null

  return (
    <YStack gap={lineHeight * 0.4}>
      {blocks.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          fontSize={fontSize}
          lineHeight={lineHeight}
          color={color}
        />
      ))}
    </YStack>
  )
}

type Style = { fontSize: number; lineHeight: number; color: string }

/** A theme token as the browser spells it. Tamagui publishes every theme key as
 *  a CSS variable, which is how the raw elements below stay on the theme. */
const cssColor = (token: string) => (token.startsWith('$') ? `var(--${token.slice(1)})` : token)

/** Headings step DOWN in size but never below the body: in a dock tab there is
 *  no room for a poster, and `##` is what the templates use for a section. */
const HEADING_SCALE: Record<number, number> = { 1: 1.35, 2: 1.18, 3: 1.08 }

function BlockView({ block, ...style }: { block: Block } & Style) {
  const { fontSize, lineHeight, color } = style

  switch (block.type) {
    case 'heading': {
      const scale = HEADING_SCALE[block.level] ?? 1
      return (
        <Text
          fontSize={Math.round(fontSize * scale)}
          lineHeight={Math.round(lineHeight * scale)}
          fontWeight="700"
          color={color}
          // A `####` under a `##` is a sub-label, not a title: it keeps the
          // body size and earns its rank from the weight alone.
          opacity={block.level >= 4 ? 0.85 : 1}
        >
          <InlineView nodes={block.children} />
        </Text>
      )
    }

    case 'paragraph':
      return (
        <Text fontSize={fontSize} lineHeight={lineHeight} color={color} whiteSpace="pre-wrap">
          <InlineView nodes={block.children} />
        </Text>
      )

    case 'list':
      return (
        <YStack gap={Math.round(lineHeight * 0.15)}>
          {block.items.map((item, index) => (
            <XStack key={index} gap="$0.5" alignItems="flex-start">
              <Text
                fontSize={fontSize}
                lineHeight={lineHeight}
                color={color}
                opacity={0.6}
                // Numbers line up in a column; a bullet needs no width.
                minWidth={block.ordered ? 18 : undefined}
                fontVariant={block.ordered ? ['tabular-nums'] : undefined}
              >
                {item.marker}
              </Text>
              <Text flex={1} fontSize={fontSize} lineHeight={lineHeight} color={color}>
                <InlineView nodes={item.children} />
              </Text>
            </XStack>
          ))}
        </YStack>
      )

    case 'quote':
      return (
        <YStack borderLeftWidth={2} borderLeftColor="$borderColor" paddingLeft="$0.75">
          <Text
            fontSize={fontSize}
            lineHeight={lineHeight}
            color={color}
            opacity={0.85}
            whiteSpace="pre-wrap"
          >
            <InlineView nodes={block.children} />
          </Text>
        </YStack>
      )

    case 'code':
      return (
        <YStack
          backgroundColor="$color3"
          borderRadius="$2"
          paddingHorizontal="$0.75"
          paddingVertical="$0.5"
        >
          {/* Code does not wrap — a dose line broken mid-token is worse than a
              scrollbar — so the block scrolls on its own axis and the panel
              keeps its width. There is no mono font token in the vendored
              config, so this is the one place the family is named outright. */}
          <pre
            style={{
              margin: 0,
              overflowX: 'auto',
              font: `${fontSize - 1}px/${lineHeight}px ui-monospace, SFMono-Regular, Menlo, monospace`,
              color: cssColor(color),
            }}
          >
            {block.value}
          </pre>
        </YStack>
      )

    case 'rule':
      return <YStack height={1} backgroundColor="$borderColor" marginVertical="$0.25" />
  }
}

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case 'text':
            return <span key={index}>{node.value}</span>
          case 'strong':
            return (
              <strong key={index} style={{ fontWeight: 700 }}>
                <InlineView nodes={node.children} />
              </strong>
            )
          case 'em':
            return (
              <em key={index}>
                <InlineView nodes={node.children} />
              </em>
            )
          case 'strike':
            return (
              <s key={index}>
                <InlineView nodes={node.children} />
              </s>
            )
          case 'code':
            return (
              <code
                key={index}
                style={{
                  font: '0.92em/1 ui-monospace, SFMono-Regular, Menlo, monospace',
                  background: 'var(--color3)',
                  borderRadius: 4,
                  padding: '1px 4px',
                }}
              >
                {node.value}
              </code>
            )
          case 'link':
            // The panel runs inside Daguito's page: a link that navigated the
            // host away would take the consultation with it.
            return (
              <a
                key={index}
                href={node.href}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: 'var(--actionText)', textDecoration: 'underline' }}
              >
                <InlineView nodes={node.children} />
              </a>
            )
        }
      })}
    </>
  )
}
