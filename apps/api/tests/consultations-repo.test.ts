/**
 * The listing rules, against a real Postgres.
 *
 * These are the rules the legacy app carried in a GORM query and could only be
 * checked by looking at the screen: the draft filter, the COALESCE the name
 * column sorts and searches by, the day filter, and the org scope that replaced
 * its per-user one.
 */
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  addDuration,
  countByMode,
  createConsultation,
  deleteConsultation,
  getConsultation,
  listConsultations,
  recordConsent,
  updateConsultation,
} from '../src/consultations/repos/consultations-repo'
import { createTemplate, deleteTemplate, listTemplates } from '../src/consultations/repos/templates-repo'
import { ORG, OTHER_ORG, USER, migrate, seedConsultation, truncate } from './helpers'

beforeAll(migrate)
beforeEach(truncate)

const page = { page: 1, limit: 10 }

describe('listing', () => {
  test('hides drafts — a half-finished create is not a consultation', async () => {
    await seedConsultation({ name: 'Real' })
    await seedConsultation({ name: 'Half typed', status: 'draft' })

    const result = await listConsultations(ORG, page)

    expect(result.total).toBe(1)
    expect(result.data.map((row) => row.name)).toEqual(['Real'])
  })

  test('only this org sees its rows', async () => {
    await seedConsultation({ name: 'Ours' })
    await seedConsultation({ name: 'Theirs', org: OTHER_ORG })

    const ours = await listConsultations(ORG, page)
    const theirs = await listConsultations(OTHER_ORG, page)

    expect(ours.data.map((row) => row.name)).toEqual(['Ours'])
    expect(theirs.data.map((row) => row.name)).toEqual(['Theirs'])
  })

  test('newest first by default', async () => {
    await seedConsultation({ name: 'older', createdAt: '2026-01-01T10:00:00Z' })
    await seedConsultation({ name: 'newer', createdAt: '2026-03-01T10:00:00Z' })

    const result = await listConsultations(ORG, page)

    expect(result.data.map((row) => row.name)).toEqual(['newer', 'older'])
  })

  test('sorts by the name it SHOWS: the title, or the patient when there is none', async () => {
    await seedConsultation({ name: null, patientName: 'ana' })
    await seedConsultation({ name: 'zulema', patientName: 'aaa' })
    await seedConsultation({ name: 'mario', patientName: null })

    const asc = await listConsultations(ORG, { ...page, sort: 'name', dir: 'asc' })

    // 'zulema' sorts last despite its patient being first alphabetically: the
    // column renders the title, so the title is what it sorts by.
    expect(asc.data.map((row) => row.name ?? row.patient_name)).toEqual(['ana', 'mario', 'zulema'])
  })

  test('a row with no name at all sorts last, both directions', async () => {
    await seedConsultation({ name: null, patientName: null })
    await seedConsultation({ name: 'named' })

    const asc = await listConsultations(ORG, { ...page, sort: 'name', dir: 'asc' })
    const desc = await listConsultations(ORG, { ...page, sort: 'name', dir: 'desc' })

    expect(asc.data[0]!.name).toBe('named')
    expect(desc.data[0]!.name).toBe('named')
  })

  test('search matches the patient name too, case-insensitively', async () => {
    await seedConsultation({ name: null, patientName: 'María Camila' })
    await seedConsultation({ name: 'Control anual' })

    expect((await listConsultations(ORG, { ...page, q: 'maría' })).total).toBe(1)
    expect((await listConsultations(ORG, { ...page, q: 'CONTROL' })).total).toBe(1)
    expect((await listConsultations(ORG, { ...page, q: 'nobody' })).total).toBe(0)
  })

  test('search ignores accents in both directions', async () => {
    await seedConsultation({ name: null, patientName: 'María Camila' })
    await seedConsultation({ name: 'Peñaloza' })

    // Typing the accent is the exception, not the rule: "maria" has to find
    // "María", and "PENALOZA" has to find "Peñaloza".
    expect((await listConsultations(ORG, { ...page, q: 'maria' })).total).toBe(1)
    expect((await listConsultations(ORG, { ...page, q: 'PENALOZA' })).total).toBe(1)
    // And the accented spelling still finds the accented row.
    expect((await listConsultations(ORG, { ...page, q: 'peñaloza' })).total).toBe(1)
  })

  test('sorts by the name as it is READ, not as it is encoded', async () => {
    await seedConsultation({ name: null, patientName: 'maría camila' })
    await seedConsultation({ name: 'Sofía Rojas' })
    await seedConsultation({ name: 'Álvaro' })

    const asc = await listConsultations(ORG, { ...page, sort: 'name', dir: 'asc' })

    // The database collation puts uppercase before lowercase, which had
    // "maría camila" sorting after "Sofía Rojas"; and "Álvaro" would land past
    // Z. Folding fixes both.
    expect(asc.data.map((row) => row.name ?? row.patient_name)).toEqual([
      'Álvaro',
      'maría camila',
      'Sofía Rojas',
    ])
  })

  test('the day filter is a calendar day, and ANDs with the search', async () => {
    await seedConsultation({ name: 'on the day', createdAt: '2026-02-10T23:30:00Z' })
    await seedConsultation({ name: 'next day', createdAt: '2026-02-11T00:30:00Z' })

    const day = await listConsultations(ORG, { ...page, date: '2026-02-10' })
    expect(day.data.map((row) => row.name)).toEqual(['on the day'])

    const both = await listConsultations(ORG, { ...page, date: '2026-02-10', q: 'next' })
    expect(both.total).toBe(0)
  })

  test('the mode filter is applied BEFORE the page, so a tab pages properly', async () => {
    for (let i = 0; i < 12; i++) await seedConsultation({ name: `video ${i}`, mode: 'video' })
    for (let i = 0; i < 3; i++) await seedConsultation({ name: `office ${i}`, mode: 'in_person' })

    const first = await listConsultations(ORG, { page: 1, limit: 10, mode: 'video' })
    const second = await listConsultations(ORG, { page: 2, limit: 10, mode: 'video' })

    // This is the legacy bug the port fixes: it paginated first and filtered the
    // ten rows it got, so the second page of a tab could come back empty while
    // the pager still offered it.
    expect(first.data).toHaveLength(10)
    expect(second.data).toHaveLength(2)
    expect(first.total).toBe(12)
    expect(second.data.every((row) => row.mode === 'video')).toBe(true)
  })

  test('the count and the page agree on the filter', async () => {
    await seedConsultation({ name: 'match me', mode: 'video' })
    await seedConsultation({ name: 'not me', mode: 'in_person' })
    await seedConsultation({ name: 'draft', mode: 'video', status: 'draft' })

    const result = await listConsultations(ORG, { ...page, mode: 'video', q: 'match' })

    expect(result.total).toBe(result.data.length)
    expect(result.total).toBe(1)
  })

  test('a nonsense page comes back empty rather than throwing', async () => {
    await seedConsultation({ name: 'only one' })

    const result = await listConsultations(ORG, { page: 9, limit: 10 })

    expect(result.data).toEqual([])
    // The total still says how far back to go — that is what the pager needs.
    expect(result.total).toBe(1)
  })

  test('limit is clamped, so ?limit=100000 cannot ask for the table', async () => {
    await seedConsultation({ name: 'one' })
    const result = await listConsultations(ORG, { page: 1, limit: 100_000 })
    expect(result.limit).toBe(100)
  })

  test('tab counts ignore the tab but honour the search', async () => {
    await seedConsultation({ name: 'ana video', mode: 'video' })
    await seedConsultation({ name: 'ana office', mode: 'in_person' })
    await seedConsultation({ name: 'beto video', mode: 'video' })
    await seedConsultation({ name: 'draft', mode: 'video', status: 'draft' })

    expect(await countByMode(ORG, {})).toMatchObject({ all: 3, video: 2, in_person: 1 })
    expect(await countByMode(ORG, { q: 'ana' })).toMatchObject({ all: 2, video: 1, in_person: 1 })
  })
})

