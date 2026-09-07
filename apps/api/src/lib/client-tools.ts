/**
 * Client-side tools over a Daguito stream session — the thing the JS SDK does
 * not expose and the Go SDK does.
 *
 * The legacy registers its edit tools with `session.RegisterTool(...)`
 * (go-sdk v0.5.9). `@daguito/sdk` 0.3.15 has no such method, which looked like
 * a hard blocker: the alternative was five handlers inside Daguito's own API,
 * or waiting for a JS release.
 *
 * It is not a blocker, because the capability is not in the SDK — it is in the
 * PROTOCOL, and the JS SDK exposes every piece of it. From the Go SDK's own
 * doc comment on RegisterTool:
 *
 *   "The spec is auto-injected into base_input.client_tools on every send;
 *    when the server emits agent.tool_call_started for this tool, handler runs
 *    locally and its return value is fed back via a tool_result frame."
 *
 * Three moving parts, all reachable from here:
 *
 *   1. `base_input.client_tools` — an array of specs. The flow's `ai_agent`
 *      node MERGES them with the tools declared statically in its config, so
 *      the published flow needs no change and `web_search` keeps working.
 *   2. `agent.tool_call_started` — arrives as a `node.emit` with that `kind`,
 *      carrying `tool_name`, `call_id` and `args`. `WebhookStreamSession.on`
 *      already delivers those.
 *   3. `{ type: 'tool_result', call_id, ok, result | error }` — written back
 *      with `sendRaw`, which the JS SDK documents as its escape hatch for
 *      exactly this: "protocol extensions".
 *
 * So this file is ~60 lines that make the assistant able to EDIT, instead of a
 * change in somebody else's repo and a deploy of their API.
 */
import type { WebhookStreamSession } from '@daguito/sdk'

/** The wire shape, matching the Go SDK's `ToolSpec` field for field. */
export type ClientToolSpec = {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** How long the agent waits for us before calling the tool failed. */
  client_timeout_ms?: number
}

export type ClientTool = {
  spec: ClientToolSpec
  run: (args: Record<string, unknown>) => Promise<unknown>
}

/** The Go SDK's default, kept: an edit that takes longer than this is stuck. */
const DEFAULT_TIMEOUT_MS = 30_000

/** What goes in `base_input.client_tools`. */
export const clientToolSpecs = (tools: ClientTool[]): ClientToolSpec[] =>
  tools.map((tool) => ({
    client_timeout_ms: DEFAULT_TIMEOUT_MS,
    ...tool.spec,
  }))

/**
 * Answer the agent's tool calls on this session for as long as it is open.
 *
 * Returns the unsubscribe. Every failure is reported as a tool RESULT with
 * `ok: false` rather than thrown: the agent is waiting on `call_id`, and a
 * result that never arrives hangs the turn until the flow's own timeout —
 * whereas an error it can read is something it can recover from.
 */
export function serveClientTools(
  session: WebhookStreamSession,
  tools: ClientTool[],
  onCall?: (name: string, ok: boolean) => void,
): () => void {
  const byName = new Map(tools.map((tool) => [tool.spec.name, tool]))

  return session.on('node.emit', ({ kind, data }) => {
    if (kind !== 'agent.tool_call_started') return

    const payload = (data ?? {}) as Record<string, unknown>
    const name = typeof payload.tool_name === 'string' ? payload.tool_name : ''
    const callId = typeof payload.call_id === 'string' ? payload.call_id : ''
    // A call for a tool we did not register is not ours to answer: the flow
    // declares `web_search` statically and Daguito runs that one itself.
    if (!name || !callId) return
    const tool = byName.get(name)
    if (!tool) return

    const args =
      payload.args && typeof payload.args === 'object'
        ? (payload.args as Record<string, unknown>)
        : {}

    void (async () => {
      try {
        const result = await tool.run(args)
        session.sendRaw({ type: 'tool_result', call_id: callId, ok: true, result })
        onCall?.(name, true)
      } catch (err) {
        session.sendRaw({
          type: 'tool_result',
          call_id: callId,
          ok: false,
          error: err instanceof Error ? err.message : 'tool failed',
        })
        onCall?.(name, false)
      }
    })()
  })
}
