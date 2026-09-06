/**
 * The consultation workspace — what the detail screen reads and writes.
 *
 *   GET   /api/consultations/:id/workspace          → the four panels at once
 *   POST  /api/consultations/:id/transcript         → append what was heard
 *   POST  /api/consultations/:id/recommendations    → add suggestions
 *   PATCH /api/consultations/:id/recommendations/:rid → featured / removed / clear
 *   PATCH /api/consultations/:id/note               → save the clinical note
 *   POST  /api/consultations/:id/chat               → a message in the assistant thread
 *
 * The writes are shared: the doctor's own edits come from the panel, and the
 * transcript, the suggestions and the drafted note come from the transcription
 * flow. Same routes, same org check — an engine writing into this API is a
 * caller like any other and gets no back door.
 */
import { Elysia, t } from 'elysia'
import { requireOrg } from '../../lib/guard'
import { safeError } from '../../lib/errors'
import { getConsultation } from '../repos/consultations-repo'
import {
  addChatMessage,
  addRecommendations,
  appendTranscript,
  loadWorkspace,
  saveNote,
  setRecommendationStatus,
} from '../repos/workspace-repo'

export const workspaceRoutes = new Elysia({ prefix: '/api/consultations/:id' })
  .get('/workspace', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    // The consultation is fetched first and not just joined: it is the org
    // check for everything below, and a workspace for a consultation this org
    // does not own is a 404, not four empty panels.
    const consultation = await getConsultation(guard.orgId, params.id)
    if (!consultation) {
      set.status = 404
      return { error: 'not found' }
    }
    return { consultation, ...(await loadWorkspace(guard.orgId, params.id)) }
  })

  .post(
    '/transcript',
    async ({ request, params, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      if (!(await getConsultation(guard.orgId, params.id))) {
        set.status = 404
        return { error: 'not found' }
      }
      try {
        return {
          segments: await appendTranscript({
            orgId: guard.orgId,
            consultationId: params.id,
            segments: body.segments,
          }),
        }
      } catch (err) {
        const { status, body: safe } = safeError(err, 400, 'invalid_transcript')
        set.status = status
        return safe
      }
    },
    {
      body: t.Object({
        segments: t.Array(
          t.Object({
            text: t.String(),
            speaker: t.Optional(t.Nullable(t.String())),
            at_seconds: t.Optional(t.Number({ minimum: 0 })),
          }),
          { maxItems: 500 },
        ),
      }),
    },
  )

  .post(
    '/recommendations',
    async ({ request, params, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      if (!(await getConsultation(guard.orgId, params.id))) {
        set.status = 404
        return { error: 'not found' }
      }
      return {
        recommendations: await addRecommendations({
          orgId: guard.orgId,
          consultationId: params.id,
          items: body.items,
        }),
      }
    },
    {
      body: t.Object({
        items: t.Array(
          t.Object({
            value: t.String({ minLength: 1 }),
            category: t.Optional(t.String()),
            priority: t.Optional(t.Nullable(t.Number())),
          }),
          { maxItems: 100 },
        ),
      }),
    },
  )

  .patch(
    '/recommendations/:rid',
    async ({ request, params, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      const recommendation = await setRecommendationStatus({
        orgId: guard.orgId,
        id: params.rid,
        status: body.status ?? null,
      })
      if (!recommendation) {
        set.status = 404
        return { error: 'not found' }
      }
      return { recommendation }
    },
    {
      body: t.Object({
        // Null clears it: pressing "destacar" twice is how a doctor undoes it.
        status: t.Optional(
          t.Nullable(t.Union([t.Literal('featured'), t.Literal('removed')])),
        ),
      }),
    },
  )

  // PATCH, not PUT: the API's CORS allows GET/POST/PATCH/DELETE, and a note
  // save is an upsert of one field of the consultation, not a new resource.
  .patch(
    '/note',
    async ({ request, params, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      if (!(await getConsultation(guard.orgId, params.id))) {
        set.status = 404
        return { error: 'not found' }
      }
      return {
        note: await saveNote({
          orgId: guard.orgId,
          consultationId: params.id,
          body: body.body,
          templateId: body.template_id ?? null,
          // Only this route's caller decides, and the default is the safe one:
          // an engine write never overwrites what a doctor typed.
          source: body.source === 'engine' ? 'engine' : 'doctor',
        }),
      }
    },
    {
      body: t.Object({
        body: t.String(),
        template_id: t.Optional(t.Nullable(t.String())),
        source: t.Optional(t.Union([t.Literal('doctor'), t.Literal('engine')])),
      }),
    },
  )

  .post(
    '/chat',
    async ({ request, params, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      if (!(await getConsultation(guard.orgId, params.id))) {
        set.status = 404
        return { error: 'not found' }
      }
      return {
        message: await addChatMessage({
          orgId: guard.orgId,
          consultationId: params.id,
          role: body.role === 'assistant' ? 'assistant' : 'doctor',
          body: body.body,
        }),
      }
    },
    {
      body: t.Object({
        body: t.String({ minLength: 1, maxLength: 8000 }),
        role: t.Optional(t.Union([t.Literal('doctor'), t.Literal('assistant')])),
      }),
    },
  )
