/**
 * The clinical assistant — "Dr. Midulabs" in the legacy product.
 *
 * It is an AGENT flow on Daguito (`consultation-chatbot`), not a model this
 * API calls: the prompt, the tools and the model live in the flow, published
 * once in the org. One turn is one run — the doctor's message in, the
 * assistant's answer out — and both are persisted by the caller.
 *
 * Two details carried over from the legacy service, because both are bugs
 * waiting to happen:
 *
 *   - the session key is `chatbot:<consultation id>`, NOT the consultation id.
 *     The transcription flow already uses the bare id, and sharing a session
 *     key makes Daguito fan the live transcript into the chat bubble;
 *   - the `context` keys must match the `{{placeholders}}` in the flow's system
 *     prompt exactly. The agent interpolates them with a FLAT lookup, so a
 *     renamed key renders empty and the assistant answers that it has no note
 *     when it does.
 */
import { WebhookStreamSession } from '@daguito/sdk'
import { clientToolSpecs, serveClientTools, type ClientTool } from './client-tools'
import {
  fetchSessionCost,
  resolveFlowWebhook,
  streamApiUrl,
  isStreamConfigured,
} from './daguito-stream'

/**
 * The legacy's slug, which is what prod resolves. Its copy under our own slug
 * (`pediatric-consultation-chatbot`, same prompt, same numbers) lives in
 * `src/flows`; see the note in `lib/daguito-stream.ts` for what switching costs.
 */
const CHATBOT_FLOW = 'consultation-chatbot'

/** A turn that runs longer than this is not going to answer usefully. */
const TURN_TIMEOUT_MS = 90_000

export type AssistantTurn = {
  reply: string
  status: 'completed' | 'failed' | 'unknown'
  /** Which note tools actually ran. The route uses it to know the note
   *  changed without diffing it. */
  tools_used: string[]
}

/**
 * Pull the assistant's text out of what the flow returned.
 *
 * A completed agent run answers with a RUN TRACE, not a string: `output.steps`
 * is one entry per node, and the reply is `data.output.content` on the agent
 * step. Measured against the live flow — the first version of this looked for
 * `reply` / `text` / `message`, found none of them, and the doctor's question
 * came back with an empty answer even though the agent had written a full one.
 *
 * The LAST agent step wins: a flow with a follow-up node answers twice, and the
 * last word is the one meant for the doctor.
 */
function replyFrom(output: unknown): string {
  if (typeof output === 'string') return output.trim()
  if (!output || typeof output !== 'object') return ''
  const record = output as Record<string, unknown>

  const steps = record.steps
  if (Array.isArray(steps)) {
    let reply = ''
    for (const step of steps) {
      const content = (step as { data?: { output?: { content?: unknown } } })?.data?.output?.content
      if (typeof content === 'string' && content.trim()) reply = content.trim()
    }
    if (reply) return reply
  }

  // A flow wired to answer with a plain value, and the shapes a simpler graph
  // returns.
  for (const key of ['reply', 'text', 'message', 'response', 'answer', 'content']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** Exposed for the tests: reading a run trace is the part that bit. */
export const replyFromForTest = replyFrom

export const isAssistantConfigured = isStreamConfigured

/**
 * Run one turn of the assistant.
 *
 * Throws only when the engine could not be reached at all; a flow that ran and
 * said nothing comes back as an empty reply, which the caller reports as such
 * instead of persisting a blank assistant message.
 */
export async function askAssistant(p: {
  consultationId: string
  message: string
  /**
   * The WORKING DOCUMENT the assistant reads: the clinical note as it stands,
   * or — when nothing has been written yet — the authored template body with
   * its `[[placeholders]]` still in place. See the caller for why the second
   * half matters.
   */
  workingDoc?: string | null
  /** What has been transcribed so far. */
  transcript?: string | null
  language?: string
  /** The tools it may call — `get_template_structure` and `fill_field`, so it
   *  can write the note instead of describing what to write. */
  tools?: ClientTool[]
}): Promise<AssistantTurn> {
  const webhook = await resolveFlowWebhook(CHATBOT_FLOW)
  const tools = p.tools ?? []

  const session = new WebhookStreamSession({
    apiUrl: streamApiUrl(),
    webhookId: webhook.webhook_id,
    token: webhook.webhook_token,
    // Never the bare consultation id: that is the transcription flow's session,
    // and sharing it leaks live transcript fragments into the chat.
    sessionKey: chatSessionKey(p.consultationId),
    // A turn is one exchange. Reconnecting would re-run it.
    autoReconnect: false,
  })

  const used: string[] = []
  const unsubscribe = serveClientTools(session, tools, (name, ok) => {
    if (ok) used.push(name)
  })

  let reply = ''
  let status: AssistantTurn['status'] = 'unknown'

  try {
    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(deadline)
        resolve()
      }
      const deadline = setTimeout(done, TURN_TIMEOUT_MS)

      session.on('flow.completed', ({ output }) => {
        reply = replyFrom(output)
        status = 'completed'
        done()
      })
      session.on('flow.failed', () => {
        status = 'failed'
        done()
      })
      session.on('error', () => {
        status = 'failed'
        done()
      })
      session.on('closed', done)

      session.connect()
      session.send(
        { kind: 'text', text: p.message },
        {
          context: {
            template_context: p.workingDoc?.trim() || 'Sin nota clínica todavía.',
            transcript: p.transcript?.trim() || 'No transcription captured yet.',
            language: p.language ?? 'es',
          },
          // The note tools. The flow's `ai_agent` node merges these with the
          // ones it declares statically, so nothing published changes.
          ...(tools.length ? { client_tools: clientToolSpecs(tools) } : {}),
        },
      )
    })
  } finally {
    unsubscribe()
    session.close()
  }

  return { reply, status, tools_used: used }
}

/**
 * The assistant's session key — `chatbot:<id>`, never the bare consultation id.
 *
 * Exported because three things have to agree on it: the turn this API fires,
 * the ledger read that bills it, and the browser tailing it live. Daguito routes
 * stream events by session key, so a mismatch is not an error — it is the live
 * transcript appearing inside the chat bubble.
 */
export const chatSessionKey = (consultationId: string): string => `chatbot:${consultationId}`

/**
 * What the assistant's turn cost, from Daguito's ledger.
 *
 * Same reason as the pre-recorded run: the `cost` events are streamed to
 * whoever is consuming the flow, and for a turn this API runs one-shot that is
 * nobody. The ledger is the authority. Best-effort by nature — an unbilled turn
 * is an accounting gap, never a reason to lose the doctor's answer.
 */
export async function assistantTurnCost(consultationId: string): Promise<number> {
  try {
    const webhook = await resolveFlowWebhook(CHATBOT_FLOW)
    const cost = await fetchSessionCost(webhook, chatSessionKey(consultationId))
    return cost?.total_usd ?? 0
  } catch {
    return 0
  }
}
