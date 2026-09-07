/**
 * The pure half of the pre-recorded pipeline.
 *
 * These are the parts that fail SILENTLY when they are wrong: a template that
 * is not filled comes back as a plausible generic note, and a mis-parsed
 * speaker line still renders — it just carries a diarization label inside the
 * doctor's clinical record. Both were observed against the live flow before
 * they were covered here.
 */
import { describe, expect, test } from 'bun:test'
import { segmentsFromTranscript } from '../src/lib/prerecorded'
import {
  costBucket,
  costUsdFrom,
  fieldNamesFrom,
  fillTemplate,
  stringifyValue,
} from '../src/lib/template-fill'

describe('the transcript of an uploaded recording', () => {
  test('a bracketed diarization channel is a speaker, not part of the words', () => {
    // What `s_stt_file` actually returned from a real run: diarization ran but
    // `speaker_roles` did not clear its confidence floor, so the channel is all
    // there is. Before this was handled the label stayed INSIDE the text and
    // every line of the record began with a literal "[A]".
    expect(segmentsFromTranscript('[A] Buenos días doctor.\n[B] Desde ayer.')).toEqual([
      { speaker: 'speaker_a', text: 'Buenos días doctor.', at_seconds: 0 },
      { speaker: 'speaker_b', text: 'Desde ayer.', at_seconds: 0 },
    ])
  })

  test('a role the flow resolved IS the speaker', () => {
    expect(segmentsFromTranscript('doctor: ¿Desde cuándo?\npaciente: Desde ayer.')).toEqual([
      { speaker: 'doctor', text: '¿Desde cuándo?', at_seconds: 0 },
      { speaker: 'patient', text: 'Desde ayer.', at_seconds: 0 },
    ])
  })

  test('an unlabelled line keeps all of its words and claims no speaker', () => {
    // Attributing it would be a guess, and the guess lands in a medical record.
    expect(segmentsFromTranscript('Tiene fiebre desde ayer.')).toEqual([
      { speaker: null, text: 'Tiene fiebre desde ayer.', at_seconds: 0 },
    ])
  })

  test('a colon inside a sentence is not a speaker label', () => {
    const [only] = segmentsFromTranscript('Le dije lo siguiente: que volviera mañana.')
    expect(only!.speaker).toBeNull()
    expect(only!.text).toBe('Le dije lo siguiente: que volviera mañana.')
  })

  test('blank lines are dropped, not stored as empty rows', () => {
    expect(segmentsFromTranscript('\n\n[A] Hola\n   \n')).toHaveLength(1)
  })
})

describe('filling the doctor’s template', () => {
  const BODY = '## Motivo\n\n[[el motivo]]\n\n## Plan\n\n[[el plan]]\n'

  test('the markdown survives and only the placeholders are replaced', () => {
    // The whole point of a template: the note that comes back is the doctor's
    // document with the blanks filled, not a document the model wrote.
    const filled = fillTemplate(BODY, { motivo: 'Fiebre', plan: 'Control en 48 h' }, [
      'motivo',
      'plan',
    ])
    expect(filled).toBe('## Motivo\n\nFiebre\n\n## Plan\n\nControl en 48 h\n')
  })

  test('a field the consultation never mentioned says so', () => {
    // Blank would read as "does not apply". This reads as what it is, and it is
    // what the live run produced for the two sections the audio never covered.
    expect(fillTemplate(BODY, { motivo: 'Fiebre' }, ['motivo', 'plan'])).toContain('_No referido_')
  })

  test('placeholders map POSITIONALLY, not by name', () => {
    // A `[[…]]` carries a description, never a key, so the Nth placeholder takes
    // the Nth field name. Getting this wrong fills every section with the
    // previous section's answer, which reads perfectly and is entirely wrong.
    expect(fillTemplate(BODY, { a: 'primero', b: 'segundo' }, ['a', 'b'])).toBe(
      '## Motivo\n\nprimero\n\n## Plan\n\nsegundo\n',
    )
  })

  test('a whole document the flow rendered wins over the template', () => {
    expect(fillTemplate(BODY, { markdown: '# Ya viene armada' }, [])).toBe('# Ya viene armada')
  })

  test('no template at all still keeps the work, one heading per field', () => {
    const note = fillTemplate('', { subjetivo: 'Fiebre', plan: 'Control' }, [])
    expect(note).toContain('## (S) Subjetivo')
    expect(note).toContain('## (P) Plan')
  })

  test('the value is plain text: tags and markdown are stripped', () => {
    // The node's prompt forbids them because the value is pasted INTO the
    // doctor's own formatting. This is the part that does not rely on the model
    // having obeyed.
    expect(stringifyValue('<p><strong>Fiebre</strong></p>')).toBe('Fiebre')
    expect(stringifyValue('**Fiebre**')).toBe('Fiebre')
    expect(stringifyValue(['Uno', 'Dos'])).toBe('- Uno\n- Dos')
    expect(stringifyValue(null)).toBe('')
    expect(stringifyValue('null')).toBe('')
  })

  test('the ordered field names come from the schema Daguito returned', () => {
    expect(fieldNamesFrom({ field_names: ['a', 'b'] })).toEqual(['a', 'b'])
    // An older envelope carries only the JSON Schema; JS keeps string keys in
    // insertion order, which is the order Daguito wrote them.
    expect(fieldNamesFrom({ schema: { properties: { x: {}, y: {} } } })).toEqual(['x', 'y'])
    expect(fieldNamesFrom(null)).toEqual([])
  })
})

describe('what a charge is for', () => {
  test('STT time is transcription, an agent is what it wrote', () => {
    expect(costBucket('stt_stream', 's_stt')).toBe('streaming')
    expect(costBucket('a_transcribe_file', 's_stt_file')).toBe('streaming')
    expect(costBucket('agent', 'c_facts')).toBe('facts')
    expect(costBucket('agent', 'c_soap')).toBe('template')
    expect(costBucket('agent', 'anything_else')).toBe('chatbot')
  })

  test('microcents are millionths of a dollar, like the ledger says', () => {
    // Off by a factor of a hundred here and every consultation is billed at 1%
    // of what it cost, which nobody notices until the invoice.
    expect(costUsdFrom({ cost_microcents: 1_184 })).toBeCloseTo(0.001184, 9)
    expect(costUsdFrom({ cost_usd: 0.5 })).toBe(0.5)
    expect(costUsdFrom({})).toBe(0)
  })
})
