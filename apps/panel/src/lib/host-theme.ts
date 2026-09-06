// Which theme the panel paints in.
//
// Daguito owns light/dark for the whole page and the panel is a guest in its
// document, so the mode has to come FROM the host. Reading
// `prefers-color-scheme` here answers a different question — the operator's OS —
// and is wrong the moment the two disagree: app-dev3 forces dark on <html>
// before first paint, so a laptop set to light put a white panel inside a black
// dashboard.
//
// The host writes the mode on <html> twice over: `data-theme` + `color-scheme`
// synchronously in index.html, and again from `useThemePreference` on every
// toggle. That attribute is the contract; the OS is only the fallback for a
// host that sets neither.
import { useEffect, useState } from 'react'

export const THEME_MODES = ['light', 'dark'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

const DARK_QUERY = '(prefers-color-scheme: dark)'

const isMode = (value: unknown): value is ThemeMode =>
  typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value)

/** `color-scheme: light dark` means "either" — not an answer, so it is skipped. */
function fromDocument(): ThemeMode | null {
  if (typeof document === 'undefined') return null
  const root = document.documentElement
  if (isMode(root.dataset.theme)) return root.dataset.theme
  if (isMode(root.style.colorScheme)) return root.style.colorScheme
  return null
}

function fromSystem(): ThemeMode {
  if (typeof matchMedia !== 'function') return 'light'
  return matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function readHostTheme(): ThemeMode {
  return fromDocument() ?? fromSystem()
}

/**
 * The host's mode, kept live.
 *
 * Daguito mounts the panel ONCE and remounts it only when the page id changes,
 * never on a theme toggle — so a mode read at mount would be stale for the rest
 * of the session: the operator flips the dashboard to light and the panel stays
 * black. Watching <html> is what makes the toggle reach us.
 *
 * `preferred` wins when the host passes one in the mount props, which is the
 * cheaper contract if Daguito ever starts sending it.
 */
export function useHostTheme(preferred?: ThemeMode): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(() => preferred ?? readHostTheme())

  useEffect(() => {
    if (preferred) {
      setMode(preferred)
      return
    }
    const sync = () => setMode(readHostTheme())
    sync()

    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style'],
    })
    const media = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null
    media?.addEventListener('change', sync)

    return () => {
      observer.disconnect()
      media?.removeEventListener('change', sync)
    }
  }, [preferred])

  return mode
}
