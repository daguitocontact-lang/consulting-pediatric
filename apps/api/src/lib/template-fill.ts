/**
 * Rendering the doctor's template with what the flow extracted.
 *
 * A faithful port of the legacy app's `pkg/service/template_placeholder.go`
 * (itself a port of its Python pipeline's `_fill_template`). The rule it
 * encodes is the whole point of a template: the doctor's markdown is kept
 * EXACTLY as they wrote it, and only each `[[…]]` placeholder is swapped for
 * the value the flow extracted. The note that comes back is their document with
 * the blanks filled, not a document the model wrote in its own shape.
 *
 * Pure functions: the part of the pre-recorded pipeline that can be tested with
 * no websocket, no API key and no audio.
 */

/** `[[a natural-language description of the field]]` — no type syntax, no key. */
const PLACEHOLDER = /\[\[([^[\]]+)\]\]/g

/** The headings used when there is no template at all. */
const NOTE_TITLES: Record<string, string> = {
  subjetivo: '(S) Subjetivo',
  objetivo: '(O) Objetivo',
  analisis: '(A) Análisis',
  plan: '(P) Plan',
}

/** What a placeholder renders as when the consultation did not mention it.
 *  Blank would read as "the field does not apply"; this reads as what it is. */
const NOT_MENTIONED = '_No referido_'

const HTML_TAG = /<[^>]*>/g
const MD_BOLD = /\*\*([^*]+)\*\*/g
const MD_HEADING = /^#{1,6}\s*/gm

/**
 * Strip the formatting the model was told not to produce.
 *
 * The `c_soap` prompt is emphatic that values must be plain text — no tags, no
 * markdown, no section labels — because they are pasted INTO the doctor's own
 * formatting. Models comply most of the time. This is the part that does not
 * depend on them complying.
 */
function sanitize(value: string): string {
  return value.replace(HTML_TAG, '').replace(MD_BOLD, '$1').replace(MD_HEADING, '').trim()
}

/**
 * One extracted value → the text that goes in the blank.
 *
 * Lists become markdown bullets; a null, a "null" or a "none" becomes empty so
 * the caller can substitute. JSON gives us strings, numbers, booleans, arrays
 * and nulls, and all five arrive here.
 */
export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitize(String(item ?? '').trim()))
      .filter(Boolean)
      .map((item) => `- ${item}`)
      .join('\n')
  }
  const text = sanitize(String(value).trim())
  const lower = text.toLowerCase()
  return lower === 'null' || lower === 'none' ? '' : text
}

/** `motivo_consulta` → `Motivo Consulta`, for the no-template fallback. */
function humanize(field: string): string {
  return field
    .replace(/_/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ')
}

/**
 * The ordered field slugs Daguito persists next to the schema.
 *
 * Placeholders carry no key — they are free-form descriptions — so the Nth
 * placeholder maps to the Nth slug POSITIONALLY. That is the contract, and it
 * is why editing a template body invalidates its cached schema: insert a
 * placeholder in the middle and every field after it would otherwise be filled
 * with the previous one's answer.
 */
export function fieldNamesFrom(schema: Record<string, unknown> | null | undefined): string[] {
  if (!schema) return []
  const names = schema.field_names
  if (Array.isArray(names)) return names.filter((n): n is string => typeof n === 'string')
  // Older envelopes carry only the JSON Schema. Object key order in JS is
  // insertion order for string keys, which is the order Daguito wrote them.
  const inner = schema.schema
  const properties =
    inner && typeof inner === 'object'
      ? (inner as Record<string, unknown>).properties
      : (schema as Record<string, unknown>).properties
  if (properties && typeof properties === 'object') return Object.keys(properties)
  return []
}

/**
 * The doctor's template, filled.
 *
 * Three paths, in the legacy's order:
 *
 *   1. the flow emitted a whole rendered document — keep it verbatim, it IS
 *      the note (no per-field sanitising: nothing was substituted);
 *   2. there is no template — one `## heading` per extracted field, so the work
 *      is not lost just because nobody picked a template;
 *   3. the normal path — walk the placeholders in order and substitute.
 */
export function fillTemplate(
  templateBody: string,
  state: Record<string, unknown>,
  fieldNames: string[],
): string {
  // `soap` is Daguito's key, not ours — the flow's external contract.
  for (const key of ['markdown', 'text', 'soap', 'document']) {
    const whole = state[key]
    if (typeof whole === 'string' && whole.trim()) return whole.trim()
  }

  if (!templateBody) {
    return Object.keys(state)
      .sort()
      .map((key) => {
        const text = stringifyValue(state[key])
        if (!text) return ''
        return `## ${NOTE_TITLES[key] ?? humanize(key)}\n\n${text}`
      })
      .filter(Boolean)
      .join('\n\n')
  }

  let cursor = 0
  return templateBody.replace(PLACEHOLDER, () => {
    const index = cursor++
    const byName = fieldNames[index] ? stringifyValue(state[fieldNames[index]!]) : ''
    // A schema built without Daguito's cache keys its fields positionally.
    const value = byName || stringifyValue(state[`field_${index}`])
    return value || NOT_MENTIONED
  })
}

/**
 * Which bucket a charge belongs to.
 *
 * STT time is transcription; everything else the consultation flows bill is a
 * model writing something — the note (`c_soap`), the suggestions (`c_facts`) or
 * the assistant. The legacy's `costBucket`, widened by the node id because the
 * live flows bill two different agents where the pre-recorded one bills only
 * the note.
 */
export function costBucket(
  stepType: string,
  nodeId: string,
): 'streaming' | 'facts' | 'template' | 'chatbot' {
  const step = stepType.toLowerCase()
  if (step.startsWith('stt') || step.includes('transcribe') || step.includes('whisper')) {
    return 'streaming'
  }
  const node = nodeId.toLowerCase()
  if (node === 'c_facts') return 'facts'
  if (node === 'c_soap') return 'template'
  return 'chatbot'
}

/** USD to six decimals — a single STT second costs fractions of a cent, and
 *  rounding to cents throws every individual charge away. */
export const roundUsd = (value: number): number => Math.round(value * 1e6) / 1e6

/** The USD amount carried by a `cost` emit, in the shapes Daguito sends it. */
export function costUsdFrom(data: Record<string, unknown>): number {
  const usd = data.cost_usd ?? data.usd ?? data.amount_usd
  if (typeof usd === 'number' && Number.isFinite(usd)) return usd
  // Some steps bill in microcents, the ledger's own unit: 1 USD = 1e6 of them
  // (the legacy's `USD()` helper divides by exactly that).
  const micro = data.cost_microcents ?? data.microcents
  if (typeof micro === 'number' && Number.isFinite(micro)) return micro / 1e6
  return 0
}
