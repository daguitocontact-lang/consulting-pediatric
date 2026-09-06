/**
 * Shared test plumbing: a migrated database, a clean slate per file, and a
 * token the real auth path accepts.
 */
import { SignJWT, importPKCS8 } from 'jose'
import { sql } from '../src/lib/db'
import { runMigrations } from '../src/lib/migrate'

export const ORG = 'org_test'
export const OTHER_ORG = 'org_other'
export const USER = '00000000-0000-0000-0000-0000000000de'

/**
 * Migrate once per process.
 *
 * The migrations are the schema under test — running them here rather than
 * hand-writing a CREATE TABLE in the fixtures is what makes a broken migration
 * a failing test instead of a surprise on the next deploy.
 */
let migrated: Promise<void> | null = null
export function migrate(): Promise<void> {
  if (!migrated) migrated = runMigrations()
  return migrated
}

/** Empty the domain tables between files. Truncate, not DELETE: it resets fast
 *  and takes the FK-dependent rows with it. */
export async function truncate(): Promise<void> {
  await sql`TRUNCATE consultations, consultation_templates RESTART IDENTITY CASCADE`
}

/**
 * A token the API's own `authorize` accepts, signed with the throwaway key the
 * preload minted. Everything else about the check is real: RS256, the
 * `custom-panel` audience, the expiry.
 */
export async function token(
  p: { org?: string; user?: string; expiresIn?: string } = {},
): Promise<string> {
  const key = await importPKCS8(process.env.TEST_JWT_PRIVATE_KEY!, 'RS256')
  return new SignJWT({ org_id: p.org ?? ORG, sub: p.user ?? USER })
    .setProtectedHeader({ alg: 'RS256' })
    .setAudience('custom-panel')
    .setIssuedAt()
    .setExpirationTime(p.expiresIn ?? '5m')
    .sign(key)
}

export const auth = async (p?: Parameters<typeof token>[0]) => ({
  authorization: `Bearer ${await token(p)}`,
})

/**
 * Insert a consultation directly, so a listing test can set up ten rows without
 * ten HTTP calls. `createdAt` is settable: half these tests are about ordering
 * and the day filter, and both need rows that are not all "now".
 */
export async function seedConsultation(p: {
  org?: string
  name?: string | null
  patientName?: string | null
  mode?: string
  status?: string
  durationSeconds?: number
  templateId?: string | null
  createdAt?: string
}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO consultations
      (org_id, name, patient_name, mode, status, duration_seconds, template_id, created_by,
       created_at)
    VALUES
      (${p.org ?? ORG}, ${p.name ?? null}, ${p.patientName ?? null}, ${p.mode ?? 'in_person'},
       ${p.status ?? 'initial'}, ${p.durationSeconds ?? 0}, ${p.templateId ?? null},
       ${USER}::uuid, ${p.createdAt ?? new Date().toISOString()}::timestamptz)
    RETURNING id
  `
  return row!.id
}
