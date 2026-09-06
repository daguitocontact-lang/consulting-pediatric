// UI copy in Spanish and English. The repo rule is English for code and
// localizable copy for the UI: this is where the copy lives, so no page holds a
// hard-coded string.
//
// Spanish is the default because the operators work in Spanish. The host may
// pass `locale`; when it does not, anything that is not English falls back to
// Spanish.
//
// This is the SKELETON dictionary: only the keys the shared components already
// ask for. A page adds its own keys here (both dictionaries) as it is written.

export type Lang = 'es' | 'en'

// Spanish is the source dictionary: its keys type the English one, so a missing
// translation is a compile error, not a blank label at runtime.
const es = {
  'common.search': 'Buscar',
  'common.loading': 'Cargando…',
  'common.dash': '—',
  'common.yes': 'Sí',
  'common.no': 'No',
  'common.error.session': 'Sesión vencida. Recarga el panel.',
  'common.error.forbidden': 'Esta organización no tiene acceso a este panel.',
  'common.error.unexpected': 'Error inesperado',

  // Copy of the shared create/edit dialog (components/CreateForm.tsx).
  'form.save': 'Guardar',
  'form.cancel': 'Cancelar',
  'form.edit': 'Editar',
  'form.delete': 'Eliminar',
  'form.remove': 'Quitar',
  'form.add': 'Agregar',
  'form.saving': 'Guardando…',
  'form.error': 'No se pudo guardar: {detail}',

  // The menu row Daguito draws (manifest.ts) and the panel's own top bar
  // (components/Shell.tsx): one `nav.*` key per SECTION.
  'nav.group': 'Pediatric',
  'nav.home': 'Inicio',

  'home.title': 'Pediatric — En creación',
  'home.status': 'API v{version} · DB {db} · leído de la base de datos',
  'home.offline': 'Sin conexión con la API ({detail})',

  // Contact picker (components/ContactField.tsx): it searches Daguito's CRM.
  'contact.searchHint': 'Busca por nombre, teléfono o email',
  'contact.searching': 'Buscando…',
  'contact.noResults': 'Ningún contacto coincide.',
  'contact.selected': 'Titular: {name}',
  'contact.change': 'Cambiar',
  'contact.usingId': 'Usando el uuid pegado.',
  'contact.unavailable': 'No se puede buscar en el directorio; pega el uuid del contacto.',
  // Placeholder shown when the directory is unreachable and only a uuid will do.
  // The key is named after the form the shared component was written for; it is
  // the component's contract, so it keeps its name until the component changes.
  'reservations.form.customerHint': '00000000-0000-0000-0000-000000000000',

  // Org-member picker (components/UserSelectField.tsx).
  'user.unavailable': 'No se pudo cargar el equipo.',
  'wizard.booking.sellerNone': 'Sin responsable',
}

export type Key = keyof typeof es

const en: Record<Key, string> = {
  'common.search': 'Search',
  'common.loading': 'Loading…',
  'common.dash': '—',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.error.session': 'Session expired. Reload the panel.',
  'common.error.forbidden': 'This organization has no access to this panel.',
  'common.error.unexpected': 'Unexpected error',

  'form.save': 'Save',
  'form.cancel': 'Cancel',
  'form.edit': 'Edit',
  'form.delete': 'Delete',
  'form.remove': 'Remove',
  'form.add': 'Add',
  'form.saving': 'Saving…',
  'form.error': 'Could not save: {detail}',

  'nav.group': 'Pediatric',
  'nav.home': 'Home',

  'home.title': 'Pediatric — Under construction',
  'home.status': 'API v{version} · DB {db} · read from the database',
  'home.offline': 'No connection to the API ({detail})',

  'contact.searchHint': 'Search by name, phone or email',
  'contact.searching': 'Searching…',
  'contact.noResults': 'No contact matches.',
  'contact.selected': 'Lead: {name}',
  'contact.change': 'Change',
  'contact.usingId': 'Using the pasted uuid.',
  'contact.unavailable': 'The directory is not reachable; paste the contact uuid.',
  'reservations.form.customerHint': '00000000-0000-0000-0000-000000000000',

  'user.unavailable': 'Could not load the team.',
  'wizard.booking.sellerNone': 'No owner',
}

const DICTS: Record<Lang, Record<Key, string>> = { es, en }

/**
 * Only the language matters; es-CO and es-419 are the same copy for us.
 *
 * The BROWSER does not get a vote: Daguito's own chrome is Spanish whatever the
 * browser is set to, and an English "Reservations" under a Spanish "Inicio"
 * reads as a bug. So the host decides, and Spanish is the answer until it says
 * otherwise.
 */
export function resolveLang(locale?: string): Lang {
  return (locale ?? '').toLowerCase().startsWith('en') ? 'en' : 'es'
}

export type Translator = {
  lang: Lang
  /** `t('home.offline', { detail })` fills the {placeholders}. */
  t: (key: Key, vars?: Record<string, string | number>) => string
  /**
   * Plural form. Pass the base key: `plural(3, 'rooms.count')` picks
   * `rooms.count_one` or `rooms.count_other` and fills `{n}`. Both languages
   * only distinguish one from many, so a single rule covers them.
   */
  plural: (n: number, key: string, vars?: Record<string, string | number>) => string
}

export function translator(locale?: string): Translator {
  const lang = resolveLang(locale)
  const dict = DICTS[lang]

  const fill = (template: string, vars?: Record<string, string | number>) =>
    vars
      ? template.replace(/\{(\w+)\}/g, (match, name: string) =>
          name in vars ? String(vars[name]) : match,
        )
      : template

  const t = (key: Key, vars?: Record<string, string | number>) => fill(dict[key], vars)

  const plural = (n: number, key: string, vars?: Record<string, string | number>) => {
    const form = `${key}${n === 1 ? '_one' : '_other'}` as Key
    // A missing plural key is a bug in the caller, not in the dictionary: show
    // the number rather than "undefined", so the UI still reads.
    const template = dict[form] ?? '{n}'
    return fill(template, { n, ...vars })
  }

  return { lang, t, plural }
}
