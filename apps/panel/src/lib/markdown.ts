/**
 * Markdown, parsed here and rendered by `components/Markdown.tsx`.
 *
 * Everything the doctor reads on the consultation screen is markdown and none
 * of it was written by hand: the note comes out of `c_soap` against a template
 * whose headings ARE `##`, and the assistant answers like every chat model
 * does — `**Primera línea**`, a dash list under it. Shown verbatim that reads
 * as broken output, and worse, the emphasis lands on the asterisks instead of
 * on the dose.
 *
 * No library, for the same reason as `panel-layout.ts`: the bundle already
 * carries React and Tamagui into somebody else's page, this is a subset of
 * CommonMark that fits in a file, and every rule in it is a pure function that
 * a test can hold. What is supported is what the two writers actually emit —
 * headings, emphasis, lists, quotes, code, links, rules — and anything else
 * falls through as the text it was, which is the only failure mode worth
 * having in a clinical record.
 *
 * Two things it deliberately does NOT do:
 *  - `[[hueco]]` is not a link. A template body is full of them and they must
 *    survive to the screen exactly as typed, so a `[…]` only becomes a link
 *    when a `(` follows the `]`.
 *  - a soft line break stays a line break. Real markdown collapses it into a
 *    space; a note where the doctor put "No refiere" under a heading on its own
 *    line means that line to be its own line.
 */

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'strike'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] }

export type ListItem = { children: Inline[]; marker: string }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'quote'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'rule' }

// ── Inline ────────────────────────────────────────────────────────────

/** Markers that open and close by repetition, longest first so `**` wins. */
const EMPHASIS: { marker: string; type: 'strong' | 'em' | 'strike' }[] = [
  { marker: '**', type: 'strong' },
  { marker: '__', type: 'strong' },
  { marker: '~~', type: 'strike' },
  { marker: '*', type: 'em' },
  { marker: '_', type: 'em' },
]

const ESCAPABLE = '\\`*_~[]()#-'

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char)

/**
 * Parses one line's worth of markdown into spans.
 *
 * A marker that never closes is not emphasis, it is an asterisk: the scanner
 * only consumes a pair, so `3 * 4` and a lone `**` stay literal text.
 */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''

  const flush = () => {
    if (text) {
      out.push({ type: 'text', value: text })
      text = ''
    }
  }

  let i = 0
  while (i < src.length) {
    const char = src[i]

    if (char === '\\' && ESCAPABLE.includes(src[i + 1] ?? '')) {
      text += src[i + 1]
      i += 2
      continue
    }

    if (char === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ type: 'code', value: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    if (char === '[') {
      const link = matchLink(src, i)
      if (link) {
        flush()
        out.push({ type: 'link', href: link.href, children: parseInline(link.label) })
        i = link.end
        continue
      }
    }

    const emphasis = matchEmphasis(src, i)
    if (emphasis) {
      flush()
      out.push({ type: emphasis.type, children: parseInline(emphasis.content) })
      i = emphasis.end
      continue
    }

    text += char
    i += 1
  }

  flush()
  return out
}

function matchEmphasis(
  src: string,
  at: number,
): { type: 'strong' | 'em' | 'strike'; content: string; end: number } | null {
  for (const { marker, type } of EMPHASIS) {
    if (!src.startsWith(marker, at)) continue

    // `snake_case` and `mg_kg` are one word, not an italic. Underscores only
    // open when they are not sitting between two word characters; asterisks
    // have no such rule, which is why every generator uses them.
    if (marker.startsWith('_') && isWordChar(src[at - 1])) continue

    let from = at + marker.length
    while (from < src.length) {
      let close = src.indexOf(marker, from)
      if (close < 0) break
      // `***texto***` is bold AND italic: three asterisks are one run that has
      // to be split, so the outer marker closes at the END of the run and the
      // leftovers stay inside for the recursive pass to pick up.
      let runEnd = close
      while (src[runEnd] === marker[0]) runEnd += 1
      if (runEnd - close > marker.length) close = runEnd - marker.length
      const content = src.slice(at + marker.length, close)
      // A pair with nothing in it, or one whose closer is glued to the start
      // (`** x`), is not emphasis — and `_` again refuses to close mid-word.
      if (
        content.length > 0 &&
        !/^\s/.test(content) &&
        !/\s$/.test(content) &&
        !(marker.startsWith('_') && isWordChar(src[close + marker.length]))
      ) {
        return { type, content, end: close + marker.length }
      }
      from = close + marker.length
    }
  }
  return null
}

