// Pagination footer, shared by every list long enough to need one.
//
// Modelled on the finder the Pediatric team already works in: previous / next on
// the outside, the running count in the middle, numbered pages on the right.
// Lists that fit on one page render nothing at all — a pager over 8 rows is
// furniture, not navigation.
import { Text, XStack } from 'tamagui'
import { Button } from './ui'

/**
 * Page numbers with an ellipsis: 26 pages of buttons is a wall, and the useful
 * ones are always the first, the last and the neighbours of where you are.
 */
export function Pager({
  page,
  pages,
  previous,
  next,
  summary,
  onGo,
}: {
  page: number
  pages: number
  previous: string
  next: string
  summary: string
  onGo: (page: number) => void
}) {
  if (pages <= 1) return null

  const numbers: (number | 'gap')[] = []
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 2) numbers.push(n)
    else if (numbers[numbers.length - 1] !== 'gap') numbers.push('gap')
  }

  return (
    <XStack gap="$0.75" alignItems="center" flexWrap="wrap" justifyContent="space-between">
      <Button size="sm" variant="ghost" disabled={page <= 1} onPress={() => onGo(page - 1)}>
        {previous}
      </Button>
      <Text fontSize={13} color="$color11">
        {summary}
      </Text>
      <XStack gap="$0.25" alignItems="center" flexWrap="wrap">
        {numbers.map((n, index) =>
          n === 'gap' ? (
            <Text key={`gap-${index}`} fontSize={13} color="$color11" paddingHorizontal="$0.5">
              …
            </Text>
          ) : (
            <Button
              key={n}
              size="sm"
              variant={n === page ? 'primary' : 'ghost'}
              onPress={() => onGo(n)}
            >
              {String(n)}
            </Button>
          ),
        )}
        <Button size="sm" variant="ghost" disabled={page >= pages} onPress={() => onGo(page + 1)}>
          {next}
        </Button>
      </XStack>
    </XStack>
  )
}
