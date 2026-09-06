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
  'nav.consultations': 'Consultas',

  // ── Consultas médicas (pages/consultations.tsx) ────────────────────
  'consultations.title': 'Consultas médicas',
  'consultations.new': 'Nueva consulta',
  'consultations.count_one': '{n} consulta',
  'consultations.count_other': '{n} consultas',
  'consultations.searchLabel': 'Buscar',
  'consultations.searchHint': 'Nombre del paciente o de la consulta',
  'consultations.dateLabel': 'Día',
  'consultations.clearFilters': 'Quitar filtros',
  'consultations.empty': 'Sin consultas.',
  'consultations.emptyBody': 'Crea la primera consulta para empezar a grabar.',
  'consultations.emptyFiltered': 'Nada coincide.',
  'consultations.emptyFilteredBody': 'Ninguna consulta coincide con la búsqueda o el día elegido.',
  'consultations.error': 'No se pudieron cargar las consultas: {detail}',
  // The name a consultation with no title and no patient falls back to.
  'consultations.unnamed': 'Consulta del {date}',
  'consultations.col.name': 'Consulta',
  'consultations.col.date': 'Fecha',
  'consultations.col.status': 'Estado',
  'consultations.col.template': 'Plantilla',
  'consultations.col.duration': 'Duración',
  'consultations.noTemplate': 'Sin plantilla',
  'consultations.tab.all': 'Todas',
  'consultations.mode.video': 'Videoconsulta',
  'consultations.mode.inPerson': 'Presencial',
  'consultations.mode.transcription': 'Transcripción',
  'consultations.status.draft': 'Borrador',
  'consultations.status.initial': 'Pendiente',
  'consultations.status.recording': 'Grabando',
  'consultations.status.processing': 'Procesando',
  'consultations.status.finished': 'Finalizada',
  'consultations.form.mode': 'Tipo de consulta',
  'consultations.form.patient': 'Paciente',
  'consultations.form.patientName': 'Nombre del paciente',
  'consultations.form.name': 'Título (opcional)',
  'consultations.form.template': 'Plantilla',
  'consultations.form.notes': 'Notas',
  'consultations.rename': 'Renombrar consulta',
  'consultations.renameField': 'Título',
  'consultations.deleteTitle': 'Eliminar consulta',
  'consultations.deleteBody': '«{name}» se elimina definitivamente. No se puede deshacer.',
  'consultations.toast.created': 'Consulta creada.',
  'consultations.toast.renamed': 'Consulta renombrada.',
  'consultations.toast.deleted': 'Consulta eliminada.',
  'consultations.action.open': 'Abrir',
  'consultations.action.join': 'Sala',
  'consultations.action.resume': 'Continuar',
  'consultations.action.rename': 'Renombrar',
  'consultations.action.delete': 'Eliminar',
  'consultations.consent': 'Consentimiento registrado',

  // ── Sala de video (components/MeetingRoom.tsx) ─────────────────────
  'meeting.title': 'Sala · {name}',
  'meeting.connecting': 'Conectando con la sala…',
  'meeting.hint': 'La sala queda abierta mientras el diálogo esté abierto.',
  'meeting.finishedHint': 'Esta consulta ya está cerrada; la sala es solo para consultarla.',
  'meeting.leave': 'Salir de la sala',
  'meeting.error': 'No se pudo abrir la sala: {detail}',

  // ── Pantalla de consulta (pages/consultation.tsx) ──────────────────
  'workspace.title': 'Consulta médica',
  'workspace.back': 'Volver',
  'workspace.start': 'Iniciar consulta',
  'workspace.stop': 'Detener consulta',
  'workspace.joinFirst': 'Ingresa a la reunión para iniciar',
  'workspace.recording': 'Grabando',
  'workspace.panel.meeting': 'Reunión',
  'workspace.panel.chatbot': 'Asistente',
  'workspace.panel.transcription': 'Transcripción',
  'workspace.panel.recommendations': 'Recomendaciones',
  'workspace.panel.note': 'Nota clínica',
  'workspace.error': 'No se pudo cargar la consulta: {detail}',
  'workspace.recommendations.empty': 'No hay recomendaciones disponibles',
  'workspace.recommendations.feature': 'Destacar',
  'workspace.recommendations.discard': 'Descartar',
  'workspace.note.empty': 'Sin nota clínica disponible',
  'workspace.note.write': 'Escribir la nota',
  'workspace.note.draft': 'Borrador generado — revísalo antes de firmarlo.',
  'workspace.note.edited': 'Editada por ti.',
  'workspace.transcript.empty': 'La transcripción aparece aquí mientras hablan.',
  'workspace.transcript.doctor': 'Doctor',
  'workspace.transcript.patient': 'Paciente',
  'workspace.chat.title': 'Asistente clínico',
  'workspace.chat.intro': 'Pregúntale sobre esta consulta.',
  'workspace.chat.placeholder': 'Escribe un mensaje…',
  'workspace.chat.send': 'Enviar',
  'workspace.chat.pending': 'El asistente aún no está conectado; tu mensaje queda guardado en el hilo.',
  'workspace.chat.disclaimer':
    'El asistente se basa en IA y puede equivocarse. Revisa y valida con tu criterio clínico.',

  'pager.previous': 'Anterior',
  'pager.next': 'Siguiente',
  'pager.summary': 'Página {page} de {pages}',

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
  'nav.consultations': 'Consultations',

  'consultations.title': 'Medical consultations',
  'consultations.new': 'New consultation',
  'consultations.count_one': '{n} consultation',
  'consultations.count_other': '{n} consultations',
  'consultations.searchLabel': 'Search',
  'consultations.searchHint': "Patient's or consultation's name",
  'consultations.dateLabel': 'Day',
  'consultations.clearFilters': 'Clear filters',
  'consultations.empty': 'No consultations yet.',
  'consultations.emptyBody': 'Create the first consultation to start recording.',
  'consultations.emptyFiltered': 'Nothing matches.',
  'consultations.emptyFilteredBody': 'No consultation matches the search or the chosen day.',
  'consultations.error': 'Could not load the consultations: {detail}',
  'consultations.unnamed': 'Consultation of {date}',
  'consultations.col.name': 'Consultation',
  'consultations.col.date': 'Date',
  'consultations.col.status': 'Status',
  'consultations.col.template': 'Template',
  'consultations.col.duration': 'Length',
  'consultations.noTemplate': 'No template',
  'consultations.tab.all': 'All',
  'consultations.mode.video': 'Video',
  'consultations.mode.inPerson': 'In person',
  'consultations.mode.transcription': 'Transcription',
  'consultations.status.draft': 'Draft',
  'consultations.status.initial': 'Pending',
  'consultations.status.recording': 'Recording',
  'consultations.status.processing': 'Processing',
  'consultations.status.finished': 'Finished',
  'consultations.form.mode': 'Consultation type',
  'consultations.form.patient': 'Patient',
  'consultations.form.patientName': "Patient's name",
  'consultations.form.name': 'Title (optional)',
  'consultations.form.template': 'Template',
  'consultations.form.notes': 'Notes',
  'consultations.rename': 'Rename consultation',
  'consultations.renameField': 'Title',
  'consultations.deleteTitle': 'Delete consultation',
  'consultations.deleteBody': '"{name}" is deleted for good. This cannot be undone.',
  'consultations.toast.created': 'Consultation created.',
  'consultations.toast.renamed': 'Consultation renamed.',
  'consultations.toast.deleted': 'Consultation deleted.',
  'consultations.action.open': 'Open',
  'consultations.action.join': 'Room',
  'consultations.action.resume': 'Resume',
  'consultations.action.rename': 'Rename',
  'consultations.action.delete': 'Delete',
  'consultations.consent': 'Consent on file',

  'meeting.title': 'Room · {name}',
  'meeting.connecting': 'Connecting to the room…',
  'meeting.hint': 'The room stays open while this dialog is.',
  'meeting.finishedHint': 'This consultation is closed; the room is read-only.',
  'meeting.leave': 'Leave the room',
  'meeting.error': 'Could not open the room: {detail}',

  'workspace.title': 'Medical consultation',
  'workspace.back': 'Back',
  'workspace.start': 'Start consultation',
  'workspace.stop': 'Stop consultation',
  'workspace.joinFirst': 'Join the room to start',
  'workspace.recording': 'Recording',
  'workspace.panel.meeting': 'Meeting',
  'workspace.panel.chatbot': 'Assistant',
  'workspace.panel.transcription': 'Transcript',
  'workspace.panel.recommendations': 'Recommendations',
  'workspace.panel.note': 'Clinical note',
  'workspace.error': 'Could not load the consultation: {detail}',
  'workspace.recommendations.empty': 'No recommendations yet',
  'workspace.recommendations.feature': 'Pin',
  'workspace.recommendations.discard': 'Discard',
  'workspace.note.empty': 'No clinical note yet',
  'workspace.note.write': 'Write the note',
  'workspace.note.draft': 'Generated draft — review it before signing.',
  'workspace.note.edited': 'Edited by you.',
  'workspace.transcript.empty': 'The transcript appears here as they speak.',
  'workspace.transcript.doctor': 'Doctor',
  'workspace.transcript.patient': 'Patient',
  'workspace.chat.title': 'Clinical assistant',
  'workspace.chat.intro': 'Ask it about this consultation.',
  'workspace.chat.placeholder': 'Type a message…',
  'workspace.chat.send': 'Send',
  'workspace.chat.pending': 'The assistant is not connected yet; your message is kept in the thread.',
  'workspace.chat.disclaimer':
    'The assistant is AI-based and can be wrong. Review and validate with your clinical judgement.',

  'pager.previous': 'Previous',
  'pager.next': 'Next',
  'pager.summary': 'Page {page} of {pages}',

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
