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
  scope: TemplateScope
  owner_id: string | null
  active: boolean
  created_at: string
}

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
    SELECT id, title, scope, owner_id, active, created_at
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
  scope?: TemplateScope
}): Promise<TemplateRow> {
  const scope = p.scope ?? 'org'
  const [row] = await sql<TemplateRow[]>`
    INSERT INTO consultation_templates (org_id, title, scope, owner_id)
    VALUES (${p.orgId}, ${p.title.trim()}, ${scope},
            ${scope === 'personal' ? sql`${p.userId}::uuid` : sql`NULL`})
    RETURNING id, title, scope, owner_id, active, created_at
  `
  return row!
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
