/**
 * The consultation workspace: the four panels' persistence.
 *
 * The rules worth pinning are the ones that decide whose text wins — the
 * doctor's note over the engine's draft — and the ones that keep a panel from
 * filling with duplicates when the engine re-emits its whole list.
 */
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { consultationsModule } from '../src/consultations'
import {
  addChatMessage,
  addRecommendations,
  appendTranscript,
  getNote,
  listRecommendations,
  listTranscript,
  loadWorkspace,
  saveNote,
  setRecommendationStatus,
} from '../src/consultations/repos/workspace-repo'
import { ORG, OTHER_ORG, auth, migrate, seedConsultation, truncate } from './helpers'

const app = new Elysia().use(consultationsModule)
const call = (path: string, init: RequestInit = {}) =>
  app.handle(new Request(`http://localhost${path}`, init))
const json = async <T>(response: Response): Promise<T> => (await response.json()) as T

beforeAll(migrate)
beforeEach(truncate)

describe('transcript', () => {
  test('keeps the order it was SPOKEN in, not the order it arrived', async () => {
    const id = await seedConsultation({ name: 'talk' })

    // A partial that lands late is normal: the engine corrects an earlier
    // stretch while a later one is already through.
    await appendTranscript({
      orgId: ORG,
      consultationId: id,
      segments: [{ text: 'later', at_seconds: 30 }],
    })
    await appendTranscript({
      orgId: ORG,
      consultationId: id,
      segments: [{ text: 'earlier', at_seconds: 5 }],
    })

    expect((await listTranscript(ORG, id)).map((s) => s.text)).toEqual(['earlier', 'later'])
  })

  test('drops empty segments instead of rendering blank speaker lines', async () => {
    const id = await seedConsultation({ name: 'talk' })

    const written = await appendTranscript({
      orgId: ORG,
      consultationId: id,
      segments: [{ text: '   ', speaker: 'doctor' }, { text: 'real words' }],
    })

    expect(written).toHaveLength(1)
    expect(written[0]!.text).toBe('real words')
  })

  test('the route refuses a consultation of another org', async () => {
    const id = await seedConsultation({ name: 'ours' })

    const response = await call(`/api/consultations/${id}/transcript`, {
      method: 'POST',
      headers: { ...(await auth({ org: OTHER_ORG })), 'content-type': 'application/json' },
      body: JSON.stringify({ segments: [{ text: 'leak' }] }),
    })

    expect(response.status).toBe(404)
    expect(await listTranscript(ORG, id)).toEqual([])
  })
})

describe('recommendations', () => {
  test('the same advice twice is one row, accents and punctuation aside', async () => {
    const id = await seedConsultation({ name: 'rec' })

    await addRecommendations({
      orgId: ORG,
      consultationId: id,
      items: [{ value: 'Solicitar hemograma' }],
    })
    // The engine re-emits its whole list as the conversation grows.
    await addRecommendations({
      orgId: ORG,
      consultationId: id,
      items: [{ value: 'solicitar hemograma.' }, { value: 'Control en 48 horas' }],
    })

    const list = await listRecommendations(ORG, id)
    expect(list).toHaveLength(2)
  })

  test('pinned first, then by the engine ranking', async () => {
    const id = await seedConsultation({ name: 'rec' })
    const [first, second] = await addRecommendations({
      orgId: ORG,
      consultationId: id,
      items: [
        { value: 'ranked first', priority: 1 },
        { value: 'ranked second', priority: 2 },
      ],
    })
    expect(first!.value).toBe('ranked first')

    await setRecommendationStatus({ orgId: ORG, id: second!.id, status: 'featured' })

    expect((await listRecommendations(ORG, id)).map((r) => r.value)).toEqual([
      'ranked second',
      'ranked first',
    ])
  })

  test('a verdict can be undone', async () => {
    const id = await seedConsultation({ name: 'rec' })
    const [only] = await addRecommendations({
      orgId: ORG,
      consultationId: id,
      items: [{ value: 'maybe' }],
    })

    await setRecommendationStatus({ orgId: ORG, id: only!.id, status: 'removed' })
    const cleared = await setRecommendationStatus({ orgId: ORG, id: only!.id, status: null })

    // Pressing "descartar" twice is how a doctor takes it back; a triage that
    // cannot be undone is one nobody uses.
    expect(cleared!.status).toBeNull()
  })

  test('another org cannot triage this org\'s recommendation', async () => {
    const id = await seedConsultation({ name: 'rec' })
    const [only] = await addRecommendations({
      orgId: ORG,
      consultationId: id,
      items: [{ value: 'ours' }],
    })

    expect(
      await setRecommendationStatus({ orgId: OTHER_ORG, id: only!.id, status: 'removed' }),
    ).toBeNull()
  })
})

