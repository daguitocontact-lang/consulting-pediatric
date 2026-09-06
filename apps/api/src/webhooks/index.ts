import { Elysia } from 'elysia'
import { SERVED_ORG_IDS } from '../lib/auth'
import { canVerify, signatureHeaderFrom, verifySignature } from './lib/signature'

/**
 * Inbound webhooks from Daguito.
 *
 * The only routes in the API that are NOT gated by `authorize()`: the caller is
 * Daguito's delivery worker, which holds no panel token and no user session.
 * What replaces it is the HMAC over the raw body (lib/signature.ts) plus the
 * SAME tenant rule the rest of the API enforces — an event for an org this
 * custom does not serve is refused, exactly as a token for one would be.
 *
 * The subscription itself lives in DAGUITO's repo (a migration that inserts it
 * with the url of this endpoint); the secret it prints once goes into
 * DAGUITO_WEBHOOK_SECRET here. Without that variable this answers 503 and
 * writes nothing.
 */

type DaguitoEvent = {
  event?: string
  action?: string
  resource?: string
  data?: Record<string, unknown> & { id?: string }
  previous_values?: Record<string, unknown>
  org_id?: string
}

/**
 * Answers 200 for anything it decides not to act on.
 *
 * The delivery engine retries five times on a non-2xx, so a 4xx for "this event
 * is not one I care about" buys five identical failures and a red row in
 * Daguito's delivery log for a payload that will never do anything here. Only a
 * bad signature (someone else calling) and a real failure to write are worth an
 * error status.
 *
 * Anything this handler CREATES must be idempotent by the event's own id: the
 * five retries are five deliveries of the same event. A column holding the
 * source id plus a unique partial index is how the template repo did it — the
 * second delivery then finds the row and answers 200 with it.
 */
export const webhooksModule = new Elysia().post(
  '/webhooks/daguito/events',
  async ({ body, request, set }) => {
    if (!canVerify()) {
      set.status = 503
      return { error: 'webhook receiver not configured' }
    }
    // `body` is the RAW text (see `parse: 'text'` below): the signature covers
    // the bytes Daguito sent, not a re-serialization of them. Re-serializing a
    // parsed object re-escapes every accent and the HMAC stops matching.
    const raw = typeof body === 'string' ? body : ''
    if (!verifySignature(raw, signatureHeaderFrom(request))) {
      set.status = 401
      return { error: 'invalid signature' }
    }

    let event: DaguitoEvent
    try {
      event = JSON.parse(raw) as DaguitoEvent
    } catch {
      set.status = 400
      return { error: 'invalid json' }
    }

    // Signed by Daguito is not the same as "for us": Daguito mints a secret per
    // subscription, so this can only be our own — but the org check stays, so a
    // subscription pointed here from another tenant cannot write to this DB.
    if (!event.org_id || !SERVED_ORG_IDS.includes(event.org_id)) {
      set.status = 403
      return { error: 'org not served by this custom' }
    }

    // TODO(custom): act on the events this client's flow needs, and ignore the
    // rest with a 200. Narrow FIRST on resource/action, then on the field that
    // matters, e.g.:
    //
    //   if (event.resource !== 'ticket' || event.action !== 'updated') {
    //     return { ok: true, ignored: 'not a ticket update' }
    //   }
    console.log(`[webhook] ${event.resource}.${event.action} org=${event.org_id} — no handler yet`)
    return { ok: true, ignored: 'no handler' }
  },
  // Raw body, not parsed JSON: the HMAC is over the exact bytes Daguito sent.
  { parse: 'text' },
)
