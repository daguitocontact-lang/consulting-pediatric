/**
 * Jitsi meeting credentials.
 *
 * The room lives on the Jitsi server, not here: what this API does is name the
 * room and sign the short-lived JWT that lets a doctor in as moderator. Same
 * shape as the legacy app's `security/jitsi.go`, which is what the deployed
 * Jitsi (`prosody`, `token_verification`) already accepts:
 *
 *   iss = sub = aud = JITSI_APP_ID, `room`, `context.user`, `context.features`
 *
 * signed HS256 with JITSI_APP_SECRET.
 *
 * NOT fail-closed, on purpose, and this is the one place in the API where that
 * is true by design rather than by accident: with no credentials configured the
 * token is null and the panel joins a PUBLIC room. That is how a self-hosted
 * Jitsi behaves before its JWT module is turned on, and how the dev stack runs
 * against meet.jit.si. It protects a video room, not the client's records —
 * every route that reads data is still behind `requireOrg`.
 */
import { SignJWT } from 'jose'

/** The public server. It verifies tokens against 8x8's keys, never ours. */
const PUBLIC_DOMAIN = 'meet.jit.si'

/** Where the rooms live. The public server is the default. */
export const JITSI_DOMAIN = process.env.JITSI_DOMAIN?.trim() || PUBLIC_DOMAIN

const APP_ID = process.env.JITSI_APP_ID?.trim() ?? ''
const APP_SECRET = process.env.JITSI_APP_SECRET?.trim() ?? ''

/** Twelve hours, like the legacy signer: a consultation outlives an hour, and
 *  the token is only a door key to one room. */
const TTL = '12h'

export type JitsiUser = {
  id: string
  name: string
  email?: string
  /** Doctors are moderators; that is what unlocks recording and transcription
   *  on the Jitsi side. A patient joining from a link is not. */
  moderator: boolean
}

export type MeetingCredentials = {
  domain: string
  room: string
  /** null = the server has no JWT module configured, so the room is public. */
  jwt: string | null
  /** What the panel opens, and what a patient can be sent. */
  url: string
  moderator: boolean
}

/**
 * Whether this API can sign a token the configured server will accept.
 *
 * Credentials AND a server of our own. Sending a self-signed token to
 * meet.jit.si is worse than sending none: the public server verifies against
 * 8x8's keys, refuses ours, and the doctor is shown "Error de autenticación —
 * no tienes permiso para unirte a esta llamada" on a room that would have let
 * them straight in unauthenticated. Measured against meet.jit.si, 2026-09-06.
 *
 * So a half-configuration degrades to a public room and says so in the log,
 * where the operator can act on it, instead of at the consultation.
 */
export const isJitsiSecured = (): boolean =>
  Boolean(APP_ID && APP_SECRET) && JITSI_DOMAIN !== PUBLIC_DOMAIN

// Once, at boot: a warning per room would bury the logs of a busy clinic.
if (APP_ID && APP_SECRET && JITSI_DOMAIN === PUBLIC_DOMAIN) {
  console.warn(
    `[jitsi] JITSI_APP_ID/SECRET are set but JITSI_DOMAIN is ${PUBLIC_DOMAIN}, which cannot ` +
      'verify them — rooms will be public and unauthenticated. Point JITSI_DOMAIN at the ' +
      'server those credentials belong to, or clear them.',
  )
}

/**
 * Sign one room token. Returns null when Jitsi is unsecured — the caller then
 * joins the room without a token instead of failing to join at all.
 */
export async function signJitsiToken(room: string, user: JitsiUser): Promise<string | null> {
  if (!isJitsiSecured()) return null

  // Only a moderator gets the features: a token that hands recording to every
  // participant is how a waiting room ends up recording itself.
  const features = user.moderator
    ? {
        recording: true,
        livestreaming: true,
        transcription: true,
        'outbound-call': true,
      }
    : {
        recording: false,
        livestreaming: false,
        transcription: false,
        'outbound-call': false,
      }

  return new SignJWT({
    context: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email ?? '',
        avatar: '',
        moderator: user.moderator,
      },
      features,
    },
    room,
  })
    // `typ` is NOT optional here, whatever RFC 7519 says about it: jitsi's
    // luajwtjitsi rejects the token outright with "Invalid typ" when the header
    // lacks it (`if not header.typ or header.typ ~= "JWT"`), and jose does not
    // add one on its own. The room then drops every joiner into a reconnect
    // loop that reads as a network problem.
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(APP_ID)
    .setSubject(APP_ID)
    .setAudience(APP_ID)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime(TTL)
    // A jti, so a Jitsi that replays-protects can tell two tokens apart.
    .setJti(crypto.randomUUID())
    .sign(new TextEncoder().encode(APP_SECRET))
}

/** Everything the panel needs to open the room, in one object. */
export async function meetingFor(room: string, user: JitsiUser): Promise<MeetingCredentials> {
  return {
    domain: JITSI_DOMAIN,
    room,
    jwt: await signJitsiToken(room, user),
    url: `https://${JITSI_DOMAIN}/${room}`,
    moderator: user.moderator,
  }
}
