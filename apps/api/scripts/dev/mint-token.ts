/**
 * Mint a Daguito-shaped token for LOCAL DEV.
 *
 *   cd apps/api && bun scripts/dev/mint-token.ts [orgId] [userId] [ttl]
 *
 * In prod, tokens are signed by Daguito with its RS256 private key and this API
 * only ever holds the public half. Locally there is no Daguito to mint them, so
 * this script keeps a throwaway keypair under infra/.dev-jwt/ (gitignored),
 * writes the public half into infra/.env as DAGUITO_JWT_PUBLIC_KEY (base64 —
 * env files can't hold newlines; auth.ts decodes it), and prints a signed token.
 *
 * The API's verification path is NOT weakened: it still checks a real RS256
 * signature, the `custom-panel` audience and expiry — just against a local key.
 * To exercise Daguito's own dev tokens instead, put Daguito's public key in
 * infra/.env and skip this script.
 */
import { generateKeyPair, exportPKCS8, exportSPKI, importPKCS8, SignJWT } from 'jose'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const AUDIENCE = 'custom-panel'
const ROOT = join(import.meta.dir, '..', '..', '..', '..') // apps/api/scripts/dev -> repo root
const KEY_DIR = join(ROOT, 'infra', '.dev-jwt')
const PRIVATE_PEM = join(KEY_DIR, 'private.pem')
const PUBLIC_PEM = join(KEY_DIR, 'public.pem')
const ENV_FILE = join(ROOT, 'infra', '.env')

const orgId = process.argv[2] ?? 'org_dev'
// A uuid, not a readable handle: `sub` lands in `created_by` / `changed_by`,
// which are uuid columns pointing at the core's users.id. A token signed with
// "user_dev" verifies fine and then fails every write with a Postgres cast
// error — the kind of dev-only difference that is found at the worst moment.
const userId = process.argv[3] ?? '00000000-0000-0000-0000-0000000000de'
const ttl = process.argv[4] ?? '12h'

// Reuse the existing keypair so a token minted yesterday still verifies against
// the key already sitting in infra/.env.
if (!existsSync(PRIVATE_PEM)) {
  mkdirSync(KEY_DIR, { recursive: true })
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  writeFileSync(PRIVATE_PEM, await exportPKCS8(privateKey), { mode: 0o600 })
  writeFileSync(PUBLIC_PEM, await exportSPKI(publicKey))
  console.log(`[mint] generated dev keypair at infra/.dev-jwt/`)
}

const publicB64 = Buffer.from(readFileSync(PUBLIC_PEM, 'utf8')).toString('base64')

// Upsert DAGUITO_JWT_PUBLIC_KEY in infra/.env so the stack picks it up on the
// next `docker compose up`. Only that one line is touched.
if (existsSync(ENV_FILE)) {
  const lines = readFileSync(ENV_FILE, 'utf8').split('\n')
  const idx = lines.findIndex((l) => l.startsWith('DAGUITO_JWT_PUBLIC_KEY='))
  // APPEND, never replace. The API reads this as a comma-separated list (see
  // lib/auth.ts), so the dev key can sit next to Daguito's instead of evicting
  // it — which is what used to turn the panel inside the real host into a 401
  // the moment anyone minted a token for a curl.
  const existing = idx >= 0 ? (lines[idx]!.split('=')[1] ?? '') : ''
  const keys = existing
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  if (!keys.includes(publicB64)) keys.push(publicB64)
  const line = `DAGUITO_JWT_PUBLIC_KEY=${keys.join(',')}`
  if (idx >= 0) lines[idx] = line
  else lines.push(line)
  writeFileSync(ENV_FILE, lines.join('\n'))
  console.log(
    keys.length > 1
      ? `[mint] added the dev key to infra/.env (${keys.length} keys accepted)`
      : `[mint] wrote DAGUITO_JWT_PUBLIC_KEY into infra/.env`,
  )
} else {
  console.log(`[mint] infra/.env not found — add this line yourself:`)
  console.log(`DAGUITO_JWT_PUBLIC_KEY=${publicB64}`)
}

const token = await new SignJWT({ org_id: orgId })
  .setProtectedHeader({ alg: 'RS256' })
  .setSubject(userId)
  .setAudience(AUDIENCE)
  .setIssuedAt()
  .setExpirationTime(ttl)
  .sign(await importPKCS8(readFileSync(PRIVATE_PEM, 'utf8'), 'RS256'))

console.log(`\n[mint] org=${orgId} user=${userId} ttl=${ttl}\n`)
console.log(token)
console.log(`\nTry it:\n  curl -s localhost:${process.env.API_PORT ?? 4101}/api/status \\\n    -H "authorization: Bearer ${token}"\n`)
console.log('Restart the api container so it reloads the key: docker compose -f infra/docker-compose.dev.yml up -d api\n')
