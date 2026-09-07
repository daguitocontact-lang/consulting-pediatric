/**
 * Editing a template through the agent's tools.
 *
 * `mdops.test.ts` covers what an operation does to a string. This covers the
 * layer the model actually reaches: the five tools behind
 * `POST /agent/functions/:name`, which read and WRITE the template row.
 *
 * Three things are asserted here that a pure-function test cannot:
 *
 *   * the edit is PERSISTED, and chained edits compose through the database —
 *     the legacy chains them through a per-turn in-memory session, and this is
 *     the adaptation that replaces it;
 *   * a failed edit comes back as a RESULT, not an exception. The typed
 *     `error_kind` is what lets the model recover on its own; a 400 makes it
 *     apologise and stop;
 *   * a `template_id` from another org reaches NOTHING. The model is told the id
 *     in a prompt, so the id is untrusted input — `claims.orgId` from the
 *     verified token is the only thing scoping the write.
 */
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { invokeTool, toolSpecs } from '../src/agent/functions'
import { createTemplate, getTemplate } from '../src/consultations/repos/templates-repo'
import { Elysia } from 'elysia'
import { templatesRoutes } from '../src/consultations/routes/templates'
import { buildSystemPrompt } from '../src/lib/template-assistant'
import { ORG, OTHER_ORG, USER, auth, migrate, truncate } from './helpers'

const claims = { orgId: ORG, userId: USER, userName: null }
const strangerClaims = { orgId: OTHER_ORG, userId: USER, userName: null }

type ToolResult = {
  success: boolean
  error_kind?: string
  error?: string
  current_sections?: string[]
  change?: { op: string; section?: string }
}

const seed = async (body: string, org = ORG) =>
  createTemplate({ orgId: org, userId: USER, title: `t-${crypto.randomUUID()}`, body })

const bodyOf = async (id: string, org = ORG) => (await getTemplate(org, id))?.body

beforeAll(migrate)
beforeEach(truncate)

describe('the tools the assistant is given', () => {
  test('are exactly the five the legacy registers', () => {
    // The names are the contract the model was tuned against — they appear in
    // its prompt by name. Renaming one here silently removes a capability.
    expect(toolSpecs.map((s) => s.name).sort()).toEqual([
      'append_content',
      'delete_section',
      'insert_after',
      'replace_section',
      'replace_text',
    ])
  })

  test('every one takes the template_id, because HTTP has no session', () => {
    // The legacy holds the working body in memory for a turn; over HTTP each
    // call has to say which document it means.
    for (const spec of toolSpecs) {
      const params = spec.parameters as { properties: Record<string, unknown>; required: string[] }
      expect(Object.keys(params.properties)).toContain('template_id')
      expect(params.required).toContain('template_id')
    }
  })

  test('a name nobody serves is refused', async () => {
    expect(invokeTool('drop_database', {}, claims)).rejects.toThrow('unknown tool')
  })
})

describe('an edit is persisted', () => {
  test('append_content writes an empty template', async () => {
    const template = await seed('')
    const result = (await invokeTool(
      'append_content',
      { template_id: template.id, content: '## Motivo\n\n[[el motivo]]' },
      claims,
    )) as ToolResult

    expect(result.success).toBe(true)
    expect(await bodyOf(template.id)).toBe('## Motivo\n\n[[el motivo]]\n')
  })

  test('chained edits compose — through the row, not through memory', async () => {
    // The turn that made this worth testing: "create it, then add a plan".
    // Each call re-reads what the previous one wrote, so the second edit is
    // applied to a document that already has the first.
    const template = await seed('')
    await invokeTool(
      'append_content',
      { template_id: template.id, content: '## Motivo\n\n[[el motivo]]' },
      claims,
    )
    await invokeTool(
      'insert_after',
      { template_id: template.id, anchor: '[[el motivo]]', content: '\n## Plan\n\n[[el plan]]' },
      claims,
    )
    const result = (await invokeTool(
      'replace_section',
      { template_id: template.id, section: 'plan', new_content: '[[tratamiento y controles]]' },
      claims,
    )) as ToolResult

    expect(result.success).toBe(true)
    const body = (await bodyOf(template.id))!
    expect(body).toContain('## Motivo')
    expect(body).toContain('[[tratamiento y controles]]')
    expect(body).not.toContain('[[el plan]]')
  })

  test('delete_section takes the heading with its body', async () => {
    const template = await seed('## Motivo\n\na\n\n## Plan\n\nb\n')
    await invokeTool('delete_section', { template_id: template.id, section: 'Plan' }, claims)
    const body = (await bodyOf(template.id))!
    expect(body).toContain('## Motivo')
    expect(body).not.toContain('## Plan')
  })

  test('replace_text changes one fragment and leaves the rest alone', async () => {
    const template = await seed('Paracetamol 500 mg cada 8 h.\n')
    await invokeTool(
      'replace_text',
      { template_id: template.id, old_string: '500 mg', new_string: '1 g' },
      claims,
    )
    expect(await bodyOf(template.id)).toBe('Paracetamol 1 g cada 8 h.\n')
  })

  test('every result carries the sections, so the model has fresh state', async () => {
    // Its next call resolves a heading by name; without the up-to-date outline
    // it targets one the last edit removed.
    const template = await seed('## Motivo\n\na\n')
    const result = (await invokeTool(
      'append_content',
      { template_id: template.id, content: '## Plan\n\nb' },
      claims,
    )) as ToolResult
    expect(result.current_sections).toEqual(['Motivo', 'Plan'])
  })
})

