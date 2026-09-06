import { SERVED_ORG_IDS } from '../lib/auth'
import { daguitoFetch, isConfigured } from './lib/client'
import { CONTACT_FIELDS, keyFromLabel, type ContactFieldSpec } from './lib/contact-fields'

/**
 * Registers the custom's contact fields in Daguito, at boot.
 *
 * The client's form asks for a document, a split name and a postal address, and
 * Daguito's CRM has no column for any of them: they live in the org's custom
 * field definitions, which the operator would otherwise have to create by hand
 * in Ajustes — nine times, in the right order, for every org. Doing it from the
 * boot path is what makes a new deploy (or a new tenant in DAGUITO_ORG_IDS)
 * arrive with the form already complete.
 *
 * Idempotent by KEY, not by label: a second boot finds the nine fields and
 * writes nothing. A field an operator edited afterwards is left exactly as they
 * left it — this only ever adds what is missing.
 */

type RemoteField = {
  id: string
  key: string
  label: string
  type: string
  options: string[]
  required: boolean
}

const path = (orgId: string) => `/organizations/${encodeURIComponent(orgId)}/custom-fields`

async function listContactFields(orgId: string): Promise<RemoteField[]> {
  const res = await daguitoFetch<{ fields: RemoteField[] }>(`${path(orgId)}?entity=contact`)
  return res.fields ?? []
}

async function createContactField(orgId: string, spec: ContactFieldSpec): Promise<void> {
  await daguitoFetch(path(orgId), {
    method: 'POST',
    body: {
      entity: 'contact',
      label: spec.label,
      type: spec.type,
      options: spec.options ? [...spec.options] : undefined,
      required: spec.required ?? false,
    },
  })
}

/**
 * A field that is already there but no longer looks like the spec.
 *
 * Reported, never corrected: the operator can change a field from Daguito's
 * settings, and a boot that silently rewrote their edit every morning would be
 * worse than a log line. Options are compared as a set — Daguito keeps the
 * order the CRM shows them in, which is theirs to arrange.
 */
function describeDrift(spec: ContactFieldSpec, field: RemoteField): string | null {
  if (field.type !== spec.type) return `type ${field.type} (spec says ${spec.type})`
  const wanted = new Set(spec.options ?? [])
  const missing = [...wanted].filter((o) => !field.options.includes(o))
  return missing.length ? `missing options ${missing.join(', ')}` : null
}

async function syncOrg(orgId: string): Promise<void> {
  const existing = await listContactFields(orgId)
  const byKey = new Map(existing.map((f) => [f.key, f]))

  const missing: ContactFieldSpec[] = []
  for (const spec of CONTACT_FIELDS) {
    const found = byKey.get(keyFromLabel(spec.label))
    if (!found) {
      missing.push(spec)
      continue
    }
    const drift = describeDrift(spec, found)
    if (drift) console.warn(`[daguito] contact field "${found.label}" org=${orgId}: ${drift}`)
  }

  if (!missing.length) {
    console.log(`[daguito] contact fields org=${orgId}: all ${CONTACT_FIELDS.length} already there`)
    return
  }

  // In spec order, one at a time: Daguito files a new field at
  // `position = existing.length`, so a sequential loop is what puts the form in
  // the order it is read — parallel calls would race for the same positions.
  for (const spec of missing) {
    await createContactField(orgId, spec)
  }
  console.log(
    `[daguito] contact fields org=${orgId}: registered ${missing.length} ` +
      `(${missing.map((f) => f.label).join(', ')})`,
  )
}

/**
 * Called from the boot path. Never throws: a Daguito that is unreachable, or a
 * service user that lost its role, must not stop this API from serving its own
 * data — the fields are still registered on the next boot.
 */
export async function syncContactFields(): Promise<void> {
  if (!isConfigured()) {
    console.log('[daguito] contact fields: skipped (no DAGUITO_API_BASE / service user)')
    return
  }
  for (const orgId of SERVED_ORG_IDS) {
    try {
      await syncOrg(orgId)
    } catch (err) {
      console.error(`[daguito] contact fields org=${orgId} failed (continuing):`, err)
    }
  }
}

export { CONTACT_FIELDS, keyFromLabel } from './lib/contact-fields'
