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
  'workspace.room.optional':
    'Esta consulta no necesita videollamada. Abre la sala solo si quieres sumar a alguien: un acudiente, una interconsulta, un intérprete.',
  'workspace.room.open': 'Abrir la sala',
  'workspace.recording': 'Grabando',
  'workspace.stream.connecting': 'Conectando el motor…',
  'workspace.stream.live': 'Escuchando',
  'workspace.stream.speaking': 'Escuchando · entra audio',
  'workspace.stream.silent': 'Escuchando · sin audio del micrófono',
  'workspace.stream.unconfigured': 'Sin motor de transcripción',
  'workspace.stream.error': 'Motor no disponible',
  'patient.title': 'Consulta médica',
  'patient.mic.on': 'Micrófono activo',
  'patient.mic.muted': 'Micrófono silenciado',
  'patient.mic.off': 'Sin micrófono — la consulta sigue',
  'patient.invalid': 'Este enlace no es válido o ya venció. Pídele al consultorio uno nuevo.',
  'patient.finished': 'Esta consulta ya terminó.',
  'patient.offline': 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.',
  'patient.link.copied': 'Enlace del paciente copiado',
  'workspace.patientLink': 'Enlace del paciente',
  'nav.templates': 'Plantillas',
  'template.bot.title': 'Asistente de plantilla',
  'template.bot.intro':
    'Pídeme cambios sobre esta plantilla en lenguaje natural. Yo la edito; el texto fijo que escribiste se queda como está.',
  'template.bot.eg1': 'Crea un campo de motivo de consulta.',
  'template.bot.eg2': 'Agrega una sección de signos de alarma al final.',
  'template.bot.eg3': 'En el Plan, pide también la fecha del control.',
  'template.bot.placeholder': 'Pide un cambio…',
  'template.bot.send': 'Enviar',
  'template.bot.thinking': 'Editando…',
  'template.bot.silent': 'No recibí respuesta del asistente.',
  'template.new': 'Nueva plantilla',
  'template.new.title': 'Plantilla sin título',
  'template.title': 'Nombre de la plantilla',
  'template.empty': 'Todavía no hay plantillas.',
  'template.noBody': 'Sin estructura — no guía la nota',
  'template.personal': 'Personal',
  'template.retired': 'Plantilla retirada (hay consultas que la usan)',
  'template.deleted': 'Plantilla eliminada',
  'template.delete.title': '¿Eliminar la plantilla?',
  'consent.title': 'Permiso de transcripción',
  'consent.doctorNote':
    'Asegúrate de tener el consentimiento verbal del acompañante antes de continuar.',
  'consent.scriptLabel': 'Guion para leer en voz alta',
  'consent.script':
    '«¿Me autorizan a usar el asistente digital para transcribir nuestra conversación? Me ayuda a armar la historia clínica más rápido y sin dejar de mirarlos.»',
  'consent.accept': 'El acompañante aceptó',
  'consent.saving': 'Guardando…',
  'workspace.finished': 'Consulta finalizada',
  'workspace.transcript.emptyHint':
    'Se irá llenando con lo que se hable, en cuanto inicies la consulta.',
  'workspace.recommendations.emptyHint':
    'El motor las propone a medida que avanza la conversación.',
  'layout.resize': 'Ajustar el tamaño',
  'layout.move': 'Mover el panel',
  'workspace.room.ended': 'La reunión terminó',
  'workspace.room.endedInPerson': 'Consulta finalizada',
  'mic.active': 'Micrófono activo',
  'mic.idle': 'Consulta sin iniciar',
  'mic.inPerson': 'Consulta presencial',
  'workspace.mute': 'Silenciar',
  'workspace.unmute': 'Activar micrófono',
  'workspace.stream.muted': 'Micrófono silenciado',
  'workspace.stream.upload': 'Se transcribe desde el archivo',
  'workspace.panel.audio': 'Grabación',
  'workspace.audio.empty': 'Todavía no hay grabación',
  'workspace.audio.upload': 'Subir grabación',
  'workspace.audio.processing': 'Transcribiendo la grabación…',
  'workspace.audio.failed': 'La transcripción falló',
  'workspace.audio.retry': 'Reintentar',
  'workspace.audio.replace': 'Reemplazar',
  'workspace.audio.remove': 'Quitar',
  // La barra del editor de markdown (components/MarkdownEditor.tsx): la nota y
  // la plantilla son markdown, y estos botones escriben los mismos marcadores
  // que el médico teclearía.
  'editor.bold': 'Negrita (⌘B)',
  'editor.italic': 'Cursiva (⌘I)',
  'editor.list': 'Lista',

  'template.body': 'Estructura de la nota',
  'template.body.hint':
    'Escribe tu plantilla y marca cada dato a extraer con [[descripción del dato]]. El motor rellena esos huecos y deja el resto tal cual.',
  'template.body.save': 'Guardar plantilla',
  'template.body.saved': 'Plantilla guardada',
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
  'workspace.chat.pending':
    'El asistente aún no está conectado; tu mensaje queda guardado en el hilo.',
  'workspace.chat.thinking': 'El asistente está pensando…',
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
  'workspace.room.optional':
    'This consultation needs no video call. Open the room only to bring somebody in: a guardian, a second opinion, an interpreter.',
  'workspace.room.open': 'Open the room',
  'workspace.recording': 'Recording',
  'workspace.stream.connecting': 'Connecting the engine…',
  'workspace.stream.live': 'Listening',
  'workspace.stream.speaking': 'Listening · audio coming in',
  'workspace.stream.silent': 'Listening · no audio from the microphone',
  'workspace.stream.unconfigured': 'No transcription engine',
  'patient.title': 'Medical consultation',
  'patient.mic.on': 'Microphone on',
  'patient.mic.muted': 'Microphone muted',
  'patient.mic.off': 'No microphone — the call continues',
  'patient.invalid': 'This link is not valid or has expired. Ask the practice for a new one.',
  'patient.finished': 'This consultation has ended.',
  'patient.offline': 'We could not connect. Check your connection and try again.',
  'patient.link.copied': 'Patient link copied',
  'workspace.patientLink': 'Patient link',
  'nav.templates': 'Templates',
  'template.bot.title': 'Template assistant',
  'template.bot.intro':
    'Ask for changes to this template in plain language. I edit it; the fixed text you wrote stays as it is.',
  'template.bot.eg1': 'Add a chief-complaint field.',
  'template.bot.eg2': 'Add a warning-signs section at the end.',
  'template.bot.eg3': 'In the Plan, also ask for the follow-up date.',
  'template.bot.placeholder': 'Ask for a change…',
  'template.bot.send': 'Send',
  'template.bot.thinking': 'Editing…',
  'template.bot.silent': 'The assistant did not answer.',
  'template.new': 'New template',
  'template.new.title': 'Untitled template',
  'template.title': 'Template name',
  'template.empty': 'No templates yet.',
  'template.noBody': 'No structure — it does not steer the note',
  'template.personal': 'Personal',
  'template.retired': 'Template retired (consultations still use it)',
  'template.deleted': 'Template deleted',
  'template.delete.title': 'Delete this template?',
  'consent.title': 'Recording permission',
  'consent.doctorNote':
    'Make sure you have verbal consent from the accompanying adult before continuing.',
  'consent.scriptLabel': 'Script to read aloud',
  'consent.script':
    '"May I use the digital assistant to transcribe our conversation? It helps me write the clinical record faster and without looking away from you."',
  'consent.accept': 'The accompanying adult agreed',
  'consent.saving': 'Saving…',
  'workspace.finished': 'Consultation finished',
  'workspace.transcript.emptyHint':
    'It fills in with what is said, as soon as you start the consultation.',
  'workspace.recommendations.emptyHint': 'The engine suggests them as the conversation goes on.',
  'layout.resize': 'Resize',
  'layout.move': 'Move panel',
  'workspace.room.ended': 'The meeting has ended',
  'workspace.room.endedInPerson': 'Consultation finished',
  'mic.active': 'Microphone on',
  'mic.idle': 'Consultation not started',
  'mic.inPerson': 'In-person consultation',
  'workspace.mute': 'Mute',
  'workspace.unmute': 'Unmute',
  'workspace.stream.muted': 'Microphone muted',
  'workspace.stream.upload': 'Transcribed from the file',
  'workspace.panel.audio': 'Recording',
  'workspace.audio.empty': 'No recording yet',
  'workspace.audio.upload': 'Upload a recording',
  'workspace.audio.processing': 'Transcribing the recording…',
  'workspace.audio.failed': 'The transcription failed',
  'workspace.audio.retry': 'Retry',
  'workspace.audio.replace': 'Replace',
  'workspace.audio.remove': 'Remove',
  'editor.bold': 'Bold (⌘B)',
  'editor.italic': 'Italic (⌘I)',
  'editor.list': 'List',

  'template.body': 'Note structure',
  'template.body.hint':
    'Write your template and mark each value to extract with [[a description of it]]. The engine fills those blanks and leaves everything else exactly as written.',
  'template.body.save': 'Save template',
  'template.body.saved': 'Template saved',

  'workspace.stream.error': 'Engine unavailable',
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
  'workspace.chat.pending':
    'The assistant is not connected yet; your message is kept in the thread.',
  'workspace.chat.thinking': 'The assistant is thinking…',
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
