/**
 * Loading Jitsi's External API into a panel that lives inside somebody else's
 * page.
 *
 * The legacy app used `@jitsi/react-sdk`, which is a React wrapper that ends up
 * injecting the very same `external_api.js` — and it cannot be used here. This
 * bundle is a micro-frontend: Daguito imports ONE `panel.js` and shares no
 * React with it, so a second React-dependent package is weight in the bundle
 * for a wrapper around a script tag. The script itself is what matters, and it
 * has to come from the Jitsi server the API names at runtime (a self-hosted
 * domain in prod, meet.jit.si in dev), which a build-time import could not do
 * anyway.
 *
 * Note for whoever deploys this: the host page's CSP must allow the Jitsi
 * domain in `script-src` and `frame-src`, or the room renders as a blank box
 * with a CSP violation in the console and nothing else.
 */

export type MeetingCredentials = {
  domain: string
  room: string
  jwt: string | null
  url: string
  moderator: boolean
}

/** Jitsi's constructor, as it lands on `window`. */
type JitsiApi = {
  dispose: () => void
  addListener: (event: string, handler: (payload?: unknown) => void) => void
  executeCommand: (command: string, ...args: unknown[]) => void
}

type JitsiConstructor = new (domain: string, options: Record<string, unknown>) => JitsiApi

declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiConstructor
  }
}

/**
 * Load `external_api.js` once per domain and hand back the constructor.
 *
 * Keyed by domain and cached as a PROMISE, not as a boolean: two rows opening
 * a room at the same moment must wait on one script tag, not race to append
 * two — the second would redefine `JitsiMeetExternalAPI` under the first.
 */
const loaders = new Map<string, Promise<JitsiConstructor>>()

export function loadJitsi(domain: string): Promise<JitsiConstructor> {
  const cached = loaders.get(domain)
  if (cached) return cached

  const loading = new Promise<JitsiConstructor>((resolve, reject) => {
    if (window.JitsiMeetExternalAPI) {
      resolve(window.JitsiMeetExternalAPI)
      return
    }
    const src = `https://${domain}/external_api.js`
    // The host page may already carry the script (Daguito could grow its own
    // calls one day); reuse the tag rather than adding a second.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    const script = existing ?? document.createElement('script')
    const onLoad = () => {
      const api = window.JitsiMeetExternalAPI
      if (api) resolve(api)
      else reject(new Error('jitsi loaded without JitsiMeetExternalAPI'))
    }
    script.addEventListener('load', onLoad)
    script.addEventListener('error', () => {
      // Let a later attempt retry: a failed load must not poison the domain
      // forever, and the usual cause (the host's CSP, a tunnel that was down)
      // is fixable while the tab stays open.
      loaders.delete(domain)
      reject(new Error(`could not load ${src}`))
    })
    if (!existing) {
      script.src = src
      script.async = true
      document.head.appendChild(script)
    } else if (window.JitsiMeetExternalAPI) {
      onLoad()
    }
  })

  loaders.set(domain, loading)
  return loading
}

/**
 * The options the room is opened with.
 *
 * Kept in a function so it can be read — and tested — without a browser. The
 * prejoin page is off because the doctor already decided to enter by pressing
 * the button, and the deep-linking interstitial is off because this runs inside
 * an iframe in Daguito, where "open in the app" leads nowhere.
 */
export function meetingOptions(p: {
  credentials: MeetingCredentials
  displayName: string
  lang: string
}): Record<string, unknown> {
  const { credentials } = p
  return {
    roomName: credentials.room,
    // Only when the server is secured; passing `jwt: null` makes the SDK send
    // the string "null" and the room refuses it.
    ...(credentials.jwt ? { jwt: credentials.jwt } : {}),
    userInfo: { displayName: p.displayName },
    lang: p.lang,
    configOverwrite: {
      // BOTH spellings, on purpose. Jitsi renamed the flag around 2.0-7xxx and
      // a server only honours the one it knows: with just the old name a
      // current meet.jit.si still showed "Entrar a la reunión" (measured), and
      // with just the new one an older self-hosted server would.
      prejoinPageEnabled: false,
      prejoinConfig: { enabled: false },
      disableDeepLinking: true,
      startWithAudioMuted: false,
      startWithVideoMuted: false,
      // A paediatric consultation is a conversation, not a webinar: the tile
      // view puts the parent and the child on screen at the same size.
      startWithTileView: true,
    },
    interfaceConfigOverwrite: {
      MOBILE_APP_PROMO: false,
      SHOW_JITSI_WATERMARK: false,
      SHOW_CHROME_EXTENSION_BANNER: false,
    },
  }
}

/**
 * Whether a consultation's room can still be opened.
 *
 * A finished consultation keeps its room name — the history has to say where it
 * happened — but re-opening it would put the doctor back in a call for a
 * consultation that is closed and whose duration is already banked.
 */
export function canJoinMeeting(status: string): boolean {
  return status !== 'finished'
}
