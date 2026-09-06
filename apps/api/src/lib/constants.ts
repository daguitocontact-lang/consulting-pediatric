/**
 * Domain enums. EXACT mirror of the CHECK constraints in
 * migrations/0002_consultations.sql — the two change together. No lookup
 * tables: these are closed sets, and every new value needs UI and logic anyway,
 * so a table would only add a JOIN and the illusion that the client can invent
 * statuses.
 *
 * The panel imports the same codes to render labels and colours; the
 * localizable copy lives there, only the codes live here.
 */

/** How the consultation is held. Drives the tabs on the listing. */
export const CONSULTATION_MODE = ['video', 'in_person', 'transcription'] as const
export type ConsultationMode = (typeof CONSULTATION_MODE)[number]

/**
 * Where the consultation is in its life.
 *
 * `draft` is the row the create dialog leaves behind before it is confirmed —
 * the listing never shows it. `processing` is the one that moves on its own
 * (the transcription is running), which is why the panel polls while any row
 * is in it.
 */
export const CONSULTATION_STATUS = [
  'draft',
  'initial',
  'recording',
  'processing',
  'finished',
] as const
export type ConsultationStatus = (typeof CONSULTATION_STATUS)[number]

/** Never listed: a draft is an unfinished create, not a consultation. */
export const CONSULTATION_HIDDEN_STATUS: ConsultationStatus = 'draft'

/** Still moving on its own, so the listing refreshes while one is on screen. */
export const CONSULTATION_IN_PROGRESS: readonly ConsultationStatus[] = ['recording', 'processing']

export const TEMPLATE_SCOPE = ['org', 'personal'] as const
export type TemplateScope = (typeof TEMPLATE_SCOPE)[number]

/**
 * The columns the listing may sort by, mapped to what they sort ON.
 *
 * An allow-list rather than a passthrough: the value arrives in a query string
 * and ends up next to ORDER BY, and postgres.js cannot parameterize an
 * identifier. Anything not in here falls back to the default order.
 */
export const CONSULTATION_SORT = ['name', 'date', 'status', 'duration'] as const
export type ConsultationSort = (typeof CONSULTATION_SORT)[number]
