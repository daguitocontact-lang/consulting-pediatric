/**
 * The consultation screen's two rules that are not about pixels: what the
 * clock shows, and when the doctor may start.
 */
import { describe, expect, test } from 'bun:test'
import { autoJoinsMeeting, canStartRecording, elapsedSeconds } from '../src/lib/workspace'

const base = {
  duration_seconds: 0,
  status: 'recording',
  meeting_started_at: null,
  meeting_ended_at: null,
}

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
        {
          duration_seconds: 120,
          status: 'recording',
          meeting_started_at: started,
          meeting_ended_at: ended,
        },
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

  test('a room left open yesterday does not run the clock today', () => {
    const started = new Date('2026-02-10T10:00:00Z').toISOString()
    const now = new Date('2026-02-11T10:00:00Z').getTime()

    // A closed laptop or a crashed tab never records the end, so the room stays
    // "open" in the database. Counting it made an eight-minute consultation
    // read 6:14:07 the next morning.
    expect(
      elapsedSeconds({ ...base, status: 'initial', duration_seconds: 480, meeting_started_at: started }, now),
    ).toBe(480)
  })
})

describe('canStartRecording', () => {
  test('a VIDEO consultation needs the room: the audio is the call', () => {
    expect(canStartRecording({ inMeeting: false, status: 'initial', mode: 'video' })).toBe(false)
    expect(canStartRecording({ inMeeting: true, status: 'initial', mode: 'video' })).toBe(true)
  })

  test('a presencial does NOT: two people, one office, one microphone', () => {
    // Requiring a video room here asks the doctor to open a call to nobody.
    expect(canStartRecording({ inMeeting: false, status: 'initial', mode: 'in_person' })).toBe(true)
  })

  test('neither does a transcription — it is an upload', () => {
    expect(
      canStartRecording({ inMeeting: false, status: 'initial', mode: 'transcription' }),
    ).toBe(true)
  })

  test('a finished consultation is finished, room or no room', () => {
    expect(canStartRecording({ inMeeting: true, status: 'finished', mode: 'video' })).toBe(false)
    expect(canStartRecording({ inMeeting: false, status: 'finished', mode: 'in_person' })).toBe(
      false,
    )
  })
})

describe('autoJoinsMeeting', () => {
  test('TEMPORARY: every kind opens the room while transcription is debugged', () => {
    // The rule this replaces — and that should come back — is that only a video
    // consultation opens it, because a presencial is two people in one office
    // and does not need a camera opened for them. Starting a consultation does
    // not depend on it either way: see canStartRecording.
    expect(autoJoinsMeeting('video')).toBe(true)
    expect(autoJoinsMeeting('in_person')).toBe(true)
    expect(autoJoinsMeeting('transcription')).toBe(true)
  })
})