function matchLink(src: string, at: number): { label: string; href: string; end: number } | null {
  // `[[hueco]]` — a template blank, not a link. It has no `](` and so it falls
  // out of here as literal text, which is exactly what the flow needs to read
  // back.
  let depth = 0
  let close = -1
  for (let i = at; i < src.length; i += 1) {
    if (src[i] === '\\') {
      i += 1
      continue
    }
    if (src[i] === '[') depth += 1
    else if (src[i] === ']') {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close < 0 || src[close + 1] !== '(') return null

  const end = src.indexOf(')', close + 2)
  if (end < 0) return null

  const href = src.slice(close + 2, end).trim()
  if (!href || /\s/.test(href)) return null

  return { label: src.slice(at + 1, close), href, end: end + 1 }
}

// ── Blocks ────────────────────────────────────────────────────────────

const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const BULLET = /^(\s*)([-*+])\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const FENCE = /^ {0,3}(?:```|~~~)/

/** The whole document, as blocks. Blank input is an empty list, not a blank
 *  paragraph: a panel decides for itself what "nothing yet" looks like. */
export function parseMarkdown(src: string): Block[] {
  const lines = (src ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i += 1
      continue
    }

    if (FENCE.test(line)) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      // An unclosed fence still ends: at the end of the document.
      if (i < lines.length) i += 1
      blocks.push({ type: 'code', value: body.join('\n') })
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      i += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6
      // Closing hashes (`## Título ##`) are decoration, not content.
      const body = heading[2].replace(/\s+#+\s*$/, '')
      blocks.push({ type: 'heading', level, children: parseInline(body) })
      i += 1
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])![1])
        i += 1
      }
      blocks.push({ type: 'quote', children: parseInline(body.join('\n')) })
      continue
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = !BULLET.test(line)
      const items: ListItem[] = []
      while (i < lines.length) {
        const match = ordered ? ORDERED.exec(lines[i]) : BULLET.exec(lines[i])
        if (!match) break
        const rest: string[] = [match[3]]
        i += 1
        // An item can run over: a following line that is neither blank nor the
        // start of something else belongs to the bullet above it.
        while (
          i < lines.length &&
          lines[i].trim() &&
          !BULLET.test(lines[i]) &&
          !ORDERED.test(lines[i]) &&
          !HEADING.test(lines[i]) &&
          !QUOTE.test(lines[i]) &&
          !RULE.test(lines[i]) &&
          !FENCE.test(lines[i])
        ) {
          rest.push(lines[i].trim())
          i += 1
        }
        items.push({
          children: parseInline(rest.join(' ')),
          marker: ordered ? `${match[2]}.` : '•',
        })
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const paragraph: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEADING.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !ORDERED.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !FENCE.test(lines[i])
    ) {
      paragraph.push(lines[i])
      i += 1
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) })
  }

  return blocks
}

// ── Editing (the toolbar and ⌘B) ──────────────────────────────────────

export type WrapResult = { text: string; selectionStart: number; selectionEnd: number }

/**
 * Wraps (or unwraps) the selection in a marker — what ⌘B does in every editor.
 *
 * It is a pure function over the textarea's value and its two offsets, so the
 * rules are testable and the component only has to put the result back and
 * restore the selection:
 *  - already wrapped, inside or outside the selection → the markers come off,
 *    so the same key toggles;
 *  - a selection with spaces at its edges is trimmed first, because `** x **`
 *    is not bold in any renderer;
 *  - no selection at all wraps the word the caret is in, and on empty space
 *    leaves an empty pair with the caret between the markers, ready to type.
 */
export function toggleWrap(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
): WrapResult {
  let start = Math.max(0, Math.min(selectionStart, text.length))
  let end = Math.max(start, Math.min(selectionEnd, text.length))

  if (start === end) {
    const word = wordAround(text, start)
    start = word.start
    end = word.end
  } else {
    // Trim the selection onto the words themselves.
    while (start < end && /\s/.test(text[start])) start += 1
    while (end > start && /\s/.test(text[end - 1])) end -= 1
  }

  const len = marker.length
  const selected = text.slice(start, end)

  // Wrapped from outside: `**|texto|**`.
  if (text.slice(start - len, start) === marker && text.slice(end, end + len) === marker) {
    const next = text.slice(0, start - len) + selected + text.slice(end + len)
    return { text: next, selectionStart: start - len, selectionEnd: end - len }
  }

  // Wrapped from inside: `|**texto**|`.
  if (selected.length > 2 * len && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(len, -len)
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    }
  }

  const next = text.slice(0, start) + marker + selected + marker + text.slice(end)
  return {
    // An empty pair puts the caret between the markers; a wrapped word keeps
    // the word selected, so a second press undoes it.
    selectionStart: selected ? start + len : start + len,
    selectionEnd: selected ? end + len : start + len,
    text: next,
  }
}

/** The word the caret sits in, or an empty range when it sits on whitespace. */
function wordAround(text: string, at: number): { start: number; end: number } {
  const boundary = /[\s]/
  let start = at
  let end = at
  while (start > 0 && !boundary.test(text[start - 1])) start -= 1
  while (end < text.length && !boundary.test(text[end])) end += 1
  return start === end ? { start: at, end: at } : { start, end }
}

/**
 * Puts a line prefix on (or takes it off) every line the selection touches —
 * what the list button does.
 *
 * Toggling looks at the WHOLE selection: if every line already carries the
 * prefix the button takes it off, otherwise it puts it on the ones missing it.
 * A half-marked selection therefore finishes the job instead of inverting it,
 * which is what an editor does and what a doctor expects when they select four
 * lines of indications and press the bullet.
 */
export function toggleLinePrefix(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
): WrapResult {
  const start = Math.max(0, Math.min(selectionStart, text.length))
  const end = Math.max(start, Math.min(selectionEnd, text.length))

  const from = text.lastIndexOf('\n', start - 1) + 1
  const toBreak = text.indexOf('\n', end)
  const to = toBreak < 0 ? text.length : toBreak

  const lines = text.slice(from, to).split('\n')
  const marked = lines.every((line) => !line.trim() || line.trimStart().startsWith(prefix))

  const next = lines
    .map((line) => {
      if (!line.trim()) return line
      if (marked) {
        const at = line.indexOf(prefix)
        return line.slice(0, at) + line.slice(at + prefix.length)
      }
      // A line that already carries it is left alone: marking a half-marked
      // selection finishes it, it does not double the bullet.
      return line.trimStart().startsWith(prefix) ? line : prefix + line
    })
    .join('\n')

  return {
    text: text.slice(0, from) + next + text.slice(to),
    // The whole affected block stays selected: the next press undoes it.
    selectionStart: from,
    selectionEnd: from + next.length,
  }
}
