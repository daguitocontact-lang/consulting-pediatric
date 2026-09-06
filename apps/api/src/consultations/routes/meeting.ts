/**
 * The video room of a consultation — ANY consultation.
 *
 *   GET  /api/consultations/:id/meeting        → credentials to open the room
 *   POST /api/consultations/:id/meeting/start  → the room was joined
 *   POST /api/consultations/:id/meeting/end    → the room was closed
 *
 * The legacy app minted a room only when the mode was not `in_person`, so the
 * office consultation — the most common one in a paediatric practice — was the
 * one that could not pull in a parent who could not come, a specialist for a
 * second opinion, or an interpreter. Nothing about a room depends on the mode:
 * it is a door, and the doctor decides whether to open it.
 *
 * The panel is handed a domain and a token rather than reading a build-time
 * env: the bundle is loaded at runtime inside Daguito's page and cannot be
 * rebuilt to point at another Jitsi, and the token is per user anyway.
 */
import { Elysia } from 'elysia'
import { requireOrg } from '../../lib/guard'
import { meetingFor } from '../../lib/jitsi'
import { endMeeting, getConsultation, startMeeting } from '../repos/consultations-repo'

export const meetingRoutes = new Elysia({ prefix: '/api/consultations/:id/meeting' })
  .get('/', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    // The room name is read from the row rather than computed, so a token can
    // only ever be signed for a room of THIS org's consultation.
    const consultation = await getConsultation(guard.orgId, params.id)
    if (!consultation) {
      set.status = 404
      return { error: 'not found' }
    }
    return {
      meeting: await meetingFor(consultation.room_name, {
        id: guard.userId,
        // The room shows who is in it; the patient's name is the label that
        // makes sense to the other side, and the doctor's own name is not
        // something this API knows — Daguito owns the directory.
        name: consultation.patient_name ?? 'Doctor',
        moderator: true,
      }),
      started_at: consultation.meeting_started_at,
      ended_at: consultation.meeting_ended_at,
    }
  })

  .post('/start', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    const consultation = await startMeeting(guard.orgId, params.id)
    if (!consultation) {
      set.status = 404
      return { error: 'not found' }
    }
    return { consultation }
  })

  .post('/end', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    const consultation = await endMeeting(guard.orgId, params.id)
    if (!consultation) {
      set.status = 404
      return { error: 'not found' }
    }
    return { consultation }
  })
