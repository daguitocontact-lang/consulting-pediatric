/**
 * The flows this custom OWNS, as code.
 *
 * A port of the legacy's `pkg/daguitoflows`, and it exists for the same reason:
 * a flow is a deployable artefact, not a thing somebody once clicked together
 * in a dashboard. Kept here it is reviewable, diffable, and re-appliable to a
 * fresh org with one command (`bun scripts/flows/sync.ts`).
 *
 * Only flows this custom owns live here, and OWNS is about the SLUG. The
 * consultation engine the legacy publishes — `realtime-consultation`,
 * `in-person-consultation`, `pre-recorded-consultation`, `consultation-chatbot` —
 * is never written from this repo: both products publish into the same Daguito
 * account, so a sync from a custom would overwrite the flows the legacy product
 * is running a consultation on right now.
 *
 * What is here instead are COPIES of those four, byte-for-byte, under
 * `pediatric-*` slugs of our own. That is the same move the template assistant
 * already made, for the same reason: a copy is ours to edit — a paediatric
 * prompt, another model, one more node — without touching the legacy's, and
 * `sync.ts` can never write a slug that is not in this file.
 *
 * Copying them does NOT switch the engine over. `lib/daguito-stream.ts` and
 * `lib/daguito-chat.ts` still resolve the legacy slugs, which is what prod runs
 * today; flipping is four constants there, and only after
 * `bun scripts/flows/sync.ts --apply` has actually published these — an API that
 * resolves an unpublished slug fails every recording.
 */
import { TOOL_SPECS } from '../agent/specs'
import chatbotPrompt from '../prompts/consultation-chatbot.md' with { type: 'text' }
import realtimeGraph from './graphs/realtime-consultation.json'
import inPersonGraph from './graphs/in-person-consultation.json'
import preRecordedGraph from './graphs/pre-recorded-consultation.json'

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
  /**
   * `false` skips Daguito's inbound debounce + dedup. The legacy sets it on the
   * chatbot because its panel blocks the composer the moment the doctor sends —
   * ours does too, so the debounce is dead time on every turn. Omitted means
   * Daguito's default, which is `true`.
   */
  coalesceEnabled?: boolean
  /** Rolling summary of the thread, so a long consultation still fits a turn. */
  memorySummaryConfig?: Record<string, unknown>
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

/**
 * The clinical assistant — the legacy's "Dr. Midulabs" (`consultation-chatbot`),
 * under our slug.
 *
 * The prompt is its `pkg/prompts/medical_chatbot.md`, copied verbatim into
 * `src/prompts/consultation-chatbot.md`. Verbatim on purpose: the day the flip
 * happens (see the header) the doctor has to get the same assistant they had the
 * day before, and a prompt is not a place to change two things at once. It still
 * introduces itself as Dr. Midulabs — that is a copy edit in the .md and a
 * re-sync, nothing else.
 *
 * Its two placeholders, `{{template_context}}` and `{{transcript}}`, are the
 * contract with `lib/daguito-chat.ts`, which ships exactly those keys per turn.
 * The agent interpolates FLAT: rename one here and the assistant answers that
 * there is no note while the note sits right there.
 *
 * The numbers are the legacy's `MedicalChatbot()`: 20 turns of history because
 * the doctor refers back across a whole consultation, 25 tool iterations because
 * a grounded answer is several searches deep.
 *
 * ONE tool, not two. The legacy also gives it `search_knowledge`, gated on
 * `requires_data.kb_scope` — a Daguito-side RAG search over the chunks indexed
 * for the consultation. This custom indexes nothing into a knowledge base, so
 * that tool would announce a capability with nothing behind it, which is the
 * same reason `sync.ts` refuses to publish a tool this API does not serve. The
 * day something here ingests, it is one entry in this array.
 */
export const consultationChatbotFlow = (): FlowDefinition => ({
  slug: 'pediatric-consultation-chatbot',
  name: 'Pediatric Consultation Chatbot',
  provider: 'openrouter',
  model: MODEL,
  systemPrompt: chatbotPrompt,
  temperature: 0.3,
  maxTokens: 1200,
  historyTurns: 20,
  recentTurns: 20,
  maxToolIterations: 25,
  coalesceEnabled: false,
  memorySummaryConfig: { enabled: true, max_sentences: 6 },
  tools: [
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
  ],
})

/**
 * A flow that is a GRAPH and not an agent.
 *
 * The three consultation modes are node/edge pipelines — STT nodes, a word
 * counter, a condition, two streaming `collect_data` agents — so they are
 * published through `/v1/flows/upsert` and not the `trigger → ai_agent` preset.
 * They live as JSON next door, exactly as the legacy keeps them, and for the
 * same reason: it is the shape Daguito stores, so nothing translates it and
 * nothing can drift. A multi-line clinical prompt inside a TypeScript literal
 * would also be unreviewable.
 */
export type GraphFlowDefinition = {
  slug: string
  /** The legacy slug this is a copy of. Documentation — nothing resolves it. */
  copyOf: string
  name: string
  triggerType: 'message'
  graph: {
    /**
     * Flow-level, not topology, and it must survive the upsert: `false` is what
     * makes the inbound audio path skip the debounce. Daguito defaults it to
     * `true`, so a copy that loses it transcribes in laggy bursts.
     */
    coalesce_enabled?: boolean
    nodes: Record<string, unknown>[]
    edges: Record<string, unknown>[]
  }
}

/**
 * The three consultation modes, copied byte-for-byte from the legacy's
 * `pkg/daguitoflows/graphs/`.
 *
 * What each one is, because the differences are the whole product:
 *
 *   * realtime (video) — TWO `a_transcribe_stream` nodes, `s_stt_doctor` on
 *     `<session>:doctor` and `s_stt_patient` on `<session>:patient`, each with
 *     an exact `speaker_role`. Both have to be fed; the patient link is what
 *     feeds the second (`consultations/routes/patient.ts`).
 *   * in-person — ONE node on `<session>:doctor` with `diarize: true,
 *     max_speakers: 2`: two people, one microphone, and the channel labels
 *     (`A`/`B`) are NOT roles — `lib/flow-transform.ts` is careful about that.
 *   * pre-recorded — a single `a_transcribe_file` node reading `audio_url`.
 *     There is no streaming node in this graph at all, which is why
 *     `flowForMode('transcription')` returns null and the mode is an upload run
 *     server-side (`lib/prerecorded.ts`).
 *
 * All three fill the doctor's template through `{{template_body}}` +
 * `use_template_schema`, which is the whole reason the Plantillas section
 * exists.
 */
export const GRAPH_FLOWS: GraphFlowDefinition[] = [
  {
    slug: 'pediatric-realtime-consultation',
    copyOf: 'realtime-consultation',
    name: 'Pediatric Real-time Consultation',
    triggerType: 'message',
    graph: realtimeGraph as GraphFlowDefinition['graph'],
  },
  {
    slug: 'pediatric-in-person-consultation',
    copyOf: 'in-person-consultation',
    name: 'Pediatric In-Person Consultation',
    triggerType: 'message',
    graph: inPersonGraph as GraphFlowDefinition['graph'],
  },
  {
    slug: 'pediatric-pre-recorded-consultation',
    copyOf: 'pre-recorded-consultation',
    name: 'Pediatric Pre-recorded Consultation',
    triggerType: 'message',
    graph: preRecordedGraph as GraphFlowDefinition['graph'],
  },
]

/** Every AGENT flow this custom publishes. The array is the contract. */
export const FLOWS: FlowDefinition[] = [templateAssistantFlow(), consultationChatbotFlow()]
