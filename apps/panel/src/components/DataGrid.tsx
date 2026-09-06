// The panel's table.
//
// Daguito's vendored `DataTable` is a READING surface — a hairline per row, no
// hover, no sorting, header cells that are plain text. That is right for the
// four-row "recent transactions" card it was drawn for, and wrong for a screen
// where the whole job is finding one product among hundreds: there, the table
// IS the interface, and it has to answer back.
//
// So this is ours, and it does the three things a working table owes its user:
//
//   · the header SORTS, and says which way;
//   · the row under the cursor lights up, and the whole row is the click target
//     when there is somewhere to go;
//   · the header stays put while the body scrolls.
//
// Column API is deliberately the same shape as the vendored one (key, label,
// width/minWidth/flex, align, render), so moving a page over is an import and a
// tag — and moving it BACK is too, if this ever ships in @daguito/ui.
import { useMemo, useState, type ReactNode } from 'react'
import { Text, XStack, YStack } from 'tamagui'
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Pencil,
  Power,
  PowerOff,
  Trash2,
} from '@tamagui/lucide-icons'
import { Button } from './ui'
import { useIsMobile } from '../ui/hooks/useIsMobile'

export type GridColumn<Row> = {
  key: string
  label: string
  /**
   * Share of the SLACK — the width left after every column has its `width`
   * or `minWidth`. Text columns take a share (default 1); a column with a
   * `width` takes none unless it says so. Spreading the slack over the count
   * columns too was tried, and it is what put a hand's width between "3" and
   * its NOCHES label on a wide monitor while the package next to it was
   * truncated: a number has nothing to do with extra room, a name does. The
   * page is capped at a reading width now (PageShell), so the slack is small
   * and the names are where it belongs.
   */
  flex?: number
  /** Fixed width. The column neither grows nor shrinks unless `flex` says so. */
  width?: number
  minWidth?: number
  align?: 'left' | 'right' | 'center'
  render: (row: Row) => ReactNode
  /**
   * Makes the header clickable. Return what the column should sort BY — the
   * displayed text is often not it: a status badge sorts by its code, a price
   * by its number and not by "$1.233.600".
   */
  sortValue?: (row: Row) => string | number | null
  /**
   * Keeps `onRowPress` from firing for clicks landing in this cell. Set it on
   * the actions column: without it, pressing Eliminar would open the confirm
   * AND the row's editor behind it.
   */
  ownClicks?: boolean
  /**
   * What the column becomes on a phone, where the table is a list of cards.
   *
   * A card with five labelled rows is a third of the screen for ONE record,
   * and four of those labels are only there because a table needs headers.
   * `inline` drops the label and joins the value into a single meta line
   * under the title — the way a booking reads out loud: "20 de dic, $0,
   * salida, COC-2026…". `hide` is for a column that only earns its place in
   * a wide table. Unset keeps the labelled row.
   */
  mobile?: 'inline' | 'hide'
}

type Direction = 'asc' | 'desc'

function justify(align: GridColumn<unknown>['align']) {
  if (align === 'right') return 'flex-end' as const
  if (align === 'center') return 'center' as const
  return 'flex-start' as const
}

