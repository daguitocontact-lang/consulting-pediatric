import type { ReactNode } from 'react'
import { Stack, Text, XStack, YStack } from 'tamagui'

export type DataColumn<Row> = {
  key: string
  label: string
  /** Flex weight for column width. Defaults to 1. Ignored if `width` is set. */
  flex?: number
  /** Fixed pixel width. Wins over flex; use for columns with stable content (counts, badges). */
  width?: number
  /** Min width in px. */
  minWidth?: number
  align?: 'left' | 'right' | 'center'
  render: (row: Row) => ReactNode
}

export type DataTableProps<Row> = {
  columns: DataColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  emptyLabel?: string
  /** Optional row background tint (e.g. dirty edit state). */
  rowBackground?: (row: Row) => string | undefined
  /**
   * Width below which the table scrolls horizontally instead of letting flex
   * crush the columns. Defaults to the floor the columns themselves declare.
   */
  minWidth?: number
}

type AlignValue = DataColumn<unknown>['align']

function justifyFor(align: AlignValue) {
  if (align === 'right') return 'flex-end' as const
  if (align === 'center') return 'center' as const
  return 'flex-start' as const
}

/**
 * The width the columns declare for themselves. Gaps are excluded on purpose:
 * this is a floor, and undershooting only means the table starts scrolling
 * slightly later. Columns that are pure flex contribute nothing, so a table of
 * only flex columns keeps its old fluid behaviour.
 */
function intrinsicMinWidth<Row>(columns: DataColumn<Row>[]): number {
  return columns.reduce((total, col) => total + (col.width ?? col.minWidth ?? 0), 0)
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  emptyLabel = 'Sin datos',
  rowBackground,
  minWidth,
}: DataTableProps<Row>) {
  // Header and rows share ONE scroll container: separate ones would let the
  // header drift out of alignment with the columns underneath it.
  const floor = minWidth ?? intrinsicMinWidth(columns)
  // Visual language matches the Credits "Recent transactions" table: a
  // card surface (color1, 16px radius), tiny uppercase 10px header cells,
  // and rows separated by a single hairline — no zebra, no hover fill.
  return (
    <YStack
      backgroundColor="$color1"
      borderRadius={16}
      borderWidth={1}
      borderColor="$borderColor"
      overflow="scroll"
    >
      <YStack minWidth={floor} paddingHorizontal="$5" paddingTop="$4" paddingBottom="$3">
        <XStack
          paddingVertical="$2"
          borderBottomWidth={1}
          borderBottomColor="$borderColor"
          gap="$3"
        >
          {columns.map((col) => {
            const fixedWidth = typeof col.width === 'number'
            return (
              <XStack
                key={col.key}
                width={fixedWidth ? col.width : undefined}
                flexBasis={fixedWidth ? col.width : 0}
                flexGrow={fixedWidth ? 0 : (col.flex ?? 1)}
                flexShrink={fixedWidth ? 0 : 1}
                minWidth={col.minWidth}
                justifyContent={justifyFor(col.align)}
                alignItems="center"
              >
                <Text
                  fontSize={10}
                  fontWeight="700"
                  color="$color11"
                  textTransform="uppercase"
                  letterSpacing={0.5}
                  fontFamily="$body"
                >
                  {col.label}
                </Text>
              </XStack>
            )
          })}
        </XStack>
        {rows.length === 0 ? (
          <Stack paddingVertical="$6" alignItems="center">
            <Text fontSize={12} color="$color11">
              {emptyLabel}
            </Text>
          </Stack>
        ) : (
          rows.map((row, idx) => (
            <XStack
              key={rowKey(row)}
              paddingVertical="$2.5"
              borderBottomWidth={idx === rows.length - 1 ? 0 : 1}
              borderBottomColor="$borderColor"
              gap="$3"
              alignItems="center"
              backgroundColor={rowBackground?.(row)}
            >
              {columns.map((col) => {
                const fixedWidth = typeof col.width === 'number'
                return (
                  <XStack
                    key={col.key}
                    width={fixedWidth ? col.width : undefined}
                    flexBasis={fixedWidth ? col.width : 0}
                    flexGrow={fixedWidth ? 0 : (col.flex ?? 1)}
                    flexShrink={fixedWidth ? 0 : 1}
                    minWidth={col.minWidth}
                    justifyContent={justifyFor(col.align)}
                    alignItems="center"
                  >
                    {col.render(row)}
                  </XStack>
                )
              })}
            </XStack>
          ))
        )}
      </YStack>
    </YStack>
  )
}
