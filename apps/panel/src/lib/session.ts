// The panel's token, and how it gets a new one.
//
// Daguito mints it with a FIVE MINUTE life and mints it exactly once per host
// load — `signCustomPanelToken({ ..., ttlS: 300 })` in the API's
// `organizations.ts`, called from `useCustomPanel`, which guards itself with
// `loadedFor.current === orgId` so no re-render ever re-mints. Leave the panel
// open longer than that and every call answers 401 at the same moment.
//
// So the panel renews the token the way Daguito renews its own session: by
// itself, before the call and again after a 401, and it only gives up — the
// "sesión vencida" banner — when the RENEWAL fails. That is the difference
// between a session with a clock nobody was told about and one that just works.
//
// This is possible without touching Daguito because of where this code RUNS.
// The bundle is served from pediatric-panel.daguito.com, but Daguito imports it as
// a module into its own page, so a fetch from here carries the host's origin
// and the user's Daguito cookie — the very endpoint the host used to mint our
// token answers us too, with no new contract and no second credential.

/** How close to the end is close enough to renew before even trying a call. */
const RENEW_WITHIN_MS = 60_000

let token = ''
let orgId = ''
/** One renewal at a time: five parallel calls must not mint five tokens. */
let renewal: Promise<string | null> | null = null

/**
 * Why the last renewal failed, when one did.
 *
 *   * `session` — Daguito refused to mint (401/403). The user's session THERE
 *     is over, and nothing this panel does will bring it back: the endpoint
 *     answers that 401 with `sb_access=; Max-Age=0`, so it has already cleared
 *     the cookies it authenticates with. Only a new login helps.
 *   * `unavailable` — the request never got an answer (offline, DNS, a proxy).
 *     The session may well be fine and the next call may work.
 *
 * The banner reads this to say which of the two happened instead of blaming a
 * session that never expired.
 */
export type RenewalFailure = 'session' | 'unavailable'
let failure: RenewalFailure | null = null

/** What killed the last renewal, or null while nothing has. */
export function renewalFailure(): RenewalFailure | null {
  return failure
}

/** `exp` in ms, or 0 when the token is unreadable — which counts as expired. */
function expiry(jwt: string): number {
  const payload = jwt.split('.')[1]
  if (!payload) return 0
  try {
    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number
    }
    return typeof exp === 'number' ? exp * 1000 : 0
  } catch {
    return 0
  }
}

/**
 * Take the host's token at mount.
 *
 * The newer one wins rather than the last one in: the host re-mounts the panel
 * on every page change and hands back the SAME token it minted at load, which
 * by then may be older than the one we renewed ourselves.
 */
export function adoptToken(next: string, org: string): void {
  orgId = org || orgId
  if (next && expiry(next) > expiry(token)) token = next
}

/** What to send right now — the renewed token, or the host's if we have none. */
export function currentToken(fallback: string): string {
  return token || fallback
}

/**
 * Where Daguito's API lives, derived from the page the panel is running in.
 *
 * Daguito's own `resolveApiUrl` (apps/web/src/lib/api.ts), rule for rule:
 * `app.daguito.com` → `api.daguito.com`, `app-dev2…` → `api-dev2…`, localhost →
 * :4001 — and, like it, an unrecognised host falls back to PROD instead of
 * giving up. The fallback is not a guess about the host, it is the same guess
 * the page around us already made: a panel is only ever loaded by a Daguito
 * that resolved its own API this way, so following it is right far more often
 * than refusing.
 *
 * Returning null here (what this did before) made the one failure that has no
 * symptom: no request, no console error, and five minutes later a "session
 * expired" band on a session that was perfectly alive.
 */
function daguitoApi(): string {
  if (typeof window === 'undefined') return 'https://api.daguito.com'
  const { protocol, hostname } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:4001'
  if (/^app(-[a-z0-9]+)?\.daguito\.com$/i.test(hostname)) {
    return `${protocol}//${hostname.replace(/^app/, 'api')}`
  }
  return 'https://api.daguito.com'
}

/**
 * A fresh token from Daguito, or null when it cannot be had.
 *
 * `credentials: 'include'` is the whole point: the endpoint authenticates the
 * USER by their Daguito cookie, exactly as it did when the host loaded the
 * panel. Null covers every way that can fail — the user's Daguito session
 * really did end (401), the panel is embedded somewhere this rule does not
 * know, the network — and the caller turns null into the banner.
 *
 * Daguito's own `/v1/auth/refresh` is deliberately NOT called from here: its
 * refresh token is single-use and rotates, and a rotation racing the host's
 * would kill the whole family. Renewing the panel token is ours to do; renewing
 * the Daguito session stays the host's.
 */
async function mint(): Promise<string | null> {
  if (!orgId) {
    // The host mounts us with the org it minted the token for; without it there
    // is no endpoint to ask. Not a session problem — say so.
    failure = 'unavailable'
    return null
  }
  try {
    const res = await fetch(
      `${daguitoApi()}/organizations/${encodeURIComponent(orgId)}/custom-panel/token`,
      { credentials: 'include' },
    )
    if (!res.ok) {
      // 401: no live Daguito session. 403: this user may no longer open the
      // panel (the org's `allowed_user_ids`). Both are answers, not outages,
      // and both are final until somebody logs in again.
      failure = res.status === 401 || res.status === 403 ? 'session' : 'unavailable'
      return null
    }
    const body = (await res.json()) as { token?: string }
    const next = typeof body.token === 'string' && body.token ? body.token : null
    failure = next ? null : 'unavailable'
    return next
  } catch {
    failure = 'unavailable'
    return null
  }
}

/**
 * Renew now, sharing one request with whoever else asked while it was open.
 *
 * A `session` failure STOPS the renewals. Every call in flight retries on its
 * own 401, so a panel with five pages open answers a dead session with five
 * more requests, and each of those 401s makes Daguito re-clear the auth cookies
 * — hammering the one endpoint that could still say yes if the user logs in in
 * another tab. One `no` is enough; the banner takes it from here, and a reload
 * starts the panel over with a fresh mint from the host.
 */
export function renew(): Promise<string | null> {
  if (failure === 'session') return Promise.resolve(null)
  if (!renewal) {
    renewal = mint().then((next) => {
      if (next) token = next
      renewal = null
      return next
    })
  }
  return renewal
}

/**
 * The token to send, renewed first if it is about to run out.
 *
 * Renewing BEFORE the call rather than only after a 401 is what keeps the
 * five-minute clock invisible: the failed call, the banner and the retry all
 * stop happening, and a panel left open over lunch just works.
 */
export async function freshToken(fallback: string): Promise<string> {
  const live = currentToken(fallback)
  if (expiry(live) - Date.now() > RENEW_WITHIN_MS) return live
  return (await renew()) ?? live
}
