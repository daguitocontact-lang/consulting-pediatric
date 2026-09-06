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
  consultation: { duration_seconds: number; meeting_started_at: string | null; meeting_ended_at: string | null },
  now: number = Date.now(),
): number {
  const banked = Math.max(0, consultation.duration_seconds || 0)
  const started = consultation.meeting_started_at
  // A room that has ended has already banked its time; adding the span again
  // would double the last stretch.
  if (!started || consultation.meeting_ended_at) return banked
  const open = (now - new Date(started).getTime()) / 1000
  return banked + Math.max(0, Math.floor(open))
}

/** mm:ss / h:mm:ss for the header clock — the same shape as the listing. */
export { formatDuration } from './consultations'

/**
 * Whether "Iniciar consulta" can be pressed.
 *
 * The legacy screen showed a yellow "Ingresa a la reunión para iniciar" chip
 * next to a disabled button: recording is fed by the room's audio, so there is
 * nothing to record until the doctor is in it. A finished consultation is done
 * whatever the room says.
 */
export function canStartRecording(p: { inMeeting: boolean; status: string }): boolean {
  return p.inMeeting && p.status !== 'finished'
}
