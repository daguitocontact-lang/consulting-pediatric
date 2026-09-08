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
import { PANEL_ORIGIN, PATIENT_PAGE_IS_OURS, PATIENT_PAGE_URL } from './panel-origin'

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

/**
 * The url the doctor copies.
 *
 * The credential stays in the FRAGMENT: it is never sent to a server, never
 * lands in an access log, and does not travel in a `Referer` when the page
 * loads Jitsi's script from another origin. That is why the id is in there too
 * rather than in the path — the parent's visit is not a line in somebody's
 * request log, not even Daguito's.
 *
 * When the page is served under Daguito's domain (`PATIENT_BASE_URL`) the
 * fragment also carries where to find this API and the bundle. It has to: the
 * page used to read both off its own hostname, and on `app.daguito.com` that
 * derivation gives Daguito's own host for the API and a `panel.js` that is not
 * there. Both values are ours, both are public, and the page refuses any that
 * is not under `daguito.com`.
 */
export function patientLinkUrl(
  p: { consultationId: string; token: string; apiBase: string },
  // Where the page is, as a parameter with the configured answer as its
  // default: the rules above are then readable — and testable — without an
  // environment, which is the same trick `meetingOptions` uses in the panel.
  page: { url: string; ours: boolean; panelOrigin: string } = {
    url: PATIENT_PAGE_URL,
    ours: PATIENT_PAGE_IS_OURS,
    panelOrigin: PANEL_ORIGIN,
  },
): string {
  const fragment = new URLSearchParams({ c: p.consultationId, t: p.token })
  if (!page.ours) {
    fragment.set('api', p.apiBase)
    fragment.set('panel', page.panelOrigin)
  }
  // `{id}` for a route whose path IS the consultation, which is what a SPA
  // router gives you. The id stays in the fragment as well: that is where the
  // page reads it from, in both hosting shapes, and one parser beats two.
  const url = page.url.replace('{id}', encodeURIComponent(p.consultationId))
  return `${url}#${fragment.toString()}`
}

/**
 * This API's public base, as the caller reached it.
 *
 * Taken from the request rather than a variable: the doctor's panel called
 * this route at the hostname the patient must call too, and cloudflared passes
 * the original `Host` through untouched. `API_BASE_URL` overrides it for the
 * case that breaks the assumption (a proxy that rewrites the host).
 */
export function apiBaseFromRequest(request: Request): string {
  const configured = process.env.API_BASE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const host = request.headers.get('host')
  if (!host) return ''
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
  return `${proto}://${host}`
}
