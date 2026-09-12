/**
 * Publish this custom's flows to Daguito.
 *
 *   bun scripts/flows/sync.ts            # show what WOULD change
 *   bun scripts/flows/sync.ts --apply    # publish it
 *   bun scripts/flows/sync.ts --apply --only pediatric-consultation-chatbot
 *
 * The legacy's `cmd/flows sync`, with one deliberate difference: it does NOT
 * apply by default. Both products publish into the same Daguito account, and an
 * upsert is a live change to an agent a doctor may be talking to right now — so
 * the safe run is the one you get by typing nothing.
 *
 * Two kinds of flow, two endpoints, both UPSERTS keyed on the slug — running
 * this twice is the same as running it once, and it never touches a slug that is
 * not in `src/flows`:
 *
 *   * AGENT flows (`FLOWS`) → `POST /v1/flows/upsert-agent`, the preset
 *     `trigger → ai_agent` graph Daguito builds server-side.
 *   * GRAPH flows (`GRAPH_FLOWS`) → `POST /v1/flows/upsert`, the node/edge
 *     graphs the three consultation modes are.
 *
 * Both are posted with `fetch` rather than through `@daguito/sdk`, and that is
 * not a preference. At 0.3.15 the SDK drops two fields on the floor: its
 * `upsertAgent` has no `coalesce_enabled` in the body it builds, and its
 * `upsertFlow` rebuilds the graph as `{ nodes, edges }` — so a graph's
 * `coalesce_enabled: false` never leaves the process. Daguito defaults that flag
 * to TRUE, so a consultation published through the SDK would get the inbound
 * debounce the legacy explicitly turns off, and the transcript would arrive in
 * laggy bursts with no error anywhere. Both endpoints take the flag; only the
 * SDK loses it. Revisit when @daguito/sdk sends it.
 *
 * Credentials come from `infra/.env` (dev) or the task's environment (prod);
 * `DAGUITO_STREAM_API_KEY` is the account key, and it is the only thing here
 * that must not end up in a log — so nothing prints it.
 */
import { FLOWS, GRAPH_FLOWS } from '../../src/flows'
import { TOOL_SPECS } from '../../src/agent/specs'

const API_URL = (process.env.DAGUITO_STREAM_API_URL || process.env.DAGUITO_API_BASE || '').replace(
  /\/+$/,
  '',
)
const API_KEY = process.env.DAGUITO_STREAM_API_KEY || process.env.DAGUITO_API_KEY || ''

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const only = args[args.indexOf('--only') + 1]
const filter = <T extends { slug: string }>(flows: T[]): T[] =>
  args.includes('--only') ? flows.filter((f) => f.slug === only) : flows
const agentFlows = filter(FLOWS)
const graphFlows = filter(GRAPH_FLOWS)

if (!API_URL || !API_KEY) {
  console.error(
    'DAGUITO_STREAM_API_URL / DAGUITO_STREAM_API_KEY are required.\n' +
      'In dev: set -a; . infra/.env; set +a',
  )
  process.exit(1)
}
if (!agentFlows.length && !graphFlows.length) {
  const known = [...FLOWS, ...GRAPH_FLOWS].map((f) => f.slug).join(', ')
  console.error(`no flow matches --only ${only}. Known: ${known}`)
  process.exit(1)
}

/**
 * One upsert. Returns what Daguito calls the flow, so the run says `created` or
 * `updated` and never guesses.
 */
async function upsert(path: string, body: unknown): Promise<{ flowId: string; created: boolean }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data: { flow_id?: string; created?: boolean; error?: string } = {}
  try {
    data = JSON.parse(text) as typeof data
  } catch {
    // A non-JSON body is a proxy or a 502; the status plus the first line of it
    // is the only useful thing to report.
  }
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  return { flowId: data.flow_id ?? '?', created: Boolean(data.created) }
}

console.log(`${apply ? 'Publishing' : 'Would publish'} to ${API_URL}\n`)

for (const flow of agentFlows) {
  const handlerTools = flow.tools.filter((t) => TOOL_SPECS.some((s) => s.name === t.name))

  console.log(`  ${flow.slug}  (agent)`)
  console.log(`    name    ${flow.name}`)
  console.log(`    model   ${flow.provider}/${flow.model}`)
  console.log(`    tools   ${flow.tools.map((t) => t.name).join(', ') || '—'}`)
  // The half that runs HERE. Worth calling out on every run: these are useless
  // unless this API is reachable from Daguito, which in dev means the tunnel is
  // up and in prod means the service is deployed.
  console.log(`    ours    ${handlerTools.length} at POST /agent/functions/:name`)

  // A flow published with tools this API does not serve is an agent that will
  // announce a capability and then fail mid-turn — worse than not having it.
  // `web_search` is the exception: it is Daguito's own handler, running there.
  const missing = flow.tools
    .filter((t) => t.name !== 'web_search')
    .filter((t) => !TOOL_SPECS.some((s) => s.name === t.name))
  if (missing.length) {
    console.error(`    ERROR   not served by this API: ${missing.map((t) => t.name).join(', ')}`)
    process.exit(1)
  }

  if (!apply) {
    console.log('')
    continue
  }

  try {
    const result = await upsert('/v1/flows/upsert-agent', {
      slug: flow.slug,
      name: flow.name,
      provider: flow.provider,
      model: flow.model,
      system_prompt: flow.systemPrompt,
      temperature: flow.temperature,
      max_tokens: flow.maxTokens,
      history_turns: flow.historyTurns,
      recent_turns: flow.recentTurns,
      max_tool_iterations: flow.maxToolIterations,
      tools: flow.tools,
      ...(flow.memorySummaryConfig ? { memory_summary_config: flow.memorySummaryConfig } : {}),
      ...(flow.coalesceEnabled === undefined ? {} : { coalesce_enabled: flow.coalesceEnabled }),
      trigger_channels: ['webhook'],
    })
    console.log(`    ${result.created ? 'created' : 'updated'}  flow ${result.flowId}\n`)
  } catch (err) {
    console.error(`    FAILED  ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}

for (const flow of graphFlows) {
  const steps = flow.graph.nodes.map((n) => String(n.id))

  console.log(`  ${flow.slug}  (graph)`)
  console.log(`    name    ${flow.name}`)
  console.log(`    copy of ${flow.copyOf}`)
  // Declaration order, not the path through the graph — the edges are what
  // order it, and they are in the JSON.
  console.log(`    nodes   ${steps.join(', ')}`)
  // The flag the SDK loses. Printed because "the transcript lags" is a horrible
  // thing to debug from the panel, and this line is where it would have shown.
  console.log(`    coalesce ${flow.graph.coalesce_enabled === false ? 'off' : 'on (default)'}`)

  if (!apply) {
    console.log('')
    continue
  }

  try {
    const result = await upsert('/v1/flows/upsert', {
      slug: flow.slug,
      name: flow.name,
      trigger_type: flow.triggerType,
      graph: flow.graph,
    })
    console.log(`    ${result.created ? 'created' : 'updated'}  flow ${result.flowId}\n`)
  } catch (err) {
    console.error(`    FAILED  ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}

if (!apply) {
  console.log('Nothing was changed. Re-run with --apply to publish.')
}
