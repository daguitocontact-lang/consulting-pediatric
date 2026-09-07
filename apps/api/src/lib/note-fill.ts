/**
 * The clinical note as a set of fillable FIELDS.
 *
 * A port of the legacy's `pkg/service/medical_chatbot_fill.go`, and the reason
 * the assistant can write into the note at all: it does not rewrite the
 * document, it locates ONE field's value span and splices it. The doctor's
 * fixed text — every heading, label and separator they wrote — is never
 * touched, because it is what the spans are measured from.
 *
 * The alignment is the interesting part, and the legacy learned it the hard
 * way. The note is rendered by an LLM that rarely reproduces the template's
 * fixed text byte for byte: it reformats headings, merges units like ` mg/dL`
 * into the value, tweaks spacing. Strict alignment failed the WHOLE document on
 * the first such drift — measured at 83% of their production notes — and left
 * the assistant unable to edit any field at all. So anchoring is RESILIENT: a
 * fixed segment that cannot be found is marked unlocated and only the fields it
 * bounds are skipped, while every other field stays editable.
 *
 * Pure functions over (doc, template): no session, no websocket, no model.
 */

/** `[[a natural-language description of the field]]` — the template's slots. */
const PLACEHOLDER = /\[\[([^[\]]+)\]\]/g

/** What the renderer leaves in a slot the consultation said nothing about. */
const NOT_MENTIONED = '_No referido_'

const HTML_TAG = /<[^>]*>/g

export type NoteField = {
  /** The human label, taken from the fixed text just before the slot. */
  label: string
  /** The template's instruction for this slot. */
  hint: string
  /** The value as it stands, trimmed. */
  value: string
  /** Where the value sits in the note, for a splice. */
  start: number
  end: number
  /** Blank, an untouched placeholder, or "_No referido_". */
  empty: boolean
}

/**
 * The label a doctor would call this field.
 *
 * The last non-empty line of the fixed text before the slot, stripped of
 * markup: `## Motivo de consulta\n\n[[…]]` → "Motivo de consulta".
 */
