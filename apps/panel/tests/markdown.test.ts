/**
 * The markdown the two writers on the consultation screen actually emit, and
 * what ⌘B does to a selection.
 *
 * Both are pure functions over strings, so the whole contract is testable
 * without rendering a panel or faking a caret — same reason the dock's rules
 * live in `panel-layout.ts`.
 */
import { describe, expect, test } from 'bun:test'
import {
  parseInline,
  parseMarkdown,
  toggleLinePrefix,
  toggleWrap,
  type Block,
  type Inline,
} from '../src/lib/markdown'

/** The text of a span tree, with the markup dropped — what the doctor reads. */
const plain = (nodes: Inline[]): string =>
  nodes
    .map((node) =>
      node.type === 'text' || node.type === 'code' ? node.value : plain(node.children),
    )
    .join('')

const inlineOf = (block: Block) =>
  block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote'
    ? block.children
    : []

describe('inline', () => {
  test('bold is bold, and the asterisks are gone', () => {
    const nodes = parseInline('**Primera línea — venta libre** y nada más')
    expect(nodes[0]).toEqual({
      type: 'strong',
      children: [{ type: 'text', value: 'Primera línea — venta libre' }],
    })
    expect(plain(nodes)).toBe('Primera línea — venta libre y nada más')
  })

  test('bold wins over italic when both markers are there', () => {
    expect(parseInline('**x**')[0].type).toBe('strong')
    expect(parseInline('*x*')[0].type).toBe('em')
  })

  test('emphasis nests', () => {
    const [node] = parseInline('**Acetaminofén *500 mg***')
    expect(node.type).toBe('strong')
    expect(plain([node])).toBe('Acetaminofén 500 mg')
  })

  test('a marker that never closes stays an asterisk', () => {
    expect(parseInline('3 * 4 y **algo')).toEqual([{ type: 'text', value: '3 * 4 y **algo' }])
  })

  test('an underscore inside a word is not an italic', () => {
    expect(parseInline('dosis_max_dia')).toEqual([{ type: 'text', value: 'dosis_max_dia' }])
  })

  test('code, links and strikethrough', () => {
    expect(parseInline('`500 mg`')).toEqual([{ type: 'code', value: '500 mg' }])
    expect(parseInline('[MedlinePlus](https://medlineplus.gov)')).toEqual([
      {
        type: 'link',
        href: 'https://medlineplus.gov',
        children: [{ type: 'text', value: 'MedlinePlus' }],
      },
    ])
    expect(parseInline('~~no~~')[0].type).toBe('strike')
  })

  test('a template blank is not a link and survives untouched', () => {
    // The flow reads `[[…]]` back out of the body: mangling one here would
    // silently stop a section of the note from being filled.
    expect(parseInline('[[el motivo por el que consultan]]')).toEqual([
      { type: 'text', value: '[[el motivo por el que consultan]]' },
    ])
  })

  test('a backslash escapes a marker', () => {
    expect(parseInline('\\*no es cursiva\\*')).toEqual([{ type: 'text', value: '*no es cursiva*' }])
  })
})

describe('blocks', () => {
  test('the note as `c_soap` writes it', () => {
    const blocks = parseMarkdown(
      [
        '## Motivo de consulta',
        '',
        'Dolor en el pecho y dolor de cabeza.',
        '',
        '## Antecedentes',
        '',
        'No refiere',
      ].join('\n'),
    )
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'paragraph'])
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2 })
    expect(plain(inlineOf(blocks[0]))).toBe('Motivo de consulta')
    expect(plain(inlineOf(blocks[1]))).toBe('Dolor en el pecho y dolor de cabeza.')
  })

  test('a dash list of doses, with the bold kept inside the item', () => {
    const [block] = parseMarkdown(
      '- **Acetaminofén** (500-650 mg c/4-6h)\n- **Ibuprofeno** (400 mg c/6-8h)',
    )
    expect(block.type).toBe('list')
    if (block.type !== 'list') throw new Error('not a list')
    expect(block.ordered).toBe(false)
    expect(block.items).toHaveLength(2)
    expect(block.items[0].children[0].type).toBe('strong')
    expect(plain(block.items[0].children)).toBe('Acetaminofén (500-650 mg c/4-6h)')
  })

  test('a numbered list keeps its numbers', () => {
    const [block] = parseMarkdown('1. Primero\n2. Segundo')
    if (block.type !== 'list') throw new Error('not a list')
    expect(block.ordered).toBe(true)
    expect(block.items.map((i) => i.marker)).toEqual(['1.', '2.'])
  })

  test('a wrapped bullet keeps its continuation line', () => {
    const [block] = parseMarkdown('- Acetaminofén 500 mg,\n  máx 3-4 g/día')
    if (block.type !== 'list') throw new Error('not a list')
    expect(block.items).toHaveLength(1)
    expect(plain(block.items[0].children)).toBe('Acetaminofén 500 mg, máx 3-4 g/día')
  })

  test('a soft line break inside a paragraph is kept', () => {
    // A note where the doctor put each finding on its own line means it.
    const [block] = parseMarkdown('Talla: 96 cm\nPeso: 14 kg')
    expect(plain(inlineOf(block))).toBe('Talla: 96 cm\nPeso: 14 kg')
  })

  test('quotes, rules and fenced code', () => {
    expect(parseMarkdown('> Según la guía').map((b) => b.type)).toEqual(['quote'])
    expect(parseMarkdown('---').map((b) => b.type)).toEqual(['rule'])
    const [code] = parseMarkdown('```\nuna cosa\n```')
    expect(code).toEqual({ type: 'code', value: 'una cosa' })
  })

  test('a heading needs its space: `#hashtag` is a paragraph', () => {
    expect(parseMarkdown('#hashtag')[0].type).toBe('paragraph')
  })

  test('empty input is no blocks at all', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('   \n\n')).toEqual([])
  })
})

