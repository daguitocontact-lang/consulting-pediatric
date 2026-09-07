import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { readVersion, dbOk } from './lib/db'
import { runMigrations } from './lib/migrate'
import { syncContactFields } from './daguito'
import { requireOrg } from './lib/guard'
import { toolSpecs, invokeTool } from './agent/functions'
import { PANEL_ORIGIN } from './lib/panel-origin'
import { consultationsModule } from './consultations'
import { webhooksModule } from './webhooks'

const PORT = Number(process.env.PORT ?? 8080)
// Only Daguito's web may call this API from a browser. The static panel lives in
// R2 (not here) — this service is JSON-only. Data is additionally token-gated.
//
// Comma-separated: prod passes exactly one origin, but local dev needs several
// at once (the Daguito web on localhost, its *-<user>.daguito.com tunnel, and
// the panel's own tunnel when it is opened standalone).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'https://app.daguito.com'

// The patient's page is OURS — published by our own deploy to our own bucket —
// and it is the only client of /public/consultations/:id/patient/*. So its
// origin is allowed automatically rather than left to ALLOWED_ORIGIN: forgetting
// to list it breaks the patient's microphone with a CORS error in a console
// nobody on a phone will ever open, on a page that otherwise looks fine. It is
// resolved in ONE place (lib/panel-origin.ts) with the link the doctor copies,
// so the two can never point at different hosts.
const allowedOrigins = [...ALLOWED_ORIGIN.split(','), PANEL_ORIGIN]
  .map((o) => o.trim())
  .filter(Boolean)
  .filter((origin, index, all) => all.indexOf(origin) === index)

// Apply pending migrations on boot (idempotent, advisory-locked). Best-effort:
// /health stays up even if the DB is briefly unreachable, so ECS keeps the task.
await runMigrations().catch((err) => console.error('[migrate] failed (continuing):', err))

// The same idea one level up: the contact fields this custom's forms need are
// registered in Daguito's CRM on boot, so a fresh org (or a fresh deploy)
// arrives with the form complete instead of N manual entries in Ajustes.
// Idempotent and non-fatal — it never keeps the API from serving.
await syncContactFields()

const app = new Elysia()
  /**
   * A malformed id is a bad request, not a crash.
   *
   * Every repo casts path ids with `::uuid`, so `DELETE /api/things/tmp-1`
   * reaches Postgres and comes back as `invalid input syntax for type uuid` —
   * which Elysia turns into a bare HTTP 500 in the operator's face. Postgres
   * says 22P02 for exactly this, and one hook here covers every module rather
   * than a uuid check bolted onto each route that takes an id.
   */
  .onError(({ error, set }) => {
    const code = (error as { code?: string })?.code
    if (code === '22P02') {
      set.status = 400
      return { error: 'invalid id' }
    }
  })
  .use(
    cors({
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      credentials: false,
      // The panel names a downloaded file from what the API sent. A response
      // header is invisible to cross-origin JS unless it is exposed, so without
      // this every download saves under the fallback name the caller guessed.
      exposeHeaders: ['content-disposition'],
      // Every call carries an Authorization header, so each one costs a
      // preflight AND a GET. The plugin's default caches the preflight for 5s,
      // shorter than a polling page's interval; ten minutes halves the
      // requests crossing the tunnel.
      maxAge: 600,
    }),
  )
  // Liveness — used by ECS/monitoring. No auth, no DB.
  .get('/health', () => ({ ok: true }))

  // Proves the whole chain: Daguito(web) -> this API(ECS) -> RDS. Gated by the
  // signed token so only Daguito-authenticated users see it.
  .get('/api/status', async ({ request, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    const [version, ok] = await Promise.all([readVersion(), dbOk()])
    return { status: 'building', version, db_ok: ok, ts: new Date().toISOString() }
  })

  // ── The custom's domain ───────────────────────────────────────────────
  // Each module is a folder under src/ with `routes/` + `repos/` and an
  // index.ts exporting one Elysia instance. EVERY handler starts with
  // `const guard = await requireOrg(request)` (see lib/guard.ts) and every
  // query filters by `guard.orgId`. Never call `verifyDaguitoToken` directly:
  // the org check is what keeps another Daguito tenant's validly signed token
  // out of this client's data.
  .use(consultationsModule)

  // ── Inbound from Daguito: webhooks ───────────────────────────────────
  // Not token-gated like the rest — the caller is Daguito's delivery worker.
  // It authenticates with an HMAC over the raw body (src/webhooks).
  .use(webhooksModule)

  // ── Agent functions: tools the Daguito agent calls, running HERE ──────
  .get('/agent/functions', async ({ request, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    return { functions: toolSpecs }
  })
  .post('/agent/functions/:name', async ({ request, params, body, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    try {
      const args = (body as Record<string, unknown>) ?? {}
      return {
        ok: true,
        result: await invokeTool(params.name, args, {
          orgId: guard.orgId,
          userId: guard.userId,
          userName: guard.userName,
        }),
      }
    } catch (err) {
      set.status = 400
      return { ok: false, error: err instanceof Error ? err.message : 'tool failed' }
    }
  })

  // NOTE: the micro-frontend panel is NOT served here — it lives in R2 + CDN
  // (pediatric-panel.daguito.com). This service is API-only.
  .listen(PORT)

console.log(`[pediatric-api] listening on :${PORT} · origins: ${allowedOrigins.join(', ')}`)

export type App = typeof app
