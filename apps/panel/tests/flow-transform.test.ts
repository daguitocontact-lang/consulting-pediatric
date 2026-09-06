/**
 * The consultation flow's output → what the panels store.
 *
 * These shapes are the engine's contract, not ours: the flows are the ones the
 * legacy product publishes in Daguito, and this is the part of the integration
 * that can be checked without a websocket, a microphone or an API key.
 */
import { describe, expect, test } from 'bun:test'
import {
  noteFromState,
  recommendationsFromState,
  transcriptFromEvent,
} from '../src/lib/flow-transform'

describe('recommendations (c_facts)', () => {
  test('reads the four buckets, in the order they are read on screen', () => {
    const items = recommendationsFromState({
      preguntas: ['¿Desde cuándo la fiebre?'],
      posibles_diagnosticos: ['IRA viral'],
      tratamientos: ['Acetaminofén 15 mg/kg'],
      recomendaciones_generales: ['Control en 48 h'],
    })

    expect(items.map((i) => i.category)).toEqual([
      'question',
      'possible_diagnosis',
      'treatment',
      'recommendation',
    ])
    expect(items.map((i) => i.priority)).toEqual([1, 2, 3, 4])
  })

  test('strips the low-confidence marker but keeps the line', () => {
    const [only] = recommendationsFromState({
      posibles_diagnosticos: ['[BAJA CONFIANZA] Neumonía atípica'],
    })

    // The marker is for a filter, not for a doctor to read; dropping the line
    // instead would hide a differential the flow did raise.
    expect(only!.value).toBe('Neumonía atípica')
  })

  test('falls back to the flat list an older flow emits', () => {
    const items = recommendationsFromState({ recomendaciones: ['Hidratación', 'Reposo'] })

    expect(items.map((i) => i.value)).toEqual(['Hidratación', 'Reposo'])
    expect(items.every((i) => i.category === 'recommendation')).toBe(true)
  })

  test('the categorised schema wins over the legacy list', () => {
    const items = recommendationsFromState({
      preguntas: ['¿Tos seca o con flema?'],
      recomendaciones: ['ignorado'],
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.value).toBe('¿Tos seca o con flema?')
  })

  test('ignores empty strings and non-strings without breaking', () => {
    expect(recommendationsFromState({ preguntas: ['', '   ', 42, null] })).toEqual([])
    expect(recommendationsFromState({})).toEqual([])
  })
})

describe('the SOAP note (c_soap)', () => {
  test('markdown from the flow wins verbatim', () => {
    expect(noteFromState({ markdown: '# Nota\n\ncontenido', subjetivo: 'ignorado' })).toBe(
      '# Nota\n\ncontenido',
    )
  })

  test('assembles the four sections in SOAP order', () => {
    const note = noteFromState({
      plan: ['Control en 48 h', 'Signos de alarma'],
      subjetivo: 'Fiebre de 3 días',
      analisis: 'IRA viral',
      objetivo: 'Faringe eritematosa',
    })

    expect(note.split('\n\n').map((block) => block.split('\n')[0])).toEqual([
      '## (S) Subjetivo',
      'Fiebre de 3 días',
      '## (O) Objetivo',
      'Faringe eritematosa',
      '## (A) Análisis',
      'IRA viral',
      '## (P) Plan',
      '- Control en 48 h',
    ])
  })

  test('a section the flow has not filled is omitted, not left empty', () => {
    // An empty heading reads as "we found nothing", which is not the same as
    // "the flow has not said yet".
    const note = noteFromState({ subjetivo: 'Tos', objetivo: '' })

    expect(note).toContain('(S) Subjetivo')
    expect(note).not.toContain('(O) Objetivo')
  })

  test('a state with nothing usable is an empty string, never "undefined"', () => {
    expect(noteFromState({})).toBe('')
  })
})

describe('the transcript', () => {
  test('a partial is never stored', () => {
    // It is rewritten as the speaker keeps talking; storing it leaves
    // half-sentences in the clinical record.
    expect(transcriptFromEvent({ text: 'la niña lleva', is_final: false })).toEqual([])
    expect(transcriptFromEvent({ text: 'la niña lleva', partial: true })).toEqual([])
  })

  test('reads a list of utterances with speakers and times', () => {
    const segments = transcriptFromEvent({
      utterances: [
        // `start` is milliseconds — the unit AssemblyAI emits.
        { speaker: 'A', text: 'Buenos días', start: 3_000 },
        { speaker: 'B', text: 'Tiene fiebre', start: 11_400 },
      ],
    })

    // Diarization labels its channels A/B; the panel only distinguishes the two
    // that matter.
    expect(segments).toEqual([
      { speaker: 'doctor', text: 'Buenos días', at_seconds: 3 },
      { speaker: 'patient', text: 'Tiene fiebre', at_seconds: 11 },
    ])
  })

  test('the unit comes from the field name, not from the size of the number', () => {
    // AssemblyAI (what the flows transcribe with) emits `start` in ms; our own
    // API speaks at_seconds. Guessing by magnitude confuses 12500 ms with a
    // three-and-a-half-hour consultation, and both are plausible.
    expect(transcriptFromEvent({ text: 'hola', start: 12_500 })[0]!.at_seconds).toBe(12)
    expect(transcriptFromEvent({ text: 'hola', at_seconds: 12_500 })[0]!.at_seconds).toBe(12_500)
    expect(transcriptFromEvent({ text: 'hola' })[0]!.at_seconds).toBe(0)
  })

  test('an unknown speaker label survives as written', () => {
    const [only] = transcriptFromEvent({ text: 'hola', speaker: 'Enfermera' })
    expect(only!.speaker).toBe('Enfermera')
  })

  test('a label diarization has not settled is NO speaker', () => {
    // AssemblyAI labels the first finals `PENDING` and settles them later;
    // rendering that put the word "PENDING" above the first sentence of every
    // consultation. Measured against the live flow.
    expect(transcriptFromEvent({ text: 'hola', speaker_label: 'PENDING' })[0]!.speaker).toBeNull()
    expect(transcriptFromEvent({ text: 'hola', speaker_label: 'UNKNOWN' })[0]!.speaker).toBeNull()
    expect(transcriptFromEvent({ text: 'hola', speaker: '' })[0]!.speaker).toBeNull()
  })

  test('reads the words from `transcript` when the node names it that way', () => {
    const [only] = transcriptFromEvent({ transcript: 'Buenos días, doctora.' })
    expect(only!.text).toBe('Buenos días, doctora.')
  })

  test('an event with no text yields nothing', () => {
    expect(transcriptFromEvent({ text: '   ' })).toEqual([])
    expect(transcriptFromEvent({})).toEqual([])
  })
})
