/**
 * The patient's side of a video consultation.
 *
 *   POST /api/consultations/:id/patient-link          → the doctor mints a link
 *   GET  /public/consultations/:id/patient/session    → the patient opens it
 *
 * The second route is the ONLY one in this API besides the Daguito webhook that
 * does not go through `requireOrg`, and for the same kind of reason: the caller
 * is not a Daguito user and has no panel token. What it accepts instead is a
 * link token this API signed itself (lib/patient-link.ts), scoped to exactly
 * one consultation and carrying its org — so nothing here reads a tenant from
 * the request.
 *
 * Why it exists at all: `realtime-consultation` transcribes TWO channels, and
 * the patient's is `<session>:patient`. Nobody was feeding it, and an idle
 * transcribe node does not fail — it starves for its whole timeout and the
 * merge holds the doctor's transcript back with it.
 *
 * What the link buys, and nothing more:
 *   * the Jitsi room, as a NON-moderator,
 *   * a `produce`-only stream credential — push audio, never read the channel.
 *     The recommendations and the clinical note travel on that channel; a
 *     `bidi` token would put them one websocket away from a forwarded link.
 *   * `open: false` — the doctor's client opened the flow. Opening it twice
 *     runs it twice.
 */
import { Elysia } from 'elysia'
import { requireOrg } from '../../lib/guard'
import { meetingFor } from '../../lib/jitsi'
import { isLiveMode, isStreamConfigured, streamCredentials } from '../../lib/daguito-stream'
import { signPatientLink, verifyPatientLink } from '../../lib/patient-link'
import { PANEL_ORIGIN } from '../../lib/panel-origin'
import { getConsultation } from '../repos/consultations-repo'

export const patientRoutes = new Elysia()
  /**
   * The link the doctor sends the parent.
   *
   * Minted on demand rather than stored on the row: it carries an expiry, and a
   * link the doctor copies today for a consultation next week should be minted
   * next week. Only a video consultation has a second channel to feed — an
   * in-person one is a single microphone in a room, and handing out a link for
   * it would put a stranger's audio into the same transcript.
   */
  .post('/api/consultations/:id/patient-link', async ({ request, params, set }) => {
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
    if (consultation.mode !== 'video') {
      set.status = 409
      return { error: 'mode_not_video', detail: 'only a video consultation has a patient side' }
    }

    const { token, expiresAt } = await signPatientLink({
      consultationId: consultation.id,
      orgId: guard.orgId,
    })
    return {
      // The token is in the FRAGMENT, not the query: a fragment is never sent
      // to the server, never lands in an access log, and does not travel in a
      // Referer header when the page loads Jitsi's script from another origin.
      url: `${PANEL_ORIGIN}/patient.html#c=${consultation.id}&t=${token}`,
      expires_at: expiresAt,
    }
  })

  /**
   * Everything the patient's page needs, in one call.
   *
   * One round trip on purpose: the page is opened on a phone, on mobile data,
   * by somebody who will close it if it takes two seconds to do something.
   */
  .get('/public/consultations/:id/patient/session', async ({ params, query, set }) => {
    // No CORS credentials, no cookies: the link token is the whole credential
    // and it arrives in the query the page puts it in.
    const claims = await verifyPatientLink(query.t, params.id)
    if (!claims) {
      // 401 whether the token is malformed, expired or for another consultation.
      // Distinguishing them tells a probe which of the three it got wrong.
      set.status = 401
      return { error: 'invalid_link' }
    }

    const consultation = await getConsultation(claims.orgId, claims.consultationId)
    if (!consultation || consultation.mode !== 'video') {
      set.status = 404
      return { error: 'not found' }
    }
    if (consultation.status === 'finished') {
      // The visit is over. Saying so is better than a room nobody is in.
      set.status = 410
      return { error: 'consultation_finished' }
    }

    const meeting = await meetingFor(consultation.room_name, {
      id: `patient:${consultation.id}`,
      name: consultation.patient_name ?? 'Paciente',
      // Never a moderator: the room is the doctor's.
      moderator: false,
    })

    // The engine is optional here in a way it is not for the doctor: a patient
    // whose audio cannot be transcribed can still be in the call, and the call
    // is what they came for.
    let stream = null
    if (isStreamConfigured() && isLiveMode(consultation.mode)) {
      try {
        stream = await streamCredentials({
          mode: consultation.mode,
          sessionKey: consultation.id,
          // The doctor's client opened the flow with the authoritative
          // base_input. Opening it again would run it twice.
          open: false,
          // Push only. This is the difference between a link that shares a
          // microphone and a link that reads a clinical note.
          role: 'produce',
        })
      } catch (err) {
        console.warn(`[patient] stream credentials failed for ${consultation.id}:`, err)
      }
    }

    return {
      consultation: {
        id: consultation.id,
        patient_name: consultation.patient_name,
        status: consultation.status,
      },
      meeting,
      stream,
    }
  })
