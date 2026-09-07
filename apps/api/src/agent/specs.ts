/**
 * WHAT the Daguito agent may call — the declarations, with no implementation.
 *
 * Split from the handlers so that anything which only needs the NAMES can have
 * them without dragging a database connection in: `src/flows` binds these tools
 * to the published flow, and `scripts/flows/sync.ts` runs from a laptop with no
 * DATABASE_URL at all. The handlers live next door in `functions.ts`.
 *
 * A tool NAME is a contract the agent's prompt already knows, so it is the one
 * thing here that may stay in the client's language; everything else is English.
 */

export type ToolSpec = {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
}

const TEMPLATE_ID = {
  type: 'string',
  description:
    'El identificador de la plantilla, tal como aparece en tus instrucciones. Cópialo exactamente.',
}

/**
 * The template assistant's five edit tools.
 *
 * The names, descriptions and parameter schemas are the legacy's, translated
 * nowhere: they are the contract the model was tuned against. The legacy
 * registers them as CLIENT tools over its websocket session
 * (`session.RegisterTool`), which the JS SDK has no equivalent for — 0.3.15 is
 * the latest published and exposes no such API. So they are bound to the flow
 * (`src/flows`) and Daguito calls them over HTTP instead.
 *
 * `template_id` is the parameter the websocket version does not need: the
 * legacy holds the working body in memory for the length of a turn, and over
 * HTTP there is no session, so each call has to say which document it means.
 * The model is told the id in the system prompt (`{{template_id}}`).
 */
export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'replace_section',
    description:
    "Reemplaza el cuerpo de una sección de la plantilla por completo, manteniendo el heading. Úsala cuando el doctor pida 'edita la sección X', 'reescribe el plan', 'cambia el subjetivo'.",
    parameters: {
    type: 'object',
    properties: {
      template_id: TEMPLATE_ID,
      section: {
        type: 'string',
        description:
          "Nombre de la sección (case/acento-insensitive). Ej: 'Plan', 'Subjetivo', 'Análisis'.",
      },
      new_content: {
        type: 'string',
        description:
          'El nuevo cuerpo en markdown. NO incluyas el heading — solo el contenido que va debajo.',
      },
    },
    required: ['template_id', 'section', 'new_content'],
    },
  },
  {
    name: 'insert_after',
    description:
    "Inserta contenido nuevo en la línea siguiente a un texto ancla. Úsala cuando el doctor pida 'agrega X después de Y', 'añade una fila debajo de Z'. El ancla debe ser único — incluye contexto si es necesario.",
    parameters: {
    type: 'object',
    properties: {
      template_id: TEMPLATE_ID,
      anchor: {
        type: 'string',
        description:
          'Texto que ya existe en la plantilla, copiado exactamente (case y espacios sensitivos). Debe ser único.',
      },
      content: {
        type: 'string',
        description: 'El bloque markdown a insertar inmediatamente después de la línea del ancla.',
      },
    },
    required: ['template_id', 'anchor', 'content'],
    },
  },
  {
    name: 'replace_text',
    description:
    'Reemplaza un fragmento de texto exacto por otro. Úsala para cambios puntuales: corregir una palabra, cambiar una dosis, reemplazar un placeholder. El old_string debe ser único salvo que pases replace_all=true.',
    parameters: {
    type: 'object',
    properties: {
      template_id: TEMPLATE_ID,
      old_string: {
        type: 'string',
        description:
          'Texto a reemplazar, copiado exactamente. Incluye contexto suficiente para que sea único.',
      },
      new_string: { type: 'string', description: 'El texto que lo reemplaza.' },
      replace_all: {
        type: 'boolean',
        description: 'true para reemplazar TODAS las apariciones. Omítelo para reemplazar una.',
      },
    },
    required: ['template_id', 'old_string', 'new_string'],
    },
  },
  {
    name: 'delete_section',
    description: 'Borra una sección completa (su encabezado y su cuerpo).',
    parameters: {
    type: 'object',
    properties: {
      template_id: TEMPLATE_ID,
      section: { type: 'string', description: 'Nombre de la sección a borrar.' },
    },
    required: ['template_id', 'section'],
    },
  },
  {
    name: 'append_content',
    description:
    "Crea contenido desde cero cuando la plantilla está vacía, o agrega un bloque nuevo al FINAL cuando no hay un ancla/encabezado existente al que apuntar. Úsala cuando el doctor pida 'crea la plantilla' sobre un documento vacío, o 'agrega esto al final'.",
    parameters: {
    type: 'object',
    properties: {
      template_id: TEMPLATE_ID,
      content: {
        type: 'string',
        description:
          'El bloque markdown a agregar al final de la plantilla (o el contenido completo si la plantilla está vacía).',
      },
    },
    required: ['template_id', 'content'],
    },
  },
]
