import { sql } from './db'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Apply migrations/*.sql on boot, tracked in a _migrations ledger so each file
// runs once. Idempotent + safe to run from every task (advisory lock serializes
// concurrent boots). Migrations live next to the API so a new .sql ships with a
// deploy — no separate migration step.
const DIR = join(import.meta.dir, '..', '..', 'migrations')
const LOCK_KEY = 918273645 // arbitrary, stable

export async function runMigrations(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`
  // Serialize across concurrently-booting tasks.
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`
  try {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    for (const name of files) {
      const done = await sql`SELECT 1 FROM _migrations WHERE name = ${name}`
      if (done.length) continue
      const ddl = readFileSync(join(DIR, name), 'utf8')
      await sql.unsafe(ddl)
      await sql`INSERT INTO _migrations (name) VALUES (${name}) ON CONFLICT DO NOTHING`
      console.log(`[migrate] applied ${name}`)
    }
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`
  }
}
