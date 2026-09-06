// Dev harness that stands in for Daguito while working on the panel.
//
// The panel is a library module ({ getManifest, mount, unmount }) — there is no
// page to open on its own. This file renders a minimal host around it: the menu
// built from getManifest(), and a container the selected page is mounted into
// with the SAME props Daguito passes in prod. Working against the real contract
// (including unmount on every page switch) surfaces leaks here instead of in
// Daguito.
//
// DEV ONLY: nothing imports this from src/entry.ts, so the library build never
// pulls it into dist/panel.js.
import { MOUNTABLE_PAGE_IDS, getManifest, mount, unmount, type MountProps } from '../entry'

const LS = {
  apiBase: 'pediatric.dev.apiBase',
  // The default apiBase in force when the override above was typed. See below.
  apiBaseFor: 'pediatric.dev.apiBaseFor',
  token: 'pediatric.dev.token',
  orgId: 'pediatric.dev.orgId',
  pageId: 'pediatric.dev.pageId',
  locale: 'pediatric.dev.locale',
  theme: 'pediatric.dev.theme',
}

// Reading localStorage throws in some privacy modes; never let that blank the page.
const get = (k: string, fallback: string) => {
  try {
    return localStorage.getItem(k) ?? fallback
  } catch {
    return fallback
  }
}
const set = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}

// Default the API to whatever matches how this harness was reached, because
// mixing them breaks: served over the tunnel (https), a call to
// http://localhost:4101 is blocked as mixed content. The panel and API
// hostnames differ only in that one word, in dev and in prod alike
// (pediatric-panel-dev2 -> pediatric-api-dev2, pediatric-panel -> pediatric-api), so the
// default follows the page. Still editable in the bar.
function defaultApiBase(): string {
  const { protocol, hostname } = location
  if (hostname.includes('-panel')) return `${protocol}//${hostname.replace('-panel', '-api')}`
  return 'http://localhost:4101'
}

// Credentials the dev stack already agrees on, served by the dev-only Vite
// plugin in scripts/dev-credentials.ts: the org id from infra/.env and a token
// freshly signed with the throwaway key in infra/.dev-jwt/ — the same key whose
// public half infra/.env hands the API. Nothing to paste, and nothing that can
// expire while the tab is open. Not imported: that module touches node:fs.
type DevCredentials = { orgId: string; token: string; reason: string }
const devCreds: DevCredentials = await fetch('/@pediatric-dev-credentials')
  .then((r) => (r.ok ? (r.json() as Promise<DevCredentials>) : null))
  .catch(() => null)
  .then((c) => c ?? { orgId: 'org_dev', token: '', reason: 'el dev server no respondió' })

/** exp check only — the API is what verifies the signature. */
function isUnexpired(jwt: string): boolean {
  const payload = jwt.split('.')[1]
  if (!payload) return false
  try {
    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof exp === 'number' && exp * 1000 > Date.now() + 30_000
  } catch {
    return false
  }
}

// A stored apiBase typed against a DIFFERENT page origin is worse than none: a
// dev slug that no longer exists (pediatric-api-dev2), or http://localhost:4101
// while the page itself came over the https tunnel, fails as a bare
// "NetworkError when attempting to fetch resource" with nothing pointing at
// localStorage as the culprit. So remember the default that was in force when
// the override was typed, and drop the override the moment the default moves.
// An override with no stamp at all predates this and is treated as stale.
const currentApiBase = defaultApiBase()
let apiBase = get(LS.apiBase, currentApiBase)
if (get(LS.apiBaseFor, '') !== currentApiBase) {
  apiBase = currentApiBase
  set(LS.apiBase, apiBase)
  set(LS.apiBaseFor, currentApiBase)
}

// A token typed in the bar wins — that is how you exercise Daguito's real
// tokens — but only while it is still valid. Once it expires it turns every
// page into a 401, and the minted dev token is always fresh.
const storedToken = get(LS.token, '')
let token = isUnexpired(storedToken) ? storedToken : devCreds.token
let orgId = get(LS.orgId, devCreds.orgId)
// Daguito may send a locale; the switcher here is how we see both languages.
// Default to Spanish like the real host does — the browser's language is
// deliberately not consulted (see resolveLang).
let locale = get(LS.locale, 'es')

// Light/dark the way Daguito publishes it: `data-theme` + `color-scheme` on
// <html>, written before the panel mounts and rewritten on every toggle. The
// panel reads THAT (lib/host-theme.ts), never the OS, so the switch below is
// the real contract and not a harness-only shortcut. Dark by default because
// app-dev3's shell forces dark before first paint.
let theme = get(LS.theme, 'dark')

function applyTheme(mode: string) {
  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode
}
applyTheme(theme)

// The harness lists what the bundle can MOUNT, not what Daguito shows: pages
// kept out of the customer's sidebar (home)
// still have to be openable while they are being worked on.
const menu = getManifest(locale)
const pages = [
  ...menu,
  ...MOUNTABLE_PAGE_IDS.filter((id) => !menu.some((p) => p.id === id)).map((id) => ({
    id,
    label: `${id} (fuera del menú)`,
    icon: 'LayoutGrid',
    module: `./${id}`,
  })),
]
let activeId = get(LS.pageId, pages[0]?.id ?? 'home')
let mountedEl: HTMLElement | null = null
let mountedPageId: string | null = null

