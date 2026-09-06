/**
 * The listing's presentation rules (src/lib/consultations.ts).
 *
 * They live in a module of their own precisely so they can be checked here:
 * inside the page they were a `useMemo` whose only test was looking at the
 * screen, which is how the legacy version shipped "NaN:NaN" in the duration
 * column for rows the API had not backfilled.
 */
import { describe, expect, test } from 'bun:test'
import {
  capitalizeWords,
  displayName,
  formatDuration,
  hasWorkInFlight,
  rowActions,
  shortDateTime,
  statusTone,
  type Consultation,
} from '../src/lib/consultations'
import { translator } from '../src/lib/i18n'

const i18n = translator('es')

const consultation = (patch: Partial<Consultation> = {}): Consultation => ({
  id: 'c1',
  patient_contact_id: null,
  patient_name: null,
  name: null,
  language: 'es',
  mode: 'in_person',
  status: 'initial',
  template_id: null,
  template_title: null,
  duration_seconds: 0,
  notes: null,
  patient_consent_at: null,
  created_at: '2026-02-10T15:04:00Z',
  updated_at: '2026-02-10T15:04:00Z',
  ...patch,
})

describe('formatDuration', () => {
  test('mm:ss under an hour', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(9)).toBe('00:09')
    expect(formatDuration(75)).toBe('01:15')
    expect(formatDuration(3599)).toBe('59:59')
  })

  test('h:mm:ss once there is an hour, without padding the hours', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(7325)).toBe('2:02:05')
  })

  test('a missing or broken value reads as zero, never NaN', () => {
    expect(formatDuration(Number.NaN)).toBe('00:00')
    expect(formatDuration(-30)).toBe('00:00')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('00:00')
  })

  test('fractional seconds do not leak into the label', () => {
    expect(formatDuration(90.7)).toBe('01:30')
  })
})

describe('displayName', () => {
  test('the doctor’s own title wins', () => {
    expect(displayName(consultation({ name: 'Control anual', patient_name: 'ana' }), i18n)).toBe(
      'Control anual',
    )
  })

  test('then the patient, capitalized', () => {
    expect(displayName(consultation({ patient_name: 'maría camila' }), i18n)).toBe('María Camila')
  })

  test('a blank title is not a title', () => {
    expect(displayName(consultation({ name: '   ', patient_name: 'ana' }), i18n)).toBe('Ana')
  })

  test('with neither, the row still says something a person can point at', () => {
    const label = displayName(consultation(), i18n)
    expect(label).toStartWith('Consulta del ')
    expect(label).not.toContain('undefined')
  })
})

describe('capitalizeWords', () => {
  test('capitalizes each word and leaves the rest of it alone', () => {
    expect(capitalizeWords('ana maría')).toBe('Ana María')
    expect(capitalizeWords('MC-12')).toBe('MC-12')
    expect(capitalizeWords('óscar')).toBe('Óscar')
  })
})

describe('shortDateTime', () => {
  test('a broken timestamp renders a dash instead of "Invalid Date"', () => {
    expect(shortDateTime('not a date', 'es')).toBe('—')
  })
})

describe('statusTone', () => {
  test('recording is the loud one, finished the calm one', () => {
    expect(statusTone('recording')).toBe('error')
    expect(statusTone('processing')).toBe('warning')
    expect(statusTone('finished')).toBe('success')
    expect(statusTone('initial')).toBe('info')
    expect(statusTone('draft')).toBe('neutral')
  })
})

describe('hasWorkInFlight', () => {
  test('polls while something moves on its own, and stops when nothing does', () => {
    expect(hasWorkInFlight([consultation({ status: 'processing' })])).toBe(true)
    expect(hasWorkInFlight([consultation({ status: 'recording' })])).toBe(true)
    expect(hasWorkInFlight([consultation({ status: 'finished' })])).toBe(false)
    expect(hasWorkInFlight([])).toBe(false)
  })
})

describe('rowActions', () => {
  test('renaming is for a finished consultation', () => {
    expect(rowActions('finished').rename).toBe(true)
    expect(rowActions('recording').rename).toBe(false)
  })

  test('clinical history is not deletable from a listing', () => {
    expect(rowActions('finished').remove).toBe(false)
    expect(rowActions('initial').remove).toBe(true)
  })

  test('the room is offered until the consultation is closed', () => {
    // The legacy app tied the room to the mode and left `in_person` without
    // one; here the only thing that closes a room is the consultation ending.
    expect(rowActions('initial').join).toBe(true)
    expect(rowActions('recording').join).toBe(true)
    expect(rowActions('processing').join).toBe(true)
    expect(rowActions('finished').join).toBe(false)
  })
})
