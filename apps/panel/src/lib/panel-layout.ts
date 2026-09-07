/**
 * The dock: which tab sits in which group, and how big the groups are.
 *
 * The legacy screen uses flexlayout-react with almost everything left at its
 * defaults — it only turns OFF closing and renaming
 * (`tabEnableClose: false, tabEnableRename: false`). Which means the thing it
 * leaves ON is the one that matters: `tabEnableDrag`. A doctor there does not
 * swap whole panels, they drag a TAB from one group into another — ending with
 * the note and the recommendations stacked as two tabs of one big pane, or all
 * five spread out, whatever suits the consultation they are in.
 *
 * So the model is groups of tabs, not four fixed slots. A group that loses its
 * last tab disappears and its space goes to its neighbour; a group can hold all
 * five. That is the whole difference between "rearrangeable" and the dock the
 * legacy actually has.
 *
 * No library: it is an array of arrays and three numbers, and every rule about
 * it is a pure function that can be tested without rendering anything.
 *
 * The layout is per BROWSER, not per user row: it is a preference about a
 * screen, it has to survive a reload, and it is not worth a column, a migration
 * and a round trip. `localStorage` can throw outright (a private window, a
 * browser set to block site data) and the panel runs inside somebody else's
 * page, so every access is guarded and a failure just means the default.
 */

/** Everything that can live in the dock. Five, not four: the assistant and the
 *  transcript are separate tabs the doctor can pull apart, as in the legacy. */
export type TabKey = 'meeting' | 'chatbot' | 'transcription' | 'recommendations' | 'note'

export const ALL_TABS: TabKey[] = [
  'meeting',
  'chatbot',
  'transcription',
  'recommendations',
  'note',
]

/** The four groups: 0–1 are the left column top to bottom, 2–3 the right. */
export type Groups = [TabKey[], TabKey[], TabKey[], TabKey[]]

export type PanelLayout = {
  groups: Groups
  /** Percentage of the row the LEFT column takes. */
  columnSplit: number
  /** Percentage of each column its TOP group takes. */
  leftSplit: number
  rightSplit: number
}

/** The legacy dock's opening arrangement: the room over the assistant and the
 *  transcript on the left, the recommendations over the note on the right. */
export const DEFAULT_LAYOUT: PanelLayout = {
  groups: [['meeting'], ['chatbot', 'transcription'], ['recommendations'], ['note']],
  columnSplit: 40,
  leftSplit: 55,
  rightSplit: 50,
}

/**
 * How small a group may get.
 *
 * Not zero: a group dragged to nothing is a panel the doctor cannot get back,
 * because the handle to drag it open again is the edge that just disappeared.
 * Fifteen percent still shows a tab strip and a line of content.
 */
const MIN = 15
const MAX = 100 - MIN

export const clampSplit = (value: number): number =>
  Number.isFinite(value) ? Math.min(MAX, Math.max(MIN, Math.round(value))) : 50

/**
 * Move a tab into a group, at a position.
 *
 * `before` is the tab it should land in front of, which is how a drop lands
 * where it was aimed rather than always at the end. Dropping a tab back where
 * it already is returns the same array so React skips the re-render — a drag
 * that ends where it started should cost nothing.
 */
export function moveTab(
  groups: Groups,
  tab: TabKey,
  toGroup: number,
  before?: TabKey,
): Groups {
  if (toGroup < 0 || toGroup > 3) return groups
  const from = groups.findIndex((group) => group.includes(tab))
  if (from < 0) return groups
  if (from === toGroup && !before && groups[toGroup]!.at(-1) === tab) return groups

  const next = groups.map((group) => group.filter((key) => key !== tab)) as Groups
  const target = next[toGroup]!
  const at = before ? target.indexOf(before) : -1
  if (at >= 0) target.splice(at, 0, tab)
  else target.push(tab)
  return next
}

/**
 * Read a stored layout, repairing anything that does not describe every tab
 * exactly once.
 *
 * A stored layout is old data by definition — it may have been written by a
 * version with four tabs, or different names — so it is validated rather than
 * trusted. A tab that went missing is appended back rather than dropping the
 * whole arrangement: losing one panel's position beats losing all of them, and
 * a doctor who cannot find the note has no way to bring it back.
 */