const host = document.getElementById('host') as HTMLElement
host.innerHTML = `
  <style>
    :root { color-scheme: light dark }
    * { box-sizing: border-box }
    body { margin: 0; font: 14px/1.5 Inter, system-ui, sans-serif }
    .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
           padding: 10px 14px; border-bottom: 1px solid #8883; background: #80808014 }
    .bar b { font-size: 13px; margin-right: 4px }
    .bar input { font: inherit; font-size: 12px; padding: 5px 8px; min-width: 0;
                 border: 1px solid #8886; border-radius: 6px; background: transparent; color: inherit }
    .bar input.token { flex: 1; min-width: 240px; font-family: ui-monospace, monospace }
    .bar select { font: inherit; font-size: 12px; padding: 5px 8px; border: 1px solid #8886;
                  border-radius: 6px; background: transparent; color: inherit }
    .bar button { font: inherit; font-size: 12px; padding: 5px 12px; cursor: pointer;
                  border: 1px solid #8886; border-radius: 6px; background: transparent; color: inherit }
    .wrap { display: flex; min-height: calc(100vh - 47px) }
    nav { width: 190px; flex: none; border-right: 1px solid #8883; padding: 10px }
    nav button { display: block; width: 100%; text-align: left; font: inherit; font-size: 13px;
                 padding: 7px 10px; margin-bottom: 4px; cursor: pointer; border: 0;
                 border-radius: 6px; background: transparent; color: inherit }
    nav button[aria-current='true'] { background: #8080803d; font-weight: 600 }
    nav small { display: block; padding: 4px 10px 8px; opacity: .5; font-size: 11px }
    main { flex: 1; min-width: 0 }
    .hint { padding: 10px 14px; font-size: 12px; opacity: .65; border-bottom: 1px solid #8883 }
    code { font-family: ui-monospace, monospace; background: #80808024; padding: 1px 5px; border-radius: 4px }
  </style>
  <div class="bar">
    <b>Pediatric panel · dev</b>
    <input id="api" value="${apiBase}" size="24" aria-label="apiBase" />
    <input id="org" value="${orgId}" size="10" aria-label="orgId" />
    <input id="tok" class="token" value="${token}" placeholder="Bearer token (bun scripts/dev/mint-token.ts)" aria-label="token" />
    <select id="lang" aria-label="locale">
      <option value="es"${locale.startsWith('en') ? '' : ' selected'}>ES</option>
      <option value="en"${locale.startsWith('en') ? ' selected' : ''}>EN</option>
    </select>
    <select id="theme" aria-label="theme">
      <option value="dark"${theme === 'dark' ? ' selected' : ''}>Oscuro</option>
      <option value="light"${theme === 'light' ? ' selected' : ''}>Claro</option>
    </select>
    <button id="apply">Aplicar y remontar</button>
  </div>
  <div class="hint" id="hint"></div>
  <div class="wrap">
    <nav id="nav"><small>manifest (${pages.length})</small></nav>
    <main id="slot"></main>
  </div>`

const nav = host.querySelector('#nav') as HTMLElement
const slot = host.querySelector('#slot') as HTMLElement
const hint = host.querySelector('#hint') as HTMLElement

const tokenSource = !token
  ? ''
  : token === devCreds.token
    ? ` Token firmado por el dev server desde <code>infra/.dev-jwt/</code> (org <code>${devCreds.orgId}</code>).`
    : ' Usando el token pegado en la barra.'

hint.innerHTML = token
  ? `Montando con el contrato real: <code>mount(el, { token, apiBase, orgId, pageId })</code>.${tokenSource} Guardar un archivo recarga la página.`
  : `Sin token: la API responderá 401 — ${devCreds.reason || 'pega uno arriba'}.`

function render() {
  // Always unmount the previous page first — that is what Daguito does, so a
  // page that leaks listeners or nodes shows it here.
  // React owns the node now: unmount takes only the element (the root is
  // keyed by it), so the page id is no longer part of the call.
  if (mountedEl) unmount(mountedEl)
  slot.innerHTML = ''

  const props: MountProps = { token, apiBase, orgId, pageId: activeId, locale }
  mount(slot, props)
  mountedEl = slot
  mountedPageId = activeId

  nav.querySelectorAll('button').forEach((b) =>
    b.setAttribute('aria-current', String(b.dataset.id === activeId)),
  )
}

for (const p of pages) {
  const b = document.createElement('button')
  b.textContent = `${p.label}  ·  ${p.icon}`
  b.dataset.id = p.id
  b.onclick = () => {
    activeId = p.id
    set(LS.pageId, activeId)
    render()
  }
  nav.appendChild(b)
}

// Switching language rebuilds the menu too: the labels are copy, not ids, so a
// stale nav would be the first thing to give the illusion of a half-translated
// panel.
;(host.querySelector('#lang') as HTMLSelectElement).onchange = (event) => {
  locale = (event.target as HTMLSelectElement).value
  set(LS.locale, locale)
  location.reload()
}

// NO remount and NO reload: Daguito toggles the theme with the panel already on
// screen, so this has to prove the panel repaints on its own. If it takes a
// remount to follow, lib/host-theme.ts stopped watching <html>.
;(host.querySelector('#theme') as HTMLSelectElement).onchange = (event) => {
  theme = (event.target as HTMLSelectElement).value
  set(LS.theme, theme)
  applyTheme(theme)
}

;(host.querySelector('#apply') as HTMLButtonElement).onclick = () => {
  apiBase = (host.querySelector('#api') as HTMLInputElement).value.trim()
  orgId = (host.querySelector('#org') as HTMLInputElement).value.trim()
  token = (host.querySelector('#tok') as HTMLInputElement).value.trim()
  set(LS.apiBase, apiBase)
  set(LS.orgId, orgId)
  set(LS.token, token)
  render()
}

render()
