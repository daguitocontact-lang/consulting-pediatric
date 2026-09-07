/**
 * The dock: groups of tabs, dragged between each other and resized.
 *
 * The legacy uses flexlayout-react with everything at its defaults except
 * closing and renaming, so what a doctor can do there is drag a TAB out of one
 * group and into another. This is that, in about a page: a tab strip whose
 * buttons are drag sources, a group that is a drop target, and three edges that
 * resize.
 *
 * Plain `<div>`s for anything that touches a browser gesture, for the reason
 * `components/dnd.tsx` already writes down: Tamagui's Stack forwards unknown
 * props to the DOM on web, but `draggable`, `onDrop` and the pointer events are
 * not in its prop types, so wiring them there costs a cast per call site. The
 * panel only ever runs in a browser — there is no native target to keep happy.
 */
import { useRef, useState, type ReactNode } from 'react'
import { GripVertical, Maximize2, Minimize2 } from '@tamagui/lucide-icons'
import { Text, XStack, YStack } from 'tamagui'
import type { TabKey } from '../../lib/panel-layout'

const MIME = 'application/x-pediatric-tab'

export type DockTab = { key: TabKey; label: string; content: ReactNode }

/**
 * One group: a tab strip over the selected tab's content.
 *
 * The strip is the drop target as well as the drag source, so a tab can be
 * aimed BETWEEN two others — dropping on a button inserts before it, dropping
 * on the empty part of the strip appends. Landing always at the end is the
 * thing that makes a dock feel like it is guessing.
 */
export function DockGroup({
  tabs,
  index,
  onMoveTab,
  expanded,
  onToggleExpand,
}: {
  tabs: DockTab[]
  /** Which group this is, so a drop knows where it landed. */
  index: number
  onMoveTab: (tab: TabKey, toGroup: number, before?: TabKey) => void
  expanded?: boolean
  onToggleExpand?: () => void
}) {
  const [active, setActive] = useState<TabKey | null>(null)
  const [over, setOver] = useState(false)
  /** The tab a drop would land in FRONT of, so the insertion point is visible
   *  before letting go rather than a surprise afterwards. */
  const [before, setBefore] = useState<TabKey | null>(null)
  // A tab the doctor moved away should not leave the group blank: the
  // selection falls back to whatever is still here.
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0]

  const accept = (event: React.DragEvent) => event.dataTransfer.types.includes(MIME)

  const drop = (event: React.DragEvent, beforeKey?: TabKey) => {
    event.preventDefault()
    event.stopPropagation()
    setOver(false)
    setBefore(null)
    const key = event.dataTransfer.getData(MIME) as TabKey
    if (key) onMoveTab(key, index, beforeKey)
  }

  return (
    <YStack
      flex={1}
      minHeight={0}
      borderRadius={14}
      overflow="hidden"
      borderWidth={1}
      borderColor={over ? '$actionText' : '$borderColor'}
      backgroundColor="$color2"
    >
      <div
        onDragOver={(event) => {
          if (!accept(event)) return
          // The default is "refuse the drop"; preventing it is what makes this
          // a target at all.
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => {
          setOver(false)
          setBefore(null)
        }}
        onDrop={(event) => drop(event)}
        // The tab strip is a rule with the active tab underlined, not a row of
        // raised chips: it reads as one surface, and the panel below it is not
        // interrupted by a second border.
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px' }}
      >
        {tabs.map((tab) => {
          const selected = tab.key === current?.key
          return (
            <div
              key={tab.key}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(MIME, tab.key)
                // Some browsers refuse a drag with no text/plain flavour.
                event.dataTransfer.setData('text/plain', tab.key)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(event) => {
                if (!accept(event)) return
                event.preventDefault()
                event.stopPropagation()
                setBefore(tab.key)
              }}
              onDragLeave={() => setBefore((current) => (current === tab.key ? null : current))}
              onDrop={(event) => drop(event, tab.key)}
              onClick={() => setActive(tab.key)}
              style={{
                cursor: 'grab',
                // Where it will land, shown on the tab it will go in front of.
                boxShadow: before === tab.key ? 'inset 2px 0 0 0 currentColor' : undefined,
              }}
            >
              <XStack
                alignItems="center"
                gap="$0.25"
                paddingVertical="$1.25"
                marginRight="$1.5"
                // The 2px accent rule under the selected tab. Bottom border
                // rather than a background, so the strip stays one line.
                borderBottomWidth={2}
                borderBottomColor={selected ? '$actionText' : 'transparent'}
              >
                {/* The grip is the affordance, and it is the reason this is
                    discoverable at all. A tab that is draggable with nothing to
                    say so is a feature nobody finds: `cursor: grab` only shows
                    up once you are already hovering the right pixel, and docks
                    are not common enough for a doctor to try it. */}
                <GripVertical size={12} color="$color10" />
                <Text
                  fontSize={13.5}
                  fontWeight="600"
                  color={selected ? '$color' : '$color10'}
                  userSelect="none"
                >
                  {tab.label}
                </Text>
              </XStack>
            </div>
          )
        })}

        {/* The rest of the strip is droppable too — that is "put it last". */}
        <div style={{ flex: 1, alignSelf: 'stretch', minHeight: 24 }} />

        {onToggleExpand ? (
          <XStack
            role="button"
            tabIndex={0}
            aria-label="expand"
            onPress={onToggleExpand}
            padding="$0.5"
            borderRadius="$2"
            hoverStyle={{ backgroundColor: '$color4' }}
            cursor="pointer"
          >
            {expanded ? (
              <Minimize2 size={14} color="$color11" />
            ) : (
              <Maximize2 size={14} color="$color11" />
            )}
          </XStack>
        ) : null}
      </div>

      <YStack
        flex={1}
        overflow="hidden"
        backgroundColor="$color2"
        borderTopWidth={1}
        borderTopColor="$borderColor"
      >
        {current?.content}
      </YStack>
    </YStack>
  )
}

