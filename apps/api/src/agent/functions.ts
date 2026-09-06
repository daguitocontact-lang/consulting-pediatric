import type { PanelClaims } from '../lib/auth'

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

export type ToolSpec = {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
}

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
const TOOLS: { spec: ToolSpec; handler: Handler }[] = []

export const toolSpecs: ToolSpec[] = TOOLS.map((t) => t.spec)

export async function invokeTool(
  name: string,
  args: Record<string, unknown>,
  claims: PanelClaims,
): Promise<unknown> {
  const tool = TOOLS.find((t) => t.spec.name === name)
  if (!tool) throw new Error(`unknown tool: ${name}`)
  return tool.handler(args ?? {}, claims)
}
