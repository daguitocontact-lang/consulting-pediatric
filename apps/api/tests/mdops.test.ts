/**
 * The markdown edit primitives the template assistant is built out of.
 *
 * Ported alongside `src/lib/mdops.ts` from the legacy's `pkg/mdops` tests. This
 * is where the assistant's whole editing surface is actually verified: the
 * model chooses WHICH operation, but what an operation does to the doctor's
 * template is decided here, and a wrong offset silently rewrites part of a
 * clinical document.
 */
import { describe, expect, test } from 'bun:test'
import {
  MdError,
  append,
  deleteSection,
  insertAfter,
  normalizeTitle,
  replaceSection,
  replaceText,
  sectionTitles,
} from '../src/lib/mdops'

const DOC = `# Nota

## Motivo

[[el motivo]]

## Plan

Control en 48 h.

### Medicación

Acetaminofén.

## Observaciones

Ninguna.
`

/** Every operation promises this: applying the change to the old document by
 *  plain splice reproduces the returned document exactly. */
const splices = (doc: string, result: { doc: string; change: { start_idx: number; end_idx: number; new: string } }) =>
  doc.slice(0, result.change.start_idx) + result.change.new + doc.slice(result.change.end_idx) ===
  result.doc

describe('finding a section', () => {
  test('a heading is found however the model spells it', () => {
    // "Plan", "plan", "PLAN:" and an accented title all have to resolve, or the
    // model burns a turn on a lookup that should have worked.
    for (const name of ['Plan', 'plan', 'PLAN', 'Plan:', '  plan  ']) {
      expect(replaceSection(DOC, name, 'nuevo').doc).toContain('nuevo')
    }
  })

  test('accents fold', () => {
    expect(normalizeTitle('Análisis')).toBe('analisis')
    expect(normalizeTitle('MEDICACIÓN:')).toBe('medicacion')
    expect(normalizeTitle('  Plan   terapéutico ')).toBe('plan terapeutico')
  })

  test('a partial name resolves when it is unambiguous', () => {
    // The model says "Medicación"; the heading is "### Medicación".
    const out = replaceSection(DOC, 'medicacion', 'Ibuprofeno.')
    expect(out.doc).toContain('Ibuprofeno.')
  })

  test('a name that matches nothing says what IS available', () => {
    // The hint is the whole point: it turns the model's next attempt into an
    // informed one instead of another guess.
    try {
      replaceSection(DOC, 'Antecedentes', 'x')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(MdError)
      expect((err as MdError).kind).toBe('section_not_found')
      expect((err as MdError).message).toContain('Motivo')
      expect((err as MdError).message).toContain('Plan')
    }
  })

  test('a duplicated heading is ambiguous, not a coin flip', () => {
    const doc = '## Plan\n\na\n\n## Plan\n\nb\n'
    expect(() => replaceSection(doc, 'Plan', 'x')).toThrow(MdError)
    try {
      replaceSection(doc, 'Plan', 'x')
    } catch (err) {
      expect((err as MdError).kind).toBe('section_ambiguous')
    }
  })

  test('the titles come back in document order', () => {
    expect(sectionTitles(DOC)).toEqual(['Nota', 'Motivo', 'Plan', 'Medicación', 'Observaciones'])
  })
})

