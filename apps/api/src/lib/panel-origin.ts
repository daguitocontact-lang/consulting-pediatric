/**
 * Where the panel is served from — the one answer, for the two things that ask.
 *
 * The API needs it twice and both have to agree, or the failure is invisible:
 * the patient's link is built from it (routes/patient.ts) and the CORS
 * allow-list is opened for it (index.ts). Point the link at one host and allow
 * another, and the page loads and then cannot call the API, which reads on a
 * phone as "the microphone does not work".
 *
 * Three sources, most specific first:
 *
 *   1. `PANEL_BASE_URL` — an explicit override, and what prod sets.
 *   2. `PANEL_PUBLIC_HOST` — the developer's Cloudflare tunnel, which
 *      infra/.env already carries for the panel's own Vite server
 *      (scripts/dev/setup-tunnels.sh writes it). Reusing it is what makes a
 *      patient link work in dev with NO new variable: without this step the
 *      default below wins and the link points at a prod hostname that does not
 *      resolve yet — `DNS_PROBE_FINISHED_NXDOMAIN` on the parent's phone, from
 *      an API that is running perfectly.
 *   3. the prod host.
 *
 * A bare hostname is assumed https: the panel is loaded cross-origin as an ESM
 * module and a browser will not import it over anything else.
 */
const raw =
  process.env.PANEL_BASE_URL?.trim() ||
  process.env.PANEL_PUBLIC_HOST?.trim() ||
  'https://pediatric-panel.daguito.com'

export const PANEL_ORIGIN = (/^https?:\/\//.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '')

/**
 * Where the PATIENT's page lives, which is not always ours.
 *
 * By default it is `/consulta` in our own bucket — the same bytes as
 * `patient.html`, published under a second, extensionless key by
 * `deploy-panel.yml`, and still next to `panel.js` so the import inside it is
 * same-origin. A parent gets a link to a ROUTE, not to a file: `.html` in a URL
 * a practice sends over WhatsApp reads like something that leaked out of a
 * server. (`patient.html` stays published — links already minted live 12 h, and
 * it is the path the Vite dev server serves.)
 *
 * `PATIENT_BASE_URL` moves it: the practice would rather the parent open a
 * `app.daguito.com/…` link than a bucket hostname they have never seen, so
 * Daguito serves (or proxies) the page under its own domain. The value is the
 * FULL url of that page — the fragment is appended to it — because the route is
 * Daguito's to name and this API should not be guessing its shape.
 *
 * It may carry `{id}`, for a router whose route IS the consultation
 * (`https://app.daguito.com/consulta/{id}`): that is a specific route in a SPA,
 * not a file, and it is the shape a Daguito page will have. The id then travels
 * in the path as well as in the fragment — which means Daguito's access log
 * sees it, the one thing the fragment was chosen to avoid. Leave `{id}` out
 * unless their router needs it.
 *
 * The moment it is set, two things the page used to derive from its own
 * location stop being derivable: which API to call (its host is now
 * `app.daguito.com`) and where the bundle is (no longer next to it). So the
 * link carries both — see `patientLinkUrl` — and the page only honours values
 * that are still under `daguito.com`.
 */
const patientRaw = process.env.PATIENT_BASE_URL?.trim()

/** True while the page is the one WE publish, next to the bundle. */
export const PATIENT_PAGE_IS_OURS = !patientRaw

export const PATIENT_PAGE_URL = patientRaw
  ? (/^https?:\/\//.test(patientRaw) ? patientRaw : `https://${patientRaw}`).replace(/\/+$/, '')
  : `${PANEL_ORIGIN}/consulta`

/**
 * Its origin, for the CORS allow-list.
 *
 * The patient's page calls `/public/consultations/:id/patient/session` from a
 * browser, so wherever it is served from has to be allowed — and forgetting
 * shows up as a microphone that does not work on a phone, with the reason in a
 * console nobody will open.
 */
export const PATIENT_ORIGIN = (() => {
  try {
    // `{id}` is not a legal path character everywhere, and the origin does not
    // care about the path anyway.
    return new URL(PATIENT_PAGE_URL.replace('{id}', 'x')).origin
  } catch {
    return PANEL_ORIGIN
  }
})()
