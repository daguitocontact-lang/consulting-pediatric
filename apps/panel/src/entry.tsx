// Runtime-loaded micro-frontend entry. Daguito imports this ESM module directly
// (`import("https://pediatric-panel.daguito.com/panel.js")`) and calls
// `mount(el, props)` on a plain <div> — see CustomPanelPage.tsx in the core.
//
// The host contract is DOM, not React: it passes no React instance and no
// Tamagui provider. So the panel brings its OWN React root and its own
// TamaguiProvider, using the core's tokens, themes and components (vendored in
// src/theme and src/components/ui until @daguito/ui is published). Two React
// instances on the page is fine — they share no context, only the DOM node.
//
// No StrictMode either: it double-invokes effects, so every page would fire its
// API calls twice inside a host that is already a dev build. The host decides
// dev vs prod, not the remote.
import { createRoot, type Root } from 'react-dom/client'
import { useCallback, useEffect, useState } from 'react'
import { TamaguiProvider, Text, Theme, XStack, YStack } from 'tamagui'
import { tamaguiConfig } from './theme/config'
import { ensureKeyframes } from './ui/lib/keyframes'
import { ToastProvider } from './components/Toast'
import { Shell } from './components/Shell'
import {
  MENU_PAGE_ID,
  buildManifest,
  isLegacyPageId,
  isNavSectionId,
  type NavSectionId,
  type PanelPage,
} from './manifest'
import { SESSION_EXPIRED, type MountProps } from './lib/api'
import { adoptToken } from './lib/session'
import { writeSection } from './lib/route'
import { translator } from './lib/i18n'
import { useHostTheme, type ThemeMode } from './lib/host-theme'
import { Page as home } from './pages/home'
import { Page as consultations } from './pages/consultations'

export type { PanelPage, MountProps }

/**
 * Every section this panel can mount.
 *
 * Daguito's menu carries ONE row for this custom (see manifest.ts) and the top
 * bar inside it navigates these. Typing the map by the union is what enforces
 * the pairing: a section listed in the manifest's SECTIONS with no module here
 * stops the BUILD instead of shipping a tab that lands nowhere.
 *
 * A page with no tab of its own (a deep link, a diagnostic) widens the type
 * instead: `NavSectionId | 'occupancy'`, and an entry in PAGES for it.
 */
export type SectionId = NavSectionId

const PAGES: Record<SectionId, (props: MountProps) => React.ReactElement> = {
  consultations,
  home,
}

/**
 * Every page this bundle can mount, menu or no menu. The manifest is a SUBSET:
 * a page dropped from Daguito's sidebar is still built and still mounts, and the
 * dev harness lists these so it stays workable on.
 */
export const MOUNTABLE_PAGE_IDS = Object.keys(PAGES)

/**
 * The pages Daguito should render in the menu (one item per entry, with icon).
 * `locale` is optional and backwards-compatible: the host may not send one, and
 * then the labels stay Spanish — the language Daguito's own menu is in.
 */
export function getManifest(locale?: string): PanelPage[] {
  return buildManifest(locale)
}

/**
 * React does NOT render into the node Daguito hands us — it renders into a child
 * of it. The host clears the node itself before every mount
 * (`el.innerHTML = ''` in CustomPanelPage.tsx), and a React root whose children
 * are ripped out from under it throws `NotFoundError: removeChild` on the next
 * update. Owning a child container means the host's wipe removes OUR container
 * whole, and we notice and start clean instead of reconciling against nodes that
 * no longer exist.
 */
type Mounted = { container: HTMLElement; root: Root }

const mounted = new WeakMap<HTMLElement, Mounted>()

/**
 * A page id this bundle does not know.
 *
 * It used to fall back to `home`, which lies: the menu said "Servicios" and the
 * screen said "En creación", and the only way to tell was to read the source.
 * In dev it means the host is holding a module from before that page existed
 * (Vite hot-updates the panel, but Daguito imports the remote ONCE and keeps
 * the reference), and the cure is a hard reload of the host. Saying so beats
 * rendering a different page as if nothing happened.
 */
