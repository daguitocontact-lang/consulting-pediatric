/**
 * The listing's presentation rules, kept out of the page so they can be read —
 * and tested — without a browser.
 *
 * Ported from the legacy `/dashboard/consultations`, where the same rules lived
 * inline in a `useMemo` over the rows and could only be checked by looking at
 * the screen.
 */
import type { Key, Translator } from './i18n'

export type ConsultationMode = 'video' | 'in_person' | 'transcription'
export type ConsultationStatus = 'draft' | 'initial' | 'recording' | 'processing' | 'finished'

export type Consultation = {
  id: string
  patient_contact_id: string | null
  patient_name: string | null
  name: string | null
  language: string
  mode: ConsultationMode
  status: ConsultationStatus
  template_id: string | null
  template_title: string | null
  duration_seconds: number
  notes: string | null
  patient_consent_at: string | null
  created_at: string
  updated_at: string
}

export type ConsultationPage = {
  data: Consultation[]
  total: number
  page: number
  limit: number
  counts: Record<'all' | ConsultationMode, number>
}

/**
 * mm:ss, or hh:mm:ss once there is an hour to show.
 *
 * Same shape as the legacy formatter, minus its two bugs: a negative or
 * non-finite value (an API that has not backfilled the column yet sends null,
 * which arrives here as NaN) rendered "NaN:NaN", and the hour form padded the
 * hours to two digits, so a three-hour consultation read "03:00:00" as if it
 * were a timestamp.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00'
  const total = Math.floor(seconds)
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number) => value.toString().padStart(2, '0')
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`
}

/** "maria camila" → "Maria Camila". Leaves the rest of a word alone: an id
 *  like "MC-12" must not become "Mc-12". */
export function capitalizeWords(value: string): string {
  return value.replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase())
}

/**
 * What the name column shows.
 *
 * The doctor's own title wins; then the patient's name; and when the
 * consultation has neither — the ones opened straight from a recording — the
 * date it was created, so the row is still something a person can point at.
 */
export function displayName(consultation: Consultation, i18n: Translator): string {
  const own = consultation.name?.trim()
  if (own) return own
  const patient = consultation.patient_name?.trim()
  if (patient) return capitalizeWords(patient)
  return i18n.t('consultations.unnamed', { date: shortDateTime(consultation.created_at, i18n.lang) })
}

/** "12 sep, 14:30" — the listing's date column and the unnamed-row fallback. */
export function shortDateTime(iso: string, lang: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(lang === 'en' ? 'en-US' : 'es-CO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export type StatusTone = 'success' | 'warning' | 'info' | 'error' | 'neutral'

/**
 * The badge colour.
 *
 * `recording` is red because it is the one state where something is happening
 * in the room and the doctor needs to see it from across the table;
 * `processing` is amber (the machine is working, nobody is waiting on the
 * doctor); `finished` green. A draft is grey — it is barely a row.
 */
export function statusTone(status: ConsultationStatus): StatusTone {
  switch (status) {
    case 'finished':
      return 'success'
    case 'recording':
      return 'error'
    case 'processing':
      return 'warning'
    case 'initial':
      return 'info'
    default:
      return 'neutral'
  }
}

/** Whether the listing should keep polling: something is still moving. */
export function hasWorkInFlight(rows: Consultation[]): boolean {
  return rows.some((row) => row.status === 'processing' || row.status === 'recording')
}

/**
 * Which actions a row offers, by status.
 *
 * The legacy page rendered four buttons on every row and disabled three of
 * them, so a finished consultation showed two greyed icons that never did
 * anything. Here a row offers what it can do:
 *
 *   - `open`   — always: the detail screen reads even a draft;
 *   - `rename` — only once finished, which is when it has a name worth fixing;
 *   - `resume` — while it is being recorded;
 *   - `remove` — never once finished: that is clinical history, and deleting
 *     it is not a listing's job.
 */
export function rowActions(status: ConsultationStatus): {
  open: boolean
  rename: boolean
  resume: boolean
  remove: boolean
} {
  return {
    open: true,
    rename: status === 'finished',
    resume: status === 'recording' || status === 'initial',
    remove: status !== 'finished',
  }
}

export const MODE_KEY: Record<ConsultationMode, Key> = {
  video: 'consultations.mode.video',
  in_person: 'consultations.mode.inPerson',
  transcription: 'consultations.mode.transcription',
}

export const STATUS_KEY: Record<ConsultationStatus, Key> = {
  draft: 'consultations.status.draft',
  initial: 'consultations.status.initial',
  recording: 'consultations.status.recording',
  processing: 'consultations.status.processing',
  finished: 'consultations.status.finished',
}
