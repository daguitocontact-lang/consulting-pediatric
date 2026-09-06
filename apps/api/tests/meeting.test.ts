/**
 * The Jitsi room every consultation owns.
 *
 * The rule this file exists for: a room for EVERY mode. The legacy app signed a
 * token only when the mode was not `in_person`, so the office consultation —
 * the common one here — had no room at all.
 */
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { jwtVerify } from 'jose'
import { consultationsModule } from '../src/consultations'
import { endMeeting, getConsultation, startMeeting } from '../src/consultations/repos/consultations-repo'
import { ORG, OTHER_ORG, auth, migrate, seedConsultation, truncate } from './helpers'

const app = new Elysia().use(consultationsModule)

const call = (path: string, init: RequestInit = {}) =>
  app.handle(new Request(`http://localhost${path}`, init))

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T

type MeetingBody = {
  meeting: { domain: string; room: string; jwt: string | null; url: string; moderator: boolean }
  started_at: string | null
  ended_at: string | null
}

beforeAll(migrate)
beforeEach(truncate)

describe('a room for every kind of consultation', () => {
  test.each(['video', 'in_person', 'transcription'])('%s gets a room', async (mode) => {
    const id = await seedConsultation({ name: `a ${mode} one`, mode })

    const body = await json<MeetingBody>(
      await call(`/api/consultations/${id}/meeting`, { headers: await auth() }),
    )

    expect(body.meeting.room).toMatch(/^pediatric-[0-9a-f]{32}$/)
    expect(body.meeting.url).toBe(`https://${body.meeting.domain}/${body.meeting.room}`)
  })

  test('every consultation gets its OWN room', async () => {
    const first = await seedConsultation({ name: 'one' })
    const second = await seedConsultation({ name: 'two' })

    const rooms = await Promise.all(
      [first, second].map(async (id) =>
        (
          await json<MeetingBody>(
            await call(`/api/consultations/${id}/meeting`, { headers: await auth() }),
          )
        ).meeting.room,
      ),
    )

    expect(rooms[0]).not.toBe(rooms[1])
  })

  test('the room name is stable across calls — a reload is the same room', async () => {
    const id = await seedConsultation({ name: 'stable' })
    const headers = await auth()

    const first = await json<MeetingBody>(await call(`/api/consultations/${id}/meeting`, { headers }))
    const second = await json<MeetingBody>(await call(`/api/consultations/${id}/meeting`, { headers }))

    expect(second.meeting.room).toBe(first.meeting.room)
  })

  test('the room name is not derived from the id, so it cannot be guessed from a url', async () => {
    const id = await seedConsultation({ name: 'unguessable' })

    const body = await json<MeetingBody>(
      await call(`/api/consultations/${id}/meeting`, { headers: await auth() }),
    )

    // In public mode (no JITSI_APP_SECRET) the name IS the access control.
    expect(body.meeting.room).not.toContain(id.slice(0, 8))
  })

  test('another org cannot ask for a room of this org\'s consultation', async () => {
    const id = await seedConsultation({ name: 'ours' })

    const response = await call(`/api/consultations/${id}/meeting`, {
      headers: await auth({ org: OTHER_ORG }),
    })

    expect(response.status).toBe(404)
  })

  test('no token, no room', async () => {
    const id = await seedConsultation({ name: 'ours' })
    expect((await call(`/api/consultations/${id}/meeting`)).status).toBe(401)
  })
})

describe('the token', () => {
  test('is null when the server has no credentials — the room is public, not broken', async () => {
    // The preload configures no JITSI_APP_SECRET, which is how a dev stack (and
    // a self-hosted Jitsi before its JWT module is on) actually runs.
    const id = await seedConsultation({ name: 'public' })

    const body = await json<MeetingBody>(
      await call(`/api/consultations/${id}/meeting`, { headers: await auth() }),
    )

    expect(body.meeting.jwt).toBeNull()
    expect(body.meeting.domain).toBe('meet.jit.si')
  })

  test('is null on the PUBLIC server even with credentials — it cannot verify them', async () => {
    process.env.JITSI_APP_ID = 'pediatric_app'
    process.env.JITSI_APP_SECRET = 'a-secret-at-least-32-bytes-long-xxxxx'
    delete process.env.JITSI_DOMAIN // meet.jit.si

    const { signJitsiToken, isJitsiSecured } = await import(
      `../src/lib/jitsi?public=${Date.now()}`
    )

    // meet.jit.si verifies against 8x8's keys and refuses ours, which the
    // doctor sees as "no tienes permiso para unirte a esta llamada" on a room
    // that would have let them in unauthenticated.
    expect(isJitsiSecured()).toBe(false)
    expect(await signJitsiToken('room', { id: 'u', name: 'A', moderator: true })).toBeNull()

    delete process.env.JITSI_APP_ID
    delete process.env.JITSI_APP_SECRET
  })

  test('carries the room, the app id and the moderator features once configured', async () => {
    process.env.JITSI_APP_ID = 'pediatric_app'
    process.env.JITSI_APP_SECRET = 'a-secret-at-least-32-bytes-long-xxxxx'
    process.env.JITSI_DOMAIN = 'meet.pediatric.example'
    // The module reads its env at import time, exactly like lib/auth — so the
    // signer is imported AFTER the variables are set, in its own registry
    // entry.
    const { signJitsiToken, meetingFor } = await import(
      `../src/lib/jitsi?configured=${Date.now()}`
    )

    const token = (await signJitsiToken('pediatric-room', {
      id: 'user-1',
      name: 'Ana',
      moderator: true,
    })) as string
    expect(token).not.toBeNull()

    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode('a-secret-at-least-32-bytes-long-xxxxx'),
      { audience: 'pediatric_app', issuer: 'pediatric_app' },
    )

    expect(payload.room).toBe('pediatric-room')
    expect(payload.sub).toBe('pediatric_app')
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    const context = payload.context as {
      user: { name: string; moderator: boolean }
      features: Record<string, boolean>
    }
    expect(context.user).toMatchObject({ name: 'Ana', moderator: true })
    expect(context.features).toMatchObject({ recording: true, transcription: true })

    const guest = (await signJitsiToken('pediatric-room', {
      id: 'user-2',
      name: 'Parent',
      moderator: false,
    })) as string
    const guestPayload = (await jwtVerify(
      guest,
      new TextEncoder().encode('a-secret-at-least-32-bytes-long-xxxxx'),
    )) as { payload: { context: { features: Record<string, boolean> } } }
    // A room where every participant may record is a room that records itself.
    expect(guestPayload.payload.context.features.recording).toBe(false)

    const credentials = await meetingFor('pediatric-room', {
      id: 'user-1',
      name: 'Ana',
      moderator: true,
    })
    expect(credentials.domain).toBe('meet.pediatric.example')
    expect(credentials.url).toBe('https://meet.pediatric.example/pediatric-room')

    delete process.env.JITSI_APP_ID
    delete process.env.JITSI_APP_SECRET
    delete process.env.JITSI_DOMAIN
  })
})

