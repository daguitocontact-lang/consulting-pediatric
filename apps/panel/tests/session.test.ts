/**
 * The panel's own token renewal — the half of the five-minute clock that is
 * ours (`lib/session.ts`).
 *
 * The module keeps its state at module scope on purpose (one token, one
 * renewal in flight, one verdict), so this file runs ONE story in order rather
 * than isolated cases: the network drops, then Daguito answers, then the
 * session ends. The last step is terminal by design, so it goes last.
 */
import { beforeAll, expect, test } from 'bun:test'
import { adoptToken, renew, renewalFailure } from '../src/lib/session'

let calls: string[] = []
let respond: () => Promise<Response>

beforeAll(() => {
  // The panel runs inside the host's page; `daguitoApi()` reads the hostname
  // off it to find Daguito's API.
  ;(globalThis as unknown as { window: unknown }).window = {
    location: { protocol: 'https:', hostname: 'app.daguito.com' },
  }
  globalThis.fetch = ((url: string) => {
    calls.push(String(url))
    return respond()
  }) as unknown as typeof fetch

  // A token for an org, exactly as the host hands them over at mount.
  adoptToken('', 'org-1')
})

test('a request that never lands is not the session ending', async () => {
  respond = () => Promise.reject(new Error('offline'))

  expect(await renew()).toBeNull()
  expect(renewalFailure()).toBe('unavailable')
  // The endpoint is derived from the host page: app.daguito.com → api.…
  expect(calls[0]).toBe('https://api.daguito.com/organizations/org-1/custom-panel/token')
})

test('a minted token clears the verdict and is what the next call sends', async () => {
  respond = () => Promise.resolve(new Response(JSON.stringify({ token: 'fresh.jwt.value' })))

  expect(await renew()).toBe('fresh.jwt.value')
  expect(renewalFailure()).toBeNull()
})

test('a 401 is final, and the panel stops asking', async () => {
  respond = () => Promise.resolve(new Response('{"error":"No autorizado"}', { status: 401 }))

  expect(await renew()).toBeNull()
  expect(renewalFailure()).toBe('session')

  // The second renewal must not reach Daguito: that 401 already cleared the
  // cookies it authenticates with, so every retry is one more pointless call
  // against an endpoint that cannot say yes until somebody logs in again.
  const before = calls.length
  expect(await renew()).toBeNull()
  expect(calls.length).toBe(before)
})
