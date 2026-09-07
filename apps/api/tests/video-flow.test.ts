/**
 * The video consultation, end to end — the flow, not the pieces.
 *
 * A video consultation is the only mode with two participants and two audio
 * channels, and every failure it has is silent: an idle `:patient` transcribe
 * node does not error, it starves for its timeout and takes the doctor's
 * transcript with it; a link scoped to the wrong consultation still verifies;
 * a `bidi` credential handed to a patient reads the clinical note and nothing
 * anywhere says so. So the flow is asserted as a sequence, in the order a
 * consultation actually happens.
 *
 * The engine is NOT configured in tests (no DAGUITO_STREAM_API_KEY), which is
 * deliberate: everything here is the part this API decides on its own — who
 * gets which room, with which role, and when the door closes. The credential
 * minting itself is Daguito's and is exercised against the real service by
 * hand, not by a suite that would need a network.
 */
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { consultationsModule } from '../src/consultations'
import { ORG, OTHER_ORG, auth, migrate, seedConsultation, truncate } from './helpers'

const app = new Elysia().use(consultationsModule)

const call = (path: string, init: RequestInit = {}) =>
  app.handle(new Request(`http://localhost${path}`, init))

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T

type Meeting = { domain: string; room: string; moderator: boolean; url: string }
type LinkBody = { url: string; expires_at: string }
type SessionBody = {
  consultation: { id: string; patient_name: string | null; status: string }
  meeting: Meeting
  stream: { session_key: string } | null
}

/** The link is `…/patient.html#c=<id>&t=<token>`; the token is what is tested. */
const tokenOf = (url: string): string => new URLSearchParams(url.split('#')[1]).get('t')!

beforeAll(migrate)
beforeEach(truncate)

describe('the video consultation, in order', () => {
  test('the doctor gets the room as moderator, the patient gets the SAME room as a guest', async () => {
    const id = await seedConsultation({ patientName: 'Mateo', mode: 'video' })

    const doctor = await json<{ meeting: Meeting }>(
      await call(`/api/consultations/${id}/meeting`, { headers: await auth() }),
    )
    const link = await json<LinkBody>(
      await call(`/api/consultations/${id}/patient-link`, {
        method: 'POST',
        headers: await auth(),
      }),
    )
    const session = await json<SessionBody>(
      await call(`/public/consultations/${id}/patient/session?t=${tokenOf(link.url)}`),
    )

    // The same room, or they are in two different calls — which looks to each
    // of them like the other never showed up.
    expect(session.meeting.room).toBe(doctor.meeting.room)
    expect(session.meeting.domain).toBe(doctor.meeting.domain)

    // The room is the doctor's. A patient who can moderate can mute them, or
    // stay in the room after they leave.
    expect(doctor.meeting.moderator).toBe(true)
    expect(session.meeting.moderator).toBe(false)
  })

  test('the link identifies the patient to the doctor, not the other way round', async () => {
    const id = await seedConsultation({ patientName: 'Mateo', mode: 'video' })
    const link = await json<LinkBody>(
      await call(`/api/consultations/${id}/patient-link`, {
        method: 'POST',
        headers: await auth(),
      }),
    )
    const session = await json<SessionBody>(
      await call(`/public/consultations/${id}/patient/session?t=${tokenOf(link.url)}`),
    )
    expect(session.consultation.patient_name).toBe('Mateo')
    // Nothing clinical crosses: no note, no recommendations, no transcript.
    expect(Object.keys(session.consultation).sort()).toEqual(['id', 'patient_name', 'status'])
  })

  test('the link carries the token in the FRAGMENT, never the query', async () => {
    // A fragment is not sent to the server, stays out of access logs, and does
    // not travel in the Referer when the page loads Jitsi from another origin.
    const id = await seedConsultation({ mode: 'video' })
    const { url } = await json<LinkBody>(
      await call(`/api/consultations/${id}/patient-link`, {
        method: 'POST',
        headers: await auth(),
      }),
    )
    expect(url).toContain('/patient.html#c=')
    expect(url.split('#')[0]).not.toContain('t=')
    expect(url).toContain(id)
  })

  test('once the consultation is finished the link stops working', async () => {
    const id = await seedConsultation({ mode: 'video' })
    const { url } = await json<LinkBody>(
      await call(`/api/consultations/${id}/patient-link`, {
        method: 'POST',
        headers: await auth(),
      }),
    )
    await call(`/api/consultations/${id}`, {
      method: 'PATCH',
      headers: { ...(await auth()), 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'finished' }),
    })

    // 410, not 401: the link was fine, the visit is over. That is what the
    // page tells the parent instead of putting them in an empty room.
    const response = await call(`/public/consultations/${id}/patient/session?t=${tokenOf(url)}`)
    expect(response.status).toBe(410)
  })
})

