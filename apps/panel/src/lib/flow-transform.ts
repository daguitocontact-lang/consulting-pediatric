/**
 * The consultation flow's output, turned into what the panels show.
 *
 * A faithful port of the legacy app's `services/daguito/transform.ts`, which is
 * itself a port of its Go bridge: the `c_facts` node emits a cumulative state
 * with four buckets, `c_soap` emits the note. Keeping the same shapes means the
 * flows do not have to change — the same ones the legacy product publishes are
 * the ones this reads.
 *
 * Pure functions on purpose: this is the part of the engine integration that
 * can be tested without a websocket, a microphone or an API key.
 */

export type FlowRecommendation = {
  category: string
  value: string
  /** Rank as the flow emitted it: the panel keeps that order under the pins. */
  priority: number
}

/**
 * The four buckets the flow's state carries, in the order they are read.
 *
 * The categories keep the legacy names because they are what the flow emits;
 * the panel translates them for display.
 */
const BUCKETS: ReadonlyArray<{ field: string; category: string }> = [
  { field: 'preguntas', category: 'question' },
  { field: 'posibles_diagnosticos', category: 'possible_diagnosis' },
  { field: 'tratamientos', category: 'treatment' },
  { field: 'recomendaciones_generales', category: 'recommendation' },
]

const CONFIDENCE_MARKER = '[BAJA CONFIANZA]'

/**
 * The flow prefixes an uncertain line with a marker meant for a filter, not for
 * a doctor to read. It is stripped for display — the line still shows, it just
 * does not shout.
 */
function stripConfidenceMarker(text: string): string {
  return text.toUpperCase().startsWith(CONFIDENCE_MARKER)
    ? text.slice(CONFIDENCE_MARKER.length).trim()
    : text
}

/** `c_facts` full_state → the recommendations to store. */
export function recommendationsFromState(state: Record<string, unknown>): FlowRecommendation[] {
  const out: FlowRecommendation[] = []
  let rank = 0
  let categorised = false

  const push = (raw: string, category: string) => {
    const value = stripConfidenceMarker(raw.trim())
    if (!value) return
    rank += 1
    out.push({ category, value, priority: rank })
  }

  for (const { field, category } of BUCKETS) {
    const items = state[field]
    if (!Array.isArray(items)) continue
    categorised = true
    for (const item of items) if (typeof item === 'string') push(item, category)
  }
  if (categorised) return out

  // An older flow emits one flat list. Same fallback the legacy bridge kept, so
  // a flow that has not been re-published still fills the panel.
  const legacy = state['recomendaciones']
  if (Array.isArray(legacy)) {
    for (const item of legacy) if (typeof item === 'string') push(item, 'recommendation')
  }
  return out
}

const SOAP_KEYS = ['subjetivo', 'objetivo', 'analisis', 'plan'] as const
const SOAP_TITLES: Record<string, string> = {
  subjetivo: '(S) Subjetivo',
  objetivo: '(O) Objetivo',
  analisis: '(A) Análisis',
  plan: '(P) Plan',
}

function fieldToMarkdown(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => `- ${item}`)
      .join('\n')
  }
  return ''
}

/**
 * `c_soap` full_state → the note's markdown.
 *
 * A flow that already produced markdown wins; otherwise the four sections are
 * assembled in SOAP order. An absent section is omitted rather than rendered
 * empty — a heading with nothing under it reads as "we found nothing", which is
 * not the same as "the flow has not said yet".
 */
export function noteFromState(state: Record<string, unknown>): string {
  const markdown = state['markdown']
  if (typeof markdown === 'string' && markdown.trim()) return markdown.trim()

  const parts: string[] = []
  for (const key of SOAP_KEYS) {
    if (!(key in state)) continue
    const text = fieldToMarkdown(state[key])
    if (text) parts.push(`## ${SOAP_TITLES[key]}\n\n${text}`)
  }
  return parts.join('\n\n')
}

export type FlowTranscriptSegment = { speaker: string | null; text: string; at_seconds: number }

/**
 * A transcription event → the segments to append.
 *
 * The STT nodes emit under a few shapes depending on the flow (a single final
 * string, a list of utterances with speakers, a partial). Only FINAL text is
 * taken: a partial is rewritten as the speaker keeps talking, and storing it
 * would leave half-sentences in the record.
 */
export function transcriptFromEvent(data: Record<string, unknown>): FlowTranscriptSegment[] {
  const asSegment = (item: Record<string, unknown>): FlowTranscriptSegment | null => {
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (!text) return null
    const speakerRaw = item.speaker ?? item.speaker_label ?? item.role
    const speaker = typeof speakerRaw === 'string' && speakerRaw ? normalizeSpeaker(speakerRaw) : null
    return { speaker, text, at_seconds: secondsFrom(item) }
  }

  // A partial is not the record.
  if (data.is_final === false || data.partial === true) return []

  const utterances = data.utterances ?? data.segments
  if (Array.isArray(utterances)) {
    return utterances
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map(asSegment)
      .filter((segment): segment is FlowTranscriptSegment => segment !== null)
  }

  const single = asSegment(data)
  return single ? [single] : []
}

/**
 * When the segment was spoken, in seconds.
 *
 * The unit comes from the FIELD NAME, never from the magnitude. Guessing by
 * size is the obvious shortcut and it is wrong in both directions: 12500 is
 * twelve and a half seconds in milliseconds and three and a half hours in
 * seconds, and both are plausible values for a consultation. AssemblyAI (what
 * the flows transcribe with) emits `start` in milliseconds; our own API speaks
 * `at_seconds`.
 */
function secondsFrom(item: Record<string, unknown>): number {
  const ms = item.start ?? item.start_ms ?? item.timestamp
  if (typeof ms === 'number' && Number.isFinite(ms)) return Math.max(0, Math.floor(ms / 1000))
  const seconds = item.at_seconds
  if (typeof seconds === 'number' && Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds))
  return 0
}

/**
 * The flow labels speakers as it can: a diarization channel ("A"/"B"), a role,
 * or a name. The panel only distinguishes the two that matter.
 */
function normalizeSpeaker(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (value.includes('doctor') || value.includes('medico') || value === 'a') return 'doctor'
  if (value.includes('pacient') || value.includes('patient') || value === 'b') return 'patient'
  return raw.trim()
}
