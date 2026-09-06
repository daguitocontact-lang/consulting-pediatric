import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

// Single shared pool. RDS's default parameter group rejects unencrypted
// connections (pg_hba `hostssl` only) — 'require' encrypts without pinning the
// Amazon RDS CA, which we don't ship in the image. The local dev Postgres
// (infra/docker-compose.dev.yml) speaks plain TCP and sets DB_SSL=disable;
// anything else keeps the prod default, so a missing env var never downgrades
// a real connection.
const ssl = process.env.DB_SSL === 'disable' ? false : ('require' as const)

export const sql = postgres(url, {
  max: 5,
  ssl,
  // The migrations are deliberately idempotent (CREATE TABLE IF NOT EXISTS), so
  // Postgres raises an "already exists, skipping" NOTICE on every boot. The
  // driver prints those by default, which buries the real logs — loudest in dev,
  // where `bun --watch` reboots on every save. Drop just those two codes;
  // anything else Postgres wants to tell us still surfaces.
  onnotice: (notice) => {
    if (notice.code !== '42P07' && notice.code !== '42710') console.warn('[pg]', notice.message)
  },
})

/** The deployed server version, stored in the DB so the panel can prove the
 *  full chain (web -> api -> db) is wired. Seeded by migration 0001. */
export async function readVersion(): Promise<string | null> {
  const rows = await sql<{ value: string }[]>`
    SELECT value FROM app_meta WHERE key = 'version' LIMIT 1
  `
  return rows[0]?.value ?? null
}

export async function dbOk(): Promise<boolean> {
  try {
    await sql`SELECT 1`
    return true
  } catch {
    return false
  }
}