describe('the clinical note', () => {
  test('the engine may fill a note nobody has touched', async () => {
    const id = await seedConsultation({ name: 'note' })

    const drafted = await saveNote({
      orgId: ORG,
      consultationId: id,
      body: '# SOAP\nS: tos',
      source: 'engine',
    })

    expect(drafted.body).toContain('S: tos')
    expect(drafted.edited_at).toBeNull()
  })

  test('the engine NEVER overwrites what the doctor wrote', async () => {
    const id = await seedConsultation({ name: 'note' })
    await saveNote({ orgId: ORG, consultationId: id, body: 'draft', source: 'engine' })
    await saveNote({ orgId: ORG, consultationId: id, body: 'the doctor\'s words', source: 'doctor' })

    await saveNote({ orgId: ORG, consultationId: id, body: 're-rendered', source: 'engine' })

    // The legacy screen re-rendered the template on every flow emission and
    // wiped edits the doctor had been making for ten minutes.
    const note = await getNote(ORG, id)
    expect(note!.body).toBe("the doctor's words")
    expect(note!.edited_at).not.toBeNull()
  })

  test('the doctor can always overwrite their own note', async () => {
    const id = await seedConsultation({ name: 'note' })
    await saveNote({ orgId: ORG, consultationId: id, body: 'first', source: 'doctor' })

    await saveNote({ orgId: ORG, consultationId: id, body: 'second', source: 'doctor' })

    expect((await getNote(ORG, id))!.body).toBe('second')
  })

  test('a note is private to its org', async () => {
    const id = await seedConsultation({ name: 'note' })
    await saveNote({ orgId: ORG, consultationId: id, body: 'ours', source: 'doctor' })

    expect(await getNote(OTHER_ORG, id)).toBeNull()
  })

  test('the route defaults to a DOCTOR write, so a stray call cannot silently draft', async () => {
    const id = await seedConsultation({ name: 'note' })

    const { note } = await json<{ note: { edited_at: string | null } }>(
      await call(`/api/consultations/${id}/note`, {
        method: 'PATCH',
        headers: { ...(await auth()), 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'typed by hand' }),
      }),
    )

    expect(note.edited_at).not.toBeNull()
  })
})

describe('the workspace endpoint', () => {
  test('returns the four panels and the consultation in one call', async () => {
    const id = await seedConsultation({ name: 'all of it' })
    await appendTranscript({ orgId: ORG, consultationId: id, segments: [{ text: 'hola' }] })
    await addRecommendations({ orgId: ORG, consultationId: id, items: [{ value: 'reposo' }] })
    await saveNote({ orgId: ORG, consultationId: id, body: '# nota', source: 'engine' })
    await addChatMessage({ orgId: ORG, consultationId: id, role: 'doctor', body: '¿y la fiebre?' })

    const body = await json<{
      consultation: { id: string }
      transcript: unknown[]
      recommendations: unknown[]
      note: { body: string }
      chat: unknown[]
    }>(await call(`/api/consultations/${id}/workspace`, { headers: await auth() }))

    expect(body.consultation.id).toBe(id)
    expect(body.transcript).toHaveLength(1)
    expect(body.recommendations).toHaveLength(1)
    expect(body.note.body).toBe('# nota')
    expect(body.chat).toHaveLength(1)
  })

  test('is a 404 for another org, not four empty panels', async () => {
    const id = await seedConsultation({ name: 'ours' })

    const response = await call(`/api/consultations/${id}/workspace`, {
      headers: await auth({ org: OTHER_ORG }),
    })

    expect(response.status).toBe(404)
  })

  test('a consultation with nothing yet answers with empty panels, not an error', async () => {
    const id = await seedConsultation({ name: 'fresh' })

    const workspace = await loadWorkspace(ORG, id)

    expect(workspace).toEqual({ transcript: [], recommendations: [], note: null, chat: [] })
  })
})

describe('the assistant thread', () => {
  test('keeps both sides in the order they were said', async () => {
    const id = await seedConsultation({ name: 'chat' })

    await addChatMessage({ orgId: ORG, consultationId: id, role: 'doctor', body: 'pregunta' })
    await addChatMessage({ orgId: ORG, consultationId: id, role: 'assistant', body: 'respuesta' })

    const { chat } = await loadWorkspace(ORG, id)
    expect(chat.map((m) => `${m.role}:${m.body}`)).toEqual([
      'doctor:pregunta',
      'assistant:respuesta',
    ])
  })

  test('the route writes as the DOCTOR unless it is told otherwise', async () => {
    const id = await seedConsultation({ name: 'chat' })

    await call(`/api/consultations/${id}/chat`, {
      method: 'POST',
      headers: { ...(await auth()), 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hola' }),
    })

    const { chat } = await loadWorkspace(ORG, id)
    expect(chat[0]!.role).toBe('doctor')
  })
})
