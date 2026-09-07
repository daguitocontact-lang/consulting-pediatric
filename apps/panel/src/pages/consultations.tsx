/**
 * Consultas médicas — the listing, ported from the legacy app's
 * /dashboard/consultations.
 *
 * What it keeps from there: the tabs by consultation type, the debounced name
 * search ANDed with a single-day picker, server-side pagination and sorting,
 * the rename dialog, and the poll that keeps a processing row moving without a
 * page refresh.
 *
 * What it does differently, and why:
 *
 *   - the tab filter is a server filter. The legacy page paginated first and
 *     filtered the ten rows it got in the browser, so selecting "Video" showed
 *     three rows and a pager that still claimed six pages;
 *   - the tabs carry counts, which is what the doctor actually scans for;
 *   - a row offers only the actions its status allows (lib/consultations.ts)
 *     rather than four buttons with three of them greyed out;
 *   - the plan/quota banner is gone. Metering belongs to the host's billing,
 *     not to a custom panel embedded in it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Text, XStack, YStack } from 'tamagui'
import { Plus, Video } from '@tamagui/lucide-icons'
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage, type MountProps } from '../lib/api'
import { translator } from '../lib/i18n'
import { useAsync } from '../lib/useAsync'
import { useDebounced } from '../lib/useDebounced'
import {
  DEFAULT_MODE,
  MODE_KEY,
  OFFERED_MODES,
  STATUS_KEY,
  displayName,
  formatDuration,
  hasWorkInFlight,
  rowActions,
  shortDateTime,
  statusTone,
  type Consultation,
  type ConsultationMode,
  type ConsultationPage,
} from '../lib/consultations'
import { ErrorNote, PageShell } from '../components/PageShell'
import { MeetingRoom } from '../components/MeetingRoom'
import { DataGrid, RowActions, type GridColumn } from '../components/DataGrid'
import { CreateForm, type FieldSpec } from '../components/CreateForm'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DateField, SearchField } from '../components/fields'
import { Tabs, type Tab } from '../components/Tabs'
import { Pager } from '../components/Pager'
import { useToast } from '../components/Toast'
import { Badge, Button, EmptyState, Spinner } from '../components/ui'
import { ConsultationScreen } from './consultation'

type TabKey = 'all' | ConsultationMode
type Template = { id: string; title: string; scope: 'org' | 'personal'; active: boolean }

const PAGE_SIZE = 10

/**
 * The tabs, derived from the modes the panel offers rather than hardcoded.
 *
 * With a single offered mode the bar is dropped entirely (see `showTabs`): a
 * filter with one option filters nothing. It comes back on its own the day a
 * second mode is offered again — the tab list is the constant, not a copy of
 * it that has to be remembered.
 */
const TABS: TabKey[] = ['all', ...OFFERED_MODES]

/** A row created in a mode the panel no longer offers still lists and still
 *  opens; only the filter for it goes away. Hiding data is not the ask. */
const showTabs = OFFERED_MODES.length > 1

/** Milliseconds between refreshes while a consultation is still moving. The
 *  legacy page used ten seconds and stopped as soon as nothing was processing;
 *  the same rule, expressed as the poll interval this page asks `useAsync` for. */
const LIVE_REFRESH_MS = 10_000