describe('opening and closing the room', () => {
  test('joining stamps the start once and moves a pending consultation to recording', async () => {
    const id = await seedConsultation({ name: 'joined', status: 'initial' })

    const first = await startMeeting(ORG, id)
    const second = await startMeeting(ORG, id)

    expect(first!.status).toBe('recording')
    expect(first!.meeting_started_at).not.toBeNull()
    // A reload, a second participant, a reopened tab: still the same meeting.
    expect(second!.meeting_started_at).toEqual(first!.meeting_started_at)
  })

  test('a finished consultation is not re-opened by entering its room', async () => {
    const id = await seedConsultation({ name: 'done', status: 'finished' })

    const after = await startMeeting(ORG, id)

    expect(after!.status).toBe('finished')
  })

  test('leaving banks the elapsed time, computed on the server', async () => {
    const id = await seedConsultation({ name: 'timed', durationSeconds: 100 })
    // Start it in the past, so there is an elapsed to bank without sleeping.
    await startMeeting(ORG, id)
    const { sql } = await import('../src/lib/db')
    await sql`
      UPDATE consultations SET meeting_started_at = now() - INTERVAL '90 seconds'
       WHERE id = ${id}::uuid
    `

    const ended = await endMeeting(ORG, id)

    // 100 already recorded + the 90 seconds in the room. The browser is never
    // asked how long it was there: a closed laptop reports nothing and a wrong
    // clock reports an hour.
    expect(ended!.duration_seconds).toBe(190)
    expect(ended!.meeting_ended_at).not.toBeNull()
  })

  test('ending twice banks the time once', async () => {
    const id = await seedConsultation({ name: 'double', durationSeconds: 0 })
    await startMeeting(ORG, id)
    const { sql } = await import('../src/lib/db')
    await sql`
      UPDATE consultations SET meeting_started_at = now() - INTERVAL '30 seconds'
       WHERE id = ${id}::uuid
    `

    const first = await endMeeting(ORG, id)
    const second = await endMeeting(ORG, id)

    // Both the hang-up event and the dialog's cleanup call this; the second
    // must not double the consultation's length.
    expect(first!.duration_seconds).toBe(30)
    expect(second!.duration_seconds).toBe(30)
  })

  test('ending a room that was never joined banks nothing', async () => {
    const id = await seedConsultation({ name: 'never joined', durationSeconds: 42 })

    const ended = await endMeeting(ORG, id)

    expect(ended!.duration_seconds).toBe(42)
  })

  test('re-opening a closed room clears the end so the next leave counts again', async () => {
    const id = await seedConsultation({ name: 'resumed', durationSeconds: 0 })
    await startMeeting(ORG, id)
    await endMeeting(ORG, id)

    const reopened = await startMeeting(ORG, id)

    expect(reopened!.meeting_ended_at).toBeNull()
  })

  test('start and end are org-scoped', async () => {
    const id = await seedConsultation({ name: 'ours' })

    expect(await startMeeting(OTHER_ORG, id)).toBeNull()
    expect(await endMeeting(OTHER_ORG, id)).toBeNull()
    expect((await getConsultation(ORG, id))!.meeting_started_at).toBeNull()
  })

  test('the routes answer 404 for a consultation that is not this org\'s', async () => {
    const id = await seedConsultation({ name: 'ours' })
    const headers = await auth({ org: OTHER_ORG })

    expect((await call(`/api/consultations/${id}/meeting/start`, { method: 'POST', headers })).status).toBe(404)
    expect((await call(`/api/consultations/${id}/meeting/end`, { method: 'POST', headers })).status).toBe(404)
  })

  test('the listing carries the room, so a row can offer it without a second call', async () => {
    await seedConsultation({ name: 'listed', mode: 'in_person' })

    const body = await json<{ data: { room_name: string }[] }>(
      await call('/api/consultations', { headers: await auth() }),
    )

    expect(body.data[0]!.room_name).toMatch(/^pediatric-/)
  })
})
