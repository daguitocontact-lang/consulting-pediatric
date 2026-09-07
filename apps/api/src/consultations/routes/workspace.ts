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
import { isLiveMode, isStreamConfigured, streamCredentials } from '../../lib/daguito-stream'
import { consultationBaseInput } from '../flow-input'
import { addCosts } from '../repos/consultations-repo'
import { askAssistant, assistantTurnCost, isAssistantConfigured } from '../../lib/daguito-chat'
import { getTemplate } from '../repos/templates-repo'
import { noteTools } from '../note-tools'
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
      const consultation = await getConsultation(guard.orgId, params.id)
      if (!consultation) {
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
        const [note, transcript, template] = await Promise.all([
          getNote(guard.orgId, params.id),
          listTranscript(guard.orgId, params.id),
          consultation.template_id ? getTemplate(guard.orgId, consultation.template_id) : null,
        ])
        // The WORKING DOCUMENT, the legacy's `workingDoc`: the note if one has
        // been written, otherwise the template's authored body with its
        // `[[placeholders]]` still in it. Seeding from the template is what
        // lets the assistant know the note's fields BEFORE any transcription
        // has produced one — without it, it reads an empty rendered note and
        // tells the doctor there is no template when there is.
        const workingDoc = note?.body?.trim() || template?.body?.trim() || null

        const turn = await askAssistant({
          consultationId: params.id,
          message: body.body,
          workingDoc,
          transcript: transcript.map((segment) => segment.text).join('\n') || null,
          // The consultation's language, not a hardcoded 'es': it is a column
          // and the flow interpolates it into the prompt.
          language: consultation.language,
          // What makes it an assistant rather than a chat beside the note: it
          // can read the note's fields and write one. Scoped to THIS
          // consultation for the length of this turn.
          tools: noteTools({ orgId: guard.orgId, consultationId: params.id }),
        })
        if (!turn.reply) {
          // A flow that ran and said nothing is not an assistant message: a
          // blank bubble in a clinical thread is worse than an honest silence.
          return { message, assistant: null, assistant_available: true }
        }
        // What Daguito charged for the turn, from its ledger — the `cost`
        // events go to whoever consumes the flow, and for a turn this API runs
        // one-shot that is nobody. Best-effort: an unbilled turn is an
        // accounting gap, never a reason to lose the doctor's answer.
        void assistantTurnCost(params.id)
          .then((usd) =>
            usd ? addCosts({ orgId: guard.orgId, id: params.id, chatbot: usd, chatbotCount: 1 }) : null,
          )
          .catch(() => {})

        return {
          message,
          assistant: await addChatMessage({
            orgId: guard.orgId,
            consultationId: params.id,
            role: 'assistant',
            body: turn.reply,
          }),
          assistant_available: true,
          /** Which note tools ran, so the screen knows to re-read the note. */
          tools_used: turn.tools_used,
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
    if (!isLiveMode(consultation.mode)) {
      // `transcription` is an upload, not a microphone: its flow has no
      // streaming STT node to listen. Handing out a credential anyway is what
      // made that mode look like it was recording and transcribe nothing.
      set.status = 409
      return { error: 'mode_not_live', detail: 'this consultation transcribes an upload' }
    }
    try {
      return {
        stream: await streamCredentials({
          mode: consultation.mode,
          sessionKey: consultation.id,
          // Server-authoritative, and the whole reason this round trip exists:
          // the template the note is written into and the model that writes it
          // are not the browser's to choose. See flow-input.ts.
          baseInput: await consultationBaseInput({
            orgId: guard.orgId,
            consultation,
            doctorName: guard.userName,
          }),
        }),
      }
    } catch (err) {
      // The engine is Daguito's; when it refuses, say so with its own status
      // rather than a 500 that reads as a bug in this API.
      set.status = 502
      return { error: 'stream_unavailable', detail: err instanceof Error ? err.message : 'failed' }
    }
  })

  /**
   * What the engine charged for this consultation, added to the row.
   *
   * Daguito bills per step and emits a `cost` event per charge, straight to the
   * browser that is consuming the flow — so the panel is the only thing that
   * sees them, exactly as in the legacy app, where the Header showed a live
   * total that never survived the consultation closing. It sends its
   * accumulator here so it does.
   *
   * Added, never set (see addCosts): a consultation recorded in three stretches
   * bills three times, and the panel only knows about its own stretch.
   */
  .post(
    '/costs',
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
      await addCosts({
        orgId: guard.orgId,
        id: params.id,
        streaming: body.streaming_usd,
        streamingCount: body.streaming_count,
        facts: body.facts_usd,
        factsCount: body.facts_count,
        template: body.template_usd,
        templateCount: body.template_count,
      })
      return { ok: true }
    },
    {
      body: t.Object({
        streaming_usd: t.Optional(t.Number({ minimum: 0 })),
        streaming_count: t.Optional(t.Number({ minimum: 0 })),
        facts_usd: t.Optional(t.Number({ minimum: 0 })),
        facts_count: t.Optional(t.Number({ minimum: 0 })),
        template_usd: t.Optional(t.Number({ minimum: 0 })),
        template_count: t.Optional(t.Number({ minimum: 0 })),
      }),
    },
  )
