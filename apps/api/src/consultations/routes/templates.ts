/**
 * Consultation template routes — what fills the "Plantilla" picker.
 *
 *   GET    /api/consultation-templates      → the org's + this doctor's own
 *   POST   /api/consultation-templates      → create one
 *   DELETE /api/consultation-templates/:id  → delete, or retire if in use
 */
import { Elysia, t } from 'elysia'
import { requireOrg } from '../../lib/guard'
import { safeError } from '../../lib/errors'
import { TEMPLATE_SCOPE } from '../../lib/constants'
import { createTemplate, deleteTemplate, listTemplates } from '../repos/templates-repo'

export const templatesRoutes = new Elysia({ prefix: '/api/consultation-templates' })
  .get('/', async ({ request, query, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    return {
      templates: await listTemplates({
        orgId: guard.orgId,
        userId: guard.userId,
        includeInactive: query.all === '1',
      }),
    }
  })

  .post(
    '/',
    async ({ request, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      try {
        set.status = 201
        return {
          template: await createTemplate({
            orgId: guard.orgId,
            userId: guard.userId,
            title: body.title,
            scope: body.scope,
          }),
        }
      } catch (err) {
        // The unique index on (org, lower(title), owner) is the only way to
        // fail here, and "you already have that template" is a 409.
        const { status, body: safe } = safeError(err, 409, 'duplicate_template')
        set.status = status
        return safe
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 200 }),
        scope: t.Optional(t.Union(TEMPLATE_SCOPE.map((s) => t.Literal(s)))),
      }),
    },
  )

  .delete('/:id', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    const outcome = await deleteTemplate({
      orgId: guard.orgId,
      userId: guard.userId,
      id: params.id,
    })
    if (outcome === 'not_found') {
      set.status = 404
      return { error: 'not found' }
    }
    // The caller is told WHICH happened: the picker drops the row either way,
    // but a template that is still on old consultations was retired, not
    // erased, and the panel says so.
    return { ok: true, outcome }
  })
