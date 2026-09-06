// The one place this panel talks to Daguito's OWN API instead of the custom's.
//
// Reservations point at a Daguito contact (`reservations.customer_id` is
// `contacts.id`, no FK, no copy — see migration 0002), so the form has to turn
// a name into that id. The custom's API cannot help: its token is `aud:
// custom-panel` and Daguito's contact directory is not its data.
//
// It works because of WHERE this module runs. Daguito imports the panel into
// its own page, so `fetch` here goes out from `app[-slug].daguito.com` and the
// session cookie (`AUTH_COOKIE_DOMAIN=.daguito.com`) rides along to
// `api[-slug].daguito.com`, whose CORS allows any `*.daguito.com` origin with
// `credentials: true`. No new endpoint, no second token — the operator's own
// session, exactly as if Daguito had made the call.
//
// Deliberately the ONLY file that knows Daguito's API shape. Everything else
// goes through lib/api.ts and the custom's token, so if Daguito ever hands the
// panel a contact picker through mount props, this is the single file to drop.

/** A contact, reduced to what a picker actually shows. */
export type DaguitoContact = {
  id: string
  /** Best display name; falls back to the channel address for unnamed rows. */
  label: string
  /** Phone/email under the name, to tell two "Juan"s apart. */
  detail: string | null
}

/** Raw row from `GET /apps/:org_id/contacts`. Only the fields we render. */
type ContactRow = {
  id: string
  name: string | null
  address: string
  email: string | null
  phone: string | null
}

/**
 * Daguito's API host, by the same rule its own web app uses
 * (`resolveApiUrl` in apps/web/src/lib/api.ts): swap the leading `app` segment
 * for `api`, so `app-dev2.daguito.com` -> `api-dev2.daguito.com` and no
 * developer's slug is hardcoded. Kept identical on purpose — if Daguito changes
 * the rule, this is what has to change with it.
 */
export function daguitoApiBase(): string | null {
  if (typeof window === 'undefined') return null
  const { protocol, hostname } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:4001'
  if (/^app(-[a-z0-9]+)?\.daguito\.com$/i.test(hostname)) {
    return `${protocol}//${hostname.replace(/^app/, 'api')}`
  }
  // Standalone dev harness, or a host we do not recognise: the caller degrades
  // to the plain uuid box rather than firing requests at a guess.
  return null
}

/** Thrown when the operator's Daguito session cannot read the directory. */
export class ContactSearchUnavailable extends Error {
  constructor(readonly status: number) {
    super(`contact search unavailable (${status})`)
    this.name = 'ContactSearchUnavailable'
  }
}

/**
 * Search the org's contacts. `signal` matters: the picker fires one of these
 * per keystroke (debounced) and an out-of-order response would repopulate the
 * list with results for a prefix the operator has already moved past.
 */
export async function searchContacts(
  orgId: string,
  query: string,
  signal?: AbortSignal,
): Promise<DaguitoContact[]> {
  const base = daguitoApiBase()
  if (!base) return []

  const url = `${base}/apps/${encodeURIComponent(orgId)}/contacts?q=${encodeURIComponent(query)}&limit=8`
  const res = await fetch(url, {
    // The whole mechanism. Without it the cookie stays home and every call 401s.
    credentials: 'include',
    signal,
  })

  if (!res.ok) {
    // 403 is the one worth naming: the route is guarded by `requireManage`,
    // while any org member may open this panel. That operator can still type a
    // uuid — they just cannot browse the directory.
    throw new ContactSearchUnavailable(res.status)
  }

  const body = (await res.json()) as { items?: ContactRow[] }
  return (body.items ?? []).map((row) => ({
    id: row.id,
    label: row.name?.trim() || row.address || row.id,
    detail: row.phone || row.email || (row.name ? row.address : null),
  }))
}

/** A member of the org, reduced to what a picker shows. */
export type DaguitoUser = { id: string; label: string }

/**
 * The org's members — this is who can be a `seller_id` (Daguito `users.id`,
 * plain uuid, no FK; see migration 0006).
 *
 * Unlike the contact directory this route is gated on MEMBERSHIP, not on the
 * manage role, so every operator who can open the panel can also populate the
 * dropdown. An org has a handful of members, so it loads once as a list rather
 * than searching per keystroke.
 */
export async function fetchOrgMembers(
  orgId: string,
  signal?: AbortSignal,
): Promise<DaguitoUser[]> {
  const base = daguitoApiBase()
  if (!base) return []

  const res = await fetch(`${base}/organizations/${encodeURIComponent(orgId)}/members`, {
    credentials: 'include',
    signal,
  })
  if (!res.ok) throw new ContactSearchUnavailable(res.status)

  const body = (await res.json()) as {
    members?: { user_id: string; name: string | null; email: string }[]
  }
  return (body.members ?? [])
    .map((m) => ({ id: m.user_id, label: m.name?.trim() || m.email || m.user_id }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
