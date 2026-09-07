/**
 * Targeted edits over a markdown document.
 *
 * A port of the legacy app's `pkg/mdops`, and it exists as its own module for
 * the same reason it does there: every operation is a pure function over
 * (document, args) → (new document, change), so the whole editing surface of
 * the template assistant is testable with no LLM, no websocket and no session.
 *
 * Every failure is a typed `kind`. That is not tidiness — the kind is handed
 * BACK to the model as the tool result, and it is what lets it recover on its
 * own: `section_not_found` means "insert one instead", `anchor_ambiguous` means
 * "send more surrounding text". A bare error string makes the model apologise
 * and stop.
 *
 * Offsets are indices into the OLD document and agree with a plain splice
 * (`doc.slice(0, start) + change.new + doc.slice(end)`), so a client can apply
 * a patch without re-deriving any of the newline normalisation done here.
 */

export type MdErrorKind =
  | 'section_not_found'
  | 'section_ambiguous'
  | 'anchor_not_found'
  | 'anchor_ambiguous'
  | 'empty_input'
  | 'no_change'

export class MdError extends Error {
  constructor(
    readonly kind: MdErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'MdError'
  }
}

/** What one successful edit did, in a shape a diff can be rendered from. */
export type Change = {
  op: 'replace_section' | 'insert_after' | 'replace_text' | 'delete_section' | 'append'
  section?: string
  /** Index into the OLD document where the change began. */
  start_idx: number
  /** Index where it ended, exclusive, in the OLD document. */
  end_idx: number
  /** What was removed (empty for an insert). */
  old: string
  /** What was inserted (empty for a delete). */
  new: string
}

/** An ATX heading: 1–6 `#`, a space, the title. The level delimits a section. */
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm

type Section = {
  level: number
  title: string
  titleNorm: string
  startIdx: number
  /** Start of the next sibling-or-higher heading, or the end of the document. */
  bodyEnd: number
}

function parseSections(doc: string): Section[] {
  const sections: Section[] = []
  HEADING.lastIndex = 0
  for (const match of doc.matchAll(HEADING)) {
    sections.push({
      level: match[1]!.length,
      title: match[2]!.trim(),
      titleNorm: normalizeTitle(match[2]!),
      startIdx: match.index!,
      bodyEnd: doc.length,
    })
  }
  // A section ends where the next heading of the same or a higher level starts;
  // a deeper one is a child and stays inside.
  for (let i = 0; i < sections.length; i += 1) {
    for (let j = i + 1; j < sections.length; j += 1) {
      if (sections[j]!.level <= sections[i]!.level) {
        sections[i]!.bodyEnd = sections[j]!.startIdx
        break
      }
    }
  }
  return sections
}

/**
 * Fold a heading for lookup: lowercase, no trailing colon, no accents, one
 * space between words. The model asks for "Plan", "plan" or "Plan:" and all
 * three have to resolve to the same heading.
 */
export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/:$/, '')
    .trim()
    .normalize('NFD')
    // Strip combining marks — á→a, ñ→n. The Go port hand-lists the characters
    // because its stdlib has no normalisation; JS has it, so this is the whole
    // accent problem rather than the seven letters somebody remembered.
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

function findSection(doc: string, name: string): Section {
  const target = normalizeTitle(name)
  if (!target) throw new MdError('empty_input', 'section name is empty')

  const sections = parseSections(doc)
  const exact = sections.filter((s) => s.titleNorm === target)

  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) {
    throw new MdError(
      'section_ambiguous',
      `${exact.length} sections match "${name}" — use a more specific name`,
    )
  }

  // Soft match, for when the model says "Plan" and the heading reads "Plan
  // terapéutico". Only when it is unambiguous.
  const partial = sections.filter((s) => s.titleNorm.includes(target))
  if (partial.length === 1) return partial[0]!

  throw new MdError(
    'section_not_found',
    `no section matches "${name}" (available: ${sectionTitles(doc).join(', ') || '<none>'})`,
  )
}

/** The headings, in document order. Handlers hand this to the model when a
 *  lookup fails, so its next attempt is informed rather than another guess. */
export function sectionTitles(doc: string): string[] {
  return parseSections(doc).map((s) => s.title)
}

/** Trailing whitespace trimmed and exactly one blank line after, so repeated
 *  edits of the same section do not drift the spacing around it. */
function normalizeSectionBody(body: string): string {
  const trimmed = body.replace(/[ \t\n]+$/, '')
  return trimmed ? `${trimmed}\n\n` : '\n'
}

const preview = (value: string): string => {
  const flat = value.replace(/\n/g, '\\n')
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat
}

/**
 * Rewrite what is under a heading, keeping the heading itself.
 *
 * The heading survives on purpose: it is the anchor every later edit resolves
 * against, so renaming through this operation would silently break the next
 * one. A rename is delete_section + insert_after.
 */
