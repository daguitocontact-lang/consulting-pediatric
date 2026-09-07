/**
 * The flows this custom OWNS, as code.
 *
 * A port of the legacy's `pkg/daguitoflows`, and it exists for the same reason:
 * a flow is a deployable artefact, not a thing somebody once clicked together
 * in a dashboard. Kept here it is reviewable, diffable, and re-appliable to a
 * fresh org with one command (`bun scripts/flows/sync.ts`).
 *
 * Only flows this custom owns live here. The CONSULTATION flows
 * (`realtime-consultation`, `in-person-consultation`, `pre-recorded-consultation`,
 * `consultation-chatbot`) are the legacy product's, published from its repo into
 * the same Daguito account, and this project only RESOLVES them by slug. Syncing
 * them from here would let a deploy of a custom overwrite the engine the legacy
 * product runs on.
 *
 * The one flow here is the template assistant, republished under our own slug
 * for exactly that reason — see below.
 */
import { TOOL_SPECS } from '../agent/specs'

/**
 * The model the legacy runs these agents on (`MidulabsLLMModel`). Kept
 * identical: the prompt was tuned against it, and a different model changes how
 * literally it follows "never describe the change, call the tool".
 */
const MODEL = 'deepseek/deepseek-v4-flash'

/**
 * The medical allowlist `web_search` is restricted to — the legacy's
 * `defaultWebSearchDomains`, verbatim.
 *
 * An allowlist rather than the open web because the assistant is quoted at a
 * child's bedside. The legacy lets admins edit it live from its panel; this
 * custom has no such screen, so the curated list is the list.
 */
const WEB_SEARCH_DOMAINS = [
  'diprece.minsal.cl',
  'minsal.cl',
  'ispch.cl',
  'nice.org.uk',
  'escardio.org',
  'cochranelibrary.com',
  'cdc.gov',
  'who.int',
  'nih.gov',
  'pubmed.ncbi.nlm.nih.gov',
  'merckmanuals.com',
  'medlineplus.gov',
  'mayoclinic.org',
  'medscape.com',
  'ema.europa.eu',
  'paho.org',
]

/**
 * The flow's system prompt is a SHELL, and that is the whole design.
 *
 * It references only `{{system_prompt}}` and `{{user_message}}`; the real
 * prompt is rendered per turn by `lib/template-assistant.ts` and shipped in
 * `base_input.context.system_prompt`. So the assistant's behaviour changes by
 * editing `src/prompts/template-assistant.md` and re-deploying the API — never
 * by re-syncing a flow.
 *
 * Copied byte for byte from the legacy's `template_assistant_flow_shell.md`.
 */
const SHELL = `{{system_prompt}}

User turn:
{{user_message}}
`

export type FlowDefinition = {
  slug: string
  name: string
  provider: 'openrouter'
  model: string
  systemPrompt: string
  temperature: number
  maxTokens: number
  historyTurns: number
  recentTurns: number
  maxToolIterations: number
  tools: { kind: 'handler'; name: string; config?: Record<string, unknown> }[]
}

/**
 * The template assistant, under OUR slug.
 *
 * `pediatric-template-assistant`, not the legacy's
 * `consultation-template-assistant`, and the difference is the point: both
 * products publish into the same Daguito account, so binding our tools onto
 * their slug would give the legacy's assistant this custom's edit tools —
 * pointed at a database it knows nothing about. A slug of our own is isolated
 * and costs one constant in `lib/template-assistant.ts`.
 *
 * The numbers are the legacy's (`TemplateAssistant()` in its
 * `pkg/daguitoflows/template_assistant.go`): temperature 0.3 because the model
 * is following instructions rather than composing; 12 tool iterations because a
 * "rewrite the plan and add a row" turn chains several edits.
 */
export const templateAssistantFlow = (): FlowDefinition => ({
  slug: 'pediatric-template-assistant',
  name: 'Pediatric Template Assistant',
  provider: 'openrouter',
  model: MODEL,
  systemPrompt: SHELL,
  temperature: 0.3,
  maxTokens: 3000,
  historyTurns: 15,
  recentTurns: 15,
  maxToolIterations: 12,
  tools: [
    // Web search, restricted to the medical allowlist. Daguito's own handler.
    {
      kind: 'handler',
      name: 'web_search',
      config: {
        tiers: [{ include_domains: WEB_SEARCH_DOMAINS, min_results: 0 }],
        results_per_search: 5,
        scrape_top_n: 3,
        cache_ttl_seconds: 24 * 60 * 60,
        emit_progress: true,
      },
    },
    // The five edit tools.
    //
    // ⚠ THESE ARE DECLARED AND CURRENTLY DROPPED. Read this before debugging
    // an assistant that answers "las herramientas no están disponibles".
    //
    // `kind: 'handler'` does NOT mean "call the custom over HTTP". Daguito's own
    // registry says so (`apps/api/src/ai/tools/handlers.ts`): `ai_agent.tools[]`
    // takes a sub-flow `{flow_id}`, an `inline` emit-only ref, or a `handler`
    // "server-side function looked up here" — running IN Daguito's API process,
    // explicitly "no extra HTTP hop". A name it does not know is silently
    // dropped from the toolbox, which is exactly what happens to these five.
    //
    // So the surface this template documents (`POST /agent/functions/:name`,
    // "tools the Daguito agent calls over HTTP") has no consumer in Daguito
    // today — searched for one and there is none. The handlers another custom
    // uses (`cocuy-availability.ts`) live INSIDE the Daguito repo.
    //
    // Two ways to close it, both outside this repo:
    //   * register five thin handlers in Daguito that proxy to this API's
    //     /agent/functions — which is what would make that surface real; or
    //   * wait for the JS SDK to expose per-session client tools, which the Go
    //     SDK already has (`session.RegisterTool`, v0.5.9) and which is how the
    //     legacy does it. @daguito/sdk is at 0.3.15 and has no such API.
    //
    // They stay declared on purpose: the day either lands, this flow already
    // names them and nothing here changes. Derived from the registry so a tool
    // added there cannot be forgotten here.
    ...TOOL_SPECS.map((spec) => ({ kind: 'handler' as const, name: spec.name })),
  ],
})

/** Every flow this custom publishes. One today; the array is the contract. */
export const FLOWS: FlowDefinition[] = [templateAssistantFlow()]
