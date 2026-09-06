// Lead-contact picker: search Daguito's directory by name, store its uuid.
//
// The reservation needs `contacts.id` (see lib/daguito.ts for why the panel can
// reach Daguito's API at all), but nobody knows a guest by uuid. So the box
// takes a name and resolves it, while still accepting a pasted uuid — the
// directory is behind `requireManage` and any org member can open this panel,
// so the operator who gets a 403 must not be locked out of creating a booking.
//
// The result list expands inline instead of floating over the form. This lives
// inside the Modal, and an absolutely-positioned dropdown there is one
// `overflow` away from being clipped by the dialog it sits in.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Text, XStack, YStack } from 'tamagui'
import { FormField, Label, Spinner } from './ui'
import { searchContacts, daguitoApiBase, type DaguitoContact } from '../lib/daguito'
import type { translator } from '../lib/i18n'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Long enough that a two-letter prefix does not fetch the whole directory. */
const MIN_QUERY = 2
/** One request per pause in typing, not per keystroke. */
const DEBOUNCE_MS = 250

export function ContactField({
  label,
  orgId,
  value,
  onChange,
  i18n,
}: {
  label: string
  orgId: string
  /** The contact uuid, or '' when nothing is chosen yet. */
  value: string
  /** The picked contact travels with its id: the caller needs the NAME too. */
  onChange: (contactId: string, contact?: DaguitoContact) => void
  i18n: ReturnType<typeof translator>
}) {
  const { t } = i18n

  const [text, setText] = useState('')
  const [picked, setPicked] = useState<DaguitoContact | null>(null)
  const [results, setResults] = useState<DaguitoContact[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  // A 403 (member without the manage role) or an unrecognised host: the field
  // quietly becomes the uuid box it used to be rather than showing an error the
  // operator can do nothing about.
  const [unavailable, setUnavailable] = useState(() => daguitoApiBase() === null)

  const abort = useRef<AbortController | null>(null)
  // Abort whatever is in flight when the dialog closes mid-search.
  useEffect(() => () => abort.current?.abort(), [])

  const runSearch = useCallback(
    async (query: string) => {
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      setBusy(true)
      try {
        const found = await searchContacts(orgId, query, controller.signal)
        if (controller.signal.aborted) return
        setResults(found)
        setSearched(true)
      } catch (err) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return
        // Any failure here is a dead end for browsing, not for the booking.
        setUnavailable(true)
        setResults([])
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    },
    [orgId],
  )

  // Debounced search on the typed text. A pasted uuid is an answer, not a
  // query, so it never triggers one.
  useEffect(() => {
    if (unavailable || picked) return
    const query = text.trim()
    if (UUID.test(query) || query.length < MIN_QUERY) {
      setResults([])
      setSearched(false)
      return
    }
    const timer = setTimeout(() => void runSearch(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, picked, unavailable, runSearch])

  function handleText(next: string) {
    setText(next)
    setPicked(null)
    // Typing after a pick invalidates it — but a pasted uuid is itself a valid
    // value, so the form stays submittable without a round trip.
    onChange(UUID.test(next.trim()) ? next.trim() : '')
  }

  function pick(contact: DaguitoContact) {
    setPicked(contact)
    setText(contact.label)
    setResults([])
    setSearched(false)
    onChange(contact.id, contact)
  }

  function clear() {
    setPicked(null)
    setText('')
    setResults([])
    setSearched(false)
    onChange('')
  }

  const showList = !picked && !unavailable && results.length > 0
  const showEmpty = !picked && !unavailable && searched && !busy && results.length === 0

  return (
    <YStack gap="$0.5">
      <Label>{label}</Label>

      <FormField
        inputSize="md"
        value={text}
        placeholder={unavailable ? t('reservations.form.customerHint') : t('contact.searchHint')}
        onChangeText={handleText}
      />

      {/* One line under the box carrying the whole state of the field, so the
          form never grows or jumps as the operator types. */}
      {picked ? (
        <XStack gap="$0.5" alignItems="center" flexWrap="wrap">
          <Text fontSize={13} color="$success700">
            {t('contact.selected', { name: picked.label })}
          </Text>
          <Text
            fontSize={13}
            color="$color11"
            textDecorationLine="underline"
            cursor="pointer"
            onPress={clear}
          >
            {t('contact.change')}
          </Text>
        </XStack>
      ) : busy ? (
        <XStack gap="$0.5" alignItems="center">
          <Spinner size="sm" />
          <Text fontSize={13} color="$color11">
            {t('contact.searching')}
          </Text>
        </XStack>
      ) : showEmpty ? (
        <Text fontSize={13} color="$color11">
          {t('contact.noResults')}
        </Text>
      ) : unavailable ? (
        <Text fontSize={13} color="$color11">
          {t('contact.unavailable')}
        </Text>
      ) : null}

      {showList ? (
        <YStack
          borderWidth={1}
          borderColor="$borderColor"
          borderRadius="$3"
          overflow="hidden"
          maxHeight={220}
        >
          {results.map((contact, index) => (
            <XStack
              key={contact.id}
              paddingHorizontal="$1"
              paddingVertical="$0.75"
              gap="$0.5"
              alignItems="center"
              justifyContent="space-between"
              cursor="pointer"
              backgroundColor="transparent"
              hoverStyle={{ backgroundColor: '$color3' }}
              borderTopWidth={index === 0 ? 0 : 1}
              borderColor="$borderColor"
              onPress={() => pick(contact)}
            >
              <Text fontSize={14} color="$color12" numberOfLines={1}>
                {contact.label}
              </Text>
              {contact.detail ? (
                <Text fontSize={13} color="$color11" numberOfLines={1}>
                  {contact.detail}
                </Text>
              ) : null}
            </XStack>
          ))}
        </YStack>
      ) : null}

      {/* The uuid actually being submitted, when it came from a paste rather
          than a pick — otherwise there is no way to tell a valid one from a
          typo before the API rejects it. */}
      {!picked && UUID.test(value) ? (
        <Text fontSize={13} color="$color11">
          {t('contact.usingId')}
        </Text>
      ) : null}
    </YStack>
  )
}