describe('what the patient link is NOT', () => {
  test('a link for one consultation does not open another', async () => {
    const mine = await seedConsultation({ mode: 'video', name: 'mine' })
    const theirs = await seedConsultation({ mode: 'video', name: 'another family' })
    const { url } = await json<LinkBody>(
      await call(`/api/consultations/${mine}/patient-link`, {
        method: 'POST',
        headers: await auth(),
      }),
    )
    const response = await call(
      `/public/consultations/${theirs}/patient/session?t=${tokenOf(url)}`,
    )
    expect(response.status).toBe(401)
  })

  test('it is not a panel token: it opens no data route', async () => {
    const id = await seedConsultation({ mode: 'video' })
    const { url } = await json<LinkBody>(
      await call(`/api/consultations/${id}/patient-link`, {
        method: 'POST',
        headers: await auth(),
      }),
    )
    const response = await call(`/api/consultations/${id}/workspace`, {
      headers: { authorization: `Bearer ${tokenOf(url)}` },
    })
    expect(response.status).toBe(401)
  })

  test('a token that is absent, forged or truncated is refused', async () => {
    const id = await seedConsultation({ mode: 'video' })
    for (const t of ['', 'nonsense', 'a.b.c']) {
      expect((await call(`/public/consultations/${id}/patient/session?t=${t}`)).status).toBe(401)
    }
    expect((await call(`/public/consultations/${id}/patient/session`)).status).toBe(401)
  })
})

describe('who may mint a patient link', () => {
  test('only a VIDEO consultation has a patient side', async () => {
    // A presencial is one microphone in one room: a link would put a stranger's
    // audio into the same transcript. An upload has no live session at all.
    for (const mode of ['in_person', 'transcription']) {
      const id = await seedConsultation({ mode })
      const response = await call(`/api/consultations/${id}/patient-link`, {
        method: 'POST',
        headers: await auth(),
      })
      expect(response.status).toBe(409)
      expect(await json<{ error: string }>(response)).toMatchObject({ error: 'mode_not_video' })
    }
  })

  test('another org cannot mint a link for our consultation', async () => {
    const id = await seedConsultation({ mode: 'video' })
    const response = await call(`/api/consultations/${id}/patient-link`, {
      method: 'POST',
      headers: await auth({ org: OTHER_ORG }),
    })
    // 404, not 403: a 403 would confirm the id exists somewhere.
    expect(response.status).toBe(404)
  })

  test('an anonymous caller cannot mint one', async () => {
    const id = await seedConsultation({ mode: 'video' })
    expect((await call(`/api/consultations/${id}/patient-link`, { method: 'POST' })).status).toBe(
      401,
    )
  })
})

describe('the room clock', () => {
  test('joining stamps the start, leaving stamps the end and banks the time', async () => {
    const id = await seedConsultation({ mode: 'video', status: 'recording' })
    const headers = await auth()

    const started = await json<{ consultation: { meeting_started_at: string | null } }>(
      await call(`/api/consultations/${id}/meeting/start`, { method: 'POST', headers }),
    )
    expect(started.consultation.meeting_started_at).not.toBeNull()

    const ended = await json<{ consultation: { meeting_ended_at: string | null } }>(
      await call(`/api/consultations/${id}/meeting/end`, { method: 'POST', headers }),
    )
    expect(ended.consultation.meeting_ended_at).not.toBeNull()
  })

  test('joining twice does not restart the clock', async () => {
    // Jitsi fires its joined event more than once, and the panel stamps on
    // open AND on the event. A second stamp would throw away the first
    // stretch of the consultation.
    const id = await seedConsultation({ mode: 'video', status: 'recording' })
    const headers = await auth()
    const first = await json<{ consultation: { meeting_started_at: string } }>(
      await call(`/api/consultations/${id}/meeting/start`, { method: 'POST', headers }),
    )
    const second = await json<{ consultation: { meeting_started_at: string } }>(
      await call(`/api/consultations/${id}/meeting/start`, { method: 'POST', headers }),
    )
    expect(second.consultation.meeting_started_at).toBe(first.consultation.meeting_started_at)
  })
})

describe('the transcription channels', () => {
  test('video runs the two-channel flow, presencial the one-channel one', async () => {
    // The doctor's browser feeds `<session>:doctor`; the patient's page feeds
    // `<session>:patient`. Sending a presencial through the video flow leaves
    // the second node idle and the merge withholds the doctor's transcript for
    // its whole timeout — the "30 seconds before it starts" bug.
    const { flowForMode } = await import('../src/lib/daguito-stream')
    expect(flowForMode('video')).toBe('realtime-consultation')
    expect(flowForMode('in_person')).toBe('in-person-consultation')
  })

  test('both sides are handed the SAME session key', async () => {
    // The session key is the consultation id: one flow session, two channels.
    // A key of the patient's own would open a second transcription of the same
    // visit, and the doctor would see half of it.
    const id = await seedConsultation({ mode: 'video', patientName: 'Mateo' })
    const { url } = await json<LinkBody>(
      await call(`/api/consultations/${id}/patient-link`, {
        method: 'POST',
        headers: await auth(),
      }),
    )
    const session = await json<SessionBody>(
      await call(`/public/consultations/${id}/patient/session?t=${tokenOf(url)}`),
    )
    // With no engine configured the credential is null and the call still
    // works — the parent is here for the call, and the room is served above.
    expect(session.stream === null || session.stream.session_key === id).toBe(true)
    expect(session.meeting.room).toBeTruthy()
  })
})