/** Nulls last in both directions: "no value" is never the interesting end. */
function compare(a: string | number | null, b: string | number | null): number {
  if (a === null || a === '') return b === null || b === '' ? 0 : 1
  if (b === null || b === '') return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function DataGrid<Row>({
  columns,
  rows,
  rowKey,
  emptyLabel,
  onRowPress,
  rowTint,
  maxHeight,
}: {
  columns: GridColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  emptyLabel?: string
  /** Makes the whole row a target. Buttons inside still win the click. */
  onRowPress?: (row: Row) => void
  rowTint?: (row: Row) => string | undefined
  /** Turns the body into its own scroller under a pinned header. */
  maxHeight?: number
}) {
  const [sort, setSort] = useState<{ key: string; dir: Direction } | null>(null)
  const { isMobile } = useIsMobile()

  const floor = columns.reduce((total, col) => total + (col.width ?? col.minWidth ?? 0), 0)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    // Copy first: sorting the caller's array in place would reorder its state.
    const out = [...rows].sort((a, b) => compare(col.sortValue!(a), col.sortValue!(b)))
    return sort.dir === 'asc' ? out : out.reverse()
  }, [rows, sort, columns])

  /** asc → desc → unsorted. The third click gives back the original order,
   *  which for these lists is a meaningful one (newest first). */
  const toggle = (key: string) =>
    setSort((current) =>
      !current || current.key !== key
        ? { key, dir: 'asc' }
        : current.dir === 'asc'
          ? { key, dir: 'desc' }
          : null,
    )

  /**
   * On a phone the table becomes a list of cards.
   *
   * Nine columns do not fit in 390px and never will: the grid used to scroll
   * sideways, which put everything past PRODUCTO — the dates, the party, the
   * total, the status — behind a gesture nobody makes. A card per row turns
   * that into scrolling DOWN, which is the one gesture a phone is for. The
   * first column is the card's title (it is the identifier in every list we
   * have), an actions column rides beside it, and the rest read as label and
   * value.
   */
  if (isMobile) {
    const [title, ...rest] = columns
    // The trailing column is the one that carries an action or a chevron: it
    // has its own clicks, or no label at all. Either way it belongs beside the
    // title, not on a line of its own captioned with nothing.
    const last = rest.at(-1)
    const trailing = last && (last.ownClicks || !last.label) ? rest.pop() : undefined
    // Three kinds of column once the row is a card: the ones that read as one
    // line under the name, the ones still worth a label of their own, and the
    // ones a phone is better off without.
    const inline = rest.filter((col) => col.mobile === 'inline')
    const rows_ = rest.filter((col) => !col.mobile)
    return (
      // Separate cards, not one framed block with hairlines: on a phone a row
      // IS the unit you act on, and an edge of its own is what says where one
      // record ends and the next begins.
      <YStack gap="$1">
        {sorted.length === 0 ? (
          <YStack
            paddingVertical="$4"
            alignItems="center"
            backgroundColor="$color1"
            borderRadius={14}
            borderWidth={1}
            borderColor="$borderColor"
          >
            <Text fontSize={13} color="$color11">
              {emptyLabel ?? '—'}
            </Text>
          </YStack>
        ) : (
          sorted.map((row, index) => (
            <YStack
              key={rowKey(row)}
              gap="$0.75"
              padding="$1.5"
              backgroundColor={rowTint?.(row) ?? '$color1'}
              borderRadius={14}
              borderWidth={1}
              borderColor="$borderColor"
              cursor={onRowPress ? 'pointer' : 'default'}
              onPress={onRowPress ? () => onRowPress(row) : undefined}
            >
              <XStack gap="$1" alignItems="flex-start" justifyContent="space-between">
                <XStack flexShrink={1} overflow="hidden" paddingTop={2}>
                  {title?.render(row)}
                </XStack>
                {trailing ? (
                  <div style={{ display: 'contents' }} onClick={(event) => event.stopPropagation()}>
                    {trailing.render(row)}
                  </div>
                ) : null}
              </XStack>
              {/* The meta line: the values that only needed a label because a
                  table has headers, run together the way they are read. */}
              {(() => {
                // Rendered and emptied FIRST, so the dot between two values is
                // never the first thing on the line: a column with nothing in
                // it for this row would otherwise still spend its separator.
                const cells = inline
                  .map((col) => ({ col, cell: col.render(row) }))
                  .filter(({ cell }) => cell !== null && cell !== undefined && cell !== '')
                if (cells.length === 0) return null
                return (
                  <XStack gap="$0.5" alignItems="center" flexWrap="wrap">
                    {cells.map(({ col, cell }, at) => (
                      <XStack key={col.key} gap="$0.5" alignItems="center" minWidth={0}>
                        {col.ownClicks ? (
                          <div
                            style={{ display: 'contents' }}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {cell}
                          </div>
                        ) : (
                          cell
                        )}
                        {/* The dot TRAILS its value instead of leading the next
                            one: the line wraps, and a wrapped line that opens
                            with a separator reads as a missing word. */}
                        {at === cells.length - 1 ? null : (
                          <Text fontSize={12} color="$color10">
                            ·
                          </Text>
                        )}
                      </XStack>
                    ))}
                  </XStack>
                )
              })()}
              {/* Everything else reads as label and value under a hairline, so
                  the title and its actions stay the head of the card. */}
              {rows_.length ? (
                <YStack height={1} backgroundColor="$borderColor" marginVertical={2} />
              ) : null}
              {rows_.map((col) => {
                const cell = col.render(row)
                // A column with nothing in it for this row is a line that says
                // nothing; on a phone that is a third of the card.
                if (cell === null || cell === undefined || cell === '') return null
                return (
                  <XStack key={col.key} gap="$1" alignItems="center" justifyContent="space-between">
                    <Text fontSize={12} color="$color11" flexShrink={0}>
                      {col.label}
                    </Text>
                    {col.ownClicks && onRowPress ? (
                      <div
                        style={{ display: 'contents' }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {cell}
                      </div>
                    ) : (
                      <XStack flexShrink={1} justifyContent="flex-end" overflow="hidden">
                        {cell}
                      </XStack>
                    )}
                  </XStack>
                )
              })}
            </YStack>
          ))
        )}
      </YStack>
    )
  }

  return (
    <YStack
      backgroundColor="$color1"
      borderRadius={16}
      borderWidth={1}
      borderColor="$borderColor"
      overflow="hidden"
    >
      <YStack overflow="scroll" maxHeight={maxHeight}>
        <YStack minWidth={floor}>
          {/* Sticky through a raw div: Tamagui's `somewhat-strict-web` style set
              has no `position: sticky`, and the panel already reaches for a
              plain element where the design system stops (see Modal's overlay
              and fields.tsx). The XStack inside keeps all the tokens. */}
          <div style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <XStack
              paddingHorizontal="$3"
              paddingVertical="$1.5"
              gap="$1.5"
              backgroundColor="$color2"
              borderBottomWidth={1}
              borderBottomColor="$borderColor"
            >
              {columns.map((col) => {
                const active = sort?.key === col.key
                const sortable = Boolean(col.sortValue)
                return (
                  <XStack
                    key={col.key}
                    flexBasis={typeof col.width === 'number' ? col.width : 0}
                    flexGrow={col.flex ?? (typeof col.width === 'number' ? 0 : 1)}
                    flexShrink={typeof col.width === 'number' ? 0 : 1}
                    minWidth={col.minWidth}
                    justifyContent={justify(col.align)}
                    alignItems="center"
                    gap="$0.5"
                    cursor={sortable ? 'pointer' : 'default'}
                    role={sortable ? 'button' : undefined}
                    tabIndex={sortable ? 0 : undefined}
                    hoverStyle={sortable ? { opacity: 0.7 } : undefined}
                    onPress={sortable ? () => toggle(col.key) : undefined}
                    onKeyDown={
                      (sortable
                        ? (event: KeyboardEvent) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              toggle(col.key)
                            }
                          }
                        : undefined) as never
                    }
                  >
                    <Text
                      fontSize={13}
                      fontWeight="600"
                      color={active ? '$color' : '$color11'}
                      numberOfLines={1}
                    >
                      {col.label}
                    </Text>
                    {/* The idle arrow shows WHICH columns sort — a control nobody
                      can see is a control nobody uses. */}
                    {sortable ? (
                      active ? (
                        sort!.dir === 'asc' ? (
                          <ChevronUp size={12} color="$color" />
                        ) : (
                          <ChevronDown size={12} color="$color" />
                        )
                      ) : (
                        <ChevronsUpDown size={12} color="$color11" opacity={0.45} />
                      )
                    ) : null}
                  </XStack>
                )
              })}
            </XStack>
          </div>

          {sorted.length === 0 ? (
            <YStack paddingVertical="$6" alignItems="center">
              <Text fontSize={13} color="$color11">
                {emptyLabel ?? '—'}
              </Text>
            </YStack>
          ) : (
            sorted.map((row, index) => (
              <XStack
                key={rowKey(row)}
                paddingHorizontal="$3"
                // 20px above and below: the row height of the reference list,
                // comfortable at arm's length on a big monitor without turning
                // into cards.
                paddingVertical="$2"
                gap="$1.5"
                alignItems="center"
                // No zebra: a hairline between rows and the hover are what
                // carries the eye across, the way the reference list does it.
                backgroundColor={rowTint?.(row) ?? 'transparent'}
                borderBottomWidth={index === sorted.length - 1 ? 0 : 1}
                borderBottomColor="$borderColor"
                cursor={onRowPress ? 'pointer' : 'default'}
                hoverStyle={{ backgroundColor: '$color3' }}
                onPress={onRowPress ? () => onRowPress(row) : undefined}
              >
                {columns.map((col) => {
                  const cell = (
                    <XStack
                      key={col.key}
                      flexBasis={typeof col.width === 'number' ? col.width : 0}
                      flexGrow={col.flex ?? (typeof col.width === 'number' ? 0 : 1)}
                      flexShrink={typeof col.width === 'number' ? 0 : 1}
                      minWidth={col.minWidth}
                      justifyContent={justify(col.align)}
                      alignItems="center"
                      // A long name ends in an ellipsis inside its own column.
                      // Without this it runs straight over the next cell —
                      // which is exactly what the product finder was doing.
                      overflow="hidden"
                    >
                      {col.render(row)}
                    </XStack>
                  )
                  // A real DOM listener, not Tamagui's onPress: stopping the
                  // bubble is the whole job here, and this is the layer the
                  // bubble actually travels through. Bubble phase, NOT capture:
                  // a capture-phase stop kills the click on its way DOWN, so
                  // the buttons inside never receive it.
                  return col.ownClicks && onRowPress ? (
                    <div
                      key={col.key}
                      style={{ display: 'contents' }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {cell}
                    </div>
                  ) : (
                    cell
                  )
                })}
              </XStack>
            ))
          )}
        </YStack>
      </YStack>
    </YStack>
  )
}

