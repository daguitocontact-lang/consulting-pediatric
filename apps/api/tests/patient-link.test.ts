/**
 * The patient's link.
 *
 * The link IS the credential — a parent with a WhatsApp message has no Daguito
 * account — so what it does and does not open is the whole security question of
 * this feature. These tests are that boundary written down.
 */
import { describe, expect, test } from 'bun:test'
import './setup'
import {
  apiBaseFromRequest,
  patientLinkUrl,
  signPatientLink,
  verifyPatientLink,
} from '../src/lib/patient-link'

const ORG = 'org_dev'
const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

describe('the patient link', () => {
  test('opens the consultation it was minted for', async () => {
    const { token } = await signPatientLink({ consultationId: A, orgId: ORG })
    expect(await verifyPatientLink(token, A)).toEqual({ consultationId: A, orgId: ORG })
  })

  test('does NOT open another consultation', async () => {
    // The one that matters: a token that merely verifies is not a token for
    // THIS consultation, and the difference is one parent listening to another
    // family's visit.
    const { token } = await signPatientLink({ consultationId: A, orgId: ORG })
    expect(await verifyPatientLink(token, B)).toBeNull()
  })

  test('carries its own org, so no caller ever supplies a tenant', async () => {
    const { token } = await signPatientLink({ consultationId: A, orgId: 'org_other' })
    const claims = await verifyPatientLink(token, A)
    expect(claims?.orgId).toBe('org_other')
  })

  test('rejects a forged, truncated or empty token', async () => {
    const { token } = await signPatientLink({ consultationId: A, orgId: ORG })
    expect(await verifyPatientLink(undefined, A)).toBeNull()
    expect(await verifyPatientLink('', A)).toBeNull()
    expect(await verifyPatientLink('not.a.token', A)).toBeNull()
    // A character flipped in the MIDDLE of the signature, not at the end.
    //
    // The end does not work, and the way it fails is worth writing down: a
    // 32-byte HMAC is 43 base64url characters, and the LAST one carries only
    // two real bits — several different characters decode to the same bytes.
    // So `slice(0,-1) + 'x'` produces a different-looking token that verifies
    // perfectly, and the test failed about one run in four.
    const [header, payload, signature] = token.split('.')
    const middle = Math.floor(signature!.length / 2)
    const flipped = signature![middle] === 'A' ? 'B' : 'A'
    const forged = `${header}.${payload}.${signature!.slice(0, middle)}${flipped}${signature!.slice(middle + 1)}`
    expect(forged).not.toBe(token)
    expect(await verifyPatientLink(forged, A)).toBeNull()

    // And a payload swapped onto a valid signature.
    const other = await signPatientLink({ consultationId: B, orgId: ORG })
    const spliced = `${header}.${other.token.split('.')[1]}.${signature}`
    expect(await verifyPatientLink(spliced, A)).toBeNull()
  })

  test('a Daguito panel token is not a patient link', async () => {
    // Different audience, different key. Without the audience check a token
    // minted for the panel would be replayable on the public route, which is
    // the one place there is no org guard.
    const { verifyDaguitoToken } = await import('../src/lib/auth')
    expect(verifyDaguitoToken).toBeDefined()
    const panelish =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEifQ.x'
    expect(await verifyPatientLink(panelish, A)).toBeNull()
  })

  test('the secret is stable across calls, so a link survives a restart', async () => {
    // It lives in `app_meta`, not in memory: two API tasks behind one load
    // balancer have to agree, and a link minted before a rolling deploy has to
    // still work after it.
    const first = await signPatientLink({ consultationId: A, orgId: ORG })
    const second = await signPatientLink({ consultationId: A, orgId: ORG })
    expect(await verifyPatientLink(first.token, A)).not.toBeNull()
    expect(await verifyPatientLink(second.token, A)).not.toBeNull()
  })

  test('it expires', async () => {
    const { expiresAt } = await signPatientLink({ consultationId: A, orgId: ORG })
    const hours = (new Date(expiresAt).getTime() - Date.now()) / 3_600_000
    // Long enough for a morning that gets rescheduled twice, short enough that
    // a forwarded link is not a standing door.
    expect(hours).toBeGreaterThan(1)
    expect(hours).toBeLessThanOrEqual(12)
  })
})