export function replaceSection(
  doc: string,
  name: string,
  newContent: string,
): { doc: string; change: Change } {
  const section = findSection(doc, name)

  const newlineAt = doc.indexOf('\n', section.startIdx)
  const headingEnd = newlineAt < 0 ? doc.length : newlineAt + 1
  const bodyStart = Math.min(headingEnd, doc.length)
  const oldBody = doc.slice(bodyStart, section.bodyEnd)
  const body = normalizeSectionBody(newContent)

  if (body === oldBody) {
    throw new MdError('no_change', 'section already contains this content')
  }

  return {
    doc: doc.slice(0, bodyStart) + body + doc.slice(section.bodyEnd),
    change: {
      op: 'replace_section',
      section: section.title,
      start_idx: bodyStart,
      end_idx: section.bodyEnd,
      old: oldBody,
      new: body,
    },
  }
}

/** Drop a heading and everything under it. Its siblings shift up. */
export function deleteSection(doc: string, name: string): { doc: string; change: Change } {
  const section = findSection(doc, name)
  return {
    doc: doc.slice(0, section.startIdx) + doc.slice(section.bodyEnd),
    change: {
      op: 'delete_section',
      section: section.title,
      start_idx: section.startIdx,
      end_idx: section.bodyEnd,
      old: doc.slice(section.startIdx, section.bodyEnd),
      new: '',
    },
  }
}

/**
 * Put `content` on the line after `anchor`.
 *
 * The anchor matches LITERALLY — whitespace and case sensitive — and must be
 * unique. No fuzzy matching on purpose: a near-match that lands in the wrong
 * place edits the doctor's template somewhere they were not looking, and the
 * typed error costs the model one retry with more context.
 */
export function insertAfter(
  doc: string,
  anchor: string,
  content: string,
): { doc: string; change: Change } {
  if (!anchor.trim()) throw new MdError('empty_input', 'anchor is empty')
  if (!content.trim()) throw new MdError('empty_input', 'content is empty')

  const first = doc.indexOf(anchor)
  if (first < 0) throw new MdError('anchor_not_found', `anchor "${preview(anchor)}" not found`)
  if (doc.indexOf(anchor, first + 1) >= 0) {
    throw new MdError(
      'anchor_ambiguous',
      'anchor appears more than once — include more surrounding text to make it unique',
    )
  }

  let text = doc
  let lineEnd = first + anchor.length
  const newlineAt = text.indexOf('\n', lineEnd)
  if (newlineAt >= 0) {
    lineEnd = newlineAt + 1
  } else {
    // The anchor is on the last line: terminate it so the block does not run
    // straight into it.
    text = `${text}\n`
    lineEnd = text.length
  }

  const block = `${content.replace(/\n+$/, '')}\n`
  return {
    doc: text.slice(0, lineEnd) + block + text.slice(lineEnd),
    change: { op: 'insert_after', start_idx: lineEnd, end_idx: lineEnd, old: '', new: block },
  }
}

/**
 * Add to the END of the document, or BE the document when it is empty.
 *
 * The create-from-scratch path: every other operation needs existing text to
 * target, so a blank template can only be written by this one.
 *
 * The separating blank line is folded into `change.new` rather than left
 * implicit, so a client applying `doc.slice(0,start) + new + doc.slice(end)`
 * reproduces this exact document without re-deriving the normalisation.
 */
export function append(doc: string, content: string): { doc: string; change: Change } {
  if (!content.trim()) throw new MdError('empty_input', 'content is empty')

  const block = `${content.replace(/\n+$/, '')}\n`
  if (doc === '') {
    return { doc: block, change: { op: 'append', start_idx: 0, end_idx: 0, old: '', new: block } }
  }

  const separator = doc.endsWith('\n\n') ? '' : doc.endsWith('\n') ? '\n' : '\n\n'
  const insert = separator + block
  return {
    doc: doc + insert,
    change: { op: 'append', start_idx: doc.length, end_idx: doc.length, old: '', new: insert },
  }
}

/**
 * Exact text replacement. `old` must occur once unless `replaceAll`.
 *
 * Deliberately not fuzzy: if the model gets the spacing wrong it gets a typed
 * error and retries with more context, which is cheap. A fuzzy match that hits
 * the wrong occurrence rewrites part of a clinical template silently.
 */
export function replaceText(
  doc: string,
  oldText: string,
  newText: string,
  replaceAll = false,
): { doc: string; change: Change } {
  if (!oldText) throw new MdError('empty_input', 'old_string is empty')
  if (oldText === newText) throw new MdError('no_change', 'old and new are identical')

  const first = doc.indexOf(oldText)
  if (first < 0) throw new MdError('anchor_not_found', `text "${preview(oldText)}" not found`)

  const count = doc.split(oldText).length - 1
  if (count > 1 && !replaceAll) {
    throw new MdError(
      'anchor_ambiguous',
      `text appears ${count} times — include surrounding context or pass replace_all=true`,
    )
  }

  return {
    doc: replaceAll
      ? doc.split(oldText).join(newText)
      : doc.slice(0, first) + newText + doc.slice(first + oldText.length),
    change: {
      op: 'replace_text',
      start_idx: first,
      end_idx: first + oldText.length,
      old: oldText,
      new: newText,
    },
  }
}
