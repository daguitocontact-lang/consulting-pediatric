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
 * The same rule Daguito's own `resolveApiUrl` uses: `app.daguito.com` →
 * `api.daguito.com`, `app-dev2…` → `api-dev2…`, localhost → :4001. An
 * unrecognised host returns null instead of guessing: a wrong host is a CORS
 * error on every renewal, and the panel is better off saying the session ended.
 * (A developer running Daguito's web with a VITE_API_URL override lands here;
 * dev tokens last twelve hours, so nothing has to be renewed anyway.)
 */
function daguitoApi(): string | null {
  if (typeof window === 'undefined') return null
  const { protocol, hostname } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:4001'
  if (/^app(-[a-z0-9]+)?\.daguito\.com$/i.test(hostname)) {
    return `${protocol}//${hostname.replace(/^app/, 'api')}`
  }
  return null
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
  const base = daguitoApi()
  if (!base || !orgId) return null
  try {
    const res = await fetch(
      `${base}/organizations/${encodeURIComponent(orgId)}/custom-panel/token`,
      { credentials: 'include' },
    )
    if (!res.ok) return null
    const body = (await res.json()) as { token?: string }
    return typeof body.token === 'string' && body.token ? body.token : null
  } catch {
    return null
  }
}

/** Renew now, sharing one request with whoever else asked while it was open. */
export function renew(): Promise<string | null> {
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
