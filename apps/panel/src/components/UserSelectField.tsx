// Seller picker: choose an org member by name, store their Daguito uuid.
//
// A dropdown rather than the search box the lead contact uses, because these
// are two different directories: an org has a handful of MEMBERS (loaded once,
// listed) and thousands of CONTACTS (searched per keystroke). The route behind
// this one is also gated only on membership, not on the manage role, so every
// operator who can open the panel can populate it.
//
// It is a select in every case. When the directory cannot be reached — the
// Daguito session lapsed, the panel opened standalone, a host that is not
// Daguito — the list is just shorter (the blank option, plus the seller already
// on the booking so that value is never lost) and a line under it says why.
// It used to turn into a uuid box then, and to the operator that read as the
// field having been swapped for something else.
import { useEffect, useState } from 'react'
import { Text, YStack } from 'tamagui'
import { SelectField } from './fields'
import { fetchOrgMembers, daguitoApiBase, type DaguitoUser } from '../lib/daguito'
import type { translator } from '../lib/i18n'

export function UserSelectField({
  label,
  orgId,
  value,
  onChange,
  i18n,
}: {
  label: string
  orgId: string
  /** Daguito users.id, or '' for unassigned. */
  value: string
  onChange: (userId: string) => void
  i18n: ReturnType<typeof translator>
}) {
  const { t } = i18n

  const [members, setMembers] = useState<DaguitoUser[]>([])
  const [unavailable, setUnavailable] = useState(() => daguitoApiBase() === null)

  useEffect(() => {
    if (unavailable || !orgId) return
    const controller = new AbortController()
    fetchOrgMembers(orgId, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        setMembers(rows)
        // An empty directory is worth saying: the operator would otherwise
        // wonder where the team went.
        if (rows.length === 0) setUnavailable(true)
      })
      .catch((err) => {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return
        setUnavailable(true)
      })
    return () => controller.abort()
  }, [orgId, unavailable])

  // A seller the booking already carries stays selectable even when the
  // directory did not load: without this option the select would show the
  // blank row and the next save would silently drop the seller.
  const known = members.some((m) => m.id === value)
  const options = [
    { value: '', label: t('wizard.booking.sellerNone') },
    ...members.map((m) => ({ value: m.id, label: m.label })),
    ...(value && !known ? [{ value, label: value }] : []),
  ]

  return (
    <YStack gap="$0.5">
      <SelectField
        label={label}
        value={value}
        // Always filtered, however few members the org has today: this list only
        // grows, and a seller is looked up by name, never by position.
        searchable
        // The blank option is first and deliberate: a reservation taken at the
        // desk has no seller, and defaulting to whichever member sorts first
        // would quietly attribute the sale to them.
        options={options}
        onChange={onChange}
      />
      {unavailable ? (
        <Text fontSize={13} color="$color11">
          {t('user.unavailable')}
        </Text>
      ) : null}
    </YStack>
  )
}
