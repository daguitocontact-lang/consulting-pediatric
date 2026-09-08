/**
 * The consultation workspace: transcript, recommendations, clinical note and
 * chat — the four panels of the detail screen.
 *
 * One module because they are read together: the screen opens with a single
 * request (`loadWorkspace`) instead of the legacy page's five, which is what
 * made it flash four empty panels in sequence while each one arrived.
 *
 * Everything here takes an `orgId` and every statement carries it. The
 * consultation is already the tenant boundary, but a query that filters only by
 * `consultation_id` is one forgotten join away from another client's data.
 */
import { sql } from '../../lib/db'

export type TranscriptSegment = {
  id: string
  speaker: string | null
  text: string
  at_seconds: number
  created_at: string
}

export type Recommendation = {
  id: string
  category: string
  value: string
  status: 'featured' | 'removed' | null
  priority: number | null
  is_active: boolean
  created_at: string
}

export type ClinicalNote = {
  body: string
  template_id: string | null
  edited_at: string | null
  updated_at: string
} | null

export type ChatMessage = {
  id: string
  role: 'doctor' | 'assistant'
  body: string
  created_at: string
}

export type Workspace = {
  transcript: TranscriptSegment[]
  recommendations: Recommendation[]
  note: ClinicalNote
  chat: ChatMessage[]
}

/** Everything the detail screen needs, in one round trip. */
export async function loadWorkspace(orgId: string, consultationId: string): Promise<Workspace> {
  const [transcript, recommendations, note, chat] = await Promise.all([
    listTranscript(orgId, consultationId),
    listRecommendations(orgId, consultationId),
    getNote(orgId, consultationId),
    listChat(orgId, consultationId),
  ])
  return { transcript, recommendations, note, chat }
}

// ── Transcript ────────────────────────────────────────────────────────

export function listTranscript(
  orgId: string,
  consultationId: string,
): Promise<TranscriptSegment[]> {
  return sql<TranscriptSegment[]>`
    SELECT id::text, speaker, text, at_seconds, created_at
      FROM consultation_transcript_segments
     WHERE org_id = ${orgId} AND consultation_id = ${consultationId}::uuid
     -- Qualified for the same reason as listChat below: id is also the name of
     -- the TEXT output column, and two segments heard in the same second would
     -- otherwise be ordered as strings.
     ORDER BY at_seconds, consultation_transcript_segments.id
  `
}

/**
 * Append what was heard.
 *
 * Segments arrive in batches from the transcription engine and the order they
 * are written in is not the order they were spoken in — `at_seconds` is, which
 * is why it is stored rather than inferred from the insert.
 */
export async function appendTranscript(p: {
  orgId: string
  consultationId: string
  segments: { speaker?: string | null; text: string; at_seconds?: number }[]
}): Promise<TranscriptSegment[]> {
  const rows = p.segments
    .map((segment) => ({
      org_id: p.orgId,
      consultation_id: p.consultationId,
      speaker: segment.speaker ?? null,
      text: segment.text.trim(),
      at_seconds: Math.max(0, Math.floor(segment.at_seconds ?? 0)),
    }))
    // An empty final segment is what an engine sends when a speaker stops
    // mid-sentence; it would render as a blank line with a speaker label.
    .filter((row) => row.text.length > 0)

  if (!rows.length) return []

  return sql<TranscriptSegment[]>`
    INSERT INTO consultation_transcript_segments ${sql(rows)}
    RETURNING id::text, speaker, text, at_seconds, created_at
  `
}

// ── Recommendations ───────────────────────────────────────────────────

export function listRecommendations(
  orgId: string,
  consultationId: string,
): Promise<Recommendation[]> {
  return sql<Recommendation[]>`
    SELECT id, category, value, status, priority, is_active, created_at
      FROM consultation_recommendations
     WHERE org_id = ${orgId} AND consultation_id = ${consultationId}::uuid
       AND is_active
     -- What the doctor pinned first, then what the engine ranked, then arrival.
     --
     -- IS TRUE, not a bare comparison: status = 'featured' evaluates to NULL
     -- for the rows whose status is NULL (most of them), and a DESC sort puts
     -- NULLs FIRST in Postgres — so the untouched suggestions sorted above the
     -- pinned one, the opposite of what the panel promises. (No backticks in a
     -- comment inside a tagged template: they close the string.)
     ORDER BY (status = 'featured') IS TRUE DESC, priority NULLS LAST, created_at
  `
}

/**
 * Add suggestions, ignoring the ones already there.
 *
 * The engine re-emits its whole list as the conversation grows, so the same
 * advice arrives many times over one consultation; `ON CONFLICT DO NOTHING`
 * against the folded-value index is what keeps the panel from growing three
 * copies of "solicitar hemograma".
 */
