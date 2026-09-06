/**
 * The one place this API talks OUT to Daguito.
 *
 * Everything else here is inbound: Daguito signs a token, we verify it
 * (lib/auth.ts). Registering the custom's contact fields is the other
 * direction, and it goes out with an ACCOUNT KEY (`dgsk_acc_…`) — an org-scoped
 * secret an owner mints in Daguito and can revoke there, never a person's
 * email and password. A leaked key is revoked in one click; a leaked login is a
 * human's whole account.
 *
 * The key is bound to exactly one org on Daguito's side, so it can only ever
 * touch the org it belongs to no matter what this code asks for.
 */

const API_BASE = (process.env.DAGUITO_API_BASE ?? '').trim().replace(/\/+$/, '')
const API_KEY = (process.env.DAGUITO_API_KEY ?? '').trim()

/**
 * Whether the outbound side is wired at all.
 *
 * Deliberately NOT fail-closed like DAGUITO_ORG_IDS: that one gates who may
 * read the client's data, this one only registers form fields. A dev machine
 * with no key must still boot the API.
 */
export function isConfigured(): boolean {
  return Boolean(API_BASE && API_KEY)
}

export class DaguitoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DaguitoError'
  }
}

/** Call Daguito's API with the custom's account key. */
export async function daguitoFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!isConfigured()) throw new DaguitoError(500, 'DAGUITO_API_BASE / DAGUITO_API_KEY not set')

  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${API_KEY}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: { error?: string }) => d?.error)
      .catch(() => null)
    // 401/403 here is almost always the key: revoked, or minted in a different
    // org than the one being set up. Say which, because the two look identical
    // from a log line that only carries the status.
    const hint =
      res.status === 401
        ? ' (key invalid or revoked)'
        : res.status === 403
          ? ' (key belongs to another org)'
          : ''
    throw new DaguitoError(res.status, `${detail ?? `HTTP ${res.status}`}${hint}`)
  }
  // 204 on delete; every other endpoint answers JSON.
  return res.status === 204 ? (null as T) : ((await res.json()) as T)
}
