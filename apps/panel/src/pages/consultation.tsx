/**
 * The consultation screen — the legacy app's /dashboard/consultation/:id.
 *
 * Four panels around a room, the way the doctor works: the meeting on the left
 * with the assistant and the transcript under it, the recommendations and the
 * clinical note on the right. The header carries the clock and the one button
 * that matters.
 *
 * What is real today: the room, the clock, the transcript, the recommendations
 * with the doctor's triage, the note (drafted or written by hand) and the
 * assistant thread — all persisted through /api/consultations/:id/workspace.
 * What is not yet: the engine that FILLS the transcript, the recommendations
 * and the note. That is a Daguito flow (the legacy app's `c_facts` / `c_soap`
 * nodes) and it writes through the same routes this screen reads, so nothing
 * here changes when it is turned on.
 *
 * The layout is a grid rather than the legacy flexlayout dock: this panel lives
 * inside Daguito's page and gets half a screen, and a draggable dock with a
 * saved cookie layout is a dependency and a migration for splitters nobody
 * moved. The one thing the dock was used for — "make this panel big" — is the
 * maximise button on each panel.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Link2, Mic, MicOff, Square, TriangleAlert, Video } from '@tamagui/lucide-icons'
import { Text, XStack, YStack } from 'tamagui'
import { apiGet, apiPatch, apiPost, errorMessage, type MountProps } from '../lib/api'
import { translator } from '../lib/i18n'
import { useAsync } from '../lib/useAsync'
import { MODE_KEY, displayName, formatDuration, shortDateTime } from '../lib/consultations'
import {
  autoJoinsMeeting,
  canStartRecording,
  elapsedSeconds,
  meetingSlot,
  needsConsent,
  type Workspace,
} from '../lib/workspace'
import { useConsultationStream } from '../lib/useConsultationStream'
import { JitsiFrame } from '../components/JitsiFrame'
import {
  NotePanel,
  RecommendationsPanel,
  TranscriptionPanel,
} from '../components/consultation/panels'
import { ChatbotPanel } from '../components/consultation/ChatbotPanel'
import { AudioPanel } from '../components/consultation/AudioPanel'
import { MicPanel } from '../components/consultation/MicPanel'
import { ConsentModal } from '../components/consultation/ConsentModal'
import { DockGroup, Splitter, paneStyle, type DockTab } from '../components/consultation/Dock'
import {
  DEFAULT_LAYOUT,
  clampSplit,
  columnLayout,
  hideTabs,
  loadLayout,
  moveTab,
  saveLayout,
  type TabKey,
} from '../lib/panel-layout'
import { ErrorNote, PageShell } from '../components/PageShell'
import { useToast } from '../components/Toast'
import { Badge, Button, Spinner } from '../components/ui'

/** Which GROUP fills the screen, if any. A group keeps its tabs when it does,
 *  so maximising the pane holding the note and the transcript still lets the
 *  doctor switch between them — the legacy's tabset maximise. */
type Maximised = number | null

/**
 * How tall the panel grid may get.
 *
 * The viewport minus the host's own chrome and this screen's header. It is an
 * estimate on purpose — the panel is embedded in Daguito's page and cannot
 * measure what is above it — and it errs SHORT: a grid a little smaller than
 * the space leaves a gap, while one a little taller pushes its own last row
 * out of reach, which is the failure being fixed here.
 */
const PANELS_MAX_HEIGHT = 'calc(100dvh - 190px)'

