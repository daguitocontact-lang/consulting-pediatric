/**
 * Publish this custom's flows to Daguito.
 *
 *   bun scripts/flows/sync.ts            # show what WOULD change
 *   bun scripts/flows/sync.ts --apply    # publish it
 *   bun scripts/flows/sync.ts --apply --only pediatric-template-assistant
 *
 * The legacy's `cmd/flows sync`, with one deliberate difference: it does NOT
 * apply by default. Both products publish into the same Daguito account, and an
 * upsert is a live change to an agent a doctor may be talking to right now — so
 * the safe run is the one you get by typing nothing.
 *
 * `upsertAgent` is an UPSERT keyed on the slug: running it twice is the same as
 * running it once, and it never touches a slug not listed in `src/flows`.
 *
 * Credentials come from `infra/.env` (dev) or the task's environment (prod);
 * `DAGUITO_STREAM_API_KEY` is the account key, and it is the only thing here
 * that must not end up in a log — so nothing prints it.
 */
import { Daguito } from '@daguito/sdk'
import { FLOWS } from '../../src/flows'
import { TOOL_SPECS } from '../../src/agent/specs'

const API_URL = (process.env.DAGUITO_STREAM_API_URL || process.env.DAGUITO_API_BASE || '').replace(
  /\/+$/,
  '',
)
const API_KEY = process.env.DAGUITO_STREAM_API_KEY || process.env.DAGUITO_API_KEY || ''

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const only = args[args.indexOf('--only') + 1]
const selected = args.includes('--only') ? FLOWS.filter((f) => f.slug === only) : FLOWS

if (!API_URL || !API_KEY) {
  console.error(
    'DAGUITO_STREAM_API_URL / DAGUITO_STREAM_API_KEY are required.\n' +
      'In dev: set -a; . infra/.env; set +a',
  )
  process.exit(1)
}
if (!selected.length) {
  console.error(`no flow matches --only ${only}. Known: ${FLOWS.map((f) => f.slug).join(', ')}`)
  process.exit(1)
}

const client = new Daguito({ apiUrl: API_URL, apiKey: API_KEY })

console.log(`${apply ? 'Publishing' : 'Would publish'} to ${API_URL}\n`)

for (const flow of selected) {
  const handlerTools = flow.tools.filter((t) => TOOL_SPECS.some((s) => s.name === t.name))

  console.log(`  ${flow.slug}`)
  console.log(`    name    ${flow.name}`)
  console.log(`    model   ${flow.provider}/${flow.model}`)
  console.log(`    tools   ${flow.tools.map((t) => t.name).join(', ')}`)
  // The half that runs HERE. Worth calling out on every run: these are useless
  // unless this API is reachable from Daguito, which in dev means the tunnel is
  // up and in prod means the service is deployed.
  console.log(`    ours    ${handlerTools.length} at POST /agent/functions/:name`)

  // A flow published with tools this API does not serve is an agent that will
  // announce a capability and then fail mid-turn — worse than not having it.
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
    const result = await client.flows.upsertAgent({
      slug: flow.slug,
      name: flow.name,
      provider: flow.provider,
      model: flow.model,
      systemPrompt: flow.systemPrompt,
      temperature: flow.temperature,
      maxTokens: flow.maxTokens,
      historyTurns: flow.historyTurns,
      recentTurns: flow.recentTurns,
      maxToolIterations: flow.maxToolIterations,
      tools: flow.tools,
      triggerChannels: ['webhook'],
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
