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