function UnknownPage({ pageId }: { pageId: string }) {
  return (
    <YStack padding="$2.5" gap="$0.75">
      <Text fontSize={16} fontWeight="800" color="$color">
        {`No conozco la página "${pageId}"`}
      </Text>
      <Text fontSize={13} color="$color11">
        Este panel trae: {MOUNTABLE_PAGE_IDS.join(', ')}. Si la página existe pero no aparece aquí,
        el host está usando una versión vieja del panel: recarga con Cmd+Shift+R.
      </Text>
    </YStack>
  )
}

/**
 * The host hands us a plain string, so the lookup widens here — in ONE place,
 * where the `undefined` it can return is handled — rather than by loosening the
 * map's type and losing the guarantee above.
 */
const isSectionId = (id: string): id is SectionId => id in PAGES

/**
 * The section a mount lands on.
 *
 * The bare /custom-panel route mounts no id at all, and an id the menu row used
 * to carry names the panel rather than a page: both open on the tab the menu
 * row points at. Any other unknown id is still a bug and still says so, rather
 * than quietly rendering a different page.
 */
function sectionFor(pageId: string): SectionId | null {
  if (!pageId || isLegacyPageId(pageId)) return MENU_PAGE_ID
  return isSectionId(pageId) ? pageId : null
}

/**
 * The custom's single menu row, with its own sections inside.
 *
 * The section is state here and the tab switch never goes THROUGH Daguito: the
 * host mounts the panel once per route and re-mounts on nothing else, so a
 * switch routed through the host would cost a full unmount/mount of the React
 * tree. The incoming `pageId` still seeds it, which is what keeps a deep link
 * (and the dev harness, which mounts every page by id) landing where it asked.
 *
 * The URL is kept in step all the same — written behind the host's back rather
 * than by asking it to navigate. See lib/route.ts for why that is safe and how
 * back/forward survive it.
 */
function Panel(props: MountProps) {
  const i18n = translator(props.locale)
  const [section, setSection] = useState(() => sectionFor(props.pageId))

  // The section the mount landed on, named in the address bar from the first
  // paint: the host may have sent us to the bare /custom-panel route, and a URL
  // that does not say which tab is open is not one anybody can pass on.
  // Replaces rather than pushes — nobody navigated here.
  useEffect(() => {
    if (section) writeSection(section, { replace: true })
    // Once, for the landing section. Every later change is a click, and
    // selectSection pushes its own entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectSection = useCallback((id: NavSectionId) => {
    setSection(id)
    writeSection(id)
  }, [])

  const Page = section ? PAGES[section] : null
  return (
    <Shell
      active={section && isNavSectionId(section) ? section : null}
      i18n={i18n}
      onSelect={selectSection}
    >
      {Page ? <Page {...props} /> : <UnknownPage pageId={props.pageId} />}
    </Shell>
  )
}

/**
 * Last resort for a session that really is over.
 *
 * The panel's token lasts five minutes and Daguito mints it once per host load
 * (`signCustomPanelToken({ ttlS: 300 })`, `useCustomPanel`), so `lib/session.ts`
 * renews it on the panel's own — silently, before each call and again after a
 * 401. This banner is what is left when the RENEWAL fails, which means the
 * user's Daguito session itself ended: no token this panel can mint will help,
 * and reloading the host is the cure.
 *
 * Said once, at the top, rather than as a red line on every page about a
 * session nobody knew had a clock.
 */
