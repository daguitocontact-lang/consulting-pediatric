/**
 * Consultation note templates.
 *
 * The legacy app kept two tables — global templates and per-user ones — and
 * merged them in the browser to render a single "Plantilla" column, which is
 * why its listing had to resolve template titles twice and still fell back to
 * "sin plantilla" when a deploy lagged. One table with a `scope` says the same
 * thing, sorts in one query, and the listing joins it.
 */
import { sql } from '../../lib/db'
import type { TemplateScope } from '../../lib/constants'

export type TemplateRow = {
  id: string
  title: string
  /**
   * The markdown the note is rendered from — what the legacy app calls the
   * template body, and what reaches the flow as `template_body` in the
   * base_input so `c_soap` fills THIS structure instead of its own default.
   *
   * Empty is legal and means "no structure of ours": the flow then writes the
   * SOAP note it knows. A title alone never steered anything.
   */
  body: string
  scope: TemplateScope
  owner_id: string | null
  active: boolean
  created_at: string
}

/**
 * The schema Daguito infers from a template body's `[[placeholders]]`, cached.
 *
 * The pre-recorded flow needs it as `template_schema`; inferring it is an LLM
 * call, so it is paid for once per body. `hash` is the preview's own
 * `bodyHash` — a template whose body was edited no longer matches and the next
 * run re-infers.
 */
export type TemplateSchemaCache = { schema: Record<string, unknown>; hash: string } | null

/**
 * The templates this user may pick: the org's, plus their own.
 *
 * Another doctor's personal template is not theirs to see — that is the whole
 * point of `scope`.
 */
export async function listTemplates(p: {
  orgId: string
  userId: string
  includeInactive?: boolean
}): Promise<TemplateRow[]> {
  return sql<TemplateRow[]>`
    SELECT id, title, body, scope, owner_id, active, created_at
      FROM consultation_templates
     WHERE org_id = ${p.orgId}
       AND (scope = 'org' OR owner_id = ${p.userId}::uuid)
       ${p.includeInactive ? sql`` : sql`AND active`}
     ORDER BY scope, lower(title)
  `
}

export async function createTemplate(p: {
  orgId: string
  userId: string
  title: string
  body?: string
  scope?: TemplateScope
}): Promise<TemplateRow> {
  const scope = p.scope ?? 'org'
  const [row] = await sql<TemplateRow[]>`
    INSERT INTO consultation_templates (org_id, title, body, scope, owner_id)
    VALUES (${p.orgId}, ${p.title.trim()}, ${p.body ?? ''}, ${scope},
            ${scope === 'personal' ? sql`${p.userId}::uuid` : sql`NULL`})
    RETURNING id, title, body, scope, owner_id, active, created_at
  `
  return row!
}

/**
 * Rewrite a template's title and/or body.
 *
 * The body is the part that matters to the engine, and it is edited far more
 * often than the title: a doctor tunes the structure of their note between
 * consultations. Scoped like every other write — the org's templates, plus
 * this doctor's own.
 */
export async function updateTemplate(p: {
  orgId: string
  userId: string
  id: string
  title?: string
  body?: string
}): Promise<TemplateRow | null> {
  const columns: Record<string, unknown> = {}
  if (p.title !== undefined) columns.title = p.title.trim()
  if (p.body !== undefined) columns.body = p.body
  if (!Object.keys(columns).length) return getTemplate(p.orgId, p.id)

  const [row] = await sql<TemplateRow[]>`
    UPDATE consultation_templates
       SET ${sql(columns)}, updated_at = now()
     WHERE org_id = ${p.orgId} AND id = ${p.id}::uuid
       AND (scope = 'org' OR owner_id = ${p.userId}::uuid)
     RETURNING id, title, body, scope, owner_id, active, created_at
  `
  return row ?? null
}

/**
 * One template, by id, without the ownership filter.
 *
 * Used by the engine path: a consultation already points at this template, and
 * the doctor running it is not necessarily the doctor who wrote it. The org
 * check is still there — it is the only boundary that matters.
 */
export async function getTemplate(orgId: string, id: string): Promise<TemplateRow | null> {
  const [row] = await sql<TemplateRow[]>`
    SELECT id, title, body, scope, owner_id, active, created_at
      FROM consultation_templates
     WHERE org_id = ${orgId} AND id = ${id}::uuid
  `
  return row ?? null
}

/**
 * Retire a template rather than delete it when consultations point at it.
 *
 * The FK is ON DELETE SET NULL, so a delete would silently blank the template
 * column of every consultation already rendered with it — the listing would
 * start reading "sin plantilla" for finished work. Deactivating keeps the
 * history and drops it from the picker, and only a template nothing uses is
 * really deleted.
 */
export async function deleteTemplate(p: {
  orgId: string
  userId: string
  id: string
}): Promise<'deleted' | 'deactivated' | 'not_found'> {
  const [used] = await sql<{ total: string }[]>`
    SELECT count(*)::text AS total FROM consultations
     WHERE org_id = ${p.orgId} AND template_id = ${p.id}::uuid
  `
  const owned = sql`(scope = 'org' OR owner_id = ${p.userId}::uuid)`

  if (Number(used?.total ?? 0) > 0) {
    const rows = await sql<{ id: string }[]>`
      UPDATE consultation_templates SET active = false, updated_at = now()
       WHERE org_id = ${p.orgId} AND id = ${p.id}::uuid AND ${owned}
       RETURNING id
    `
    return rows.length ? 'deactivated' : 'not_found'
  }

  const rows = await sql<{ id: string }[]>`
    DELETE FROM consultation_templates
     WHERE org_id = ${p.orgId} AND id = ${p.id}::uuid AND ${owned}
     RETURNING id
  `
  return rows.length ? 'deleted' : 'not_found'
}

/** The cached schema for a template, or null when there is none yet. */
export async function getTemplateSchema(
  orgId: string,
  id: string,
): Promise<TemplateSchemaCache> {
  const [row] = await sql<{ schema: Record<string, unknown> | null; schema_hash: string | null }[]>`
    SELECT schema, schema_hash FROM consultation_templates
     WHERE org_id = ${orgId} AND id = ${id}::uuid
  `
  if (!row?.schema || !row.schema_hash) return null
  return { schema: row.schema, hash: row.schema_hash }
}

/** Store one. Best-effort by nature: a cache that fails to write costs another
 *  inference, never a transcription. */
export async function saveTemplateSchema(p: {
  orgId: string
  id: string
  schema: Record<string, unknown>
  hash: string
}): Promise<void> {
  await sql`
    UPDATE consultation_templates
       SET schema = ${sql.json(p.schema as Parameters<typeof sql.json>[0])},
           schema_hash = ${p.hash}, updated_at = now()
     WHERE org_id = ${p.orgId} AND id = ${p.id}::uuid
  `
}
