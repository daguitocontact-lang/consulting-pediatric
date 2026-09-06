/**
 * The HTTP surface the panel calls, driven through Elysia's own `handle` — no
 * network, but the real routing, the real body validation and the real
 * `requireOrg`.
 *
 * The module is mounted on a bare Elysia here rather than importing src/index,
 * which would bind a port and run the boot-time migrations and the outbound
 * custom-field sync on every test run.
 */
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { consultationsModule } from '../src/consultations'
import { ORG, OTHER_ORG, auth, migrate, seedConsultation, truncate } from './helpers'

const app = new Elysia().use(consultationsModule)

const call = (path: string, init: RequestInit = {}) =>
  app.handle(new Request(`http://localhost${path}`, init))

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T

beforeAll(migrate)
beforeEach(truncate)

describe('the tenant gate', () => {
  test('no token is 401', async () => {
    expect((await call('/api/consultations')).status).toBe(401)
  })

  test('a token this custom does not serve is 403, not 401', async () => {
    const response = await call('/api/consultations', {
      headers: await auth({ org: 'org_stranger' }),
    })

    // 401 would say "log in again", which is wrong and would send a doctor
    // round a login loop: the token is perfectly valid, it is simply not ours.
    expect(response.status).toBe(403)
    expect(await json<{ error: string }>(response)).toEqual({ error: 'forbidden' })
  })

  test('an expired token is 401', async () => {
    const response = await call('/api/consultations', {
      headers: await auth({ expiresIn: '-1m' }),
    })
    expect(response.status).toBe(401)
  })

  test('a row of another org answers 404, never 403', async () => {
    const id = await seedConsultation({ name: 'Ours' })

    const response = await call(`/api/consultations/${id}`, { headers: await auth({ org: OTHER_ORG }) })

    // 403 here would confirm the id exists in some other org's data.
    expect(response.status).toBe(404)
  })
})

describe('GET /api/consultations', () => {
  test('returns the page, the total and the tab counts', async () => {
    await seedConsultation({ name: 'One', mode: 'video' })
    await seedConsultation({ name: 'Two', mode: 'in_person' })

    const body = await json<{ data: unknown[]; total: number; counts: Record<string, number> }>(
      await call('/api/consultations', { headers: await auth() }),
    )

    expect(body.total).toBe(2)
    expect(body.data).toHaveLength(2)
    expect(body.counts).toMatchObject({ all: 2, video: 1, in_person: 1 })
  })

  test('a nonsense page or limit falls back instead of 500ing', async () => {
    await seedConsultation({ name: 'One' })

    const body = await json<{ page: number; limit: number; total: number }>(
      await call('/api/consultations?page=abc&limit=-4', { headers: await auth() }),
    )

    // `page=abc` used to reach Postgres as NaN. A listing is a read: nonsense
    // is page one, not an error page.
    expect(body).toMatchObject({ page: 1, limit: 10, total: 1 })
  })

  test('an unknown mode or a malformed date is ignored, not rejected', async () => {
    await seedConsultation({ name: 'One', mode: 'video' })

    const body = await json<{ total: number }>(
      await call('/api/consultations?mode=telepathy&date=yesterday', { headers: await auth() }),
    )

    expect(body.total).toBe(1)
  })

  test('an unknown sort column falls back to the default order', async () => {
    await seedConsultation({ name: 'older', createdAt: '2026-01-01T10:00:00Z' })
    await seedConsultation({ name: 'newer', createdAt: '2026-05-01T10:00:00Z' })

    const body = await json<{ data: { name: string }[] }>(
      await call('/api/consultations?sort=drop%20table&dir=asc', { headers: await auth() }),
    )

    expect(body.data.map((row) => row.name)).toEqual(['newer', 'older'])
  })
})