function labelFromFixed(fixed: string): string {
  const lines = fixed.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const label = lines[i]!.replace(HTML_TAG, '').trim().replace(/^[*#>\-•:\s]+|[*#>\-•:\s]+$/g, '').trim()
    if (label) return label
  }
  return ''
}

/**
 * Whether a value counts as "not filled".
 *
 * Blank, the untouched `[[hint]]`, or the not-mentioned marker. A real value
 * like "No se solicitan hoy" is NOT empty — replacing that is a decision the
 * doctor has to have asked for.
 */
function isEmpty(raw: string, hint: string): boolean {
  const value = raw.trim()
  if (!value) return true
  if (value === `[[${hint}]]`) return true
  // Leftover placeholders with nothing else around them.
  const withoutSlots = value.replace(PLACEHOLDER, '').trim()
  if (withoutSlots === '' && /\[\[/.test(value)) return true
  return value.toLowerCase() === NOT_MENTIONED.toLowerCase() || value.toLowerCase() === 'no referido'
}

type Anchor = { start: number; end: number; found: boolean }

/**
 * Where each of the template's fixed segments sits in the note.
 *
 * Resilient, not all-or-nothing: a segment that cannot be found is marked
 * unlocated WITHOUT aborting, so the remaining headings still anchor and the
 * fields they bound stay editable. The cursor only advances past segments that
 * were actually located.
 */
function locateAnchors(doc: string, fixed: string[]): Anchor[] {
  const anchors: Anchor[] = []
  let cursor = 0

  fixed.forEach((segment, index) => {
    const blank = segment.trim() === ''
    if (blank && index === 0) {
      // The template opens with a slot: field 0's left edge is the doc start.
      anchors.push({ start: 0, end: 0, found: true })
    } else if (blank && index === fixed.length - 1) {
      // It ends with one: the last field's right edge is the doc end.
      anchors.push({ start: doc.length, end: doc.length, found: true })
    } else if (blank) {
      // Two adjacent slots. There is no fixed text to anchor on, so it cannot
      // bound a value; leaving it unlocated skips the two fields it touches
      // rather than splicing one of them into the wrong place.
      anchors.push({ start: cursor, end: cursor, found: false })
    } else {
      const at = doc.indexOf(segment, cursor)
      if (at < 0) anchors.push({ start: cursor, end: cursor, found: false })
      else {
        anchors.push({ start: at, end: at + segment.length, found: true })
        cursor = at + segment.length
      }
    }
  })
  return anchors
}

/**
 * The note's fields, by aligning the template against it.
 *
 * Returns null when there is no template, no slots in it, or not a single
 * field could be anchored — the caller then falls back to reading the markers
 * the renderer left in the note itself.
 */
export function alignFields(doc: string, template: string): NoteField[] | null {
  if (!template.trim()) return null

  const fixed: string[] = []
  const hints: string[] = []
  let previous = 0
  for (const match of template.matchAll(PLACEHOLDER)) {
    fixed.push(template.slice(previous, match.index!))
    hints.push(match[1]!.trim())
    previous = match.index! + match[0].length
  }
  if (!hints.length) return null
  fixed.push(template.slice(previous))

  const anchors = locateAnchors(doc, fixed)
  const fields: NoteField[] = []

  hints.forEach((hint, index) => {
    const left = anchors[index]!
    const right = anchors[index + 1]!
    // Editable only when BOTH edges are located and do not overlap; otherwise
    // the value cannot be bounded and the field is left alone.
    if (!left.found || !right.found || right.start < left.end) return
    const raw = doc.slice(left.end, right.start)
    fields.push({
      label: labelFromFixed(fixed[index]!),
      hint,
      value: raw.trim(),
      start: left.end,
      end: right.start,
      empty: isEmpty(raw, hint),
    })
  })

  return fields.length ? fields : null
}

/**
 * The fallback: the slots the note itself still carries.
 *
 * Used when there is no template to align, or when it drifted beyond
 * recognition. Only EMPTY slots are visible this way — a filled field leaves no
 * marker to find — which is the right degradation: the assistant can complete
 * what is missing and cannot touch what a doctor already wrote.
 */
export function markerFields(doc: string): NoteField[] {
  const fields: NoteField[] = []

  const push = (start: number, end: number, hint: string) => {
    fields.push({
      label: labelFromFixed(labelSource(doc, start)),
      hint,
      value: '',
      start,
      end,
      empty: true,
    })
  }

  for (const match of doc.matchAll(PLACEHOLDER)) {
    push(match.index!, match.index! + match[0].length, match[1]!.trim())
  }
  let from = 0
  for (;;) {
    const at = doc.indexOf(NOT_MENTIONED, from)
    if (at < 0) break
    push(at, at + NOT_MENTIONED.length, '')
    from = at + NOT_MENTIONED.length
  }

  return fields.sort((a, b) => a.start - b.start)
}

/**
 * The text a marker's label is read from.
 *
 * Back to the previous FIELD boundary — another slot, a closing tag, the
 * not-mentioned marker — so a label never swallows the field before it.
 *
 * The legacy also cuts at the last newline, which makes the label empty for the
 * common case: a heading on its own line with a blank line under it
 * (`## Motivo\n\n[[…]]`) leaves nothing between the last newline and the slot.
 * Its fallback path leans on the hint instead, so it never mattered there. Here
 * the last NON-EMPTY line is taken from what survives the cut, which recovers
 * the heading and still stops at a real boundary — two slots on one line
 * (`Peso [[…]] Talla [[…]]`) still label as "Peso" and "Talla".
 */
function labelSource(doc: string, markerStart: number): string {
  const before = doc.slice(0, markerStart)
  let cut = 0
  for (const separator of [']]', '>', NOT_MENTIONED]) {
    const at = before.lastIndexOf(separator)
    if (at >= 0 && at + separator.length > cut) cut = at + separator.length
  }
  return before.slice(cut)
}

/** Every field of the note: aligned when possible, markers otherwise. */
export function noteFields(doc: string, template: string): NoteField[] {
  return alignFields(doc, template) ?? markerFields(doc)
}

/** Accents folded and case dropped, so "Análisis" matches "analisis". */
export function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[*#>\-•:\s]+$/g, '')
    .trim()
}

/**
 * Find the field the model asked for.
 *
 * By label first, then by a label that contains the asked-for name, then by the
 * HINT — the model often quotes the instruction rather than the heading,
 * because the instruction is what describes the content it just wrote.
 */
export function matchField(fields: NoteField[], name: string): number {
  const target = normalizeLabel(name)
  if (!target) return -1

  const byLabel = fields.findIndex((field) => normalizeLabel(field.label) === target)
  if (byLabel >= 0) return byLabel

  const partial = fields.findIndex((field) => normalizeLabel(field.label).includes(target))
  if (partial >= 0) return partial

  return fields.findIndex((field) => field.hint && normalizeLabel(field.hint).includes(target))
}

/** Put a value in a field's span, leaving every other character alone. */
export function fillField(doc: string, field: NoteField, value: string): string {
  return doc.slice(0, field.start) + value + doc.slice(field.end)
}
