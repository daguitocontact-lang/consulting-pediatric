// What Daguito's menu gets from this custom.
//
// ONE ROW PER SECTION. The host draws one menu item per entry here, and this
// panel publishes both of its sections — Consultas and Plantillas — so the
// doctor switches them where every other row in that menu lives, instead of in
// a second navigation of our own drawn inside the page.
//
// It used to be a single row with an in-panel tab bar, and the argument was
// that our sections would be scattered among the host's own (Inicio,
// Conversaciones, Tickets…). That stopped being true for this client the day
// the org hid those rows: the menu holds this panel and little else, so there
// is nothing left to be scattered among. Two navigations for the same two
// screens is the worse trade — and the wrong one, because the panel cannot tell
// the host which row is open (lib/route.ts writes the URL deliberately WITHOUT
// the host's route event), so an in-panel switch left the sidebar highlighting
// the section you had just left.
//
// The cost is honest: switching sections now goes through the host, which
// re-mounts the panel's React tree instead of swapping a child. For two
// sections that is a re-render nobody can see.
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
export type SectionSpec = {
  id: string
  labelKey: Key
  icon: string
  /**
   * The icon the HOST draws for this row, by name.
   *
   * Daguito resolves it against a CLOSED registry it bundles at build time
   * (apps/web/src/lib/custom-panel-icons.ts) — a custom cannot pull an arbitrary
   * lucide icon into Daguito's bundle, and a name that is not there silently
   * falls back to a generic grid. So this is not the same field as `icon`
   * above, which the panel resolves for itself and is free to be anything.
   * `Stethoscope` and `FileText` would be the honest ones; neither is in that
   * registry today, and adding them is a one-line change in Daguito's repo.
   */
  menuIcon: string
}

/**
 * Every section, in the order the day is read. The panel opens on the FIRST one
 * (see MENU_PAGE_ID). A new section is three edits: a line here, a page module,
 * and the entry in PAGES in entry.tsx — the union type is what makes the third
 * one a build error instead of a tab that lands nowhere.
 */
export const SECTIONS = [
  {
    id: 'consultations',
    labelKey: 'nav.consultations',
    icon: 'Stethoscope',
    menuIcon: 'CalendarCheck',
  },
  { id: 'templates', labelKey: 'nav.templates', icon: 'FileText', menuIcon: 'ClipboardList' },
  // `home` is deliberately NOT here. It is the template's placeholder page and
  // has nothing on it yet, so it is not worth a third of the top bar — but the
  // module still ships and still mounts (see PAGES in entry.tsx), so an old
  // link to it lands somewhere real instead of on "no conozco la página", and
  // putting it back is this one line.
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
  const rows = (label: (section: SectionSpec) => string): PanelPage[] =>
    SECTIONS.map((section) => ({
      id: section.id,
      label: label(section),
      icon: section.menuIcon,
      module: `./${section.id}`,
    }))
  try {
    const t = translator(locale).t
    return rows((section) => t(section.labelKey))
  } catch {
    // Untranslated, but present: menu rows that open the panel beat no rows.
    // The ids are what make them work, and those never came from a dictionary.
    return rows((section) => section.id)
  }
}

export default buildManifest
