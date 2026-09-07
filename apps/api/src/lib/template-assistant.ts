/**
 * The template assistant — the bot that edits a clinical template with the
 * doctor, in words.
 *
 * A port of the legacy's `consultation_template_assistant.go`, and the shape is
 * the part worth understanding: the Daguito flow
 * (`consultation-template-assistant`) is a THIN SHELL whose system prompt is
 * only `{{system_prompt}}` + `{{user_message}}`. The real prompt is built here
 * and shipped in `base_input.context.system_prompt`. That is why the assistant's
 * behaviour can change by editing `src/prompts/template-assistant.md` and never
 * touching the published flow.
 *
 * The first attempt at this sent `current_template` / `template_title` and the
 * agent answered that it could not see any template — because the flow's shell
 * does not reference those names at all. They are still sent, exactly as the
 * legacy sends them, purely so a rolled-back flow version keeps working.
 *
 * The EDITS are made by the model calling CLIENT TOOLS — registered for the
 * length of the turn over this same websocket (lib/client-tools.ts), which is
 * exactly what the legacy's `session.RegisterTool` does. They run here, apply
 * `lib/mdops` operations to the row, and hand back the typed result the model
 * reasons from.
 */
import { WebhookStreamSession } from '@daguito/sdk'
import { resolveFlowWebhook, streamApiUrl, isStreamConfigured } from './daguito-stream'
import { replyFromForTest as replyFrom } from './daguito-chat'
import { clientToolSpecs, serveClientTools, type ClientTool } from './client-tools'
import prompt from '../prompts/template-assistant.md' with { type: 'text' }

/**
 * OUR slug, not the legacy's `consultation-template-assistant`.
 *
 * Both products publish into the same Daguito account. Binding this custom's
 * edit tools onto the legacy's slug would hand its assistant five tools that
 * write to a database it knows nothing about — so the flow is published
 * separately from `src/flows` (`bun scripts/flows/sync.ts --apply`). Same
 * shell, same model, same numbers.
 */
const FLOW = 'pediatric-template-assistant'

/** A turn that runs longer than this is not going to help. The legacy's. */
const TURN_TIMEOUT_MS = 120_000

/** How many previous turns travel in the prompt. The legacy's `historyTurns`. */
const HISTORY_TURNS = 15

export type AssistantMessage = { role: 'doctor' | 'assistant'; body: string }

export const isTemplateAssistantConfigured = isStreamConfigured

/**
 * Render the system prompt for one turn.
 *
 * Exported for the tests: an unsubstituted `{{placeholder}}` reaching the model
 * is the exact failure that made the first version answer "which template?" —
 * it does not error, it just renders the literal braces.
 */
export function buildSystemPrompt(p: {
  templateId: string
  title: string
  body: string
  language?: string
  history?: AssistantMessage[]
}): string {
  const replacements: Record<string, string> = {
    template_id: p.templateId,
    title: p.title.trim() || '(sin título)',
    language: p.language?.trim() || 'es',
    body: p.body.trim() || '<plantilla vacía>',
    history: formatHistory(p.history ?? []),
  }
  return prompt.replace(/\{\{(\w+)\}\}/g, (whole: string, key: string) => replacements[key] ?? whole)
}

/**
 * The conversation so far, as the prompt reads it.
 *
 * Trimmed to the last turns rather than truncated in the middle: the prompt
 * tells the model to check whether the history is empty before greeting, so a
 * history that is present but garbled makes it introduce itself again on every
 * message.
 */
function formatHistory(history: AssistantMessage[]): string {
  const recent = history.slice(-HISTORY_TURNS * 2)
  if (!recent.length) return '<primer turno>'
  return recent
    .map((m) => `${m.role === 'doctor' ? 'Doctor' : 'Asistente'}: ${m.body.trim()}`)
    .join('\n\n')
}

export type TemplateAssistantTurn = {
  reply: string
  status: 'completed' | 'failed' | 'unknown'
  /** Which edit tools actually ran, in order. The route uses it to know the
   *  document changed without diffing it. */
  edits: string[]
}

/**
 * Run one turn.
 *
 * The session key is fresh per turn (`template_assistant_<random>`), the way the
 * legacy mints it: the conversation lives in OUR history, not in a Daguito
 * session, so a turn never inherits another template's state.
 */
export async function askTemplateAssistant(p: {
  templateId: string
  title: string
  body: string
  instruction: string
  language?: string
  history?: AssistantMessage[]
  /** The edit tools the agent may call. Empty = it can only talk. */
  tools?: ClientTool[]
}): Promise<TemplateAssistantTurn> {
  const webhook = await resolveFlowWebhook(FLOW)
  const systemPrompt = buildSystemPrompt(p)
  const tools = p.tools ?? []

  const session = new WebhookStreamSession({
    apiUrl: streamApiUrl(),
    webhookId: webhook.webhook_id,
    token: webhook.webhook_token,
    // Fresh per turn, the way the legacy mints it: the conversation lives in
    // OUR history, not in a Daguito session, so a turn never inherits another
    // template's state.
    sessionKey: `template_assistant_${crypto.randomUUID().slice(0, 8)}`,
    // A turn is one exchange. Reconnecting would re-run it.
    autoReconnect: false,
  })

  const edits: string[] = []
  const unsubscribe = serveClientTools(session, tools, (name, ok) => {
    if (ok) edits.push(name)
  })

  let reply = ''
  let status: TemplateAssistantTurn['status'] = 'unknown'

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
        { kind: 'text', text: p.instruction },
        {
          context: {
            // What the flow's shell actually reads.
            system_prompt: systemPrompt,
            user_message: p.instruction,
            // Kept for a rolled-back flow version, exactly as the legacy keeps
            // them. The current shell references none of these.
            current_template: p.body.trim() || 'No current template.',
            template_title: p.title,
            language: p.language ?? 'es',
            history: formatHistory(p.history ?? []),
          },
          // The edit tools. The `ai_agent` node merges these with the ones the
          // flow declares statically, so `web_search` is untouched.
          ...(tools.length ? { client_tools: clientToolSpecs(tools) } : {}),
        },
      )
    })
  } finally {
    unsubscribe()
    session.close()
  }

  return { reply, status, edits }
}
