/**
 * The link the patient joins a video consultation with.
 *
 * A video consultation is transcribed by TWO nodes: `s_stt_doctor` listens on
 * `<session>:doctor` and `s_stt_patient` on `<session>:patient`. The doctor's
 * browser feeds the first. Nothing fed the second, and an idle transcribe node
 * does not fail — it starves for its whole 30 s timeout while the merge
 * withholds the doctor's transcript too. That is the "it takes 30 seconds to
 * start transcribing" bug, and the only real fix is the patient's own
 * microphone, from the patient's own browser, which is what the legacy app does
 * from its `/consultation-connect/:id` page.
 *
 * That page is available to a logged-in user of the legacy product. Here the
 * patient is a parent with a WhatsApp message, so the link IS the credential.
 * Which makes the shape of this token the whole security question:
 *
 *   * signed HS256 with a secret that lives in OUR database (never in the link),
 *   * scoped to ONE consultation id — it opens nothing else,
 *   * short-lived: hours, not for ever,
 *   * and it buys the holder exactly two things, a Jitsi room token as a
 *     NON-moderator and a `produce`-only stream credential. `produce` is the
 *     part that matters: the patient can push audio and cannot read the channel,
 *     so the recommendations and the clinical note the flow emits are not
 *     reachable from the link. The legacy mints `bidi` for its patient because
 *     its patient is an authenticated user of the product; ours is not.
 *
 * The secret is generated once and kept in `app_meta`, not in SSM: it is
 * meaningless outside this database (it authenticates rows in it), every task
 * reads the same one so a link survives a rolling deploy, and it means the
 * feature works on a fresh environment with no new variable to set — a secret
 * nobody remembered to configure would have made this fail closed in a way that
 * looks like a bug in the link.
 */
import { SignJWT, jwtVerify } from 'jose'
import { sql } from './db'

const META_KEY = 'patient_link_secret'

/** Long enough for a consultation that is rescheduled twice in a morning, and
 *  short enough that a link forwarded on is not a standing door. */
const TTL_SECONDS = 12 * 60 * 60

/** Its own audience, so a panel token can never be replayed here or vice versa. */
const AUDIENCE = 'pediatric-patient-link'

let cached: Promise<Uint8Array> | null = null

/**
 * The signing key, created on first use.
 *
 * `ON CONFLICT DO NOTHING` then re-read, rather than an upsert: two tasks
 * booting at once must end up with the SAME secret, and an upsert would have
 * the second one overwrite the first — invalidating every link minted in
 * between, once, mysteriously, at deploy time.
 */
function secret(): Promise<Uint8Array> {
  if (cached) return cached
  cached = (async () => {
    const value = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
    await sql`
      INSERT INTO app_meta (key, value) VALUES (${META_KEY}, ${value})
      ON CONFLICT (key) DO NOTHING
    `
    const [row] = await sql<{ value: string }[]>`
      SELECT value FROM app_meta WHERE key = ${META_KEY}
    `
    if (!row) throw new Error('patient link secret could not be stored')
    return new TextEncoder().encode(row.value)
  })()
  // A failed read must not poison the process: the next call retries.
  cached.catch(() => {
    cached = null
  })
  return cached
}

export type PatientLinkClaims = { consultationId: string; orgId: string }

/** Mint one. `orgId` travels in the token so the public route never has to
 *  trust a caller-supplied tenant. */
export async function signPatientLink(p: PatientLinkClaims): Promise<{
  token: string
  expiresAt: string
}> {
  const expires = new Date(Date.now() + TTL_SECONDS * 1000)
  const token = await new SignJWT({ org_id: p.orgId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(p.consultationId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(await secret())
  return { token, expiresAt: expires.toISOString() }
}

/**
 * Verify one, for a specific consultation.
 *
 * The consultation id is checked HERE rather than left to the caller: a token
 * that verifies is not a token for THIS consultation, and the difference is one
 * patient listening to another's visit.
 */
export async function verifyPatientLink(
  token: string | undefined,
  consultationId: string,
): Promise<PatientLinkClaims | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, await secret(), { audience: AUDIENCE })
    const orgId = typeof payload.org_id === 'string' ? payload.org_id : null
    if (!orgId || payload.sub !== consultationId) return null
    return { consultationId, orgId }
  } catch {
    return null
  }
}
