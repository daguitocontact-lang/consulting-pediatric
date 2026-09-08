import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { tamaguiPlugin } from '@tamagui/vite-plugin'
import path from 'node:path'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { devCredentialsPlugin } from './scripts/dev-credentials'

// Build the panel as a single self-contained ESM module. Daguito loads it at
// runtime with a plain dynamic import — no Module Federation plugin on the host,
// so the Daguito build carries zero risk. The module is framework-agnostic
// (pages expose { mount, unmount }); the custom can be Angular/React/Vue/vanilla.

// In prod the built module is a single file at <panel-host>/panel.js. The dev
// server serves modules from source paths, so alias /panel.js -> the entry:
// Daguito's import URL is then identical in dev and prod, and only the host
// changes. Serve-only — the build output already IS panel.js.
const devPanelAlias: Plugin = {
  name: 'pediatric-dev-panel-alias',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      // Vite serves current-hash dep chunks `immutable, max-age=31536000`, and
      // Cloudflare happily caches them at the edge for a `.js` on daguito.com.
      // The moment the optimizer mints a new browserHash the old URLs stay
      // valid AND stay pinned for a year in both caches, so a page can load
      // React at the old hash and at the new one at the same time. In dev that
      // trade (fast reloads) is worth nothing and costs a duplicated React, so
      // force revalidation on everything the optimizer emits.
      if (req.url?.startsWith('/node_modules/.vite/deps/')) {
        const setHeader = res.setHeader.bind(res)
        res.setHeader = (name: string, value: never) =>
          name.toLowerCase() === 'cache-control'
            ? setHeader(name, 'no-store')
            : setHeader(name, value)
        res.setHeader('Cache-Control', 'no-store')
      }
      // The patient's page is linked as a ROUTE, not as a file: in prod the
      // deploy publishes the same bytes under the extensionless key `consulta`
      // (deploy-panel.yml). Vite serves `public/` by filename, so dev would be
      // the only place where the link the API mints 404s — one rewrite keeps
      // the two identical.
      if (req.url && req.url.split('?')[0] === '/consulta') {
        req.url = '/patient.html'
      }
      // Match the PATH, not the whole URL: Daguito's remote_url may carry a
      // query (a cache-buster, a version pin), and `req.url === '/panel.js'`
      // would miss it and fall through to Vite's HTML fallback — the host then
      // imports an HTML document as a module.
      if (req.url && req.url.split('?')[0] === '/panel.js') {
        // Rewrite to the real entry and let Vite serve it: the host imports this
        // URL cross-origin, and Vite's own middleware is what puts the CORS and
        // transform headers on it. Serving a hand-written loader from here
        // skipped that middleware and broke the import.
        //
        // Cache-busting is the remote_url's job instead (`?b=<n>` in the org's
        // custom-panel settings): Cloudflare fronts this tunnel and rewrites
        // Cache-Control to max-age=14400 whatever we send, so a NEW url is the
        // only thing that reliably reaches the browser.
        req.url = '/src/entry.tsx'
        // `no-store`, not Vite's default `no-cache`. Vite ETags a source module
        // by size+mtime, but the body carries the dep optimizer's `browserHash`
        // in every import URL: a 304 replays a cached body importing the OLD
        // hash while the rest of the graph loads at the current one, and you get
        // two Reacts and `Cannot read properties of null (reading 'useState')`.
        res.setHeader('Cache-Control', 'no-store')
      }
      next()
    })
  },
}

// Set to the Cloudflare Tunnel hostname (scripts/dev/setup-tunnels.sh) so Vite
// emits asset + HMR URLs that resolve through the tunnel instead of localhost.
const PUBLIC_HOST = process.env.PANEL_PUBLIC_HOST?.trim() || undefined
const PORT = Number(process.env.PANEL_PORT ?? 4102)