describe('writes', () => {
  test('create returns the row the listing would show, template title included', async () => {
    const template = await createTemplate({ orgId: ORG, userId: USER, title: 'Control' })

    const created = await createConsultation(
      ORG,
      { name: 'First', mode: 'video', templateId: template.id },
      USER,
    )

    expect(created.template_title).toBe('Control')
    expect(created.status).toBe('initial')
    expect(created.created_by).toBe(USER)
  })

  test('renaming to blank clears the title so the row falls back to the patient', async () => {
    const id = await seedConsultation({ name: 'Typo', patientName: 'ana' })

    const updated = await updateConsultation({ orgId: ORG, id, patch: { name: '   ' } })

    expect(updated!.name).toBeNull()
  })

  test('a patch touches only what it names', async () => {
    const id = await seedConsultation({ name: 'Keep me', status: 'recording' })

    const updated = await updateConsultation({ orgId: ORG, id, patch: { status: 'finished' } })

    expect(updated!.status).toBe('finished')
    expect(updated!.name).toBe('Keep me')
  })

  test('another org cannot patch or delete this org\'s row', async () => {
    const id = await seedConsultation({ name: 'Ours' })

    expect(await updateConsultation({ orgId: OTHER_ORG, id, patch: { name: 'Hijacked' } })).toBeNull()
    expect(await deleteConsultation(OTHER_ORG, id)).toBe(false)
    expect((await getConsultation(ORG, id))!.name).toBe('Ours')
  })

  test('recorded time accumulates across stretches', async () => {
    const id = await seedConsultation({ name: 'Long one', durationSeconds: 120 })

    await addDuration({ orgId: ORG, id, seconds: 45 })
    const after = await addDuration({ orgId: ORG, id, seconds: 15 })

    // Setting it is how the legacy app lost the first half of a consultation
    // when the doctor reconnected.
    expect(after!.duration_seconds).toBe(180)
  })

  test('consent is stamped once and never moved', async () => {
    const id = await seedConsultation({ name: 'Consented' })

    const first = await recordConsent(ORG, id)
    const second = await recordConsent(ORG, id)

    expect(first!.patient_consent_at).not.toBeNull()
    expect(second!.patient_consent_at).toEqual(first!.patient_consent_at)
  })
})

