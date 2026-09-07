/**
 * The consultation screen's two rules that are not about pixels: what the
 * clock shows, and when the doctor may start.
 */
import { describe, expect, test } from 'bun:test'
import { autoJoinsMeeting, canStartRecording, elapsedSeconds, meetingSlot, needsConsent } from '../src/lib/workspace'

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

  test('a transcription has nothing to start — it is an upload', () => {
    // Its flow (`pre-recorded-consultation`) reads a file, not a socket. The
    // button used to be offered and opened a stream onto a graph with no
    // streaming STT node: an hour of "grabando" and an empty transcript.
    expect(
      canStartRecording({ inMeeting: false, status: 'initial', mode: 'transcription' }),
    ).toBe(false)
  })

  test('a finished consultation is finished, room or no room', () => {
    expect(canStartRecording({ inMeeting: true, status: 'finished', mode: 'video' })).toBe(false)
    expect(canStartRecording({ inMeeting: false, status: 'finished', mode: 'in_person' })).toBe(
      false,
    )
  })
})

describe('autoJoinsMeeting', () => {
  test('ONLY a video consultation opens a call by itself', () => {
    // The legacy's rule, and the reason it matters beyond the noise: joining
    // stamps `meeting_started_at`, so a presencial that never had a call reads
    // as one that did and the header's clock counts the open room. A presencial
    // gets the microphone panel with the room behind a button; a transcripción
    // has no call at all. Starting does not depend on this either way: see
    // canStartRecording.
    expect(autoJoinsMeeting('video')).toBe(true)
    expect(autoJoinsMeeting('in_person')).toBe(false)
    expect(autoJoinsMeeting('transcription')).toBe(false)
  })
})

describe('what goes where the room goes', () => {
  test('a video consultation is a call', () => {
    expect(meetingSlot({ status: 'recording', mode: 'video' })).toBe('room')
    expect(meetingSlot({ status: 'initial', mode: 'video' })).toBe('room')
  })

  test('a presencial shows the microphone, not a camera', () => {
    // Two people in one office. What can go wrong is the microphone, so that
    // is what the panel shows — with the room still behind a button.
    expect(meetingSlot({ status: 'recording', mode: 'in_person' })).toBe('mic')
  })

  test('a transcripción shows the upload, finished or not', () => {
    // It never had a room, so "la reunión terminó" is a sentence about
    // something that did not happen — and it hid the recording, which for this
    // mode IS the record and is what a doctor opens a finished one to play.
    expect(meetingSlot({ status: 'initial', mode: 'transcription' })).toBe('upload')
    expect(meetingSlot({ status: 'processing', mode: 'transcription' })).toBe('upload')
    expect(meetingSlot({ status: 'finished', mode: 'transcription' })).toBe('upload')
  })

  test('a FINISHED consultation shows no room, whatever its mode', () => {
    // The one that bit: a finished video consultation re-opened the call. The
    // doctor lands in an empty room, and joining stamps a meeting that never
    // happened onto a consultation that was already closed.
    expect(meetingSlot({ status: 'finished', mode: 'video' })).toBe('ended')
    expect(meetingSlot({ status: 'finished', mode: 'in_person' })).toBe('ended')
  })
})

describe('the consent gate', () => {
  test('a consultation with no stamp never opens a microphone', () => {
    expect(needsConsent({ patient_consent_at: null })).toBe(true)
  })

  test('once stamped, it starts straight away', () => {
    // A doctor who paused for lunch should not have to ask a parent for
    // permission twice.
    expect(needsConsent({ patient_consent_at: '2026-09-07T10:00:00Z' })).toBe(false)
  })
})

describe('a finished consultation', () => {
  test('cannot be started, whatever the room says', () => {
    // The screen no longer renders a disabled "Iniciar consulta" for it — a
    // greyed-out button asks the doctor to work out why the obvious action is
    // unavailable instead of saying the consultation is done.
    for (const mode of ['video', 'in_person', 'transcription']) {
      expect(canStartRecording({ inMeeting: true, status: 'finished', mode })).toBe(false)
    }
    // A transcripción keeps its uploader — see above.
    expect(meetingSlot({ status: 'finished', mode: 'video' })).toBe('ended')
    expect(meetingSlot({ status: 'finished', mode: 'in_person' })).toBe('ended')
  })
})
