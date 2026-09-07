/**
 * The two tools that let the assistant write the clinical note.
 *
 * This is what "Dr. Midulabs" actually is: not a chat beside the note, but an
 * assistant that fills it. The doctor says "pon en el plan control en 48 horas"
 * and the field is written — the fixed text they authored untouched, because
 * only the field's span is replaced (lib/note-fill.ts).
 *
 * Registered per TURN as client tools over the same websocket the turn runs on
 * (lib/client-tools.ts), which is exactly what the legacy's
 * `session.RegisterTool` does. They are not in `agent/functions.ts` because
 * they are not org-wide agent functions: they are scoped to ONE consultation
 * for the length of one exchange, and nothing outside that turn may call them.
 *
 * The names, descriptions and parameters are the legacy's, unchanged: they are
 * the contract the model was tuned against.
 */
import type { ClientTool } from '../lib/client-tools'
import { fillField, matchField, noteFields } from '../lib/note-fill'
import { getNote, saveNote } from './repos/workspace-repo'
import { getConsultation } from './repos/consultations-repo'
import { getTemplate } from './repos/templates-repo'

/**
 * The working document and the template it was rendered from.
 *
 * Read fresh on every call rather than held for the turn: the tools chain
 * ("fill the plan, then the diagnosis"), and each call has to see what the
 * previous one wrote. The legacy keeps it in a session; over a turn that
 * persists per call, the row is the session.
 */
async function workingDoc(orgId: string, consultationId: string) {
  const consultation = await getConsultation(orgId, consultationId)
  if (!consultation) throw new Error('consultation not found')
  const [note, template] = await Promise.all([
    getNote(orgId, consultationId),
    consultation.template_id ? getTemplate(orgId, consultation.template_id) : null,
  ])
  const templateBody = template?.body ?? ''
  // No note yet: the template's skeleton IS the working document, which is what
  // lets the assistant fill fields before any transcription has produced one.
  const doc = note?.body?.trim() ? note.body : templateBody
  return { doc, templateBody, templateId: consultation.template_id }
}

export function noteTools(p: { orgId: string; consultationId: string }): ClientTool[] {
  const { orgId, consultationId } = p

  return [
    {
      spec: {
        name: 'get_template_structure',
        description:
          "Devuelve la nota clínica actual y la lista EXACTA de sus campos: cada uno con su etiqueta, su instrucción, su estado ('empty' o 'filled') y, si está lleno, su contenido actual. Úsala SIEMPRE antes de rellenar o sobrescribir, para saber qué campos existen y qué ya tienen. Nunca asumas campos que no aparezcan aquí.",
        parameters: { type: 'object', properties: {} },
      },
      run: async () => {
        const { doc, templateBody } = await workingDoc(orgId, consultationId)
        const fields = noteFields(doc, templateBody)

        if (!doc.trim() && !fields.length) {
          return {
            has_template: false,
            current_note: '',
            fields: [],
            empty_count: 0,
            note: 'Esta consulta no tiene ninguna plantilla asignada, así que no hay campos que rellenar.',
          }
        }

        return {
          has_template: true,
          current_note: doc,
          empty_count: fields.filter((field) => field.empty).length,
          fields: fields.map((field) => ({
            label: field.label,
            ...(field.hint ? { hint: field.hint } : {}),
            status: field.empty ? 'empty' : 'filled',
            ...(field.empty ? {} : { current_value: field.value }),
          })),
        }
      },
    },
    {
      spec: {
        name: 'fill_field',
        description:
          'Escribe el contenido de UN campo que ya existe en la nota (de los que devuelve get_template_structure), conservando intactos el texto fijo y la etiqueta. Por defecto solo rellena campos vacíos. Para REEMPLAZAR el contenido de un campo que ya tiene datos, pasa overwrite=true — pero SOLO cuando el doctor lo haya pedido explícitamente. NUNCA crees, renombres, reordenes ni borres campos o estructura. Una llamada por campo.',
        parameters: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description:
                "La etiqueta EXACTA del campo, tal como la devuelve get_template_structure (ej: 'Solicitud de exámenes'). Insensible a mayúsculas/acentos.",
            },
            value: {
              type: 'string',
              description:
                'El contenido que va dentro del campo. Texto plano, SIN encabezados, etiquetas ni markdown de estructura. Si es una ampliación de un campo lleno, incluye aquí el contenido COMPLETO final (reemplaza al anterior).',
            },
            overwrite: {
              type: 'boolean',
              description:
                'true para reemplazar el contenido de un campo que YA tiene datos. Úsalo solo cuando el doctor pidió explícitamente sobrescribir/reemplazar/ampliar ese campo. Omítelo (false) para campos vacíos.',
            },
          },
          required: ['field', 'value'],
        },
      },
      run: async (args) => {
        const name = String(args.field ?? '').trim()
        const value = String(args.value ?? '').trim()
        if (!name || !value) {
          return {
            success: false,
            error: "Se requieren 'field' (la etiqueta del campo) y 'value' (el contenido).",
          }
        }

        const { doc, templateBody, templateId } = await workingDoc(orgId, consultationId)
        const fields = noteFields(doc, templateBody)
        const index = matchField(fields, name)

        if (index < 0) {
          // The available labels, so the model's next attempt is informed
          // rather than another guess — and it is told not to invent one.
          return {
            success: false,
            error: `No existe un campo que coincida con "${name}". NO inventes ni crees campos: usa solo los que existen.`,
            available_fields: fields.map((field) => field.label),
          }
        }

        const field = fields[index]!
        if (!field.empty && args.overwrite !== true) {
          // A field with content is the doctor's writing. Overwriting it is
          // something they have to have asked for, so the model is sent back
          // to confirm instead of being allowed to decide.
          return {
            success: false,
            needs_confirm: true,
            error: `El campo "${field.label}" ya tiene contenido: "${field.value}". Si el doctor pidió reemplazarlo, vuelve a llamar con overwrite=true. Si NO lo pidió, primero confírmalo con él.`,
            current_value: field.value,
          }
        }

        const next = fillField(doc, field, value)
        await saveNote({
          orgId,
          consultationId,
          body: next,
          templateId,
          // `doctor`: this IS the doctor writing, through the assistant. An
          // `engine` write would be refused on a note they had already edited,
          // which is the one case where they are certainly editing it.
          source: 'doctor',
        })

        return {
          success: true,
          field: field.label,
          action: field.empty ? 'completado' : 'sobrescrito',
          remaining_empty: noteFields(next, templateBody).filter((f) => f.empty).length,
        }
      },
    },
  ]
}