describe('templates', () => {
  test('a doctor sees the org templates and their own, never someone else\'s', async () => {
    const other = '00000000-0000-0000-0000-0000000000ff'
    await createTemplate({ orgId: ORG, userId: USER, title: 'Shared' })
    await createTemplate({ orgId: ORG, userId: USER, title: 'Mine', scope: 'personal' })
    await createTemplate({ orgId: ORG, userId: other, title: 'Theirs', scope: 'personal' })

    const mine = await listTemplates({ orgId: ORG, userId: USER })

    expect(mine.map((row) => row.title).sort()).toEqual(['Mine', 'Shared'])
  })

  test('a template in use is retired, not deleted', async () => {
    const template = await createTemplate({ orgId: ORG, userId: USER, title: 'Control' })
    const id = await seedConsultation({ name: 'Used it', templateId: template.id })

    const outcome = await deleteTemplate({ orgId: ORG, userId: USER, id: template.id })

    expect(outcome).toBe('deactivated')
    // The consultation still names the template it was rendered with — a delete
    // would have blanked that column through ON DELETE SET NULL.
    expect((await getConsultation(ORG, id))!.template_title).toBe('Control')
    expect(await listTemplates({ orgId: ORG, userId: USER })).toHaveLength(0)
  })

  test('an unused template is really deleted', async () => {
    const template = await createTemplate({ orgId: ORG, userId: USER, title: 'Never used' })

    expect(await deleteTemplate({ orgId: ORG, userId: USER, id: template.id })).toBe('deleted')
    expect(await listTemplates({ orgId: ORG, userId: USER, includeInactive: true })).toHaveLength(0)
  })

  test('the same title twice is a conflict, not a second row', async () => {
    await createTemplate({ orgId: ORG, userId: USER, title: 'Control' })

    expect(createTemplate({ orgId: ORG, userId: USER, title: 'control' })).rejects.toThrow()
  })
})