/** The hosting shapes, as the config resolves them. */
const OURS = {
  url: 'https://pediatric-panel.daguito.com/consulta',
  ours: true,
  panelOrigin: 'https://pediatric-panel.daguito.com',
}
const DAGUITO = {
  url: 'https://app.daguito.com/consulta',
  ours: false,
  panelOrigin: 'https://pediatric-panel.daguito.com',
}
/** Daguito's router, where the route itself carries the consultation. */
const ROUTE = { ...DAGUITO, url: 'https://app.daguito.com/consulta/{id}' }

describe('the url the doctor copies', () => {
  const link = (page: typeof OURS) =>
    patientLinkUrl(
      { consultationId: A, token: 'tok.en.value', apiBase: 'https://pediatric-api.daguito.com' },
      page,
    )

  test('the credential is in the fragment, never in the query or the path', async () => {
    // A fragment is not sent to the server, does not reach an access log and
    // does not travel in a Referer when the page loads Jitsi from another
    // origin. That holds for the consultation id too: a visit is not a line in
    // anybody's request log, Daguito's included.
    for (const page of [OURS, DAGUITO]) {
      const url = new URL(link(page))
      expect(url.search).toBe('')
      expect(url.pathname).not.toContain(A)
      const fragment = new URLSearchParams(url.hash.slice(1))
      expect(fragment.get('c')).toBe(A)
      expect(fragment.get('t')).toBe('tok.en.value')
    }
  })

  test('our own page is told nothing else: it is next to the bundle', () => {
    const fragment = new URLSearchParams(new URL(link(OURS)).hash.slice(1))
    expect([...fragment.keys()].sort()).toEqual(['c', 't'])
    // A route, not a file: `.html` in a link a practice sends over WhatsApp
    // reads like something that leaked out of a server.
    expect(link(OURS).startsWith('https://pediatric-panel.daguito.com/consulta#')).toBe(true)
    expect(link(OURS)).not.toContain('.html')
  })

  test('`{id}` becomes the path, for a router whose route is the consultation', () => {
    // What a SPA route looks like — Daguito serves routes, not files.
    expect(link(ROUTE).startsWith(`https://app.daguito.com/consulta/${A}#`)).toBe(true)
    // And the id is still in the fragment, which is where the page reads it
    // from whichever way it was served.
    expect(new URLSearchParams(new URL(link(ROUTE)).hash.slice(1)).get('c')).toBe(A)
  })

  test("under Daguito's domain it carries the api and the bundle", () => {
    // On app.daguito.com neither is derivable from the page's own hostname:
    // the API host came from swapping one label, and `./panel.js` from sitting
    // next to it. Without these the page calls Daguito for a session and
    // imports a bundle that is not there.
    const fragment = new URLSearchParams(new URL(link(DAGUITO)).hash.slice(1))
    expect(fragment.get('api')).toBe('https://pediatric-api.daguito.com')
    expect(fragment.get('panel')).toBe('https://pediatric-panel.daguito.com')
  })
})

describe('the api base the link hands the page', () => {
  const request = (headers: Record<string, string>) =>
    new Request('https://ignored/api/consultations/x/patient-link', { headers })

  test('is the host the doctor reached, which is the one the parent must call', () => {
    // cloudflared passes the original Host through, so the panel calling
    // `pediatric-api.daguito.com` is exactly the base the phone needs.
    expect(apiBaseFromRequest(request({ host: 'pediatric-api.daguito.com' }))).toBe(
      'https://pediatric-api.daguito.com',
    )
  })

  test('keeps the scheme it was reached over, for the docker dev stack', () => {
    expect(
      apiBaseFromRequest(request({ host: 'localhost:4101', 'x-forwarded-proto': 'http' })),
    ).toBe('http://localhost:4101')
  })

  test('API_BASE_URL wins, for a proxy that rewrites the host', () => {
    process.env.API_BASE_URL = 'https://pediatric-api.daguito.com/'
    try {
      expect(apiBaseFromRequest(request({ host: 'internal.local' }))).toBe(
        'https://pediatric-api.daguito.com',
      )
    } finally {
      delete process.env.API_BASE_URL
    }
  })
})