/**
 * The draggable edge between two groups.
 *
 * Pointer events, not mouse: one handler covers a trackpad, a touch screen and
 * a pen. `setPointerCapture` keeps the drag alive once the cursor outruns the
 * handle, which happens immediately — a drag is fast and the handle is 10px.
 *
 * The gesture reports a PERCENTAGE of the container, never pixels: the panel is
 * embedded in Daguito's page at whatever width that page gives it, and a layout
 * stored in pixels is wrong on the next screen it is opened on.
 */
export function Splitter({
  direction,
  onResize,
  label,
}: {
  direction: 'vertical' | 'horizontal'
  onResize: (percent: number) => void
  label: string
}) {
  const dragging = useRef(false)
  const vertical = direction === 'vertical'

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      tabIndex={0}
      onPointerDown={(event) => {
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return
        const parent = event.currentTarget.parentElement?.getBoundingClientRect()
        if (!parent) return
        onResize(
          vertical
            ? ((event.clientX - parent.left) / parent.width) * 100
            : ((event.clientY - parent.top) / parent.height) * 100,
        )
      }}
      onPointerUp={(event) => {
        dragging.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      // A splitter that can only be dragged cannot be used without a pointer,
      // and this one decides how much of a clinical note is on screen.
      onKeyDown={(event) => {
        const parent = event.currentTarget.parentElement?.getBoundingClientRect()
        if (!parent) return
        const offset = vertical ? event.currentTarget.offsetLeft : event.currentTarget.offsetTop
        const size = vertical ? parent.width : parent.height
        const current = (offset / size) * 100
        if (event.key === (vertical ? 'ArrowLeft' : 'ArrowUp')) onResize(current - 2)
        if (event.key === (vertical ? 'ArrowRight' : 'ArrowDown')) onResize(current + 2)
      }}
      style={{
        flex: '0 0 auto',
        width: vertical ? 10 : undefined,
        height: vertical ? undefined : 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: vertical ? 'col-resize' : 'row-resize',
        touchAction: 'none',
      }}
    >
      {/* 10px of target with a 2px line inside it: a thin hit area is a
          frustrating one, and an always-visible bar is noise. */}
      <div
        style={{
          width: vertical ? 2 : '100%',
          height: vertical ? '100%' : 2,
          borderRadius: 2,
          background: 'currentColor',
          opacity: 0.18,
        }}
      />
    </div>
  )
}

/** A pane's share of its container, as a flex basis. */
export const paneStyle = (percent: number): React.CSSProperties => ({
  flex: `1 1 ${percent}%`,
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
})