export default defineConfig({
  // Same wiring as the core's apps/web/vite.config.ts — Tamagui on web needs
  // TAMAGUI_TARGET and the react-native → react-native-web alias, and the
  // vendored components are the core's, so they need the core's setup.
  define: {
    'process.env': {},
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'process.env.TAMAGUI_TARGET': JSON.stringify('web'),
  },
  resolve: {
    alias: { 'react-native': 'react-native-web' },
    dedupe: ['react', 'react-dom', 'react-native-web', 'tamagui', '@tamagui/core', '@tamagui/web'],
  },
  // Pre-bundle these on boot. Without it, Vite discovers them lazily and
  // re-optimizes mid-session, which changes the `?v=` hash on every dep URL and
  // breaks the tab Daguito already has open with a "Failed to fetch dynamically
  // imported module" — the failure looks like the tunnel died when it did not.
  //
  // `noDiscovery` freezes the optimizer after boot: no re-run, so `browserHash`
  // is constant for the life of the process. This matters far more here than in
  // a normal app. Daguito imports this module cross-origin and keeps it for the
  // life of its tab, and Vite happily serves the SAME dep chunk under any `?v=`
  // (a stale hash returns 200, not 404). So the moment a re-optimize bumps the
  // hash, the page ends up importing chunk-XXXX.js under two URLs, the browser
  // instantiates it twice, and there are two Reacts: "Invalid hook call" and
  // `Cannot read properties of null (reading 'useState')` on the first page.
  // With discovery off, every dep MUST be listed in `include` below — anything
  // missing is served unbundled and a CJS-only package would break.
  optimizeDeps: {
    noDiscovery: true,
    // Force a brand-new `browserHash` on every dev-server start.
    //
    // Vite stamps current-hash dep chunks `immutable, max-age=31536000`. Reuse a
    // hash the browser has seen before and it replays the STORED copy without
    // revalidating — including that copy's internal `?v=` references, which can
    // point at a chunk generation from hours ago. That is how two Reacts end up
    // on one page. A hard reload does not help: Daguito pulls the panel with a
    // cross-origin `import()` fired from JS, and `Cmd+Shift+R` only bypasses the
    // cache for the navigation's own subresources, never for a later import().
    // Seeding the optimizer's config hash with the boot time makes every dep URL
    // unique per start, so nothing cached can ever be reused. Costs one dep
    // re-bundle per start (~2s).
    esbuildOptions: { define: { __PANEL_BOOT__: JSON.stringify(String(Date.now())) } },
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-native-web',
      'tamagui',
      '@tamagui/core',
      '@tamagui/core/inject-styles',
      '@tamagui/input',
      '@tamagui/shorthands',
      '@tamagui/animations-css',
      '@tamagui/lucide-icons',
      // The transcription engine's SDK. It MUST be listed: `noDiscovery` above
      // freezes the optimizer at boot, so a dep that is not here is served
      // unbundled — and this one ships CJS entrypoints.
      '@daguito/sdk',
      '@daguito/sdk/voice',
    ],
  },
  plugins: [
    react(),
    // The optimizing compiler: it flattens Tamagui's styled() calls into CSS at
    // build time, which is most of why the bundle stays reasonable.
    tamaguiPlugin({
      config: path.resolve(__dirname, 'src/theme/config.ts'),
      components: ['tamagui'],
      optimize: true,
    }),
    // Daguito loads ONE file (panel.js). Tamagui emits a stylesheet, so it has
    // to travel inside the module and inject itself on import — otherwise the
    // panel renders unstyled in prod and nobody notices until the client does.
    cssInjectedByJs(),
    devPanelAlias,
    // Hands the dev harness the org id + a freshly signed token from infra/.
    // `apply: 'serve'`, so nothing it produces can reach dist/panel.js.
    devCredentialsPlugin,
  ],
  server: {
    port: PORT,
    strictPort: true,
    host: true, // bind 0.0.0.0 — the container publishes the port
    // Daguito imports this module from ANOTHER origin, so the dev server must
    // send permissive CORS headers. Dev-only; the built module is served by R2,
    // whose CORS is locked to Daguito's origin (see modules/r2-panel).
    cors: true,
    // Vite rejects unknown Host headers; the tunnel arrives as *.daguito.com.
    allowedHosts: ['.daguito.com'],
    origin: PUBLIC_HOST ? `https://${PUBLIC_HOST}` : undefined,
    // Without this the HMR client dials ws://localhost:4102 from a page loaded
    // over the tunnel, and every save silently fails to hot-reload.
    hmr: PUBLIC_HOST ? { protocol: 'wss', host: PUBLIC_HOST, clientPort: 443 } : undefined,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    minify: true,
    lib: {
      entry: 'src/entry.tsx',
      formats: ['es'],
      fileName: () => 'panel.js',
    },
    // Tamagui emits a stylesheet; the host loads ONE file, so it has to travel
    // inside the module and inject itself at import time.
    cssCodeSplit: false,
    rollupOptions: {
      // Everything is bundled (self-contained), nothing external: the host
      // shares no React instance with the remote — see entry.tsx.
      output: {
        inlineDynamicImports: true,
        // Runs BEFORE any module in this bundle, which is the whole point.
        //
        // Tamagui keeps its config on `globalThis.__tamaguiConfig`, and every
        // component binds one the moment it is CREATED — `onConfiguredOnce`
        // (config.mjs) reads `local || global` and, being "once", never lets go.
        // Daguito is a Tamagui app too and has already left its config on that
        // global by the time we load, so every component inside @tamagui/core
        // that is created while our own `createTamagui()` has not run yet binds
        // the HOST's config. It then takes `config.animations.ResetPresence`
        // from it — a component from the HOST's bundle — and renders it with
        // OUR React: React error #321, "invalid hook call", which is what took
        // the consultation chat down.
        //
        // So the global is hidden for the length of our initialization. The
        // host's value is parked here and put back in src/theme/config.ts as
        // soon as our config exists — see the note there for why giving it back
        // matters as much as taking it away.
        banner:
          'globalThis.__pediatricHostTamaguiConfig = globalThis.__tamaguiConfig;' +
          'globalThis.__tamaguiConfig = undefined;',
      },
    },
  },
})