export async function addRecommendations(p: {
  orgId: string
  consultationId: string
  items: { value: string; category?: string; priority?: number | null }[]
}): Promise<Recommendation[]> {
  const rows = p.items
    .map((item) => ({
      org_id: p.orgId,
      consultation_id: p.consultationId,
      category: item.category?.trim() || 'general',
      value: item.value.trim(),
      priority: item.priority ?? null,
    }))
    .filter((row) => row.value.length > 0)

  if (!rows.length) return []

  await sql`
    INSERT INTO consultation_recommendations ${sql(rows)}
    ON CONFLICT DO NOTHING
  `
  return listRecommendations(p.orgId, p.consultationId)
}

/**
 * The doctor's verdict on one suggestion.
 *
 * `null` clears it — pressing "destacar" twice is how a doctor undoes it, and a
 * triage that cannot be undone is one nobody uses.
 */
export async function setRecommendationStatus(p: {
  orgId: string
  id: string
  status: 'featured' | 'removed' | null
}): Promise<Recommendation | null> {
  const [row] = await sql<Recommendation[]>`
    UPDATE consultation_recommendations
       SET status = ${p.status}, updated_at = now()
     WHERE org_id = ${p.orgId} AND id = ${p.id}::uuid
     RETURNING id, category, value, status, priority, is_active, created_at
  `
  return row ?? null
}

// ── Clinical note (the SOAP panel) ────────────────────────────────────

export async function getNote(orgId: string, consultationId: string): Promise<ClinicalNote> {
  const [row] = await sql<NonNullable<ClinicalNote>[]>`
    SELECT body, template_id, edited_at, updated_at
      FROM consultation_notes
     WHERE org_id = ${orgId} AND consultation_id = ${consultationId}::uuid
  `
  return row ?? null
}

/**
 * Write the note.
 *
 * `source` is the whole point. A note the DOCTOR saved is the record; a note
 * the engine rendered is a draft. So a machine write never overwrites a human
 * one — the legacy screen re-rendered the template every time the flow emitted
 * and wiped edits the doctor had been making for ten minutes.
 */
export async function saveNote(p: {
  orgId: string
  consultationId: string
  body: string
  templateId?: string | null
  source: 'doctor' | 'engine'
}): Promise<NonNullable<ClinicalNote>> {
  const human = p.source === 'doctor'
  const [row] = await sql<NonNullable<ClinicalNote>[]>`
    INSERT INTO consultation_notes (consultation_id, org_id, body, template_id, edited_at)
    VALUES (${p.consultationId}::uuid, ${p.orgId}, ${p.body}, ${p.templateId ?? null},
            ${human ? sql`now()` : sql`NULL`})
    ON CONFLICT (consultation_id) DO UPDATE
       SET body = CASE
             WHEN ${human} THEN EXCLUDED.body
             -- The engine may fill a note nobody has touched, and may not
             -- touch one somebody has.
             WHEN consultation_notes.edited_at IS NULL THEN EXCLUDED.body
             ELSE consultation_notes.body
           END,
           template_id = COALESCE(EXCLUDED.template_id, consultation_notes.template_id),
           edited_at = CASE WHEN ${human} THEN now() ELSE consultation_notes.edited_at END,
           updated_at = now()
     RETURNING body, template_id, edited_at, updated_at
  `
  return row!
}

// ── Chat with the assistant ───────────────────────────────────────────

/**
 * The thread, oldest first.
 *
 * The column is qualified, and that is not style: `id` is also the name of the
 * OUTPUT column, which this SELECT casts to text so the panel gets a string —
 * and Postgres resolves a bare `ORDER BY id` to the output column before the
 * table's. Sorting the text put "10" before "9", so the tenth message climbed
 * above the ninth and the assistant's answer appeared over the question that
 * asked it. Invisible until a thread reached ten messages, then wrong forever.
 */
export function listChat(orgId: string, consultationId: string): Promise<ChatMessage[]> {
  return sql<ChatMessage[]>`
    SELECT id::text, role, body, created_at
      FROM consultation_chat_messages
     WHERE org_id = ${orgId} AND consultation_id = ${consultationId}::uuid
     ORDER BY consultation_chat_messages.id
  `
}

export async function addChatMessage(p: {
  orgId: string
  consultationId: string
  role: 'doctor' | 'assistant'
  body: string
}): Promise<ChatMessage> {
  const [row] = await sql<ChatMessage[]>`
    INSERT INTO consultation_chat_messages (org_id, consultation_id, role, body)
    VALUES (${p.orgId}, ${p.consultationId}::uuid, ${p.role}, ${p.body})
    RETURNING id::text, role, body, created_at
  `
  return row!
}
