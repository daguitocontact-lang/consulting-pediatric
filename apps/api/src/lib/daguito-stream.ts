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

/**
 * How long a browser may hold a session credential.
 *
 * Six hours, the legacy backend's `streamTokenTTLSeconds`, and generous on
 * purpose: the token has to outlive the consultation. At an hour a long
 * paediatric session — a first visit with a full history — expired mid-sentence
 * and the transcript stopped with no error anywhere, because the socket stays
 * up and only the next frame is refused. The token is scoped to ONE session of
 * ONE consultation, so its lifetime is not the thing protecting anything; the
 * scope is. Daguito caps it server-side anyway.
 */
const TOKEN_TTL_SECONDS = 6 * 60 * 60

/**
 * Which LIVE flow runs, by consultation mode.
 *
 * The slugs are the legacy app's, on purpose: the flows are published once in
 * the Daguito org and both products resolve the same ones. This map has two
 * entries and not three, which is the correction that matters:
 *
 *   * `video` → `realtime-consultation`: two `a_transcribe_stream` nodes,
 *     `s_stt_doctor` on `<session>:doctor` and `s_stt_patient` on
 *     `<session>:patient`. BOTH have to be fed or the merge waits out the idle
 *     one (see the patient link — src/consultations/routes/patient.ts).
 *   * `in_person` → `in-person-consultation`: ONE node on `<session>:doctor`
 *     with `diarize: true, max_speakers: 2` — two people, one microphone.
 *
 * `transcription` is deliberately absent. Its flow, `pre-recorded-consultation`,
 * has a single `s_stt_file` node that reads `audio_url` — there is no
 * `a_transcribe_stream` in that graph at all, so pushing a microphone at it can
 * never transcribe anything: the socket opens and nothing ever listens. That
 * mode is an UPLOAD, run server-side (lib/prerecorded.ts), exactly as the
 * legacy backend does it. `flowForMode` returning null is what makes the token
 * route refuse instead of handing out a credential for a flow that cannot use
 * it.
 *
 * These slugs are the LEGACY's, and they are what prod resolves today.
 * `src/flows` now also carries byte-identical COPIES of the three graphs under
 * `pediatric-*`, so this custom can own its engine: switching over is these two
 * literals plus `PRERECORDED_FLOW` below and `CHATBOT_FLOW` in
 * `lib/daguito-chat.ts` — and only AFTER `bun scripts/flows/sync.ts --apply` has
 * published them. A slug that is not published does not resolve, and every
 * recording fails at the token route.
 */
const LIVE_FLOW_BY_MODE: Record<string, string> = {
  video: 'realtime-consultation',
  in_person: 'in-person-consultation',
}

/** The pre-recorded flow, run from the API and never streamed to. */
export const PRERECORDED_FLOW = 'pre-recorded-consultation'

export const flowForMode = (mode: string): string | null => LIVE_FLOW_BY_MODE[mode] ?? null

/** Whether this mode is transcribed live from a microphone at all. */
export const isLiveMode = (mode: string): boolean => flowForMode(mode) !== null

export const isStreamConfigured = (): boolean => Boolean(API_URL && API_KEY)

export type StreamCredentials = {
  api_url: string
  webhook_id: string
  token: string
  session_key: string
  expires_at: number | null
  flow: string
}

export type ResolvedWebhook = { webhook_id: string; webhook_token: string }

/** Where the flows live. Read by the chat module, which shares this config. */
export const streamApiUrl = (): string => API_URL

/**
 * Slug → webhook id + token, cached for the life of the process.
 *
 * The resolution is one round trip per flow and the answer does not change
 * while the flow exists; doing it per consultation added a call to Daguito to
 * the front of every recording.
 */
const webhooks = new Map<string, Promise<ResolvedWebhook>>()

export function resolveFlowWebhook(slug: string): Promise<ResolvedWebhook> {
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
  /**
   * What the holder may do on the channel. `bidi` for the doctor — audio in,
   * flow output back. `produce` for the patient: their browser has to PUSH
   * audio and must never be able to READ the channel, where the recommendations
   * and the clinical note are. The legacy app minted `bidi` for both sides
   * because both sides were logged-in users of the same product; here the
   * patient holds a link, so least privilege is the only defensible default.
   */
  role?: 'bidi' | 'produce' | 'consume'
}): Promise<StreamCredentials> {
  if (!isStreamConfigured()) {
    throw new Error('DAGUITO_API_BASE / DAGUITO_API_KEY are required to stream')
  }
  const flow = flowForMode(p.mode)
  if (!flow) {
    // A caller asking for a live credential for an upload-only mode is a bug in
    // the caller, not a missing configuration — say which.
    throw new Error(`mode ${p.mode} is not streamed live; it is transcribed from an upload`)
  }
  const webhook = await resolveFlowWebhook(flow)

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
    role: p.role ?? 'bidi',
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

/** One node's charge, as Daguito's `usage_events` ledger recorded it. */
export type SessionNodeCost = {
  node_id: string
  step_type: string
  units: number
  microcents: number
}

export type SessionCost = {
  total_microcents: number
  total_usd: number
  nodes: SessionNodeCost[]
}

/**
 * What a session actually cost, from the ledger rather than from the wire.
 *
 * The `cost` events a flow streams are a courtesy, not a guarantee: some steps
 * settle their charge to the ledger WITHOUT emitting one, so a run drained live
 * can read $0 while Daguito did bill for it — measured on the pre-recorded flow,
 * which reported nothing at all. The legacy backend hit the same thing and reads
 * this endpoint as the authority, keeping the drained value only as a fallback.
 *
 * Authenticated with the WEBHOOK token; Daguito scopes the answer to that
 * webhook's org, so the org key never has to leave for this either. Any of the
 * org's streaming webhooks works — the ledger is org-scoped, not flow-scoped.
 *
 * `units` on an STT step is SECONDS of audio, which is the only place a
 * detached run can learn how long the recording it just transcribed was.
 */
export async function fetchSessionCost(
  webhook: ResolvedWebhook,
  sessionKey: string,
): Promise<SessionCost | null> {
  try {
    const body = await post(webhook, '/session-cost', { session_key: sessionKey })
    const nodes = Array.isArray(body.nodes) ? (body.nodes as SessionNodeCost[]) : []
    return {
      total_microcents: typeof body.total_microcents === 'number' ? body.total_microcents : 0,
      total_usd: typeof body.total_usd === 'number' ? body.total_usd : 0,
      nodes,
    }
  } catch (err) {
    // Never fatal: a cost we could not read is an accounting gap, and the
    // transcript is already saved.
    console.warn(`[daguito] session-cost ${sessionKey} failed:`, err)
    return null
  }
}
