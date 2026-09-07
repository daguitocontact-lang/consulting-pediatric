/**
 * The patient's link.
 *
 * The link IS the credential — a parent with a WhatsApp message has no Daguito
 * account — so what it does and does not open is the whole security question of
 * this feature. These tests are that boundary written down.
 */
import { describe, expect, test } from 'bun:test'
import './setup'
import { signPatientLink, verifyPatientLink } from '../src/lib/patient-link'

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