export function normalizeLayout(raw: unknown): PanelLayout {
  if (!raw || typeof raw !== 'object') return DEFAULT_LAYOUT
  const value = raw as Partial<PanelLayout>

  const groups: Groups = [[], [], [], []]
  const seen = new Set<TabKey>()
  if (Array.isArray(value.groups)) {
    value.groups.slice(0, 4).forEach((group, index) => {
      if (!Array.isArray(group)) return
      for (const key of group) {
        if (isTabKey(key) && !seen.has(key)) {
          seen.add(key)
          groups[index]!.push(key)
        }
      }
    })
  }
  // Anything the stored layout never mentioned goes back where it belongs.
  const missing = ALL_TABS.filter((key) => !seen.has(key))
  for (const key of missing) {
    const home = DEFAULT_LAYOUT.groups.findIndex((group) => group.includes(key))
    groups[home >= 0 ? home : 0]!.push(key)
  }
  // Every tab in one group leaves three empty, which is legal — but all four
  // empty is not a layout at all.
  if (groups.every((group) => group.length === 0)) return DEFAULT_LAYOUT

  return {
    groups,
    columnSplit: clampSplit(value.columnSplit ?? DEFAULT_LAYOUT.columnSplit),
    leftSplit: clampSplit(value.leftSplit ?? DEFAULT_LAYOUT.leftSplit),
    rightSplit: clampSplit(value.rightSplit ?? DEFAULT_LAYOUT.rightSplit),
  }
}

const isTabKey = (value: unknown): value is TabKey =>
  typeof value === 'string' && (ALL_TABS as string[]).includes(value)

/**
 * Which groups actually render, and how the space divides between them.
 *
 * An empty group takes no room and no splitter: dragging the last tab out of a
 * pane has to close the pane, or the doctor is left staring at an empty box
 * where a panel used to be. When only one group in a column survives it takes
 * the whole column, and when a whole column empties the other takes the row.
 */
export function columnLayout(
  layout: PanelLayout,
): { column: 'left' | 'right'; groups: { index: number; size: number }[]; size: number }[] {
  const left = [0, 1].filter((index) => layout.groups[index]!.length > 0)
  const right = [2, 3].filter((index) => layout.groups[index]!.length > 0)

  const share = (indices: number[], topPercent: number) =>
    indices.length === 2
      ? [
          { index: indices[0]!, size: topPercent },
          { index: indices[1]!, size: 100 - topPercent },
        ]
      : indices.map((index) => ({ index, size: 100 }))

  const columns: ReturnType<typeof columnLayout> = []
  if (left.length) {
    columns.push({
      column: 'left',
      groups: share(left, layout.leftSplit),
      size: right.length ? layout.columnSplit : 100,
    })
  }
  if (right.length) {
    columns.push({
      column: 'right',
      groups: share(right, layout.rightSplit),
      size: left.length ? 100 - layout.columnSplit : 100,
    })
  }
  return columns
}

/**
 * The layout with some tabs taken out.
 *
 * Hiding is not the same as moving: the stored arrangement is untouched, so a
 * tab that comes back (a consultation reopened, a mode that regains its panel)
 * returns to exactly where the doctor had put it. The group it left empty
 * collapses on its own — see columnLayout.
 */
export function hideTabs(layout: PanelLayout, hidden: TabKey[]): PanelLayout {
  if (!hidden.length) return layout
  return {
    ...layout,
    groups: layout.groups.map((group) =>
      group.filter((key) => !hidden.includes(key)),
    ) as Groups,
  }
}

const STORAGE_KEY = 'pediatric:consultation-layout'

export function loadLayout(): PanelLayout {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored ? normalizeLayout(JSON.parse(stored)) : DEFAULT_LAYOUT
  } catch {
    // A private window, blocked site data, or JSON somebody edited by hand.
    return DEFAULT_LAYOUT
  }
}

export function saveLayout(layout: PanelLayout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // The layout still applies for this session; it just will not survive a
    // reload. Not worth telling the doctor about mid-consultation.
  }
}
