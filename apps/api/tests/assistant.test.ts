/**
 * The clinical assistant: how a flow run becomes a message in the thread.
 *
 * The turn itself is a Daguito agent flow, so what is testable here is the part
 * that bit: reading the reply out of a run trace, and the route's promise that
 * the doctor's message is kept whatever the engine does.
 */
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { consultationsModule } from '../src/consultations'
import { listChat } from '../src/consultations/repos/workspace-repo'
import { ORG, auth, migrate, seedConsultation, truncate } from './helpers'

const app = new Elysia().use(consultationsModule)
const call = (path: string, init: RequestInit = {}) =>
  app.handle(new Request(`http://localhost${path}`, init))
const json = async <T>(response: Response): Promise<T> => (await response.json()) as T

beforeAll(migrate)
beforeEach(truncate)

describe('reading the reply out of a run', () => {
  test('takes the agent step content, which is where a completed run puts it', async () => {
    const { replyFromForTest } = await import('../src/lib/daguito-chat')

    // The shape the live flow actually returns — not a string, a run trace.
    // Looking for `reply`/`text`/`message` found nothing and the doctor got an
    // empty answer while the agent had written a full one.
    expect(
      replyFromForTest({
        steps: [
          { node_id: 'trigger', kind: 'trigger', output: 'out' },
          { node_id: 'agent', kind: 'agent', data: { output: { content: '10-15 mg/kg/dosis' } } },
        ],
      }),
    ).toBe('10-15 mg/kg/dosis')
  })

  test('the LAST agent step wins', async () => {
    const { replyFromForTest } = await import('../src/lib/daguito-chat')

    expect(
      replyFromForTest({
        steps: [
          { data: { output: { content: 'first pass' } } },
          { data: { output: { content: 'the answer meant for the doctor' } } },
        ],
      }),
    ).toBe('the answer meant for the doctor')
  })

  test('a plain string, and the simpler shapes, still work', async () => {
    const { replyFromForTest } = await import('../src/lib/daguito-chat')

    expect(replyFromForTest('  hola  ')).toBe('hola')
    expect(replyFromForTest({ reply: 'hola' })).toBe('hola')
  })

  test('a run that said nothing is no answer, not "undefined"', async () => {
    const { replyFromForTest } = await import('../src/lib/daguito-chat')

    expect(replyFromForTest({ steps: [{ data: { output: {} } }] })).toBe('')
    expect(replyFromForTest(null)).toBe('')
    expect(replyFromForTest(42)).toBe('')
  })
})

describe('the chat route', () => {
  test('with no engine configured the message is still kept', async () => {
    // The preload configures no flow credentials, which is also how a dev
    // stack runs. The question belongs in the record either way.
    const id = await seedConsultation({ name: 'chat' })

    const body = await json<{ assistant_available: boolean; assistant: unknown }>(
      await call(`/api/consultations/${id}/chat`, {
        method: 'POST',
        headers: { ...(await auth()), 'content-type': 'application/json' },
        body: JSON.stringify({ body: '¿dosis para 16 kg?' }),
      }),
    )

    expect(body.assistant_available).toBe(false)
    expect(body.assistant).toBeNull()
    const chat = await listChat(ORG, id)
    expect(chat.map((m) => m.role)).toEqual(['doctor'])
  })

  test('a message written AS the assistant does not ask for another turn', async () => {
    const id = await seedConsultation({ name: 'chat' })

    await call(`/api/consultations/${id}/chat`, {
      method: 'POST',
      headers: { ...(await auth()), 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'respuesta del motor', role: 'assistant' }),
    })

    // Otherwise the engine writing its own reply through this route starts an
    // endless conversation with itself.
    const chat = await listChat(ORG, id)
    expect(chat).toHaveLength(1)
    expect(chat[0]!.role).toBe('assistant')
  })
})
