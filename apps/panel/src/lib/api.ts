// Thin client for the custom's API. Every page goes through here so the token
// header, the JSON parsing and the error shape are written once.
//
// The token comes from Daguito and is already scoped to the org: this client
// never sends an org id, and the API would ignore it if it did — the tenant is
// decided by the token, never by the caller.
import type { Translator } from './i18n'
import type { ThemeMode } from './host-theme'
import { freshToken, renew } from './session'

export type MountProps = {
  token: string
  apiBase: string
  orgId: string
  pageId: string
  /** BCP-47 tag from the host, when it sends one. Spanish if not. */
  locale?: string
  /** Light/dark from the host, when it sends one. Read off <html> if not. */
  theme?: ThemeMode
}

/** Fired on the window the first time a call comes back 401. */
export const SESSION_EXPIRED = 'pediatric:session-expired'

/** An API error carrying the HTTP status, so callers can tell 403 from 500. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * One fetch, one error shape. Everything else here is a thin wrapper: the
 * token header, the 401 announcement and the `{ error }` unwrapping are
 * written once so a new call cannot forget any of the three.
 */
async function send(
  props: MountProps,
  method: string,
  path: string,
  init?: { body?: BodyInit; contentType?: string },
): Promise<Response> {
  const call = (token: string) =>
    fetch(`${props.apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.contentType ? { 'content-type': init.contentType } : {}),
      },
      // Re-sendable on the retry below: every body this client builds is a
      // string or a FormData, never a stream, so it can be read twice.
      body: init?.body,
    })

  // Daguito's panel token lasts five minutes and is minted once per host load,
  // so the token in `props` goes stale while the panel sits open. `freshToken`
  // renews it before it runs out; the 401 branch covers what slips through —
  // a clock that drifted, or a token Daguito invalidated early.
  let res = await call(await freshToken(props.token))
  if (res.status === 401) {
    const renewed = await renew()
    if (renewed) res = await call(renewed)
  }

  if (!res.ok) {
    // A 401 that survived the renewal is never one page's problem: the user's
    // Daguito session itself ended, so the whole panel is cold at the same
    // moment. Announcing it lets the shell offer the reload that fixes it,
    // instead of every page showing its own red line.
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED))
    }
    // The API answers { error } on every failure; fall back to the status when
    // the body is not JSON (a proxy timing out, for instance).
    const detail = await res
      .json()
      .then((d: { error?: string }) => d?.error)
      .catch(() => null)
    throw new ApiError(res.status, detail ?? `HTTP ${res.status}`)
  }
  return res
}

async function request<T>(
  props: MountProps,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await send(props, method, path, {
    ...(body === undefined ? {} : { body: JSON.stringify(body), contentType: 'application/json' }),
  })
  return (await res.json()) as T
}

export const apiGet = <T>(props: MountProps, path: string) => request<T>(props, 'GET', path)
export const apiPost = <T>(props: MountProps, path: string, body?: unknown) =>
  request<T>(props, 'POST', path, body ?? {})
export const apiPatch = <T>(props: MountProps, path: string, body: unknown) =>
  request<T>(props, 'PATCH', path, body)
export const apiDelete = <T>(props: MountProps, path: string) => request<T>(props, 'DELETE', path)

/**
 * A file to a multipart endpoint (the passenger's ID scan).
 *
 * No content-type of ours: the browser writes it, boundary and all, and setting
 * it by hand is the classic way to make the server fail to parse the body.
 */
export const apiUpload = <T>(props: MountProps, path: string, file: File) => {
  const form = new FormData()
  form.append('file', file)
  return send(props, 'POST', path, { body: form }).then((res) => res.json() as Promise<T>)
}

/**
 * Bytes behind the token, as a blob URL plus the type they came with.
 *
 * An `<img src>` cannot carry an Authorization header, and the documents
 * endpoint answers 401 without one — so the panel fetches the file itself and
 * hands the browser an object URL. The type comes from the blob because the URL
 * has no extension to read it off. The caller OWNS the URL and must
 * `URL.revokeObjectURL` it, or the file stays in memory for the life of the
 * page.
 */
export const apiBlobUrl = (props: MountProps, path: string) =>
  send(props, 'GET', path)
    .then((res) => res.blob())
    .then((blob) => ({ url: URL.createObjectURL(blob), type: blob.type }))

/**
 * A file the API built, saved to the operator's disk.
 *
 * Same reason as `apiBlobUrl`: a plain `<a href>` to the endpoint carries no
 * Authorization header and comes back 401, so the panel fetches the bytes and
 * clicks a link at itself. The name the server sent in `content-disposition`
 * wins — it knows the date and the group number — and `fallback` covers the
 * case where a proxy stripped the header.
 */
export async function apiDownload(
  props: MountProps,
  path: string,
  fallback: string,
): Promise<void> {
  const res = await send(props, 'GET', path)
  const sent = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1]
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = sent ?? fallback
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Human message for the operator, in their language. 401 and 403 are the two
 * worth naming: an expired session is fixed by reloading, while a 403 means the
 * token is valid but minted for an org this custom does not serve — telling
 * those apart saves a support call. Anything else is shown verbatim; it comes
 * from our own API and is already specific.
 */
export function errorMessage(err: unknown, i18n: Translator): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return i18n.t('common.error.session')
    if (err.status === 403) return i18n.t('common.error.forbidden')
    return err.message
  }
  return err instanceof Error ? err.message : i18n.t('common.error.unexpected')
}
