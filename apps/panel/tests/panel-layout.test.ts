/**
 * The dock: which tab is in which group, and how the space divides.
 *
 * The gestures are a browser's, but everything they decide is here — an array
 * of arrays and three numbers — so the rules are testable without rendering
 * anything or simulating a drag.
 */
import { describe, expect, test } from 'bun:test'
import {
  ALL_TABS,
  DEFAULT_LAYOUT,
  clampSplit,
  columnLayout,
  hideTabs,
  moveTab,
  normalizeLayout,
  type Groups,
} from '../src/lib/panel-layout'

const groups = (): Groups => DEFAULT_LAYOUT.groups.map((g) => [...g]) as Groups
const flat = (g: Groups) => g.flat().sort()

describe('dragging a tab into another group', () => {
  test('it leaves the one it was in and joins the one it was dropped on', () => {
    const next = moveTab(groups(), 'note', 1)
    expect(next[3]).toEqual([])
    expect(next[1]).toEqual(['chatbot', 'transcription', 'note'])
  })

  test('dropping ON a tab inserts BEFORE it, not at the end', () => {
    // Landing always at the end is the thing that makes a dock feel like it is
    // guessing: the doctor aimed between two tabs.
    const next = moveTab(groups(), 'note', 1, 'transcription')
    expect(next[1]).toEqual(['chatbot', 'note', 'transcription'])
  })

  test('a tab can be reordered inside its own group', () => {
    const next = moveTab(groups(), 'transcription', 1, 'chatbot')
    expect(next[1]).toEqual(['transcription', 'chatbot'])
  })

  test('no move ever loses or duplicates a tab', () => {
    let current = groups()
    for (const [tab, to] of [
      ['note', 0],
      ['meeting', 3],
      ['chatbot', 2],
      ['recommendations', 0],
    ] as const) {
      current = moveTab(current, tab, to)
      expect(flat(current)).toEqual([...ALL_TABS].sort())
    }
  })

  test('every tab can end up in one group', () => {
    let current = groups()
    for (const tab of ALL_TABS) current = moveTab(current, tab, 0)
    expect(current[0]).toHaveLength(ALL_TABS.length)
    expect(current[1]).toEqual([])
    expect(current[2]).toEqual([])
    expect(current[3]).toEqual([])
  })

  test('a drag that ends where it started costs nothing', () => {
    // Same array back, so React skips the re-render.
    const start = groups()
    expect(moveTab(start, 'note', 3)).toBe(start)
  })

  test('a group that is not there, or a tab that is not, is ignored', () => {
    const start = groups()
    expect(moveTab(start, 'note', 9)).toBe(start)
    expect(moveTab(start, 'ghost' as never, 0)).toBe(start)
  })
})

describe('the space a group gets', () => {
  test('by default, two columns of two', () => {
    const columns = columnLayout(DEFAULT_LAYOUT)
    expect(columns).toHaveLength(2)
    expect(columns[0]!.size).toBe(DEFAULT_LAYOUT.columnSplit)
    expect(columns[0]!.groups.map((g) => g.index)).toEqual([0, 1])
    expect(columns[1]!.groups.map((g) => g.index)).toEqual([2, 3])
  })

  test('an emptied group takes no room, and no splitter', () => {
    // Dragging the last tab out of a pane has to CLOSE the pane, or the doctor
    // is left staring at an empty box where a panel used to be.
    const layout = { ...DEFAULT_LAYOUT, groups: moveTab(groups(), 'meeting', 1) }
    const columns = columnLayout(layout)
    expect(columns[0]!.groups).toHaveLength(1)
    expect(columns[0]!.groups[0]!.index).toBe(1)
    // One group in the column means it takes the whole column.
    expect(columns[0]!.groups[0]!.size).toBe(100)
  })

  test('an emptied COLUMN gives the whole row to the other', () => {
    let next = groups()
    for (const tab of ['recommendations', 'note'] as const) next = moveTab(next, tab, 0)
    const columns = columnLayout({ ...DEFAULT_LAYOUT, groups: next })
    expect(columns).toHaveLength(1)
    expect(columns[0]!.size).toBe(100)
  })
})

