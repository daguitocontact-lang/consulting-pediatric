/**
 * The room's client side: the options Jitsi is opened with, and the loader that
 * pulls its script into a page this panel does not own.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { canJoinMeeting, loadJitsi, meetingOptions } from '../src/lib/jitsi'

const credentials = {
  domain: 'meet.pediatric.example',
  room: 'pediatric-abc',
  jwt: 'a.b.c',
  url: 'https://meet.pediatric.example/pediatric-abc',
  moderator: true,
}

describe('meetingOptions', () => {
  test('passes the room, the token and the display name', () => {
    const options = meetingOptions({ credentials, displayName: 'María', lang: 'es' })

    expect(options.roomName).toBe('pediatric-abc')
    expect(options.jwt).toBe('a.b.c')
    expect(options.userInfo).toEqual({ displayName: 'María' })
    expect(options.lang).toBe('es')
  })

  test('omits the jwt entirely when the server is unsecured', () => {
    const options = meetingOptions({
      credentials: { ...credentials, jwt: null },
      displayName: 'María',
      lang: 'es',
    })

    // `jwt: null` is not the same as no jwt: the SDK forwards the string "null"
    // and the room rejects it, which reads as "the meeting is broken".
    expect('jwt' in options).toBe(false)
  })

  test('skips the prejoin screen, under both spellings of the flag', () => {
    const config = meetingOptions({ credentials, displayName: 'A', lang: 'es' })
      .configOverwrite as Record<string, unknown>

    // The doctor already pressed the button. Jitsi renamed this flag and a
    // server honours only the name it knows, so both are sent — with just the
    // old one, a current meet.jit.si still shows its prejoin page.
    expect(config.prejoinPageEnabled).toBe(false)
    expect(config.prejoinConfig).toEqual({ enabled: false })
    // "Open in the app" leads nowhere from an iframe inside Daguito.
    expect(config.disableDeepLinking).toBe(true)
  })
})

describe('canJoinMeeting', () => {
  test('a closed consultation keeps its room name but is not re-entered', () => {
    expect(canJoinMeeting('initial')).toBe(true)
    expect(canJoinMeeting('recording')).toBe(true)
    expect(canJoinMeeting('finished')).toBe(false)
  })
})

/**
 * A minimal DOM: bun test has none, and what matters here is the bookkeeping —
 * one script tag per domain, no matter how many rows open a room at once.
 */
type FakeScript = {
  src: string
  async: boolean
  listeners: Record<string, (() => void)[]>
  addEventListener: (event: string, handler: () => void) => void
  fire: (event: string) => void
}

function fakeDom() {
  const appended: FakeScript[] = []
  const make = (): FakeScript => {
    const listeners: Record<string, (() => void)[]> = {}
    return {
      src: '',
      async: false,
      listeners,
      addEventListener(event, handler) {
        ;(listeners[event] ??= []).push(handler)
      },
      fire(event) {
        for (const handler of listeners[event] ?? []) handler()
      },
    }
  }
  ;(globalThis as Record<string, unknown>).document = {
    querySelector: () => null,
    createElement: make,
    head: { appendChild: (script: FakeScript) => appended.push(script) },
  }
  // In a browser `window` IS the global; making them the same object here is
  // what lets the test set `JitsiMeetExternalAPI` the way the script does.
  ;(globalThis as Record<string, unknown>).window = globalThis
  return appended
}

describe('loadJitsi', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).JitsiMeetExternalAPI
  })

  test('appends one script per domain and resolves the constructor', async () => {
    const appended = fakeDom()
    const pending = loadJitsi('meet.one.example')

    expect(appended).toHaveLength(1)
    expect(appended[0]!.src).toBe('https://meet.one.example/external_api.js')

    const ctor = function JitsiMeetExternalAPI() {}
    ;(globalThis as Record<string, unknown>).JitsiMeetExternalAPI = ctor
    appended[0]!.fire('load')

    expect(await pending).toBe(ctor as never)
  })

  test('two rooms opening at once share ONE script tag', async () => {
    const appended = fakeDom()

    const first = loadJitsi('meet.two.example')
    const second = loadJitsi('meet.two.example')

    // Two tags would redefine JitsiMeetExternalAPI under each other — the
    // reason the loader caches the promise and not a boolean.
    expect(appended).toHaveLength(1)

    const ctor = function JitsiMeetExternalAPI() {}
    ;(globalThis as Record<string, unknown>).JitsiMeetExternalAPI = ctor
    appended[0]!.fire('load')

    expect(await first).toBe(await second)
  })

  test('a failed load can be retried', async () => {
    const appended = fakeDom()

    const failing = loadJitsi('meet.three.example')
    appended[0]!.fire('error')
    expect(failing).rejects.toThrow('could not load')

    // The usual cause is the host's CSP or a tunnel that was down: both are
    // fixable while the tab stays open, so the domain must not be poisoned.
    loadJitsi('meet.three.example')
    expect(appended).toHaveLength(2)
  })
})
