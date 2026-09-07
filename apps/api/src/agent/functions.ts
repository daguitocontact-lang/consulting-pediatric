import type { PanelClaims } from '../lib/auth'
import { TOOL_SPECS, type ToolSpec } from './specs'
import { MdError, append, deleteSection, insertAfter, replaceSection, replaceText, sectionTitles } from '../lib/mdops'
import { getTemplate, updateTemplate } from '../consultations/repos/templates-repo'

// Tools the Daguito AGENT can call — they RUN HERE, in the custom's API, reading
// the custom's own DB. Daguito's Functions Runner discovers them through
// `GET /agent/functions` and invokes them over HTTP with a signed token.
//
// The agent does NOT send names: it sends `contact_id`, the uuid of the
// conversation's contact in Daguito. A custom has no people table and does not
// need one — it stores the id and the panel resolves the name against the core.
//
// A tool NAME is a contract the agent's prompt already knows, so it is the one
// thing here that may stay in the client's language; everything else is English.

type Handler = (args: Record<string, unknown>, claims: PanelClaims) => Promise<unknown>

/**
 * No tools yet — the array is what a new custom fills in.
 *
 * Shape of one, from the repo this template came from:
 *
 *   {
 *     spec: {
 *       name: 'consultar_cupos',
 *       description: 'Check real availability between two dates. Read-only.',
 *       parameters: {
 *         type: 'object',
 *         properties: { check_in: { type: 'string', description: 'YYYY-MM-DD' } },
 *         required: ['check_in'],
 *       },
 *     },
 *     // `claims.orgId` comes from the verified token: every query filters by it,
 *     // exactly like a panel route. A tool is not a back door around the tenant.
 *     handler: async (args, claims) => findSomething({ orgId: claims.orgId, ... }),
 *   }
 *
 * A handler THROWS on bad input: `/agent/functions/:name` turns that into a 400
 * with the message, which is what the agent reads back to the customer.
 */
/**
 * The template assistant's edit tools.
 *
 * The legacy registers these as CLIENT tools over its websocket session
 * (`session.RegisterTool`), which the JS SDK has no equivalent for — 0.3.15 is
 * the latest published and exposes no such API. So they live where this
 * template already puts agent tools: behind `POST /agent/functions/:name`,
 * which Daguito's Functions Runner calls over HTTP with a signed token.
 *
 * Two consequences of that move, both deliberate:
 *
 *   * the legacy holds the working body in memory for the length of a turn, so
 *     chained edits see each other. Over HTTP there is no session, so each call
 *     reads and writes the TEMPLATE ROW. Chained edits still compose — through
 *     the database rather than through memory — and an edit survives a turn
 *     that drops halfway, which the in-memory version does not.
 *   * every call therefore needs to know WHICH template. The model is told the
 *     id in the system prompt (`{{template_id}}`, see prompts/) and passes it
 *     back; `claims.orgId` from the verified token is what actually scopes the
 *     write, so a wrong or guessed id reaches nothing.
 *
 * The names, descriptions and parameter schemas are the legacy's, translated
 * nowhere: they are the contract the model was tuned against.
 */
/** Read the body the tools operate on, or fail the way the model can act on. */
async function currentBody(orgId: string, templateId: unknown): Promise<{ id: string; body: string }> {
  if (typeof templateId !== 'string' || !templateId.trim()) {
    throw new Error('template_id is required')
  }
  const template = await getTemplate(orgId, templateId)
  if (!template) throw new Error(`no template with id ${templateId}`)
  return { id: template.id, body: template.body }
}

/**
 * Apply one operation and persist it.
 *
 * A typed `MdError` comes back as a RESULT, not an HTTP error: its `kind` is
 * what lets the model recover on its own ("section_not_found → I will insert
 * one instead"). Turning it into a 400 makes the model apologise and stop,
 * which is the difference between an assistant that edits and one that asks.
 */
async function applyEdit(
  orgId: string,
  userId: string,
  templateId: unknown,
  op: (body: string) => { doc: string; change: unknown },
): Promise<unknown> {
  const { id, body } = await currentBody(orgId, templateId)
  try {
    const { doc, change } = op(body)
    await updateTemplate({ orgId, userId, id, body: doc })
    return { success: true, change, current_sections: sectionTitles(doc) }
  } catch (err) {
    if (err instanceof MdError) {
      return {
        success: false,
        error_kind: err.kind,
        error: err.message,
        current_sections: sectionTitles(body),
      }
    }
    throw err
  }
}

/** name → what it does. The SPECS are the list; this is the implementation, and
 *  `invokeTool` refuses a name that is in one and not the other. */
const HANDLERS: Record<string, Handler> = {
  replace_section: (args, claims) =>
    applyEdit(claims.orgId, claims.userId, args.template_id, (body) =>
      replaceSection(body, String(args.section ?? ''), String(args.new_content ?? '')),
    ),
  insert_after: (args, claims) =>
    applyEdit(claims.orgId, claims.userId, args.template_id, (body) =>
      insertAfter(body, String(args.anchor ?? ''), String(args.content ?? '')),
    ),
  replace_text: (args, claims) =>
    applyEdit(claims.orgId, claims.userId, args.template_id, (body) =>
      replaceText(
        body,
        String(args.old_string ?? ''),
        String(args.new_string ?? ''),
        args.replace_all === true,
      ),
    ),
  delete_section: (args, claims) =>
    applyEdit(claims.orgId, claims.userId, args.template_id, (body) =>
      deleteSection(body, String(args.section ?? '')),
    ),
  append_content: (args, claims) =>
    applyEdit(claims.orgId, claims.userId, args.template_id, (body) =>
      append(body, String(args.content ?? '')),
    ),
}

export const toolSpecs: ToolSpec[] = TOOL_SPECS
export type { ToolSpec }

export async function invokeTool(
  name: string,
  args: Record<string, unknown>,
  claims: PanelClaims,
): Promise<unknown> {
  const handler = HANDLERS[name]
  if (!handler) throw new Error(`unknown tool: ${name}`)
  return handler(args ?? {}, claims)
}