describe('resizing', () => {
  test('a group can never be dragged to nothing', () => {
    // The handle to drag it open again IS the edge that would disappear.
    expect(clampSplit(0)).toBe(15)
    expect(clampSplit(-40)).toBe(15)
    expect(clampSplit(100)).toBe(85)
  })

  test('a sane drag lands where it was dropped', () => {
    expect(clampSplit(37.4)).toBe(37)
    expect(clampSplit(62.5)).toBe(63)
  })

  test('a NaN — an unmeasurable container — falls back to the middle', () => {
    // `getBoundingClientRect` on a detached node gives zeroes, and 0/0 is NaN.
    expect(clampSplit(Number.NaN)).toBe(50)
    expect(clampSplit(Number.POSITIVE_INFINITY)).toBe(50)
  })
})

describe('reading a stored layout', () => {
  test('one written by this version round-trips', () => {
    expect(normalizeLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT)
  })

  test('a tab the stored layout never mentioned comes back', () => {
    // Losing one panel's POSITION beats losing all of them — and a doctor who
    // cannot find the note has no way to bring it back.
    const partial = { groups: [['meeting'], [], [], []], columnSplit: 40, leftSplit: 55, rightSplit: 50 }
    const repaired = normalizeLayout(partial)
    expect(flat(repaired.groups)).toEqual([...ALL_TABS].sort())
  })

  test('a tab listed twice is kept once', () => {
    const dupes = { groups: [['note', 'note'], ['note'], [], []] }
    const repaired = normalizeLayout(dupes)
    expect(flat(repaired.groups)).toEqual([...ALL_TABS].sort())
    // The duplicate is dropped, and every tab the layout never mentioned is
    // appended to the group it lives in by default — `meeting` to group 0.
    expect(repaired.groups[0]).toEqual(['note', 'meeting'])
    expect(repaired.groups[1]).toEqual(['chatbot', 'transcription'])
  })

  test('names from a version that had different tabs are dropped', () => {
    const repaired = normalizeLayout({ groups: [['side', 'audio'], [], [], []] })
    expect(flat(repaired.groups)).toEqual([...ALL_TABS].sort())
  })

  test('nonsense of any shape gives the default', () => {
    for (const raw of [null, undefined, 42, 'x', [], {}]) {
      expect(normalizeLayout(raw)).toEqual(DEFAULT_LAYOUT)
    }
  })

  test('out-of-range sizes are repaired rather than rejected', () => {
    const repaired = normalizeLayout({
      groups: DEFAULT_LAYOUT.groups,
      columnSplit: 999,
      leftSplit: -1,
    })
    expect(repaired.columnSplit).toBe(85)
    expect(repaired.leftSplit).toBe(15)
  })
})

describe('hiding a tab', () => {
  test('a finished consultation loses the room, and its group closes', () => {
    // Not "La reunión terminó" in a panel the size of the screen: a closed
    // consultation is a record, and the note is what it is opened to read.
    const hidden = hideTabs(DEFAULT_LAYOUT, ['meeting'])
    expect(hidden.groups[0]).toEqual([])
    const columns = columnLayout(hidden)
    expect(columns[0]!.groups.map((g) => g.index)).toEqual([1])
    expect(columns[0]!.groups[0]!.size).toBe(100)
  })

  test('the STORED arrangement is untouched', () => {
    // Hiding is not moving. The tab comes back where the doctor left it.
    const moved = { ...DEFAULT_LAYOUT, groups: moveTab(groups(), 'meeting', 3) }
    expect(hideTabs(moved, ['meeting']).groups[3]).toEqual(['note'])
    expect(moved.groups[3]).toEqual(['note', 'meeting'])
  })

  test('hiding nothing changes nothing', () => {
    expect(hideTabs(DEFAULT_LAYOUT, [])).toBe(DEFAULT_LAYOUT)
  })
})
