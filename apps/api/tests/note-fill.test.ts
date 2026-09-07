/**
 * Locating a field inside a rendered clinical note.
 *
 * This is where the assistant's write capability lives or dies, and it fails
 * SILENTLY when it is wrong: a mis-located span splices a value into the middle
 * of somebody else's sentence, and the note still looks like a note.
 *
 * The alignment is resilient on purpose. The note is written by an LLM that
 * rarely reproduces the template's fixed text byte for byte — it reformats
 * headings, merges units into values, tweaks spacing. The legacy's strict
 * version failed the WHOLE document on the first drift (83% of their production
 * notes) and left the assistant unable to edit anything.
 */
import { describe, expect, test } from 'bun:test'
import {
  alignFields,
  fillField,
  markerFields,
  matchField,
  noteFields,
  normalizeLabel,
} from '../src/lib/note-fill'

const TEMPLATE = `## Motivo de consulta

[[el motivo por el que consultan]]

## Examen físico

[[hallazgos del examen físico]]

## Plan

[[indicaciones y controles]]
`

const RENDERED = `## Motivo de consulta

Fiebre de 38,5 °C desde ayer.

## Examen físico

_No referido_

## Plan

[[indicaciones y controles]]
`

describe('reading the note through its template', () => {
  test('every field is found, with what it currently holds', () => {
    const fields = alignFields(RENDERED, TEMPLATE)!
    expect(fields.map((f) => f.label)).toEqual([
      'Motivo de consulta',
      'Examen físico',
      'Plan',
    ])
    expect(fields[0]!.value).toBe('Fiebre de 38,5 °C desde ayer.')
    expect(fields[0]!.empty).toBe(false)
  })

  test('"_No referido_" and an untouched placeholder are EMPTY', () => {
    // Both are what the renderer leaves for a slot it had no data for. The
    // assistant may fill them without asking.
    const fields = alignFields(RENDERED, TEMPLATE)!
    expect(fields[1]!.empty).toBe(true)
    expect(fields[2]!.empty).toBe(true)
  })

  test('a real value is NOT empty, however negative it reads', () => {
    // "No se solicitan hoy" is a clinical decision, not a blank. Replacing it
    // has to be something the doctor asked for.
    const doc = RENDERED.replace('_No referido_', 'No se solicitan exámenes hoy.')
    const fields = alignFields(doc, TEMPLATE)!
    expect(fields[1]!.empty).toBe(false)
  })

  test('a heading the model reformatted does not lose the whole note', () => {
    // The failure resilient anchoring exists for: the strict version returned
    // NOTHING here and the assistant could edit no field at all.
    //
    // What survives is precise: a field needs BOTH of its bracketing anchors.
    // `## Examen físico` came back as `**Examen físico:**`, so it is the right
    // edge of "Motivo de consulta" AND the left edge of "Examen físico" — both
    // are skipped rather than mis-spliced, and "Plan" stays editable.
    const drifted = RENDERED.replace('## Examen físico', '**Examen físico:**')
    const fields = alignFields(drifted, TEMPLATE)!
    expect(fields.map((f) => f.label)).toEqual(['Plan'])
  })

  test('a heading that drifts at the END keeps everything before it', () => {
    const drifted = RENDERED.replace('## Plan', '**Plan**')
    const labels = alignFields(drifted, TEMPLATE)!.map((f) => f.label)
    expect(labels).toContain('Motivo de consulta')
  })

  test('a template that cannot be aligned at all falls back to the markers', () => {
    // Nothing of the template survives in the note, so alignment gives up —
    // and `noteFields` still finds what is unfilled.
    const unrecognisable = 'Algo completamente distinto.\n\n_No referido_\n'
    expect(alignFields(unrecognisable, TEMPLATE)).toBeNull()
    expect(noteFields(unrecognisable, TEMPLATE)).toHaveLength(1)
  })

  test('no template, no alignment', () => {
    expect(alignFields(RENDERED, '')).toBeNull()
    expect(alignFields(RENDERED, 'sin ningun hueco')).toBeNull()
  })
})

describe('reading a note with no usable template', () => {
  test('the markers left behind are the fields, in document order', () => {
    const doc = '## Motivo\n\n[[el motivo]]\n\n## Plan\n\n_No referido_\n'
    const fields = markerFields(doc)
    expect(fields.map((f) => f.label)).toEqual(['Motivo', 'Plan'])
    expect(fields.every((f) => f.empty)).toBe(true)
  })

  test('a label never swallows the field before it', () => {
    // Two slots in a row: the second one's label is read back only to the end
    // of the first, not across it.
    const doc = 'Peso [[el peso]] Talla [[la talla]]\n'
    expect(markerFields(doc).map((f) => f.label)).toEqual(['Peso', 'Talla'])
  })
})

describe('finding the field the model asked for', () => {
  const fields = alignFields(RENDERED, TEMPLATE)!

  test('by label, however it is spelled', () => {
    for (const name of ['Plan', 'plan', 'PLAN', 'Plan:']) {
      expect(fields[matchField(fields, name)]!.label).toBe('Plan')
    }
  })

  test('accents fold', () => {
    expect(fields[matchField(fields, 'examen fisico')]!.label).toBe('Examen físico')
    expect(normalizeLabel('Análisis:')).toBe('analisis')
  })

  test('by the HINT, because the model quotes the instruction', () => {
    // It just wrote the content the instruction describes, so that is the
    // phrase it reaches for — not the heading.
    expect(fields[matchField(fields, 'indicaciones y controles')]!.label).toBe('Plan')
  })

  test('a name that matches nothing is a miss, not a wrong guess', () => {
    expect(matchField(fields, 'Antecedentes')).toBe(-1)
    expect(matchField(fields, '')).toBe(-1)
  })
})

describe('writing a field', () => {
  test('only the field changes — every other character is untouched', () => {
    // The doctor's headings, spacing and separators are what the spans are
    // measured from, so overwriting any of them breaks the next edit too.
    const fields = alignFields(RENDERED, TEMPLATE)!
    const plan = fields.find((f) => f.label === 'Plan')!
    const next = fillField(RENDERED, plan, 'Control en 48 h.')

    expect(next).toContain('## Plan\n\nControl en 48 h.')
    expect(next).toContain('Fiebre de 38,5 °C desde ayer.')
    expect(next).toContain('_No referido_')
    // Same document minus exactly the old value plus exactly the new one.
    expect(next.length).toBe(RENDERED.length - (plan.end - plan.start) + 'Control en 48 h.'.length)
  })

  test('filling one field leaves the others findable', () => {
    // Chained calls are the normal case ("fill the plan, then the motivo"), so
    // the document after a write has to align just as well.
    const fields = alignFields(RENDERED, TEMPLATE)!
    const next = fillField(RENDERED, fields[2]!, 'Control en 48 h.')
    const after = alignFields(next, TEMPLATE)!
    expect(after).toHaveLength(3)
    expect(after[2]!.empty).toBe(false)
    expect(after[1]!.empty).toBe(true)
  })
})
