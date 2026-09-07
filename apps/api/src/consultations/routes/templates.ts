/**
 * Consultation template routes — what fills the "Plantilla" picker.
 *
 *   GET    /api/consultation-templates      → the org's + this doctor's own
 *   POST   /api/consultation-templates      → create one
 *   PATCH  /api/consultation-templates/:id  → rewrite its title / its body
 *   DELETE /api/consultation-templates/:id  → delete, or retire if in use
 *   POST   /api/consultation-templates/:id/assistant → one turn with the bot
 *
 * A template carries a BODY, not just a title: it is the markdown the flow
 * fills as `template_body`. See templates-repo.ts.
 */
import { Elysia, t } from 'elysia'
import { requireOrg } from '../../lib/guard'
import { safeError } from '../../lib/errors'
import { TEMPLATE_SCOPE } from '../../lib/constants'
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from '../repos/templates-repo'
import {
  askTemplateAssistant,
  isTemplateAssistantConfigured,
} from '../../lib/template-assistant'
import { TOOL_SPECS } from '../../agent/specs'
import { invokeTool } from '../../agent/functions'

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
            body: body.body,
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
        // The structure the note is written into. Long on purpose: a real SOAP
        // template with sections and hints runs to pages.
        body: t.Optional(t.String({ maxLength: 40000 })),
        scope: t.Optional(t.Union(TEMPLATE_SCOPE.map((s) => t.Literal(s)))),
      }),
    },
  )

  .patch(
    '/:id',
    async ({ request, params, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      try {
        const template = await updateTemplate({
          orgId: guard.orgId,
          userId: guard.userId,
          id: params.id,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.body !== undefined ? { body: body.body } : {}),
        })
        if (!template) {
          // Not found, another org's, or another doctor's personal one: the
          // same answer, on purpose.
          set.status = 404
          return { error: 'not found' }
        }
        return { template }
      } catch (err) {
        const { status, body: safe } = safeError(err, 409, 'duplicate_template')
        set.status = status
        return safe
      }
    },
    {
      body: t.Object({
        title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        body: t.Optional(t.String({ maxLength: 40000 })),
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

  /**
   * One turn with the template assistant.
   *
   * The bot does not answer WITH a new template — it EDITS this one, by calling
   * the tools in `src/agent/functions.ts`, which write the row directly. So the
   * template is re-read after the turn and returned alongside the reply: the
   * editor re-renders from it rather than trying to reconstruct the document
   * from a description in prose.
   *
   * The conversation is not stored. It travels in the request and into the
   * prompt (the legacy does the same — its history is the browser's), so
   * closing the panel ends the thread and a template carries no chat log.
   */
  .post(
    '/:id/assistant',
    async ({ request, params, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      const template = await getTemplate(guard.orgId, params.id)
      if (!template) {
        set.status = 404
        return { error: 'not found' }
      }
      if (!isTemplateAssistantConfigured()) {
        set.status = 503
        return { error: 'assistant_not_configured' }
      }

      try {
        const turn = await askTemplateAssistant({
          templateId: template.id,
          title: template.title,
          body: template.body,
          instruction: body.message,
          history: body.history ?? [],
          // The five edit tools, registered for the length of this turn. They
          // run HERE, scoped by the caller's own verified claims — the model
          // is told the template id in the prompt, and an id it invents or
          // borrows reaches nothing (see agent/functions.ts).
          tools: TOOL_SPECS.map((spec) => ({
            spec: {
              name: spec.name,
              description: spec.description,
              parameters: spec.parameters,
            },
            run: (args: Record<string, unknown>) =>
              invokeTool(spec.name, args, {
                orgId: guard.orgId,
                userId: guard.userId,
                userName: guard.userName,
              }),
          })),
        })
        // Re-read: the tools wrote to the row during the turn.
        const updated = await getTemplate(guard.orgId, params.id)
        return {
          reply: turn.reply,
          status: turn.status,
          template: updated,
          // Whether the turn actually changed the document, so the editor
          // reloads instead of only appending a chat bubble. Compared rather
          // than taken from `turn.edits`, because a tool can run and refuse
          // (`no_change`) — that is a call, not an edit.
          edited: updated?.body !== template.body,
          /** Which tools ran. Useful in a log when an edit did not land. */
          tools_used: turn.edits,
        }
      } catch (err) {
        set.status = 502
        return {
          error: 'assistant_unavailable',
          detail: err instanceof Error ? err.message : 'failed',
        }
      }
    },
    {
      body: t.Object({
        message: t.String({ minLength: 1, maxLength: 4000 }),
        history: t.Optional(
          t.Array(
            t.Object({
              role: t.Union([t.Literal('doctor'), t.Literal('assistant')]),
              body: t.String(),
            }),
            { maxItems: 40 },
          ),
        ),
      }),
    },
  )
