import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The other half of Daguito's `signHmac` (webhook-subscriptions/lib/hmac.ts):
 * `x-daguito-signature: sha256=<hex>`, HMAC-SHA256 over the RAW request bytes.
 *
 * Raw matters. Re-stringifying a parsed body re-escapes non-ASCII, and this
 * payload carries a ticket's subject and description — Spanish, so accents on
 * the first day and an emoji on the second. That is why the route asks Elysia
 * for `type: 'text'` and parses the JSON itself.
 */
const SIGNATURE_HEADER = 'x-daguito-signature'
const PREFIX = 'sha256='

const SECRET = process.env.DAGUITO_WEBHOOK_SECRET ?? ''

/** Whether the receiver is wired. Without a secret nothing can be verified. */
export const canVerify = (): boolean => SECRET.length > 0

export function verifySignature(rawBody: string, header: string | null): boolean {
  if (!SECRET || !header?.startsWith(PREFIX)) return false
  const expected = Buffer.from(createHmac('sha256', SECRET).update(rawBody).digest('hex'), 'utf8')
  const received = Buffer.from(header.slice(PREFIX.length), 'utf8')
  // Length has to match before timingSafeEqual, which throws otherwise — and
  // the length of a hex digest is public anyway.
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export const signatureHeaderFrom = (request: Request): string | null =>
  request.headers.get(SIGNATURE_HEADER)
