/**
 * The transcription/AI engine: Daguito flows.
 *
 * There is no AI service of our own. Daguito runs the consultation flows — the
 * ones the legacy app publishes as `realtime-consultation`,
 * `in-person-consultation` and `pre-recorded-consultation` — and the browser
 * talks to them DIRECTLY: it streams the mic in and reads the flow's output
 * (the `c_facts` node → recommendations, `c_soap` → the SOAP note) over a
 * websocket. This API's only job in that exchange is to hand the browser a
 * scoped, short-lived credential for one session.
 *
 * Three calls, exactly as the legacy Go backend makes them:
 *
 *   1. resolve the flow's webhook by slug (needs the org's API key),
 *   2. open the session so the flow's nodes are listening before audio arrives,
 *   3. mint a `bidi` token for that session (audio in, events out).
 *
 * The API key never leaves this process. What the browser gets is a token for
 * ONE session key, valid for minutes — which is why minting it here rather than
 * shipping the key to the panel is the whole point of this module.
 */

const API_URL = (process.env.DAGUITO_STREAM_API_URL || process.env.DAGUITO_API_BASE || '').replace(
  /\/+$/,
  '',
)
const API_KEY = process.env.DAGUITO_STREAM_API_KEY || process.env.DAGUITO_API_KEY || ''

/** How long a browser may hold a session credential. The legacy backend uses
 *  the same order of magnitude; a consultation outlives it, so the panel asks
 *  again rather than holding a long-lived one. */
const TOKEN_TTL_SECONDS = 3600

/**
 * Which flow runs, by consultation mode.
 *
 * The slugs are the legacy app's, on purpose: the flows are published once in
 * the Daguito org and both products resolve the same ones. A mode with no flow
 * of its own falls back to the in-person one — a single room mic with
 * diarization, which is what an unknown mode most resembles.
 */
const FLOW_BY_MODE: Record<string, string> = {
  video: 'realtime-consultation',
  in_person: 'in-person-consultation',
  transcription: 'pre-recorded-consultation',
}

export const flowForMode = (mode: string): string =>
  FLOW_BY_MODE[mode] ?? FLOW_BY_MODE.in_person!

export const isStreamConfigured = (): boolean => Boolean(API_URL && API_KEY)

export type StreamCredentials = {
  api_url: string
  webhook_id: string
  token: string
  session_key: string
  expires_at: number | null
  flow: string
}

type ResolvedWebhook = { webhook_id: string; webhook_token: string }

/**
 * Slug → webhook id + token, cached for the life of the process.
 *
 * The resolution is one round trip per flow and the answer does not change
 * while the flow exists; doing it per consultation added a call to Daguito to
 * the front of every recording.
 */
const webhooks = new Map<string, Promise<ResolvedWebhook>>()

function resolveWebhook(slug: string): Promise<ResolvedWebhook> {
  const cached = webhooks.get(slug)
  if (cached) return cached

  const resolving = (async () => {
    const res = await fetch(`${API_URL}/api/sdk/flows?slug=${encodeURIComponent(slug)}`, {
      headers: { authorization: `Bearer ${API_KEY}` },
    })
    if (!res.ok) {
      // Not cached: a flow that is not published yet must resolve on the next
      // attempt, once it is, without restarting the API.
      webhooks.delete(slug)
      throw new Error(`resolve flow ${slug}: HTTP ${res.status}`)
    }
    const body = (await res.json()) as Partial<ResolvedWebhook>
    if (!body.webhook_id || !body.webhook_token) {
      webhooks.delete(slug)
      throw new Error(`resolve flow ${slug}: no webhook credentials`)
    }
    return { webhook_id: body.webhook_id, webhook_token: body.webhook_token }
  })()

  webhooks.set(slug, resolving)
  return resolving
}

async function post(
  webhook: ResolvedWebhook,
  suffix: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_URL}/v1/webhooks/${webhook.webhook_id}${suffix}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${webhook.webhook_token}`,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`POST ${suffix} → HTTP ${res.status}: ${text.slice(0, 300)}`)
  return text ? (JSON.parse(text) as Record<string, unknown>) : {}
}

/**
 * Everything the panel needs to stream one consultation.
 *
 * `sessionKey` is the consultation id, so every participant of the same
 * consultation joins the same flow session and the output is one conversation —
 * a second doctor opening the screen does not start a second transcription.
 */
export async function streamCredentials(p: {
  mode: string
  sessionKey: string
  baseInput?: Record<string, unknown>
  /** False for a participant joining a session that is already open. */
  open?: boolean
}): Promise<StreamCredentials> {
  if (!isStreamConfigured()) {
    throw new Error('DAGUITO_API_BASE / DAGUITO_API_KEY are required to stream')
  }
  const flow = flowForMode(p.mode)
  const webhook = await resolveWebhook(flow)

  if (p.open !== false) {
    // Best-effort, exactly like the legacy backend: a flow that fails to open
    // must not stop the browser from streaming — the audio socket is what the
    // doctor is waiting on, and the flow can still pick the session up.
    try {
      await post(webhook, '/stream/open', {
        session_key: p.sessionKey,
        base_input: { language: 'es', ...p.baseInput },
      })
    } catch (err) {
      console.warn(`[daguito] open ${flow} session=${p.sessionKey} failed (continuing):`, err)
    }
  }

  const minted = await post(webhook, '/stream-tokens', {
    session_key: p.sessionKey,
    // Audio in, events out, on one credential.
    role: 'bidi',
    ttl_seconds: TOKEN_TTL_SECONDS,
  })
  const token = typeof minted.token === 'string' ? minted.token : ''
  if (!token) throw new Error('mint returned no token')

  return {
    api_url: API_URL,
    webhook_id: webhook.webhook_id,
    token,
    session_key: p.sessionKey,
    expires_at: typeof minted.expires_at === 'number' ? minted.expires_at : null,
    flow,
  }
}
