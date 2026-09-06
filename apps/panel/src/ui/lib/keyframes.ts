/**
 * Shared helper for injecting CSS `@keyframes` animations that Tamagui's
 * `@tamagui/animations-css` driver can't express (it emits CSS transitions,
 * not @keyframes). Callers register a name + rule once at module scope; the
 * first component mount injects the `<style>` tag into `document.head`,
 * every subsequent mount is a no-op.
 *
 * Why this exists: CLAUDE.md forbids ad-hoc CSS, but infinite keyframe
 * animations (shimmer sweeps, typing dots, spinners) are genuinely not
 * expressible through Tamagui primitives. Centralizing the injection here
 * keeps the raw CSS to one obvious place and avoids a dozen components
 * each defining their own `ensureStyle()` helper.
 */

const injected = new Set<string>()

export function ensureKeyframes(id: string, css: string): void {
  if (typeof document === 'undefined') return
  if (injected.has(id)) return
  injected.add(id)
  const existing = document.getElementById(id)
  if (existing) return
  const el = document.createElement('style')
  el.id = id
  el.textContent = css
  document.head.appendChild(el)
}

/**
 * Common animations reused across the app: a bouncing dot for typing-style
 * indicators and a soft pulse ring for "live"/"online" badges. Centralized
 * here so the half-dozen consumers (chat panels, status pills, admin
 * overview) share one set of keyframe rules instead of each redefining them.
 */
const COMMON_ID = 'dag-common-keyframes'
const COMMON_CSS = `
@keyframes dag-dot-bounce {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}
@keyframes dag-dot-bounce-translate {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}
@keyframes dag-pulse-ring {
  0% { box-shadow: 0 0 0 0 rgba(22,163,74,0.6); }
  70% { box-shadow: 0 0 0 6px rgba(22,163,74,0); }
  100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); }
}
@keyframes dag-status-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.dag-dot-bounce-0 { animation: dag-dot-bounce 1.2s infinite 0s; }
.dag-dot-bounce-1 { animation: dag-dot-bounce 1.2s infinite 0.2s; }
.dag-dot-bounce-2 { animation: dag-dot-bounce 1.2s infinite 0.4s; }
.dag-pulse-ring { animation: dag-pulse-ring 1.6s infinite ease-out; }
.dag-status-pulse { animation: dag-status-pulse 1.6s ease-in-out infinite; }
.dag-typing-bounce-0 { animation: dag-dot-bounce-translate 1.2s ease-in-out infinite 0s; }
.dag-typing-bounce-1 { animation: dag-dot-bounce-translate 1.2s ease-in-out infinite 0.15s; }
.dag-typing-bounce-2 { animation: dag-dot-bounce-translate 1.2s ease-in-out infinite 0.3s; }

/* Placeholder styling: Tamagui's placeholderTextColor prop doesn't always
   propagate to the underlying <input> on react-native-web, so we cascade a
   muted color via a class. Apply with className="dag-input" to any input or
   textarea that should show a low-contrast placeholder. */
.dag-input::placeholder,
.dag-input::-webkit-input-placeholder,
.dag-input::-moz-placeholder {
  color: rgba(255, 255, 255, 0.35) !important;
  opacity: 1;
  font-weight: 400;
}
.dag-input[data-theme="light"]::placeholder {
  color: rgba(0, 0, 0, 0.35) !important;
}
`

export function ensureCommonKeyframes(): void {
  ensureKeyframes(COMMON_ID, COMMON_CSS)
}
