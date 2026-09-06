// DEV ONLY. Feeds the harness (src/dev/host.ts) the same credentials the rest of
// the dev stack already agrees on, so nobody has to paste a token by hand.
//
// Everything here comes from files the stack already owns:
//   infra/.env                 -> DAGUITO_ORG_IDS, the tenant the API accepts
//   infra/.dev-jwt/private.pem -> the throwaway RS256 key that
//                                 `bun scripts/dev/mint-token.ts` generated, whose
//                                 public half is in infra/.env and therefore the
//                                 one the API verifies against.
//
// The token is minted PER REQUEST, so the harness can never show an expired one
// — the failure mode of writing a token into .env and reading it back hours
// later. Signing is plain node:crypto (a JWT is base64url header.payload plus an
// RSA-SHA256 signature); the panel deliberately gains no crypto dependency for a
// dev-only path.
//
// This is an `apply: 'serve'` plugin, not a `define`: a build-time constant would
// bake a signed token into dist/panel.js, which is uploaded to R2 and served to
// the world. A dev-server middleware cannot leak into the bundle at all.
import { createSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const AUDIENCE = 'custom-panel'
// Same uuid the minter uses: `sub` lands in uuid columns (created_by), and a
// readable handle verifies fine and then fails every write with a cast error.
const USER_ID = '00000000-0000-0000-0000-0000000000de'
const TTL_SECONDS = 12 * 60 * 60

export const DEV_CREDENTIALS_URL = '/@pediatric-dev-credentials'

function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, '')
  }
  return out
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url')

function mintToken(privatePem: string, orgId: string): string {
  if (!existsSync(privatePem)) return ''
  const now = Math.floor(Date.now() / 1000)
  // Header matches apps/api/scripts/dev/mint-token.ts exactly: the API verifies
  // with jose either way, but keeping the two minters identical means a token
  // from one is indistinguishable from the other while debugging.
  const header = b64url(JSON.stringify({ alg: 'RS256' }))
  const payload = b64url(
    JSON.stringify({ org_id: orgId, sub: USER_ID, aud: AUDIENCE, iat: now, exp: now + TTL_SECONDS }),
  )
  const signingInput = `${header}.${payload}`
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(readFileSync(privatePem, 'utf8'))
  return `${signingInput}.${b64url(signature)}`
}

export type DevCredentials = {
  /** First entry of DAGUITO_ORG_IDS — the tenant this API actually serves. */
  orgId: string
  /** Empty when infra/.dev-jwt/ has no key yet (run the minter once). */
  token: string
  /** Why the token is empty, so the harness can say so instead of just 401ing. */
  reason: string
}

/** `repoRoot` is the repo root; infra/ hangs off it. */
export function devCredentials(repoRoot: string): DevCredentials {
  const envFile = path.join(repoRoot, 'infra', '.env')
  const privatePem = path.join(repoRoot, 'infra', '.dev-jwt', 'private.pem')

  const env = readEnvFile(envFile)
  const orgId = (env.DAGUITO_ORG_IDS ?? 'org_dev').split(',')[0]!.trim() || 'org_dev'
  const token = mintToken(privatePem, orgId)

  const reason = !existsSync(envFile)
    ? 'infra/.env no existe — corre: cp infra/.env.example infra/.env'
    : token
      ? ''
      : 'sin llave de dev — corre: cd apps/api && bun scripts/dev/mint-token.ts'

  return { orgId, token, reason }
}

/**
 * Serves devCredentials() at DEV_CREDENTIALS_URL. Dev server only.
 *
 * The repo root is derived from Vite's own `root` (apps/panel) rather than
 * `__dirname`: Vite bundles the config together with its relative imports, so
 * `__dirname` here would point at the config's directory, not this file's.
 */
export const devCredentialsPlugin: Plugin = {
  name: 'pediatric-dev-credentials',
  apply: 'serve',
  configureServer(server) {
    const repoRoot = path.resolve(server.config.root, '..', '..')
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== DEV_CREDENTIALS_URL) return next()
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(devCredentials(repoRoot)))
    })
  },
}