export function Page(props: MountProps) {
  const i18n = translator(props.locale)
  const { t, plural } = i18n
  const toast = useToast()

  const [tab, setTab] = useState<TabKey>('all')
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [day, setDay] = useState('')
  // Typing must not fire a request per keystroke; the server sees the value the
  // doctor stopped on.
  const search = useDebounced(query, 400)

  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Consultation | null>(null)
  const [removing, setRemoving] = useState<Consultation | null>(null)
  const [meeting, setMeeting] = useState<Consultation | null>(null)
  // The section shows either the listing or ONE consultation. The host mounts
  // this panel per route and never re-mounts on a click, so the detail is state
  // here rather than a route of Daguito's the host would have to know about.
  const [openId, setOpenId] = useState<string | null>(null)

  const params = useMemo(() => {
    const search_ = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (tab !== 'all') search_.set('mode', tab)
    if (search) search_.set('q', search)
    if (day) search_.set('date', day)
    return search_.toString()
  }, [page, tab, search, day])

  const list = useAsync<ConsultationPage>(
    () => apiGet<ConsultationPage>(props, `/api/consultations?${params}`),
    [props.token, props.apiBase, params],
    // Poll only while something is moving. `refreshMs: 0` is off, and the
    // dependency below flips it the moment a row starts (or stops) processing.
    { refreshMs: 0 },
  )

  const rows = list.data?.data ?? []
  const counts = list.data?.counts
  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // The legacy page ran its own setInterval and cleared it on every render of
  // the rows; `useAsync` already owns a poller, so this only decides whether it
  // should be running.
  const live = hasWorkInFlight(rows)
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => list.refresh(), LIVE_REFRESH_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, params])

  const templates = useAsync<{ templates: Template[] }>(
    () => apiGet<{ templates: Template[] }>(props, '/api/consultation-templates'),
    [props.token, props.apiBase],
    { refreshMs: 0 },
  )

  // A filter change always goes back to page one: page 4 of an unfiltered list
  // is page nothing of a filtered one, and an empty table with a full pager is
  // how the legacy page looked when you searched from deep in the list.
  const onFilter = useCallback((apply: () => void) => {
    apply()
    setPage(1)
  }, [])

  const templateOptions = useMemo(
    () => [
      { value: '', label: t('consultations.noTemplate') },
      ...(templates.data?.templates ?? []).map((template) => ({
        value: template.id,
        label: template.title,
      })),
    ],
    [templates.data, t],
  )

  const createFields: FieldSpec[] = [
    // A required select with ONE option is a question with one answer: it is
    // dropped, and the mode is filled in on submit. The field returns by
    // itself the day OFFERED_MODES grows.
    ...(OFFERED_MODES.length > 1
      ? [
          {
            name: 'mode',
            label: t('consultations.form.mode'),
            type: 'select' as const,
            required: true,
            options: OFFERED_MODES.map((mode) => ({
              value: mode,
              label: t(MODE_KEY[mode]),
            })),
          },
        ]
      : []),
    // ONE patient field. It was two — the CRM picker and a free-text name —
    // which is two questions for one answer, and left the row to be titled by
    // whichever the doctor happened to fill. The picker wins because the
    // patient IS a contact in Daguito: the name comes back with the id (see
    // `<field>_label` in CreateForm) and is stored beside it so the listing can
    // sort and search by a name that lives in this database.
    { name: 'patient_contact_id', label: t('consultations.form.patient'), type: 'contact' },
    { name: 'name', label: t('consultations.form.name') },
    {
      name: 'template_id',
      label: t('consultations.form.template'),
      type: 'select',
      options: templateOptions,
    },
    { name: 'notes', label: t('consultations.form.notes'), full: true },
  ]

  const columns: GridColumn<Consultation>[] = [
    {
      key: 'name',
      label: t('consultations.col.name'),
      flex: 2,
      minWidth: 180,
      sortValue: (row) => displayName(row, i18n).toLowerCase(),
      render: (row) => (
        <YStack gap="$0.25">
          <Text fontSize={14} fontWeight="600" color="$color" numberOfLines={1}>
            {displayName(row, i18n)}
          </Text>
          <Text fontSize={12} color="$color11">
            {t(MODE_KEY[row.mode])}
          </Text>
        </YStack>
      ),
    },
    {
      key: 'date',
      label: t('consultations.col.date'),
      minWidth: 150,
      mobile: 'inline',
      sortValue: (row) => row.created_at,
      render: (row) => (
        <Text fontSize={13} color="$color11">
          {shortDateTime(row.created_at, i18n.lang)}
        </Text>
      ),
    },
    {
      key: 'status',
      label: t('consultations.col.status'),
      width: 130,
      sortValue: (row) => row.status,
      render: (row) => (
        <XStack alignItems="center" gap="$0.5">
          <Badge variant={statusTone(row.status)} size="sm">
            {t(STATUS_KEY[row.status])}
          </Badge>
          {/* The consent stamp is the one thing a clinic is audited on, so the
              listing shows that it exists rather than making the doctor open
              the consultation to find out. */}
          {row.patient_consent_at ? (
            <Text fontSize={11} color="$color11" aria-label={t('consultations.consent')}>
              ✓
            </Text>
          ) : null}
        </XStack>
      ),
    },
    {
      key: 'template',
      label: t('consultations.col.template'),
      minWidth: 140,
      mobile: 'hide',
      sortValue: (row) => row.template_title ?? '',
      render: (row) => (
        <Text fontSize={13} color={row.template_title ? '$color' : '$color11'} numberOfLines={1}>
          {row.template_title ?? t('consultations.noTemplate')}
        </Text>
      ),
    },
    {
      key: 'duration',
      label: t('consultations.col.duration'),
      width: 100,
      align: 'right',
      mobile: 'inline',
      sortValue: (row) => row.duration_seconds,
      render: (row) => (
        <Text fontSize={13} color="$color11" fontVariant={['tabular-nums']}>
          {formatDuration(row.duration_seconds)}
        </Text>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: 120,
      align: 'right',
      ownClicks: true,
      render: (row) => {
        const can = rowActions(row.status)
        return (
          <XStack alignItems="center" justifyContent="flex-end" gap="$0.5">
            {/* The room is one more icon in the row's strip, not a labelled
                button: three words of chrome per row pushed the column off the
                right edge of the table, and the strip is what the staff scan. */}
            {can.join ? (
              <Button
                size="sm"
                variant="ghost"
                width={28}
                paddingHorizontal={0}
                $sm={{ width: 36, height: 36, borderWidth: 1, borderColor: '$borderColorHover' }}
                iconBefore={<Video size={15} />}
                onPress={() => setMeeting(row)}
                aria-label={t('consultations.action.join')}
              />
            ) : null}
            <RowActions
              edit={can.rename ? () => setRenaming(row) : undefined}
              remove={can.remove ? () => setRemoving(row) : undefined}
              labels={{
                edit: t('consultations.action.rename'),
                activate: t('consultations.action.join'),
                deactivate: t('consultations.action.join'),
                remove: t('consultations.action.delete'),
              }}
            />
          </XStack>
        )
      },
    },
  ]

  const tabs: Tab<TabKey>[] = TABS.map((key) => ({
    key,
    label: key === 'all' ? t('consultations.tab.all') : t(MODE_KEY[key]),
    badge: counts ? String(counts[key]) : undefined,
  }))

  const filtered = Boolean(search || day)

  if (openId) {
    return (
      <ConsultationScreen
        props={props}
        consultationId={openId}
        onBack={() => {
          setOpenId(null)
          // The consultation may have been recorded, renamed or closed while it
          // was open; the listing behind it must not still show the old row.
          list.reload()
        }}
      />
    )
  }

  return (
    <PageShell
      title={t('consultations.title')}
      repeatsSection
      subtitle={list.loading ? t('common.loading') : plural(total, 'consultations.count')}
      titleAside={list.refreshing ? <Spinner /> : null}
      // Search and create on the title row, as on every list of the platform.
      actions={
        <>
          <SearchField
            width={340}
            value={query}
            onChange={(value) => onFilter(() => setQuery(value))}
            ariaLabel={t('consultations.searchLabel')}
            placeholder={t('consultations.searchHint')}
          />
          <Button
            size="lg"
            variant="primary"
            iconBefore={<Plus size={14} />}
            onPress={() => setCreating(true)}
          >
            {t('consultations.new')}
          </Button>
        </>
      }
    >
      {showTabs ? (
        <Tabs<TabKey> tabs={tabs} value={tab} onChange={(key) => onFilter(() => setTab(key))} fit />
      ) : null}

      <XStack gap="$1" alignItems="flex-end" flexWrap="wrap">
        <DateField
          label={t('consultations.dateLabel')}
          value={day}
          onChange={(value) => onFilter(() => setDay(value))}
          size="sm"
        />
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={() =>
              onFilter(() => {
                setQuery('')
                setDay('')
              })
            }
          >
            {t('consultations.clearFilters')}
          </Button>
        ) : null}
      </XStack>

      {list.error ? (
        <ErrorNote>{t('consultations.error', { detail: errorMessage(list.error, i18n) })}</ErrorNote>
      ) : null}

      {list.loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? t('consultations.emptyFiltered') : t('consultations.empty')}
          description={
            filtered ? t('consultations.emptyFilteredBody') : t('consultations.emptyBody')
          }
        />
      ) : (
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          onRowPress={(row) => setOpenId(row.id)}
        />
      )}

      <Pager
        page={page}
        pages={pages}
        previous={t('pager.previous')}
        next={t('pager.next')}
        summary={t('pager.summary', { page, pages })}
        onGo={setPage}
      />

      <CreateForm
        i18n={i18n}
        title={t('consultations.new')}
        open={creating}
        orgId={props.orgId}
        fields={createFields}
        onClose={() => setCreating(false)}
        onSubmit={async (values) => {
          const { consultation } = await apiPost<{ consultation: Consultation }>(
            props,
            '/api/consultations',
            {
              mode: values.mode || DEFAULT_MODE,
              patient_contact_id: values.patient_contact_id || null,
              // The name travels with the id the picker returned. Denormalised
              // on purpose: a name that only exists in Daguito cannot appear in
              // an ORDER BY here.
              patient_name: values.patient_contact_id_label || null,
              name: values.name || null,
              template_id: values.template_id || null,
              notes: values.notes || null,
            },
          )
          setCreating(false)
          setPage(1)
          list.reload()
          toast.success(t('consultations.toast.created'))
          // Straight into it, the way the legacy's create navigates
          // (`useCreateConsultation` → navigate(consultationUrl + uuid)).
          // Creating a consultation is not filing one: the doctor made it
          // because the patient is in front of them, and being dropped back on
          // the list to hunt for the row they just made is a step nobody wants.
          setOpenId(consultation.id)
        }}
      />

      <CreateForm
        i18n={i18n}
        title={t('consultations.rename')}
        open={renaming !== null}
        initial={{ name: renaming?.name ?? '' }}
        fields={[{ name: 'name', label: t('consultations.renameField'), full: true }]}
        onClose={() => setRenaming(null)}
        onSubmit={async (values) => {
          const target = renaming
          if (!target) return
          // An empty title clears the custom name and the row falls back to the
          // patient/date label — the same rule the legacy rename had.
          await apiPatch(props, `/api/consultations/${target.id}`, {
            name: values.name.trim() || null,
          })
          setRenaming(null)
          list.refresh()
          toast.success(t('consultations.toast.renamed'))
        }}
      />

      <MeetingRoom
        props={props}
        i18n={i18n}
        consultation={
          meeting
            ? { id: meeting.id, label: displayName(meeting, i18n), status: meeting.status }
            : null
        }
        onClose={() => setMeeting(null)}
        onEnded={() => list.refresh()}
      />

      <ConfirmDialog
        i18n={i18n}
        open={removing !== null}
        title={t('consultations.deleteTitle')}
        body={t('consultations.deleteBody', {
          name: removing ? displayName(removing, i18n) : '',
        })}
        confirmLabel={t('consultations.action.delete')}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          const target = removing
          if (!target) return
          await apiDelete(props, `/api/consultations/${target.id}`)
          setRemoving(null)
          list.reload()
          toast.success(t('consultations.toast.deleted'))
        }}
      />
    </PageShell>
  )
}
