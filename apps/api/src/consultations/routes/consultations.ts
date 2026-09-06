/**
 * Consultation routes — everything the panel's Consultas section calls.
 *
 *   GET    /api/consultations           → the paginated listing (+ tab counts)
 *   POST   /api/consultations           → create
 *   GET    /api/consultations/:id       → one
 *   PATCH  /api/consultations/:id       → rename, restatus, retemplate
 *   POST   /api/consultations/:id/consent  → stamp the patient's consent
 *   POST   /api/consultations/:id/duration → add recorded seconds
 *   DELETE /api/consultations/:id       → erase one created by mistake
 *
 * Every handler starts with `requireOrg` and every query carries `guard.orgId`:
 * Daguito signs `custom-panel` tokens for all its orgs with one key, so the
 * signature alone does not say whose data this is.
 */
import { Elysia, t } from 'elysia'
import { requireOrg } from '../../lib/guard'
import { safeError } from '../../lib/errors'
import { CONSULTATION_MODE, CONSULTATION_SORT, CONSULTATION_STATUS } from '../../lib/constants'
import type { ConsultationMode, ConsultationSort } from '../../lib/constants'
import {
  addDuration,
  countByMode,
  createConsultation,
  deleteConsultation,
  getConsultation,
  listConsultations,
  recordConsent,
  updateConsultation,
} from '../repos/consultations-repo'

const modeUnion = t.Union(CONSULTATION_MODE.map((m) => t.Literal(m)))
const statusUnion = t.Union(CONSULTATION_STATUS.map((s) => t.Literal(s)))

const patchBody = {
  name: t.Optional(t.Nullable(t.String())),
  patient_contact_id: t.Optional(t.Nullable(t.String())),
  patient_name: t.Optional(t.Nullable(t.String())),
  language: t.Optional(t.String({ minLength: 2, maxLength: 8 })),
  mode: t.Optional(modeUnion),
  status: t.Optional(statusUnion),
  template_id: t.Optional(t.Nullable(t.String())),
  notes: t.Optional(t.Nullable(t.String())),
}

/** A YYYY-MM-DD day from the picker; anything else is ignored, not rejected. */
const DAY = /^\d{4}-\d{2}-\d{2}$/

const asMode = (value?: string): ConsultationMode | undefined =>
  CONSULTATION_MODE.includes(value as ConsultationMode) ? (value as ConsultationMode) : undefined

const asSort = (value?: string): ConsultationSort | undefined =>
  CONSULTATION_SORT.includes(value as ConsultationSort) ? (value as ConsultationSort) : undefined

/**
 * A query-string number, or the fallback.
 *
 * `page=abc` used to reach Postgres as NaN and come back a 500. A listing is a
 * read: a nonsense page is page one, not an error page.
 */
function asNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export const consultationsRoutes = new Elysia({ prefix: '/api/consultations' })
  .get('/', async ({ request, query, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    const filters = {
      q: query.q?.trim() || undefined,
      date: query.date && DAY.test(query.date) ? query.date : undefined,
    }
    const mode = asMode(query.mode)
    // The counts ignore the tab (they are what the tabs are labelled with) but
    // honour the search and the day — a tab saying 12 while its table shows 3
    // filtered rows is the bug this shape avoids.
    const [list, counts] = await Promise.all([
      listConsultations(guard.orgId, {
        page: asNumber(query.page, 1),
        limit: asNumber(query.limit, 10),
        sort: asSort(query.sort),
        dir: query.dir === 'asc' ? 'asc' : 'desc',
        mode,
        ...filters,
      }),
      countByMode(guard.orgId, filters),
    ])
    return { ...list, counts }
  })

  .post(
    '/',
    async ({ request, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      try {
        set.status = 201
        return {
          consultation: await createConsultation(
            guard.orgId,
            {
              patientContactId: body.patient_contact_id ?? null,
              patientName: body.patient_name ?? null,
              name: body.name ?? null,
              language: body.language,
              mode: body.mode,
              status: body.status,
              templateId: body.template_id ?? null,
              notes: body.notes ?? null,
            },
            guard.userId,
          ),
        }
      } catch (err) {
        // A template id from another org fails the FK; that is a bad request,
        // not a server fault, and the driver's message names the constraint.
        const { status, body: safe } = safeError(err, 400, 'invalid_consultation')
        set.status = status
        return safe
      }
    },
    { body: t.Object(patchBody) },
  )

  .get('/:id', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    const consultation = await getConsultation(guard.orgId, params.id)
    if (!consultation) {
      set.status = 404
      return { error: 'not found' }
    }
    return { consultation }
  })

  .patch(
    '/:id',
    async ({ request, params, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      try {
        const consultation = await updateConsultation({
          orgId: guard.orgId,
          id: params.id,
          patch: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.patient_contact_id !== undefined
              ? { patientContactId: body.patient_contact_id }
              : {}),
            ...(body.patient_name !== undefined ? { patientName: body.patient_name } : {}),
            ...(body.language !== undefined ? { language: body.language } : {}),
            ...(body.mode !== undefined ? { mode: body.mode } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.template_id !== undefined ? { templateId: body.template_id } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
          },
        })
        if (!consultation) {
          // Not found OR another org's: the same answer on purpose. A 403 here
          // would confirm the id exists somewhere.
          set.status = 404
          return { error: 'not found' }
        }
        return { consultation }
      } catch (err) {
        const { status, body: safe } = safeError(err, 400, 'invalid_consultation')
        set.status = status
        return safe
      }
    },
    { body: t.Object(patchBody) },
  )

  .post('/:id/consent', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    const consultation = await recordConsent(guard.orgId, params.id)
    if (!consultation) {
      set.status = 404
      return { error: 'not found' }
    }
    return { consultation }
  })

  .post(
    '/:id/duration',
    async ({ request, params, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      const consultation = await addDuration({
        orgId: guard.orgId,
        id: params.id,
        seconds: body.seconds,
      })
      if (!consultation) {
        set.status = 404
        return { error: 'not found' }
      }
      return { consultation }
    },
    { body: t.Object({ seconds: t.Number({ minimum: 0 }) }) },
  )

  .delete('/:id', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    if (!(await deleteConsultation(guard.orgId, params.id))) {
      set.status = 404
      return { error: 'not found' }
    }
    return { ok: true }
  })
