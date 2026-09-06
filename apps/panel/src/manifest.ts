// What Daguito's menu gets from this custom.
//
// ONE row, on purpose. The host draws one menu item per entry here and has no
// nesting, so a manifest with nine lines means nine rows scattered among the
// host's own (Inicio, Conversaciones, Tickets…). The custom takes a single item
// and switches its own sections in the bar above the page
// (components/Shell.tsx), which is the grouping the host cannot express.
//
// Ids and module names are English like the rest of the code; the LABEL is UI
// copy, so it comes from the dictionary and follows the viewer's language.
import { translator, type Key } from './lib/i18n'

export type PanelPage = {
  id: string
  label: string
  icon: string // lucide icon name, e.g. "Home", "Calendar", "Ticket"
  module: string // exposed module, e.g. "./home"
}

/**
 * An id the menu row used to carry, still answered so an old link works.
 *
 * The row's id ends up in the host's URL and in the props of every mount, and
 * the host imports the remote ONCE per page load — so a browser holding a
 * cached panel.js from before a rename mounts an id that build never heard of
 * and lands on "unknown page". Renaming the row is therefore a breaking change
 * with a delay on it, and the cure is to keep answering the old name: add it
 * here rather than dropping it.
 */
const LEGACY_PAGE_IDS: readonly string[] = ['pediatric']

export const isLegacyPageId = (id: string): boolean => LEGACY_PAGE_IDS.includes(id)

/**
 * A section of the panel's own top bar.
 *
 * `icon` is resolved inside the panel (components/Shell.tsx), not by the host,
 * so it is not bound to the closed set of lucide names Daguito maps.
 */
export type SectionSpec = { id: string; labelKey: Key; icon: string }

/**
 * Every section, in the order the day is read. The panel opens on the FIRST one
 * (see MENU_PAGE_ID). A new section is three edits: a line here, a page module,
 * and the entry in PAGES in entry.tsx — the union type is what makes the third
 * one a build error instead of a tab that lands nowhere.
 */
export const SECTIONS = [
  { id: 'consultations', labelKey: 'nav.consultations', icon: 'Stethoscope' },
  { id: 'home', labelKey: 'nav.home', icon: 'Home' },
] as const satisfies readonly SectionSpec[]

/** The sections the top bar offers. */
export type NavSectionId = (typeof SECTIONS)[number]['id']

/**
 * The id the single menu row carries, and where the panel opens.
 *
 * It is the first SECTION rather than a name of its own so that a host holding
 * an older bundle still mounts a page it knows: a name of the panel was never a
 * page, while every section here has been one for as long as it has existed.
 */
export const MENU_PAGE_ID: NavSectionId = SECTIONS[0].id

const NAV_IDS: readonly string[] = SECTIONS.map((section) => section.id)

export const isNavSectionId = (id: string): id is NavSectionId => NAV_IDS.includes(id)

/**
 * The menu, with the label in the host's language (Spanish unless it says
 * otherwise).
 *
 * This function must NEVER throw. Daguito calls it inside a try/catch that
 * swallows the failure and falls back to a nameless row (`id: ''`) labelled
 * from the org's settings — which looks like a working menu and is not one: the
 * row mounts the panel with no page id and nothing here can tell why. A missing
 * dictionary key is enough to cause it. So the label is resolved defensively
 * and the row ships either way.
 */
export function buildManifest(locale?: string): PanelPage[] {
  const row = (label: string): PanelPage[] => [
    { id: MENU_PAGE_ID, label, icon: 'LayoutGrid', module: `./${MENU_PAGE_ID}` },
  ]
  try {
    return row(translator(locale).t('nav.group'))
  } catch {
    // Untranslated, but present: a menu row that opens the panel beats no row.
    return row('Pediatric')
  }
}

export default buildManifest
