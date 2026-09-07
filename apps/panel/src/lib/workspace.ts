/**
 * What the consultation screen reads from `/api/consultations/:id/workspace`,
 * and the small rules over it that are worth testing on their own.
 */
import type { Consultation } from './consultations'

export type TranscriptSegment = {
  id: string
  speaker: string | null
  text: string
  at_seconds: number
  created_at: string
}

export type Recommendation = {
  id: string
  category: string
  value: string
  status: 'featured' | 'removed' | null
  priority: number | null
  is_active: boolean
  created_at: string
}

export type ClinicalNote = {
  body: string
  template_id: string | null
  edited_at: string | null
  updated_at: string
} | null

export type ChatMessage = {
  id: string
  role: 'doctor' | 'assistant'
  body: string
  created_at: string
}

export type Workspace = {
  consultation: Consultation
  transcript: TranscriptSegment[]
  recommendations: Recommendation[]
  note: ClinicalNote
  chat: ChatMessage[]
}

/**
 * The seconds the header's clock shows.
 *
 * Not a counter the screen increments: the consultation already carries the
 * time it has banked, and the room may have been open since before this tab
 * was. So it is `what is recorded` + `how long the current room has been open`,
 * which survives a reload — the legacy timer restarted at 00:00 every time the
 * doctor refreshed mid-consultation.
 */
export function elapsedSeconds(
  consultation: {
    duration_seconds: number
    status: string
    meeting_started_at: string | null
    meeting_ended_at: string | null
  },
  now: number = Date.now(),
): number {
  const banked = Math.max(0, consultation.duration_seconds || 0)
  const started = consultation.meeting_started_at
  // A room that has ended has already banked its time; adding the span again
  // would double the last stretch.
  if (!started || consultation.meeting_ended_at) return banked
  // A room whose end was never recorded — a closed laptop, a crashed tab —
  // stays "open" in the database forever, and counting it made a consultation
  // that lasted eight minutes read 6:14:07 the next morning. The open room only
  // counts while the consultation itself is running.
  if (consultation.status !== 'recording') return banked
  const open = (now - new Date(started).getTime()) / 1000
  return banked + Math.max(0, Math.floor(open))
}

/** mm:ss / h:mm:ss for the header clock — the same shape as the listing. */
export { formatDuration } from './consultations'

/**
 * Whether "Iniciar consulta" can be pressed.
 *
 * Only a VIDEO consultation needs the room first: there the patient is on the
 * other side of a call and the audio to transcribe is the call's. A presencial
 * is two people in one office with one microphone, and a transcripción is an
 * upload — requiring a video room for either is asking the doctor to open a
 * call to nobody, and it stamps a meeting that never happened.
 *
 * A finished consultation is done whatever the room says.
 */
export function canStartRecording(p: {
  inMeeting: boolean
  status: string
  mode: string
}): boolean {
  if (p.status === 'finished') return false
  // A `transcription` consultation has no microphone to start: it is an upload,
  // transcribed by the API after the fact. Offering "iniciar consulta" there
  // opened a socket onto a flow with no streaming node — the recording button
  // that recorded nothing.
  if (p.mode === 'transcription') return false
  return p.mode === 'video' ? p.inMeeting : true
}

/**
 * Whether the room opens by itself when the screen does.
 *
 * ONLY a video consultation, which is the legacy's rule: there the patient is
 * on the other side of a call and the call IS the consultation. A presencial is
 * two people in one office — it gets the microphone panel instead, with the
 * room behind a button — and a transcripción is a file with no call at all.
 *
 * Opening it for everything (which this did while the engine was being wired)
 * has a cost beyond the noise: joining stamps `meeting_started_at`, so a
 * consultation that never had a call reads as one that did, and the header's
 * clock counts the open room.
 *
 * Starting a consultation does NOT depend on this: canStartRecording already
 * lets a presencial begin with no room at all.
 */
export function autoJoinsMeeting(mode: string): boolean {
  return mode === 'video'
}

/**
 * What goes where the room goes.
 *
 * The legacy's `BodyDockView` factory for its `meeting` slot, as a rule instead
 * of a nested ternary in the screen — it is three decisions and each one is a
 * bug that has happened:
 *
 *   * `ended` — a FINISHED consultation shows no room. Re-opening the call to
 *     read a closed consultation puts the doctor in an empty room AND stamps a
 *     meeting that never happened onto it.
 *   * `upload` — a `transcription` has no room and no microphone; its input is
 *     a file.
 *   * `mic` — a presencial is two people and one microphone. What can go wrong
 *     there is the microphone, so that is what the panel shows.
 *   * `room` — only a video consultation is a call.
 */
export type MeetingSlot = 'ended' | 'upload' | 'room' | 'mic'

export function meetingSlot(consultation: { status: string; mode: string }): MeetingSlot {
  // The MODE is asked first, and only for the one that never has a room. A
  // finished `transcription` was showing "la reunión terminó" — a reunion it
  // never had — and, worse, hid the recording behind that sentence: the audio
  // is the record for that mode, and playing it back is exactly what a doctor
  // opens a finished one to do.
  if (consultation.mode === 'transcription') return 'upload'
  if (consultation.status === 'finished') return 'ended'
  return consultation.mode === 'video' ? 'room' : 'mic'
}

/**
 * Whether pressing "iniciar" opens the microphone or asks for consent first.
 *
 * The legacy's `requestStartRecording` rule. Once is enough: a consultation
 * that already carries `patient_consent_at` starts straight away, because a
 * doctor who paused for lunch should not have to ask a parent twice — but a
 * consultation with no stamp NEVER opens a microphone, whatever the mode.
 */
export function needsConsent(consultation: { patient_consent_at: string | null }): boolean {
  return !consultation.patient_consent_at
}