export function ConsultationScreen({
  props,
  consultationId,
  onBack,
}: {
  props: MountProps
  consultationId: string
  onBack: () => void
}) {
  const i18n = translator(props.locale)
  const { t } = i18n
  const toast = useToast()

  const [inMeeting, setInMeeting] = useState(false)
  // Whether the room is on screen at all. A video consultation IS the call, so
  // it opens with the screen; every other kind keeps its room behind a button.
  const [roomOpen, setRoomOpen] = useState(false)
  // Set when Jitsi says the doctor hung up. Without it the iframe stays on
  // screen showing Jitsi's own "you left the meeting" page — a dead embed the
  // doctor cannot get out of except by leaving the consultation.
  const [roomClosed, setRoomClosed] = useState(false)
  // Set by the first answered turn: the route reports whether an assistant is
  // configured, so the panel does not have to guess.
  const [assistantOn, setAssistantOn] = useState(false)
  const [maximised, setMaximised] = useState<Maximised>(null)
  // The consent gate, open only until the doctor confirms it once.
  const [consentOpen, setConsentOpen] = useState(false)
  // Where the panels sit and how big they are. Read from localStorage once, on
  // mount rather than in the initialiser, because the panel is imported as a
  // module into somebody else's page and `window` is touched only after it is
  // certainly there.
  const [layout, setLayout] = useState(DEFAULT_LAYOUT)
  useEffect(() => setLayout(loadLayout()), [])

  const updateLayout = useCallback((patch: Partial<typeof DEFAULT_LAYOUT>) => {
    setLayout((current) => {
      const next = { ...current, ...patch }
      saveLayout(next)
      return next
    })
  }, [])

  const moveTabTo = useCallback(
    (tab: TabKey, toGroup: number, before?: TabKey) =>
      // Read the stored layout rather than closing over state: a drag that
      // lands after a re-render must not apply to a stale arrangement.
      updateLayout({ groups: moveTab(loadLayout().groups, tab, toGroup, before) }),
    [updateLayout],
  )
  // Re-renders the clock once a second while the room is open. The value
  // itself is derived from the consultation (see elapsedSeconds), so a reload
  // does not restart it — the legacy timer went back to 00:00 every time.
  const [tick, setTick] = useState(0)
  // The engine: microphone into the Daguito flow, its output back into our API
  // (lib/useConsultationStream). The screen reads the results the same way it
  // reads a note the doctor typed — through the workspace endpoint.
  const stream = useConsultationStream(props, consultationId)

  const state = useAsync<Workspace>(
    () => apiGet<Workspace>(props, `/api/consultations/${consultationId}/workspace`),
    [props.token, props.apiBase, consultationId],
    // The transcript and the recommendations are written by the engine, not by
    // this screen, so it polls while the consultation is live.
    { refreshMs: 0 },
  )

  const workspace = state.data
  const consultation = workspace?.consultation
  const recording = consultation?.status === 'recording'

  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => {
      setTick((value) => value + 1)
      // Cheap: the workspace endpoint is one round trip and this is the screen
      // the doctor is looking at.
      state.refresh()
    }, 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, consultationId])

  const elapsed = useMemo(
    () => (consultation ? elapsedSeconds(consultation) : 0),
    // `tick` is the dependency that makes the clock move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consultation, tick],
  )

  const setStatus = useCallback(
    async (status: 'recording' | 'processing' | 'finished') => {
      await apiPatch(props, `/api/consultations/${consultationId}`, { status })
      // `refresh`, never `reload`: this screen holds a Jitsi iframe and an open
      // microphone, and a foreground load turns `loading` back on. See the
      // guard below for what that used to do to them.
      state.refresh()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consultationId, props],
  )

  // Starting a consultation is two things at once and they must not drift: the
  // status the listing shows, and the microphone. Stopping is the same pair in
  // reverse, and the microphone goes first.
  const startConsultation = useCallback(async () => {
    // The mode goes in explicitly and is never guessed: it picks the flow, and
    // the wrong flow leaves an STT node idle and withholds the transcript for
    // its whole timeout. The button is only enabled once the workspace has
    // loaded, so `consultation` is here — but the hook checks anyway, because
    // that is the invariant and not a hope about render order.
    await setStatus('recording')
    await stream.start({ mode: consultation?.mode, onChange: () => state.refresh() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStatus, stream.start, consultation?.mode])

  /**
   * What the start button actually does.
   *
   * The microphone never opens before the consent is on the row. A consultation
   * that already carries the stamp starts straight away — a doctor who paused
   * for lunch should not have to ask a parent for permission twice — which is
   * exactly the legacy's `requestStartRecording` rule.
   */
  const requestStart = useCallback(() => {
    if (consultation && !needsConsent(consultation)) {
      void startConsultation()
      return
    }
    setConsentOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultation, startConsultation])

  const stopConsultation = useCallback(async () => {
    stream.stop()
    await setStatus('finished')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStatus, stream.stop])

  /**
   * The spinner is for the FIRST paint, and only for it.
   *
   * `loading` goes true on every FOREGROUND load, and a spinner returned from
   * here unmounts the whole screen — the Jitsi iframe with it. So pressing
   * «iniciar», which reloaded the workspace after the PATCH, dropped the doctor
   * out of the room and re-joined a new one: the room's own clock back at
   * 00:00 while the consultation's kept counting, the panels rebuilt and the
   * assistant scrolled back to the top. The same went for a single failed poll,
   * which took the room down and showed a full-page error.
   *
   * Once there is a workspace on screen, nothing takes it away again: a reload
   * keeps the last one until the next lands, and an error reports itself in
   * place, next to the panels.
   */
  if (!workspace || !consultation) {
    if (state.loading) {
      return (
        <YStack flex={1} alignItems="center" justifyContent="center" minHeight={280}>
          <Spinner />
        </YStack>
      )
    }
    return (
      <YStack flex={1} padding="$2" gap="$1">
        <Button size="sm" variant="ghost" iconBefore={<ArrowLeft size={15} />} onPress={onBack}>
          {t('workspace.back')}
        </Button>
        <ErrorNote>
          {t('workspace.error', { detail: errorMessage(state.error, i18n) })}
        </ErrorNote>
      </YStack>
    )
  }

  const label = displayName(consultation, i18n)
  const canStart = canStartRecording({
    inMeeting,
    status: consultation.status,
    mode: consultation.mode,
  })
  const showRoom = !roomClosed && (roomOpen || autoJoinsMeeting(consultation.mode))

  /**
   * What goes where the room goes — the legacy's `BodyDockView` factory for the
   * `meeting` slot, which is three rules and not one:
   *
   *   1. a FINISHED consultation shows no room at all. It is a record now, and
   *      re-opening the call to read it puts the doctor back in an empty room
   *      and stamps a meeting that never happened onto a closed consultation.
   *   2. a `transcription` has no room and no microphone: its input is a file.
   *   3. a `presencial` is two people and one microphone — the mic panel, with
   *      the room behind a button for the parent who could not come.
   *
   * Only a video consultation opens a call by itself.
   */
  const finished = consultation.status === 'finished'
  const slot = meetingSlot(consultation)

  const meetingTab: DockTab = {
    key: 'meeting',
    label: slot === 'upload' ? t('workspace.panel.audio') : t('workspace.panel.meeting'),
    content:
      slot === 'ended' ? (
        <YStack flex={1} alignItems="center" justifyContent="center" padding="$3">
          <Text fontSize={13} color="$color11" textAlign="center">
            {consultation.mode === 'in_person'
              ? t('workspace.room.endedInPerson')
              : t('workspace.room.ended')}
          </Text>
        </YStack>
      ) : slot === 'upload' ? (
        <AudioPanel
          props={props}
          i18n={i18n}
          consultation={consultation}
          onChanged={() => state.refresh()}
        />
      ) : showRoom ? (
        <JitsiFrame
          props={props}
          i18n={i18n}
          consultationId={consultation.id}
          displayName={label}
          onJoined={() => {
            setInMeeting(true)
            state.refresh()
          }}
          onLeft={() => {
            setInMeeting(false)
            state.refresh()
          }}
          // Jitsi's own hang-up. The room comes down and the panel goes back to
          // offering it, so re-joining is one button rather than a reload — the
          // doctor may have hung up on the parent and still have half a
          // consultation to record.
          onClose={() => {
            setRoomClosed(true)
            setRoomOpen(false)
          }}
        />
      ) : (
        // The room exists for every consultation — a parent who could not come,
        // a second opinion, an interpreter — but a presencial does not open a
        // camera just because the screen was opened. What it shows instead is
        // whether the microphone is actually hearing anything, which is the
        // only thing that can go wrong here.
        //
        // A video consultation lands here too once the doctor hangs up: the
        // microphone is still open and still transcribing, which is exactly
        // what the meter is for.
        <MicPanel
          i18n={i18n}
          state={stream.state}
          onOpenRoom={() => {
            setRoomClosed(false)
            setRoomOpen(true)
          }}
        />
      ),
  }

  const chatbotTab: DockTab = {
    key: 'chatbot',
    label: t('workspace.panel.chatbot'),
    content: (
      <ChatbotPanel
        i18n={i18n}
        messages={workspace.chat}
        assistantConnected={assistantOn}
        onSend={async (body) => {
          const turn = await apiPost<{ assistant_available?: boolean }>(
            props,
            `/api/consultations/${consultation.id}/chat`,
            { body },
          )
          setAssistantOn(Boolean(turn.assistant_available))
          state.refresh()
        }}
      />
    ),
  }

  const transcriptionTab: DockTab = {
    key: 'transcription',
    label: t('workspace.panel.transcription'),
    content: (
      <TranscriptionPanel
        i18n={i18n}
        segments={workspace.transcript}
        partials={stream.partials}
      />
    ),
  }

  const recommendationsTab: DockTab = {
    key: 'recommendations',
    label: t('workspace.panel.recommendations'),
    content: (
      <RecommendationsPanel
        i18n={i18n}
        recommendations={workspace.recommendations}
        onSetStatus={async (id, status) => {
          await apiPatch(props, `/api/consultations/${consultation.id}/recommendations/${id}`, {
            status,
          })
          state.refresh()
        }}
      />
    ),
  }

  const noteTab: DockTab = {
    key: 'note',
    label: t('workspace.panel.note'),
    content: (
      <NotePanel
        i18n={i18n}
        note={workspace.note}
        onSave={async (body) => {
          await apiPatch(props, `/api/consultations/${consultation.id}/note`, {
            body,
            source: 'doctor',
          })
          state.refresh()
          toast.success(t('form.save'))
        }}
      />
    ),
  }

  /** Every tab the dock can show, by key. The groups compose them. */
  const TABS: Record<TabKey, DockTab> = {
    meeting: meetingTab,
    chatbot: chatbotTab,
    transcription: transcriptionTab,
    recommendations: recommendationsTab,
    note: noteTab,
  }
  /**
   * The tabs a FINISHED consultation still has.
   *
   * The room goes away entirely — not "La reunión terminó" in a panel the size
   * of the screen. A closed consultation is a record: the note, the transcript
   * and the recommendations are what somebody opens it to read, and a
   * thousand-pixel box announcing a call that is over takes the space they need.
   *
   * A `transcripción` keeps its tab, because there the tab is the RECORDING and
   * playing it back is exactly what a finished one is opened for.
   */
  const hidden: TabKey[] =
    finished && consultation.mode !== 'transcription' ? ['meeting'] : []

  const visible = hideTabs(layout, hidden)

  // Which groups render and how the row divides between them — a group left
  // empty takes no space and no splitter (see columnLayout).
  const columns = columnLayout(visible)

  return (
    <PageShell
      title={label}
      subtitle={
        <XStack alignItems="center" gap="$0.75" flexWrap="wrap">
          <Text fontSize={13} color="$color11">
            {t(MODE_KEY[consultation.mode])}
          </Text>
          <Text fontSize={13} color="$color10">
            ·
          </Text>
          <Text fontSize={13} color="$color11">
            {shortDateTime(consultation.created_at, i18n.lang)}
          </Text>
          {consultation.template_title ? (
            <>
              <Text fontSize={13} color="$color10">
                ·
              </Text>
              <Text fontSize={13} color="$color11">
                {consultation.template_title}
              </Text>
            </>
          ) : null}
        </XStack>
      }
      titleAside={
        <XStack alignItems="center" gap="$0.5" flexWrap="wrap">
          {/* The clock, in the title line where the record's own facts live. */}
          <XStack
            alignItems="center"
            paddingHorizontal="$0.75"
            paddingVertical="$0.25"
            borderRadius="$10"
            backgroundColor="$color3"
          >
            <Text fontSize={13} fontVariant={['tabular-nums']} color="$color">
              {formatDuration(elapsed)}
            </Text>
          </XStack>
        {recording ? (
          <Badge variant="error" size="sm">
            {t('workspace.recording')}
          </Badge>
        ) : null}
        {stream.state.kind === 'live' ? (
          // The level, not just "live": a microphone that is muted, unplugged
          // or pointed at nothing looks identical to a working one until the
          // consultation is over and the transcript is empty.
          <Badge
            variant={
              stream.state.muted ? 'neutral' : stream.state.level > 0.01 ? 'success' : 'warning'
            }
            size="sm"
          >
            {stream.state.muted
              ? t('workspace.stream.muted')
              : stream.state.level > 0.01
                ? t('workspace.stream.speaking')
                : t('workspace.stream.silent')}
          </Badge>
        ) : stream.state.kind === 'connecting' ? (
          <Badge variant="info" size="sm">
            {t('workspace.stream.connecting')}
          </Badge>
        ) : stream.state.kind === 'unconfigured' ? (
          <Badge variant="neutral" size="sm">
            {t('workspace.stream.unconfigured')}
          </Badge>
        ) : stream.state.kind === 'upload' ? (
          <Badge variant="neutral" size="sm">
            {t('workspace.stream.upload')}
          </Badge>
        ) : stream.state.kind === 'error' ? (
          <Badge variant="warning" size="sm">
            {t('workspace.stream.error')}
          </Badge>
        ) : null}

        </XStack>
      }
      actions={
        <>
          <Button
            size="sm"
            variant="ghost"
            iconBefore={<ArrowLeft size={15} />}
            onPress={onBack}
          >
            {t('workspace.back')}
          </Button>

          {/* The guard the legacy header showed as a yellow chip: recording is
              fed by the room's audio, so there is nothing to record until the
              doctor is in it. */}
        {!canStart && consultation.status !== 'finished' && consultation.mode === 'video' ? (
          <XStack
            alignItems="center"
            gap="$0.5"
            paddingHorizontal="$0.75"
            paddingVertical="$0.5"
            borderRadius="$3"
            backgroundColor="$warning100"
          >
            <TriangleAlert size={14} color="$warning700" />
            <Text fontSize={12} color="$warning700">
              {t('workspace.joinFirst')}
            </Text>
          </XStack>
        ) : null}

        {/* The link the parent joins with.

            A video consultation is transcribed by TWO nodes, and the patient's
            (`<session>:patient`) is fed by the patient's OWN browser. Without
            it that node starves for its whole timeout and the merge withholds
            the doctor's transcript with it — so this button is not a
            convenience, it is what makes a video consultation transcribe. */}
        {consultation.mode === 'video' && consultation.status !== 'finished' ? (
          <Button
            size="sm"
            variant="secondary"
            iconBefore={<Link2 size={14} />}
            onPress={async () => {
              try {
                const { url } = await apiPost<{ url: string }>(
                  props,
                  `/api/consultations/${consultation.id}/patient-link`,
                )
                await navigator.clipboard.writeText(url)
                toast.success(t('patient.link.copied'))
              } catch (err) {
                toast.error(errorMessage(err, i18n))
              }
            }}
          >
            {t('workspace.patientLink')}
          </Button>
        ) : null}

        {/* Mute, while the microphone is open.

            Two things at once (see setMuted): the gain node silences what
            reaches the mixer, and the transport pauses so the muted stretch
            does not bill as speech. A doctor takes a phone call in the middle
            of a consultation and the alternative is stopping the recording. */}
        {stream.state.kind === 'live' ? (
          <Button
            size="sm"
            variant={stream.state.muted ? 'danger' : 'ghost'}
            iconBefore={stream.state.muted ? <MicOff size={14} /> : <Mic size={14} />}
            onPress={() => stream.setMuted(!(stream.state.kind === 'live' && stream.state.muted))}
          >
            {stream.state.muted ? t('workspace.unmute') : t('workspace.mute')}
          </Button>
        ) : null}

        {recording ? (
          <Button
            size="sm"
            variant="danger"
            iconBefore={<Square size={14} />}
            onPress={stopConsultation}
          >
            {t('workspace.stop')}
          </Button>
        ) : finished || consultation.mode === 'transcription' ? (
          // Nothing to start: a finished consultation is a record. It used to
          // render the button disabled, which asks the doctor to work out why
          // the obvious action is greyed out instead of saying it is done.
          <Badge variant="neutral" size="sm">
            {t('workspace.finished')}
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={!canStart}
            iconBefore={<Mic size={14} />}
            onPress={requestStart}
          >
            {t('workspace.start')}
          </Button>
        )}
        </>
      }
    >
      <ConsentModal
        i18n={i18n}
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        onAccept={async () => {
          // Stamped BEFORE the microphone opens, and only then. A recording
          // that begins from a failed stamp is a recording with no consent
          // behind it, which is the one thing this gate exists to prevent.
          await apiPost(props, `/api/consultations/${consultation.id}/consent`)
          setConsentOpen(false)
          await startConsultation()
        }}
      />

      {/* A refresh that failed while the consultation is on screen says so here
          and changes nothing else — one timed-out poll is not a reason to take
          down a room the doctor is in. It clears on the next good answer. */}
      {state.error ? (
        <ErrorNote>{t('workspace.error', { detail: errorMessage(state.error, i18n) })}</ErrorNote>
      ) : null}

      {/* ── The panels ─────────────────────────────────────────────────
          The row is BOUNDED to the viewport, and that is what makes the
          screen work at all. Every panel body is a ScrollView, but a
          ScrollView only scrolls when something above it decides how tall it
          is; with an unbounded `flex: 1` inside a host page that grows with
          its content, each panel simply got taller and the recommendations ran
          off the bottom with nothing to scroll — not the panel, not the page.
          Bounding it here hands the overflow back to the panels, where it
          belongs: the transcript scrolls under a note that stays put.

          `dvh`, not `vh`: on a phone the browser chrome collapses as you
          scroll, and `vh` freezes at the taller measurement, so the bottom of
          the last panel sits permanently under the address bar. */}
      {maximised !== null && visible.groups[maximised]?.length ? (
        // Maximised is a GROUP, not a tab: the group keeps its tab strip, so
        // the doctor can still switch between what is stacked in it while it
        // fills the screen — which is what the legacy's tabset maximise does.
        <YStack flex={1} minHeight={360} maxHeight={PANELS_MAX_HEIGHT}>
          <DockGroup
            index={maximised}
            tabs={visible.groups[maximised]!.map((key) => TABS[key])}
            onMoveTab={moveTabTo}
            expanded
            onToggleExpand={() => setMaximised(null)}
          />
        </YStack>
      ) : (
        <YStack flex={1} minHeight={360} maxHeight={PANELS_MAX_HEIGHT}>
          {/* Plain divs from here down. Every gesture below is a browser one
              (drag, pointer capture) and Tamagui does not type those props —
              see the note at the top of components/dnd.tsx. */}
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {columns.map((column, columnIndex) => (
              <Fragment key={column.column}>
                {columnIndex > 0 ? (
                  <Splitter
                    direction="vertical"
                    label={t('layout.resize')}
                    onResize={(percent) => updateLayout({ columnSplit: clampSplit(percent) })}
                  />
                ) : null}
                <div style={{ ...paneStyle(column.size), flexDirection: 'column' }}>
                  {column.groups.map((group, rowIndex) => (
                    <Fragment key={group.index}>
                      {rowIndex > 0 ? (
                        <Splitter
                          direction="horizontal"
                          label={t('layout.resize')}
                          onResize={(percent) =>
                            updateLayout(
                              column.column === 'left'
                                ? { leftSplit: clampSplit(percent) }
                                : { rightSplit: clampSplit(percent) },
                            )
                          }
                        />
                      ) : null}
                      <div style={paneStyle(group.size)}>
                        <DockGroup
                          index={group.index}
                          tabs={visible.groups[group.index]!.map((key) => TABS[key])}
                          onMoveTab={moveTabTo}
                          expanded={false}
                          onToggleExpand={() => setMaximised(group.index)}
                        />
                      </div>
                    </Fragment>
                  ))}
                </div>
              </Fragment>
            ))}
          </div>
        </YStack>
      )}
    </PageShell>
  )
}
