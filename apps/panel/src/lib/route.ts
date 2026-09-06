// The open section, mirrored in the host's address bar.
//
// Daguito routes `/custom-panel/<pageId>` and mounts the panel with whatever id
// that last segment names — every unknown id parses (apps/web/src/lib/router.ts
// falls through to `{ tab: 'custom-panel', customPageId }`), so the segment is
// ours to write. The sections in the top bar were host menu rows once, each with
// a URL of its own; folding them into the remote took that away, and this gives
// it back: a link to Servicios opens on Servicios, and a reload keeps the tab
// instead of dropping back to Métricas.
//
// The URL is rewritten WITHOUT the host's `daguito:routechange` event, and that
// silence is the whole trick. The host's router syncs on that event and on
// popstate; firing it would set its route state, re-render CustomPanelPage and
// re-mount the remote — the full unmount/mount the in-panel switcher exists to
// avoid (see entry.tsx). A bare pushState moves the address bar and leaves the
// host's React tree alone.
//
// Back and forward still work, and they work THROUGH the host: the browser
// fires popstate on its own, the host syncs, and CustomPanelPage re-mounts us
// with the id that history entry carries. Nothing here has to listen for it.

/** Daguito's route for the custom panel. Keep in step with its router.ts. */
const PANEL_PATH = '/custom-panel'

/**
 * The panel's base path, or `null` when we are not mounted under it.
 *
 * The dev harness (src/dev/host.ts) serves the panel from `/`, and inventing a
 * `/custom-panel/...` URL there would only hand Vite a path it cannot reload.
 * No host route, no rewrite.
 */
function panelBase(): string | null {
  const { pathname } = window.location
  if (pathname === PANEL_PATH || pathname.startsWith(`${PANEL_PATH}/`)) return PANEL_PATH
  return null
}

/**
 * Name `section` in the URL.
 *
 * `replace` is for the section a mount LANDED on: the bare `/custom-panel`
 * route opens on the first tab and the address bar should say so, but that is
 * not somewhere the user navigated and it should not cost a history entry. A
 * tab the user actually picked pushes one, so back returns to the tab before it
 * rather than leaving the panel altogether.
 */
export function writeSection(section: string, options?: { replace?: boolean }): void {
  if (typeof window === 'undefined') return
  const base = panelBase()
  if (!base) return

  const { pathname, search, hash } = window.location
  const next = `${base}/${encodeURIComponent(section)}${search}${hash}`
  // Already there: a re-render must not stack duplicate history entries.
  if (next === `${pathname}${search}${hash}`) return

  try {
    // The host pushes `{}` and reads nothing back out of it — its router reads
    // location alone — so carrying the current state forward costs nothing and
    // keeps whatever it may store there intact.
    if (options?.replace) window.history.replaceState(window.history.state, '', next)
    else window.history.pushState(window.history.state, '', next)
  } catch {
    // A URL we could not write is no reason to stop rendering a working panel:
    // the section still switches, it just goes unnamed.
  }
}
