/**
 * The consultation screen's two rules that are not about pixels: what the
 * clock shows, and when the doctor may start.
 */
import { describe, expect, test } from 'bun:test'
import { canStartRecording, elapsedSeconds } from '../src/lib/workspace'

const base = { duration_seconds: 0, meeting_started_at: null, meeting_ended_at: null }

describe('elapsedSeconds', () => {
  test('a consultation that has not started shows what it has banked', () => {
    expect(elapsedSeconds({ ...base, duration_seconds: 125 })).toBe(125)
  })

  test('a room open counts from when it opened, not from when the tab did', () => {
    const started = new Date('2026-02-10T10:00:00Z').toISOString()
    const now = new Date('2026-02-10T10:03:20Z').getTime()

    // The legacy timer restarted at 00:00 on every reload; this one survives
    // it, because the value comes from the consultation and not from a counter.
    expect(elapsedSeconds({ ...base, duration_seconds: 60, meeting_started_at: started }, now)).toBe(
      260,
    )
  })

  test('a closed room does not count twice', () => {
    const started = new Date('2026-02-10T10:00:00Z').toISOString()
    const ended = new Date('2026-02-10T10:02:00Z').toISOString()
    const now = new Date('2026-02-10T11:00:00Z').getTime()

    // The 120 seconds were banked into duration_seconds when the room closed;
    // adding the span again would double the last stretch.
    expect(
      elapsedSeconds(
        { duration_seconds: 120, meeting_started_at: started, meeting_ended_at: ended },
        now,
      ),
    ).toBe(120)
  })

  test('a clock that jumped backwards never shows less than what is banked', () => {
    const started = new Date('2026-02-10T10:05:00Z').toISOString()
    const now = new Date('2026-02-10T10:00:00Z').getTime()

    expect(elapsedSeconds({ ...base, duration_seconds: 30, meeting_started_at: started }, now)).toBe(
      30,
    )
  })
})

describe('canStartRecording', () => {
  test('needs the doctor in the room — that is where the audio comes from', () => {
    expect(canStartRecording({ inMeeting: false, status: 'initial' })).toBe(false)
    expect(canStartRecording({ inMeeting: true, status: 'initial' })).toBe(true)
  })

  test('a finished consultation is finished, room or no room', () => {
    expect(canStartRecording({ inMeeting: true, status: 'finished' })).toBe(false)
  })
})
