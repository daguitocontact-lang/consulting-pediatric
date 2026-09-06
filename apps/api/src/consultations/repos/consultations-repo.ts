/**
 * Consultation persistence — the listing the panel's Consultas section draws,
 * plus the writes that section performs (create, rename, status, consent).
 *
 * Ported from the legacy app's paginated endpoint, which is where the odd rules
 * come from and why they are kept:
 *
 *   - a `draft` is never listed. It is the row a half-finished create dialog
 *     leaves behind, and the doctor never asked for it;
 *   - the name column is COALESCE(name, patient_name), and sorting AND
 *     filtering use that same expression — otherwise the table sorts by a
 *     value it is not showing;
 *   - the day filter compares calendar days, not a range the client computed:
 *     the picker sends YYYY-MM-DD and the server owns what "that day" means —
 *     as a half-open range on the column, so the index still applies.
 *
 * What changed on purpose: the legacy query scoped rows by `user_id` (one
 * doctor's own consultations) and filtered the mode in the browser AFTER
 * paginating — which quietly renders a short page when a tab is selected, since
 * the rows were already cut to ten. Here the tenant is the ORG, the doctor is
 * an attribute of the row, and the mode is part of the SQL, so page 2 of the
 * "Video" tab is the second ten video consultations.
 */
import { sql } from '../../lib/db'
import type { ConsultationMode, ConsultationSort, ConsultationStatus } from '../../lib/constants'