function SessionGuard({ children }: { children: React.ReactNode }) {
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    const onExpired = () => setExpired(true)
    window.addEventListener(SESSION_EXPIRED, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired)
  }, [])

  if (!expired) return <>{children}</>
  return (
    <YStack flex={1}>
      <XStack
        alignItems="center"
        justifyContent="space-between"
        gap="$1"
        paddingVertical="$1"
        paddingHorizontal="$2"
        backgroundColor="$warning100"
        flexWrap="wrap"
      >
        <Text fontSize={13} color="$warning700">
          La sesión del panel venció. Recarga para seguir.
        </Text>
        <Text
          fontSize={13}
          fontWeight="700"
          color="$warning700"
          textDecorationLine="underline"
          cursor="pointer"
          onPress={() => window.location.reload()}
        >
          Recargar
        </Text>
      </XStack>
      {children}
    </YStack>
  )
}

/**
 * The panel's Tamagui root, painted in the HOST's mode rather than the OS's —
 * and painted INSIDE the panel, never on the host's page.
 *
 * `disableRootThemeClass` is the important word. Tamagui's ThemeProvider ends
 * its mount effect with `document.body.classList.add('t_' + defaultTheme)`
 * (views/ThemeProvider.mjs) — and that body is DAGUITO'S, which already carries
 * the host's own `t_light` / `t_dark` from its own Tamagui. Two theme classes on
 * one element do not negotiate: both rules match, so every variable on the page
 * comes from whichever the last stylesheet defines last — and since our CSS is
 * injected after the host's and lists `dark` after `light`, the WHOLE dashboard
 * went black the moment this panel mounted in light mode. That is the bug this
 * flag fixes; it is not an optimization.
 *
 * With the root class off, Tamagui hands the root <Theme> `forceClassName:
 * false`, which makes it render no class wrapper at all — so the class has to
 * come from the <Theme> below, and `forceClassName` there is what puts it on a
 * span of ours instead of on the host's body.
 *
 * `defaultTheme` still matters: it is what Tamagui resolves tokens against
 * before any <Theme> is read, so it has to be the same mode.
 *
 * `useHostTheme` re-renders on every toggle, so the panel follows the dashboard
 * live. It has to: the host mounts us once and only remounts on a page change.
 */
function Themed({ theme, children }: { theme?: ThemeMode; children: React.ReactNode }) {
  const mode = useHostTheme(theme)
  ensurePanelCSS()
  return (
    <TamaguiProvider
      config={tamaguiConfig}
      defaultTheme={mode}
      disableRootThemeClass
      disableInjectCSS
    >
      <Theme name={mode} forceClassName>
        {children}
      </Theme>
    </TamaguiProvider>
  )
}

/**
 * The panel's theme variables, injected by us instead of by Tamagui.
 *
 * `TamaguiProvider` normally renders its stylesheet as
 * `<style precedence="default" href="tamagui-css">`. Under React 19 that is a
 * HOISTED style: React keeps a per-document registry keyed by `href` and skips
 * anything already registered — and Daguito's own Tamagui, also React 19, has
 * registered exactly that href before we mount. Our stylesheet was therefore
 * dropped on the floor, and the panel ran on the HOST's variables.
 *
 * Which mostly worked, and that is what made it hard to see: our themes are
 * vendored copies of Daguito's, so every shared key (`$background`, `$color`,
 * `$teal600`…) resolved fine from the host's sheet. The keys the host does NOT
 * have — the action palette in theme/actions.ts — resolved to nothing, and
 * `background-color: var(--actionFill)` with no such variable computes to
 * transparent. Every primary and secondary button in the panel was painted in
 * "no colour at all": invisible on dark, invisible on light, and pressable if
 * you happened to guess where it was.
 *
 * `disableInjectCSS` plus this call is the whole fix. Our own <style id> is not
 * a React resource, so nothing dedupes it against the host's.
 */
function ensurePanelCSS(): void {
  ensureKeyframes('pediatric-tamagui', tamaguiConfig.getCSS())
  ensureKeyframes('pediatric-panel', PANEL_CSS)
}