/**
 * The per-row actions, as icons.
 *
 * Three text buttons per row ("Editar · Desactivar · Eliminar") cost 250px of
 * every row and pushed the column off the right edge of the product finder.
 * Icons cost 100px, read the same on every list, and match what the staff use
 * today (the pencil in Hermes). The label survives as the tooltip and the
 * accessible name, so nothing is lost for a screen reader or a hover.
 */
export function RowActions({
  edit,
  toggle,
  remove,
  active,
  labels,
}: {
  edit?: () => void
  toggle?: () => void
  remove?: () => void
  /** Drives the power icon: on = "deactivate", off = "activate". */
  active?: boolean
  labels: { edit: string; activate: string; deactivate: string; remove: string }
}) {
  const tip = (label: string) => ({ 'aria-label': label, title: label }) as object
  // The same 32px ghost icon on every list, and the strip leads the row the
  // way it does in the finder the staff already use.
  // An outlined square on a phone, where a bare glyph has no edge to aim at,
  // and the quiet ghost on a desktop row, where the whole row is the target.
  const icon = {
    size: 'sm',
    variant: 'ghost',
    width: 28,
    paddingHorizontal: 0,
    $sm: { width: 36, height: 36, borderWidth: 1, borderColor: '$borderColorHover' },
  } as const
  return (
    <XStack gap={2} alignItems="center">
      {edit ? (
        <Button {...icon} iconBefore={<Pencil size={15} />} onPress={edit} {...tip(labels.edit)} />
      ) : null}
      {toggle ? (
        <Button
          {...icon}
          iconBefore={active ? <PowerOff size={15} /> : <Power size={15} />}
          onPress={toggle}
          {...tip(active ? labels.deactivate : labels.activate)}
        />
      ) : null}
      {remove ? (
        <Button
          {...icon}
          iconBefore={<Trash2 size={15} />}
          onPress={remove}
          {...tip(labels.remove)}
        />
      ) : null}
    </XStack>
  )
}
