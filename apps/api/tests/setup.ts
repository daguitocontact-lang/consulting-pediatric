/**
 * Preloaded before every test file (bunfig.toml).
 *
 * Two things have to be true BEFORE any source module is imported: `lib/db`
 * reads DATABASE_URL at import time and `lib/auth` refuses to load without
 * DAGUITO_ORG_IDS. A test that imported a repo first would take the dev
 * database — or fail to boot at all — so the environment is set here, in a
 * preload, rather than at the top of each file.
 *
 * The database is a REAL Postgres, not a mock: every rule these tests are about
 * (the draft filter, the COALESCE the name column sorts by, the day filter, the
 * org scope) lives in SQL, and a mocked driver would only prove the test agrees
 * with itself. Point TEST_DATABASE_URL at any throwaway database; the compose
 * stack in infra/ is the obvious one.
 */
import { afterAll } from 'bun:test'
import { generateKeyPair, exportSPKI, exportPKCS8 } from 'jose'

const DEFAULT_URL = 'postgres://pediatric_app:pediatric@localhost:5452/pediatric_test'

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_URL
// The compose Postgres speaks plain TCP; RDS is the one that requires TLS.
process.env.DB_SSL = 'disable'
process.env.NODE_ENV = 'test'

// A throwaway RS256 pair, minted per run. The verification path under test is
// the real one — signature, audience, expiry — only the key is local, exactly
// like scripts/dev/mint-token.ts.
const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
process.env.DAGUITO_JWT_PUBLIC_KEY = await exportSPKI(publicKey)
process.env.TEST_JWT_PRIVATE_KEY = await exportPKCS8(privateKey)

// The tenant allow-list the API is fail-closed on. Two orgs, so a test can
// prove that a valid token for the OTHER one is refused rather than merely
// unauthenticated.
process.env.DAGUITO_ORG_IDS = 'org_test,org_other'
process.env.ALLOWED_ORIGIN = 'http://localhost:4112'
// No outbound calls from a test run: an unset base is what makes the boot-time
// custom-field registration skip itself.
delete process.env.DAGUITO_API_BASE
delete process.env.DAGUITO_API_KEY

/**
 * Close the pool ONCE, when the whole run is over.
 *
 * Every test file imports the same `sql` — bun runs them in one process — so an
 * `afterAll(closeDb)` inside a file ends the connection for the files after it
 * ("write CONNECTION_ENDED"). A hook registered from the preload belongs to the
 * run, not to a file, which is where this ends up being correct.
 */
afterAll(async () => {
  const { sql } = await import('../src/lib/db')
  await sql.end({ timeout: 5 })
})