export type ConsultationRow = {
  id: string
  patient_contact_id: string | null
  patient_name: string | null
  name: string | null
  language: string
  mode: ConsultationMode
  status: ConsultationStatus
  template_id: string | null
  template_title: string | null
  duration_seconds: number
  notes: string | null
  patient_consent_at: string | null
  /** The Jitsi room this consultation owns — every mode has one (0004). */
  room_name: string
  meeting_started_at: string | null
  meeting_ended_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ConsultationInput = {
  patientContactId?: string | null
  patientName?: string | null
  name?: string | null
  language?: string
  mode?: ConsultationMode
  status?: ConsultationStatus
  templateId?: string | null
  notes?: string | null
}

export type ListQuery = {
  page: number
  limit: number
  sort?: ConsultationSort
  dir?: 'asc' | 'desc'
  /** Free text, matched against the name the listing shows. */
  q?: string
  /** A single calendar day, YYYY-MM-DD. */
  date?: string
  mode?: ConsultationMode
}

export type ListResult = { data: ConsultationRow[]; total: number; page: number; limit: number }

/** The label the listing shows, and therefore the one it sorts and filters by. */
const NAME_EXPR = sql`COALESCE(c.name, c.patient_name)`

/**
 * The same label, folded: accents stripped and lowercased (migration 0003).
 *
 * Both the search and the ORDER BY go through it. `lower() LIKE` alone is
 * accent-sensitive, so "maria" missed "María"; and the database collation sorts
 * uppercase before lowercase, so "maría camila" landed after "Sofía Rojas". A
 * listing ordered by a name has to order by the name as it is read.
 */
const FOLDED_NAME = sql`pediatric_fold(COALESCE(c.name, c.patient_name))`

const SELECT = sql`
  SELECT c.id, c.patient_contact_id, c.patient_name, c.name, c.language, c.mode, c.status,
         c.template_id, t.title AS template_title, c.duration_seconds, c.notes,
         c.patient_consent_at, c.room_name, c.meeting_started_at, c.meeting_ended_at,
         c.created_by, c.created_at, c.updated_at
    FROM consultations c
    LEFT JOIN consultation_templates t ON t.id = c.template_id
`

/**
 * The ORDER BY, chosen from a closed set.
 *
 * `sort` arrives in a query string and an identifier cannot be a bound
 * parameter, so an unknown value takes the default rather than reaching SQL.
 * Nulls last in both directions: a consultation with no name is not the
 * interesting end of the list, whichever way it is sorted.
 */
function orderBy(sort: ConsultationSort | undefined, dir: 'asc' | 'desc') {
  const direction = dir === 'asc' ? sql`ASC` : sql`DESC`
  switch (sort) {
    case 'name':
      return sql`ORDER BY ${FOLDED_NAME} ${direction} NULLS LAST, c.created_at DESC`
    case 'status':
      return sql`ORDER BY c.status ${direction}, c.created_at DESC`
    case 'duration':
      return sql`ORDER BY c.duration_seconds ${direction}, c.created_at DESC`
    case 'date':
      return sql`ORDER BY c.created_at ${direction}`
    default:
      return sql`ORDER BY c.created_at DESC`
  }
}

/**
 * The WHERE every listing query shares — the count and the page MUST agree on
 * it, or the pager offers pages that come back empty.
 */
function listWhere(orgId: string, query: ListQuery) {
  const text = query.q?.trim().toLowerCase()
  return sql`
    WHERE c.org_id = ${orgId}
      AND c.status <> 'draft'
      ${query.mode ? sql`AND c.mode = ${query.mode}` : sql``}
      ${
        // A half-open range, not `created_at::date = $1`. The cast is what a
        // date filter reads like, but it is STABLE (it depends on TimeZone),
        // so it cannot be indexed and every filtered listing became a scan.
        // This form compares the column itself and uses consultations_org_created.
        query.date
          ? sql`AND c.created_at >= ${query.date}::date
                AND c.created_at < ${query.date}::date + INTERVAL '1 day'`
          : sql``
      }
      ${text ? sql`AND ${FOLDED_NAME} LIKE pediatric_fold(${'%' + text + '%'})` : sql``}
  `
}

export async function listConsultations(orgId: string, query: ListQuery): Promise<ListResult> {
  const limit = Math.min(Math.max(query.limit, 1), 100)
  const page = Math.max(query.page, 1)
  const where = listWhere(orgId, query)

  // Count and page in one round trip. They are separate statements against the
  // same snapshot rather than a window function on the page, because a COUNT(*)
  // OVER () returns nothing at all when the page is empty — and "no rows" is
  // exactly when the pager needs to know the total to send you back a page.
  const [counted, data] = await Promise.all([
    sql<{ total: string }[]>`SELECT count(*)::text AS total FROM consultations c ${where}`,
    sql<ConsultationRow[]>`
      ${SELECT}
      ${where}
      ${orderBy(query.sort, query.dir === 'asc' ? 'asc' : 'desc')}
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `,
  ])

  return { data, total: Number(counted[0]?.total ?? 0), page, limit }
}

export async function getConsultation(orgId: string, id: string): Promise<ConsultationRow | null> {
  const [row] = await sql<ConsultationRow[]>`
    ${SELECT}
    WHERE c.org_id = ${orgId} AND c.id = ${id}::uuid
    LIMIT 1
  `
  return row ?? null
}

export async function createConsultation(
  orgId: string,
  input: ConsultationInput,
  createdBy: string,
): Promise<ConsultationRow> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO consultations
      (org_id, patient_contact_id, patient_name, name, language, mode, status, template_id,
       notes, created_by)
    VALUES
      (${orgId}, ${input.patientContactId ?? null}, ${input.patientName ?? null},
       ${input.name ?? null}, ${input.language ?? 'es'}, ${input.mode ?? 'in_person'},
       ${input.status ?? 'initial'}, ${input.templateId ?? null}, ${input.notes ?? null},
       ${createdBy}::uuid)
    RETURNING id
  `
  // Read it back through the same projection the listing uses, so the caller
  // gets the template title too and the panel can prepend the row without a
  // refetch.
  return (await getConsultation(orgId, row!.id))!
}

/**
 * Patch, org-scoped. Returns null when the row is not this org's — the route
 * turns that into a 404, never a 403 that would confirm the id exists.
 *
 * Only the keys present are written: renaming must not reset the status, and
 * the panel sends one field at a time.
 */
export async function updateConsultation(p: {
  orgId: string
  id: string
  patch: ConsultationInput
}): Promise<ConsultationRow | null> {
  const columns: Record<string, unknown> = {}
  const { patch } = p
  if (patch.name !== undefined) columns.name = patch.name?.trim() || null
  if (patch.patientContactId !== undefined) columns.patient_contact_id = patch.patientContactId
  if (patch.patientName !== undefined) columns.patient_name = patch.patientName?.trim() || null
  if (patch.language !== undefined) columns.language = patch.language
  if (patch.mode !== undefined) columns.mode = patch.mode
  if (patch.status !== undefined) columns.status = patch.status
  if (patch.templateId !== undefined) columns.template_id = patch.templateId
  if (patch.notes !== undefined) columns.notes = patch.notes

  if (!Object.keys(columns).length) return getConsultation(p.orgId, p.id)

  const [row] = await sql<{ id: string }[]>`
    UPDATE consultations
       SET ${sql(columns)}, updated_at = now()
     WHERE org_id = ${p.orgId} AND id = ${p.id}::uuid
     RETURNING id
  `
  return row ? getConsultation(p.orgId, row.id) : null
}

/**
 * Add to the recorded time instead of setting it.
 *
 * A consultation is recorded in stretches — paused, resumed, a second audio
 * uploaded — and the client that sends "the duration" only knows about its own
 * stretch. Setting it is how the legacy app lost the first half of a
 * consultation whenever the doctor reconnected.
 */
export async function addDuration(p: {
  orgId: string
  id: string
  seconds: number
}): Promise<ConsultationRow | null> {
  if (p.seconds < 0) throw new Error('seconds must not be negative')
  const [row] = await sql<{ id: string }[]>`
    UPDATE consultations
       SET duration_seconds = duration_seconds + ${p.seconds}, updated_at = now()
     WHERE org_id = ${p.orgId} AND id = ${p.id}::uuid
     RETURNING id
  `
  return row ? getConsultation(p.orgId, row.id) : null
}

/**
 * Stamp the patient's verbal consent to be recorded, once.
 *
 * `COALESCE` rather than an overwrite: consent was given at a moment, and a
 * second click (or a retried request) must not move that moment forward. The
 * timestamp is what a later audit reads.
 */
export async function recordConsent(orgId: string, id: string): Promise<ConsultationRow | null> {
  const [row] = await sql<{ id: string }[]>`
    UPDATE consultations
       SET patient_consent_at = COALESCE(patient_consent_at, now()), updated_at = now()
     WHERE org_id = ${orgId} AND id = ${id}::uuid
     RETURNING id
  `
  return row ? getConsultation(orgId, row.id) : null
}

/**
 * Open the room, once.
 *
 * `COALESCE` again: the doctor reloads, the patient joins twice, the tab is
 * reopened — the meeting still started when it started. Re-opening also clears
 * a previous end, because a consultation that resumes has not ended.
 *
 * The consultation's STATUS is deliberately untouched. Being in the room and
 * recording the consultation are two different things — the doctor joins,
 * greets the family, and presses "Iniciar consulta" when the consultation
 * actually starts. Flipping the status here took that decision away: the
 * screen showed "Detener" before anyone had said anything, and the button that
 * starts the transcription engine never appeared at all.
 */
export async function startMeeting(orgId: string, id: string): Promise<ConsultationRow | null> {
  const [row] = await sql<{ id: string }[]>`
    UPDATE consultations
       SET meeting_started_at = COALESCE(meeting_started_at, now()),
           meeting_ended_at = NULL,
           updated_at = now()
     WHERE org_id = ${orgId} AND id = ${id}::uuid
     RETURNING id
  `
  return row ? getConsultation(orgId, row.id) : null
}

/**
 * Close the room and bank the time.
 *
 * The elapsed seconds are computed HERE, from the two timestamps, rather than
 * taken from the browser: a client that closed its laptop reports nothing, and
 * one with a wrong clock reports an hour. `GREATEST(...,0)` because a clock
 * that jumped backwards must not subtract from a consultation's duration.
 */
export async function endMeeting(orgId: string, id: string): Promise<ConsultationRow | null> {
  const [row] = await sql<{ id: string }[]>`
    UPDATE consultations
       SET meeting_ended_at = now(),
           duration_seconds = duration_seconds + CASE
             WHEN meeting_started_at IS NULL OR meeting_ended_at IS NOT NULL THEN 0
             ELSE GREATEST(FLOOR(EXTRACT(EPOCH FROM (now() - meeting_started_at)))::int, 0)
           END,
           updated_at = now()
     WHERE org_id = ${orgId} AND id = ${id}::uuid
     RETURNING id
  `
  return row ? getConsultation(orgId, row.id) : null
}

export async function deleteConsultation(orgId: string, id: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM consultations
     WHERE org_id = ${orgId} AND id = ${id}::uuid
     RETURNING id
  `
  return rows.length > 0
}

/** Tab counts for the listing, in one pass over the same WHERE the list uses. */
export async function countByMode(
  orgId: string,
  query: Omit<ListQuery, 'mode' | 'page' | 'limit'>,
): Promise<Record<'all' | ConsultationMode, number>> {
  const where = listWhere(orgId, { ...query, page: 1, limit: 1 })
  const rows = await sql<{ mode: ConsultationMode; total: string }[]>`
    SELECT c.mode, count(*)::text AS total FROM consultations c ${where} GROUP BY c.mode
  `
  const counts = { all: 0, video: 0, in_person: 0, transcription: 0 }
  for (const row of rows) {
    counts[row.mode] = Number(row.total)
    counts.all += Number(row.total)
  }
  return counts
}
