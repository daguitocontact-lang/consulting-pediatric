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
import { runWebhookStream } from '@daguito/sdk'
import { resolveFlowWebhook, streamApiUrl, isStreamConfigured } from './daguito-stream'

const CHATBOT_FLOW = 'consultation-chatbot'

/** A turn that runs longer than this is not going to answer usefully. */
const TURN_TIMEOUT_MS = 90_000

export type AssistantTurn = {
  reply: string
  status: 'completed' | 'failed' | 'unknown'
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
  /** The clinical note as it stands, so the assistant can read what is written. */
  note?: string | null
  /** What has been transcribed so far. */
  transcript?: string | null
  language?: string
}): Promise<AssistantTurn> {
  const webhook = await resolveFlowWebhook(CHATBOT_FLOW)

  const result = await runWebhookStream({
    apiUrl: streamApiUrl(),
    webhookId: webhook.webhook_id,
    token: webhook.webhook_token,
    // Never the bare consultation id: that is the transcription flow's session,
    // and sharing it leaks live transcript fragments into the chat.
    sessionKey: `chatbot:${p.consultationId}`,
    text: p.message,
    input: {
      context: {
        template_context: p.note?.trim() || 'Sin nota clínica todavía.',
        transcript: p.transcript?.trim() || 'No transcription captured yet.',
        language: p.language ?? 'es',
      },
    },
    timeoutMs: TURN_TIMEOUT_MS,
  })

  return { reply: replyFrom(result.output), status: result.status }
}