describe('a failed edit is a result, not an exception', () => {
  test('a section that is not there comes back typed, with what IS there', async () => {
    // The kind is what lets the model recover ("not found → I will insert one")
    // and the list is what makes its next attempt informed rather than a guess.
    const template = await seed('## Motivo\n\na\n\n## Plan\n\nb\n')
    const result = (await invokeTool(
      'replace_section',
      { template_id: template.id, section: 'Antecedentes', new_content: 'x' },
      claims,
    )) as ToolResult

    expect(result.success).toBe(false)
    expect(result.error_kind).toBe('section_not_found')
    expect(result.current_sections).toEqual(['Motivo', 'Plan'])
    // And nothing was written.
    expect(await bodyOf(template.id)).toBe('## Motivo\n\na\n\n## Plan\n\nb\n')
  })

  test('an ambiguous anchor asks for more context instead of guessing', async () => {
    const template = await seed('dosis\n\ndosis\n')
    const result = (await invokeTool(
      'insert_after',
      { template_id: template.id, anchor: 'dosis', content: 'x' },
      claims,
    )) as ToolResult
    expect(result.error_kind).toBe('anchor_ambiguous')
  })

  test('writing back what is already there is refused, not counted as an edit', async () => {
    const template = await seed('## Plan\nb\n\n')
    const result = (await invokeTool(
      'replace_section',
      { template_id: template.id, section: 'Plan', new_content: 'b' },
      claims,
    )) as ToolResult
    expect(result.error_kind).toBe('no_change')
  })
})

describe('the template id is untrusted input', () => {
  test("another org's template is not reachable", async () => {
    // The model is handed the id in a prompt. `claims.orgId` from the verified
    // token is the only thing that scopes the write — this is the assertion
    // that says a tool is not a back door around the tenant check.
    const mine = await seed('## Motivo\n\na\n')
    const result = invokeTool(
      'append_content',
      { template_id: mine.id, content: 'x' },
      strangerClaims,
    )
    await expect(result).rejects.toThrow('no template')
    expect(await bodyOf(mine.id)).toBe('## Motivo\n\na\n')
  })

  test('an id that does not exist fails loudly', async () => {
    await expect(
      invokeTool(
        'append_content',
        { template_id: '11111111-1111-1111-1111-111111111111', content: 'x' },
        claims,
      ),
    ).rejects.toThrow('no template')
  })

  test('a missing or blank id is refused before anything is read', async () => {
    for (const template_id of [undefined, '', '   ', 42]) {
      await expect(
        invokeTool('append_content', { template_id, content: 'x' }, claims),
      ).rejects.toThrow('template_id is required')
    }
  })
})

describe('the assistant route', () => {
  const app = new Elysia().use(templatesRoutes)
  const call = (path: string, init: RequestInit = {}) =>
    app.handle(new Request(`http://localhost${path}`, init))

  const turn = async (id: string, message: string, headers: Record<string, string>) =>
    call(`/api/consultation-templates/${id}/assistant`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    })

  test('a template of another org is a 404, never a 403', async () => {
    // A 403 would confirm the id exists somewhere.
    const mine = await seed('## Motivo\n\na\n')
    const response = await turn(mine.id, 'hola', await auth({ org: OTHER_ORG }))
    expect(response.status).toBe(404)
  })

  test('an anonymous caller gets nothing', async () => {
    const mine = await seed('')
    const response = await call(`/api/consultation-templates/${mine.id}/assistant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hola' }),
    })
    expect(response.status).toBe(401)
  })

  test('with no engine configured it says so instead of hanging', async () => {
    // 503, not 500: nothing is broken, the assistant is simply not wired in
    // this environment — which is the case in the test process.
    const mine = await seed('')
    const response = await turn(mine.id, 'hola', await auth())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'assistant_not_configured' })
  })

  test('an empty message is refused by the schema', async () => {
    const mine = await seed('')
    const response = await turn(mine.id, '', await auth())
    expect(response.status).toBe(422)
  })
})

describe('the prompt the assistant is given', () => {
  test('every placeholder is substituted — a stray {{…}} reaches the model', async () => {
    // The failure this guards: an unsubstituted placeholder does not error, it
    // renders as literal braces, and the model answers "which template?" —
    // which is exactly what happened with the first version of this.
    const prompt = buildSystemPrompt({
      templateId: 'abc-123',
      title: 'Pediátrica',
      body: '## Motivo\n\n[[el motivo]]',
      history: [{ role: 'doctor', body: 'hola' }],
    })
    expect(prompt).not.toMatch(/\{\{\w+\}\}/)
    expect(prompt).toContain('abc-123')
    expect(prompt).toContain('Pediátrica')
    expect(prompt).toContain('[[el motivo]]')
  })

  test('a blank template and an empty history read as such, not as holes', async () => {
    const prompt = buildSystemPrompt({ templateId: 'x', title: '', body: '' })
    expect(prompt).toContain('<plantilla vacía>')
    expect(prompt).toContain('<primer turno>')
    expect(prompt).toContain('(sin título)')
  })
})