describe('replace_section', () => {
  test('the heading survives; only the body changes', () => {
    // The heading is the anchor every later edit resolves against. Rewriting it
    // here would silently break the next operation.
    //
    // The body starts on the line straight after the heading — no blank line.
    // That is the legacy's behaviour (its own test asserts
    // `"## Plan\n1. Reposo"`), because the normalised body carries its trailing
    // blank line and no leading one. Markdown renders it the same; the reason
    // to keep it identical is that these offsets are applied as a splice by the
    // client, and "tidying" it here would desynchronise the two.
    const out = replaceSection(DOC, 'Plan', 'Control en 24 h.')
    expect(out.doc).toContain('## Plan\nControl en 24 h.')
    expect(out.doc).not.toContain('Control en 48 h.')
    expect(splices(DOC, out)).toBe(true)
  })

  test('a subsection belongs to its parent and is replaced with it', () => {
    // `### Medicación` is deeper than `## Plan`, so it is inside Plan's body.
    const out = replaceSection(DOC, 'Plan', 'Solo control.')
    expect(out.doc).not.toContain('Acetaminofén.')
    // The next SIBLING heading is untouched.
    expect(out.doc).toContain('## Observaciones')
  })

  test('writing the same content back is refused, not applied', () => {
    const once = replaceSection(DOC, 'Plan', 'Control en 24 h.')
    try {
      replaceSection(once.doc, 'Plan', 'Control en 24 h.')
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as MdError).kind).toBe('no_change')
    }
  })

  test('re-editing does not drift the spacing around the section', () => {
    let doc = DOC
    for (const body of ['a', 'b', 'c']) doc = replaceSection(doc, 'Plan', body).doc
    // Three edits, one blank line before the next heading — not three.
    expect(doc).toContain('## Plan\nc\n\n## Observaciones')
  })
})

describe('insert_after', () => {
  test('content lands on the line after the anchor', () => {
    const out = insertAfter(DOC, 'Control en 48 h.', 'Reposo relativo.')
    expect(out.doc).toContain('Control en 48 h.\nReposo relativo.\n')
    expect(splices(DOC, out)).toBe(true)
  })

  test('an anchor that appears twice is refused', () => {
    // Guessing which one costs the doctor an edit somewhere they were not
    // looking.
    const doc = 'hola\n\nhola\n'
    try {
      insertAfter(doc, 'hola', 'x')
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as MdError).kind).toBe('anchor_ambiguous')
    }
  })

  test('an anchor on the last line still gets a line of its own', () => {
    const out = insertAfter('una linea', 'una linea', 'otra')
    expect(out.doc).toBe('una linea\notra\n')
  })

  test('an anchor that is not there is a typed miss', () => {
    try {
      insertAfter(DOC, 'no existe', 'x')
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as MdError).kind).toBe('anchor_not_found')
    }
  })
})

describe('replace_text', () => {
  test('an exact fragment is swapped', () => {
    const out = replaceText(DOC, '[[el motivo]]', '[[el motivo de consulta]]')
    expect(out.doc).toContain('[[el motivo de consulta]]')
    expect(splices(DOC, out)).toBe(true)
  })

  test('an ambiguous fragment needs replace_all, and says so', () => {
    const doc = 'dosis\ndosis\n'
    try {
      replaceText(doc, 'dosis', 'dose')
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as MdError).kind).toBe('anchor_ambiguous')
      expect((err as MdError).message).toContain('replace_all')
    }
    expect(replaceText(doc, 'dosis', 'dose', true).doc).toBe('dose\ndose\n')
  })

  test('nothing to do is refused rather than reported as an edit', () => {
    try {
      replaceText(DOC, 'Plan', 'Plan')
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as MdError).kind).toBe('no_change')
    }
  })
})

describe('delete_section', () => {
  test('the heading goes with its body', () => {
    const out = deleteSection(DOC, 'Observaciones')
    expect(out.doc).not.toContain('## Observaciones')
    expect(out.doc).not.toContain('Ninguna.')
    expect(out.doc).toContain('## Plan')
    expect(splices(DOC, out)).toBe(true)
  })
})

describe('append', () => {
  test('an empty template becomes the content — the only way to start one', () => {
    // Every other operation needs existing text to target, so a blank template
    // can only be written by this one.
    const out = append('', '## Motivo\n\n[[el motivo]]')
    expect(out.doc).toBe('## Motivo\n\n[[el motivo]]\n')
    expect(splices('', out)).toBe(true)
  })

  test('exactly one blank line separates the block, however the body ended', () => {
    for (const body of ['texto', 'texto\n', 'texto\n\n']) {
      const out = append(body, 'nuevo')
      expect(out.doc).toBe('texto\n\nnuevo\n')
      expect(splices(body, out)).toBe(true)
    }
  })

  test('empty content is refused', () => {
    try {
      append(DOC, '   ')
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as MdError).kind).toBe('empty_input')
    }
  })
})