describe('⌘B', () => {
  test('it wraps the selection and keeps it selected', () => {
    const result = toggleWrap('dolor de cabeza', 0, 5, '**')
    expect(result.text).toBe('**dolor** de cabeza')
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('dolor')
  })

  test('pressing it again takes the bold off', () => {
    const on = toggleWrap('dolor de cabeza', 0, 5, '**')
    const off = toggleWrap(on.text, on.selectionStart, on.selectionEnd, '**')
    expect(off.text).toBe('dolor de cabeza')
    expect(off.text.slice(off.selectionStart, off.selectionEnd)).toBe('dolor')
  })

  test('a selection that includes the markers unwraps too', () => {
    const result = toggleWrap('**dolor** de cabeza', 0, 9, '**')
    expect(result.text).toBe('dolor de cabeza')
  })

  test('trailing spaces in the selection stay outside the markers', () => {
    // `** dolor **` is not bold in any renderer, so the selection is trimmed
    // onto the words before wrapping.
    const result = toggleWrap('dolor de cabeza', 0, 6, '**')
    expect(result.text).toBe('**dolor** de cabeza')
  })

  test('with no selection it wraps the word the caret is in', () => {
    const result = toggleWrap('dolor de cabeza', 11, 11, '**')
    expect(result.text).toBe('dolor de **cabeza**')
  })

  test('on empty space it leaves the caret between the markers', () => {
    const result = toggleWrap('dolor ', 6, 6, '**')
    expect(result.text).toBe('dolor ****')
    expect(result.selectionStart).toBe(8)
    expect(result.selectionEnd).toBe(8)
  })

  test('italic is the same function with one asterisk', () => {
    expect(toggleWrap('dolor', 0, 5, '*').text).toBe('*dolor*')
  })
})

describe('the list button', () => {
  test('it marks every line the selection touches', () => {
    const result = toggleLinePrefix('Ibuprofeno\nAcetaminofén', 2, 14, '- ')
    expect(result.text).toBe('- Ibuprofeno\n- Acetaminofén')
  })

  test('a fully marked selection comes back off', () => {
    const on = toggleLinePrefix('Ibuprofeno\nAcetaminofén', 0, 22, '- ')
    const off = toggleLinePrefix(on.text, on.selectionStart, on.selectionEnd, '- ')
    expect(off.text).toBe('Ibuprofeno\nAcetaminofén')
  })

  test('a half-marked selection finishes the job instead of inverting it', () => {
    const result = toggleLinePrefix('- Ibuprofeno\nAcetaminofén', 0, 25, '- ')
    expect(result.text).toBe('- Ibuprofeno\n- Acetaminofén')
  })

  test('blank lines are left alone', () => {
    const result = toggleLinePrefix('Uno\n\nDos', 0, 8, '- ')
    expect(result.text).toBe('- Uno\n\n- Dos')
  })

  test('what it writes parses back as a list', () => {
    const { text } = toggleLinePrefix('Ibuprofeno\nAcetaminofén', 0, 22, '- ')
    const [block] = parseMarkdown(text)
    expect(block.type).toBe('list')
  })
})