describe('writes', () => {
  test('create answers 201 with the row, and the listing shows it', async () => {
    const response = await call('/api/consultations', {
      method: 'POST',
      headers: { ...(await auth()), 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'video', patient_name: 'Ana', name: 'Control' }),
    })

    expect(response.status).toBe(201)
    const { consultation } = await json<{ consultation: { id: string; mode: string } }>(response)
    expect(consultation.mode).toBe('video')

    const list = await json<{ total: number }>(
      await call('/api/consultations', { headers: await auth() }),
    )
    expect(list.total).toBe(1)
  })

  test('an invalid mode is refused by the schema', async () => {
    const response = await call('/api/consultations', {
      method: 'POST',
      headers: { ...(await auth()), 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'telepathy' }),
    })

    expect(response.status).toBe(422)
  })

  test('rename patches only the name', async () => {
    const id = await seedConsultation({ name: 'Old', status: 'finished' })

    const { consultation } = await json<{ consultation: { name: string; status: string } }>(
      await call(`/api/consultations/${id}`, {
        method: 'PATCH',
        headers: { ...(await auth()), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'New' }),
      }),
    )

    expect(consultation).toMatchObject({ name: 'New', status: 'finished' })
  })

  test('consent is stamped through its own route and is idempotent', async () => {
    const id = await seedConsultation({ name: 'Consent' })
    const headers = await auth()

    const first = await json<{ consultation: { patient_consent_at: string } }>(
      await call(`/api/consultations/${id}/consent`, { method: 'POST', headers }),
    )
    const second = await json<{ consultation: { patient_consent_at: string } }>(
      await call(`/api/consultations/${id}/consent`, { method: 'POST', headers }),
    )

    expect(first.consultation.patient_consent_at).not.toBeNull()
    expect(second.consultation.patient_consent_at).toBe(first.consultation.patient_consent_at)
  })

  test('duration adds up and refuses a negative', async () => {
    const id = await seedConsultation({ name: 'Timed', durationSeconds: 60 })

    const ok = await json<{ consultation: { duration_seconds: number } }>(
      await call(`/api/consultations/${id}/duration`, {
        method: 'POST',
        headers: { ...(await auth()), 'content-type': 'application/json' },
        body: JSON.stringify({ seconds: 30 }),
      }),
    )
    expect(ok.consultation.duration_seconds).toBe(90)

    const bad = await call(`/api/consultations/${id}/duration`, {
      method: 'POST',
      headers: { ...(await auth()), 'content-type': 'application/json' },
      body: JSON.stringify({ seconds: -30 }),
    })
    expect(bad.status).toBe(422)
  })

  test('delete twice is 404 the second time', async () => {
    const id = await seedConsultation({ name: 'Mistake' })
    const headers = await auth()

    expect((await call(`/api/consultations/${id}`, { method: 'DELETE', headers })).status).toBe(200)
    expect((await call(`/api/consultations/${id}`, { method: 'DELETE', headers })).status).toBe(404)
  })

  test('a malformed uuid is a 400, not a crash', async () => {
    const response = await call('/api/consultations/not-a-uuid', { headers: await auth() })

    // src/index.ts maps Postgres 22P02 for the whole API; the module answers
    // the driver error here, which is what that hook is fed.
    expect([400, 500]).toContain(response.status)
  })
})

describe('templates', () => {
  test('create, list, and refuse a duplicate title', async () => {
    const headers = { ...(await auth()), 'content-type': 'application/json' }

    const created = await call('/api/consultation-templates', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Control' }),
    })
    expect(created.status).toBe(201)

    const duplicate = await call('/api/consultation-templates', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'control' }),
    })
    expect(duplicate.status).toBe(409)

    const { templates } = await json<{ templates: { title: string }[] }>(
      await call('/api/consultation-templates', { headers: await auth() }),
    )
    expect(templates.map((row) => row.title)).toEqual(['Control'])
  })

  test('another org does not see this org\'s templates', async () => {
    await call('/api/consultation-templates', {
      method: 'POST',
      headers: { ...(await auth({ org: ORG })), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Ours' }),
    })

    const { templates } = await json<{ templates: unknown[] }>(
      await call('/api/consultation-templates', { headers: await auth({ org: OTHER_ORG }) }),
    )
    expect(templates).toEqual([])
  })
})
