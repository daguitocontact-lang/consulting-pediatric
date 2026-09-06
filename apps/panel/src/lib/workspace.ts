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
  return p.mode === 'video' ? p.inMeeting : true
}

/**
 * Whether the room opens by itself when the screen does.
 *
 * A video consultation IS the call, so it opens. Every other kind keeps its
 * room — a parent who could not come, a second opinion, an interpreter — but
 * behind a button: opening a camera in a consulting room because somebody
 * opened a screen is not a feature.
 */
export function autoJoinsMeeting(mode: string): boolean {
  return mode === 'video'
}
