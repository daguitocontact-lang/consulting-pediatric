/**
 * The consultation workspace — what the detail screen reads and writes.
 *
 *   GET   /api/consultations/:id/workspace          → the four panels at once
 *   POST  /api/consultations/:id/transcript         → append what was heard
 *   POST  /api/consultations/:id/recommendations    → add suggestions
 *   PATCH /api/consultations/:id/recommendations/:rid → featured / removed / clear
 *   PATCH /api/consultations/:id/note               → save the clinical note
 *   POST  /api/consultations/:id/chat               → a message in the assistant thread
 *   POST  /api/consultations/:id/stream/token       → credentials for the flow
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
import { isStreamConfigured, streamCredentials } from '../../lib/daguito-stream'
import { askAssistant, isAssistantConfigured } from '../../lib/daguito-chat'
import { getNote, listTranscript } from '../repos/workspace-repo'
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
      const role = body.role === 'assistant' ? 'assistant' : 'doctor'
      const message = await addChatMessage({
        orgId: guard.orgId,
        consultationId: params.id,
        role,
        body: body.body,
      })

      // Only a doctor's message asks for an answer; the engine writing its own
      // reply back through this route must not trigger another turn.
      if (role !== 'doctor' || !isAssistantConfigured()) {
        return { message, assistant: null, assistant_available: isAssistantConfigured() }
      }

      try {
        // The assistant reads what the consultation has so far: the note it may
        // be asked about, and the transcript of what was actually said.
        const [note, transcript] = await Promise.all([
          getNote(guard.orgId, params.id),
          listTranscript(guard.orgId, params.id),
        ])
        const turn = await askAssistant({
          consultationId: params.id,
          message: body.body,
          note: note?.body ?? null,
          transcript: transcript.map((segment) => segment.text).join('\n') || null,
        })
        if (!turn.reply) {
          // A flow that ran and said nothing is not an assistant message: a
          // blank bubble in a clinical thread is worse than an honest silence.
          return { message, assistant: null, assistant_available: true }
        }
        return {
          message,
          assistant: await addChatMessage({
            orgId: guard.orgId,
            consultationId: params.id,
            role: 'assistant',
            body: turn.reply,
          }),
          assistant_available: true,
        }
      } catch (err) {
        // The doctor's message is already saved, which is the part that must
        // never be lost. The turn failing is reported, not thrown.
        console.error(`[assistant] turn failed for consultation ${params.id}:`, err)
        set.status = 202
        return {
          message,
          assistant: null,
          assistant_available: true,
          assistant_error: err instanceof Error ? err.message : 'assistant failed',
        }
      }
    },
    {
      body: t.Object({
        body: t.String({ minLength: 1, maxLength: 8000 }),
        role: t.Optional(t.Union([t.Literal('doctor'), t.Literal('assistant')])),
      }),
    },
  )

  /**
   * A scoped credential for this consultation's transcription flow.
   *
   * The org's Daguito API key stays in this process: what the browser receives
   * is a token for ONE session, minutes long. The session key is the
   * consultation id, so a second doctor opening the same screen joins the same
   * flow session instead of starting a second transcription.
   */
  .post('/stream/token', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    const consultation = await getConsultation(guard.orgId, params.id)
    if (!consultation) {
      set.status = 404
      return { error: 'not found' }
    }
    if (!isStreamConfigured()) {
      // 503, not 500: nothing is broken, the engine is simply not wired in this
      // environment. The panel says "sin motor de transcripción" and the rest
      // of the screen keeps working.
      set.status = 503
      return { error: 'stream_not_configured' }
    }
    try {
      return {
        stream: await streamCredentials({
          mode: consultation.mode,
          sessionKey: consultation.id,
          baseInput: {
            patient_name: consultation.patient_name ?? undefined,
            consultation_id: consultation.id,
          },
        }),
      }
    } catch (err) {
      // The engine is Daguito's; when it refuses, say so with its own status
      // rather than a 500 that reads as a bug in this API.
      set.status = 502
      return { error: 'stream_unavailable', detail: err instanceof Error ? err.message : 'failed' }
    }
  })
