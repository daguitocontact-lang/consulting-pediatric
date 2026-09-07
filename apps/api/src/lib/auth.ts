import { importSPKI, jwtVerify } from 'jose'

// Daguito signs panel/agent tokens with RS256; we verify with only its PUBLIC
// key (no shared secret to distribute). The key is injected from SSM.
//
// Comma-separated, like ALLOWED_ORIGIN: prod passes exactly ONE key, but a dev
// machine needs two at once — Daguito's, so the panel works inside the real
// host, and the throwaway one from scripts/dev/mint-token.ts, so a curl works
// without a host. They used to evict each other, and whichever was written last
// turned the other into a 401 that reads as "Sesión vencida" with no clue why.
const PUBLIC_KEY_PEMS = (process.env.DAGUITO_JWT_PUBLIC_KEY ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean)
const AUDIENCE = 'custom-panel'

// This custom serves ONE client, but Daguito mints `custom-panel` tokens for
// EVERY org it hosts and signs them all with the same key. So a valid signature
// proves the caller came from Daguito — NOT that it is our tenant. Without this
// allow-list, any Daguito org could read this client's data.
const ALLOWED_ORG_IDS = (process.env.DAGUITO_ORG_IDS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

/**
 * The same list, for the code that acts ON these orgs instead of gating them —
 * the boot-time custom-field registration (src/daguito). One declaration, so a
 * tenant added here is served AND set up, never one without the other.
 */
export const SERVED_ORG_IDS: readonly string[] = ALLOWED_ORG_IDS

// Fail closed at boot, the same way db.ts does for DATABASE_URL. A task that
// cannot enforce the tenant check must not serve at all: ECS's deployment
// circuit breaker then rolls the release back, instead of quietly putting an
// unscoped API in front of the client's data.
if (!ALLOWED_ORG_IDS.length) {
  throw new Error(
    'DAGUITO_ORG_IDS is required (comma-separated Daguito org ids this custom serves)',
  )
}

// SSM hands us the PEM verbatim, but a .env file (and docker compose
// interpolation) cannot carry newlines — so a base64-encoded PEM is accepted
// too. That is what the local dev keypair uses; see
// apps/api/scripts/dev/mint-token.ts.
function toPem(raw: string): string {
  return raw.includes('-----BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8')
}

let keysPromise: Promise<Awaited<ReturnType<typeof importSPKI>>[]> | null = null
function publicKeys() {
  if (!PUBLIC_KEY_PEMS.length) throw new Error('DAGUITO_JWT_PUBLIC_KEY is required')
  if (!keysPromise) {
    keysPromise = Promise.all(PUBLIC_KEY_PEMS.map((pem) => importSPKI(toPem(pem), 'RS256')))
  }
  return keysPromise
}

export type PanelClaims = {
  orgId: string
  userId: string
  /**
   * The doctor's display name, when Daguito puts one in the token.
   *
   * Optional and never required: the tenant boundary is `org_id` and the
   * identity is `sub`; this is a label. The engine wants it — the legacy
   * backend sends `doctor_name` in the flow's base_input, and the prompts
   * address the clinician by name — so it is read when present and simply
   * omitted when it is not.
   */
  userName: string | null
}

/**
 * Verify a token minted by Daguito. Checks signature (RS256), audience, and
 * expiry. Returns the org/user it was scoped to, or throws on any failure.
 * The caller must additionally confirm `orgId` matches the tenant it serves.
 */
export async function verifyDaguitoToken(token: string | undefined): Promise<PanelClaims> {
  if (!token) throw new Error('missing token')

  // Tried in order; the FIRST key that verifies wins. Every other check —
  // audience, expiry, and the org allow-list at the call site — is unchanged,
  // so accepting a second key widens who can sign, never what they may do.
  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'] | null = null
  let lastError: unknown = new Error('invalid token')
  for (const key of await publicKeys()) {
    try {
      payload = (await jwtVerify(token, key, { audience: AUDIENCE })).payload
      break
    } catch (err) {
      lastError = err
    }
  }
  if (!payload) throw lastError
  const claims = payload
  const orgId = typeof claims.org_id === 'string' ? claims.org_id : null
  const userId = typeof claims.sub === 'string' ? claims.sub : null
  if (!orgId || !userId) throw new Error('invalid claims')
  // Daguito has called it both things across its own surfaces; neither is
  // required, so read either and fall through to null.
  const nameClaim = claims.name ?? claims.user_name
  const userName = typeof nameClaim === 'string' && nameClaim.trim() ? nameClaim.trim() : null
  return { orgId, userId, userName }
}

/** An auth failure that carries the status the caller should return. */
export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * The full gate for a request: a valid Daguito token AND an org this custom
 * actually serves. Routes call THIS rather than verifyDaguitoToken, so a new
 * endpoint cannot forget the tenant check — forgetting it is the whole bug
 * class this exists to close.
 */
export async function authorize(req: Request): Promise<PanelClaims> {
  let claims: PanelClaims
  try {
    claims = await verifyDaguitoToken(tokenFrom(req))
  } catch {
    throw new AuthError(401, 'unauthorized')
  }
  if (!ALLOWED_ORG_IDS.includes(claims.orgId)) {
    // Signed by Daguito, but for somebody else's org.
    console.warn(`[auth] rejected org_id=${claims.orgId} — not a tenant of this custom`)
    throw new AuthError(403, 'forbidden')
  }
  return claims
}

/** Pull a bearer token from an Authorization header or `?token=`. */
export function tokenFrom(req: Request): string | undefined {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return new URL(req.url).searchParams.get('token') ?? undefined
}