/**
 * The one rule Tamagui cannot give us: the placeholder's colour.
 *
 * Tamagui's Input paints its placeholder with
 * `input::placeholder { color: var(--placeholderColor) !important }` and, on
 * the element itself, writes `--placeholderColor: var(--placeholderColor)` —
 * the theme token resolved to a CSS variable of the SAME name. A custom
 * property that references itself is a cycle; the browser throws it away, the
 * `!important` rule resolves to nothing, and the hint inherits the text colour:
 * "Busca por nombre, telefono o email" read as a filled field, not an empty one.
 * Measured in the dev harness, 2026-09-03; the earlier `::placeholder` rule
 * here could never win against that `!important`.
 *
 * So the variable is re-declared on the input from one that does not loop:
 * `--pediatric-placeholder`, set on the theme wrappers with the exact values
 * `src/ui/themes.ts` gives `placeholderColor` for light and dark (a nested
 * wrapper wins by being the nearer ancestor, as custom properties inherit).
 * `!important` because an inline declaration beats a normal stylesheet one,
 * and only an important author rule beats an inline normal one.
 *
 * Scoped to the panel's own container so the host's inputs are left alone —
 * this sheet lands in the document <head> Daguito shares with us. The plain
 * `::placeholder` rule stays for inputs that are not Tamagui's (the custom
 * `.pediatric-field` boxes), which have no `!important` of their own to fight.
 */
const PANEL_CSS = `
.pediatric-panel, .pediatric-panel .t_light { --pediatric-placeholder: rgba(0, 0, 0, 0.4); }
.pediatric-panel .t_dark { --pediatric-placeholder: rgba(255, 255, 255, 0.5); }
.pediatric-panel input.is_Input,
.pediatric-panel textarea.is_Input,
.pediatric-panel textarea.is_TextArea {
  --placeholderColor: var(--pediatric-placeholder) !important;
}
.pediatric-panel input::placeholder,
.pediatric-panel textarea::placeholder {
  color: var(--placeholderColor, rgba(0, 0, 0, 0.4));
  opacity: 1;
}
`

/** Mount the panel into `el`. Daguito calls this with the page id + token. */
export function mount(el: HTMLElement, props: MountProps): void {
  // The host hands the same token it minted at load on every page change; the
  // session keeps whichever is newer, so a token this panel renewed itself is
  // not thrown away by a re-mount. See lib/session.ts.
  adoptToken(props.token, props.orgId)

  let record = mounted.get(el)
  // Our container gone (or reparented) means the host wiped the node between
  // mounts: that root can never reconcile again, so it is dropped rather than
  // reused — reusing it is what triggers "createRoot() on a container that has
  // already been passed to createRoot()".
  if (record && record.container.parentNode !== el) {
    mounted.delete(el)
    dispose(record)
    record = undefined
  }

  if (!record) {
    const container = document.createElement('div')
    container.className = 'pediatric-panel'
    container.style.cssText = 'display:flex;flex-direction:column;min-height:100%'
    el.appendChild(container)
    record = { container, root: createRoot(container) }
    mounted.set(el, record)
  }

  record.root.render(
    <Themed theme={props.theme}>
      {/* Above the page, so any page can report what a write did. */}
      <ToastProvider>
        <SessionGuard>
          {/* Keyed by the id the host asked for: a new route seeds a new tab,
              while a re-render with the same one keeps the open section. */}
          <Panel key={props.pageId} {...props} />
        </SessionGuard>
      </ToastProvider>
    </Themed>,
  )
}

export function unmount(el: HTMLElement): void {
  const record = mounted.get(el)
  if (!record) return
  mounted.delete(el)
  dispose(record)
}

function dispose(record: Mounted): void {
  // Deferred: React throws if a root is unmounted while it is rendering, and
  // the host unmounts inside its own effect cleanup — which is exactly that.
  queueMicrotask(() => {
    try {
      record.root.unmount()
    } catch {
      // Already gone (the host wiped the node); nothing left to clean up.
    }
    record.container.remove()
  })
}
