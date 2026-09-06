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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Mic, Square, TriangleAlert, Video } from '@tamagui/lucide-icons'
import { Text, XStack, YStack } from 'tamagui'
import { apiGet, apiPatch, apiPost, errorMessage, type MountProps } from '../lib/api'
import { translator } from '../lib/i18n'
import { useAsync } from '../lib/useAsync'
import { displayName, formatDuration } from '../lib/consultations'
import {
  autoJoinsMeeting,
  canStartRecording,
  elapsedSeconds,
  type Workspace,
} from '../lib/workspace'
import { useConsultationStream } from '../lib/useConsultationStream'
import { JitsiFrame } from '../components/JitsiFrame'
import { Panel } from '../components/consultation/Panel'
import {
  NotePanel,
  RecommendationsPanel,
  TranscriptionPanel,
} from '../components/consultation/panels'
import { ChatbotPanel } from '../components/consultation/ChatbotPanel'
import { ErrorNote } from '../components/PageShell'
import { useToast } from '../components/Toast'
import { Badge, Button, Spinner } from '../components/ui'

/** Which panel is maximised, if any. */
type Maximised = 'meeting' | 'side' | 'recommendations' | 'note' | null

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
  // Set by the first answered turn: the route reports whether an assistant is
  // configured, so the panel does not have to guess.
  const [assistantOn, setAssistantOn] = useState(false)
  const [maximised, setMaximised] = useState<Maximised>(null)
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
      state.reload()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consultationId, props],
  )

  // Starting a consultation is two things at once and they must not drift: the
  // status the listing shows, and the microphone. Stopping is the same pair in
  // reverse, and the microphone goes first.
  const startConsultation = useCallback(async () => {
    await setStatus('recording')
    await stream.start({ onChange: () => state.refresh() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStatus, stream.start])

  const stopConsultation = useCallback(async () => {
    stream.stop()
    await setStatus('finished')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStatus, stream.stop])

  if (state.loading) {
    return (
      <YStack flex={1} alignItems="center" justifyContent="center" minHeight={280}>
        <Spinner />
      </YStack>
    )
  }

  if (state.error || !workspace || !consultation) {
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
  const showRoom = roomOpen || autoJoinsMeeting(consultation.mode)

  const meetingPanel = (
    <Panel
      tabs={[
        {
          key: 'meeting',
          label: t('workspace.panel.meeting'),
          content: showRoom ? (
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
            />
          ) : (
            // The room exists for every consultation — a parent who could not
            // come, a second opinion, an interpreter — but a presencial does
            // not open a camera just because the screen was opened.
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$1" padding="$2">
              <Video size={22} color="$color10" />
              <Text fontSize={13} color="$color11" textAlign="center">
                {t('workspace.room.optional')}
              </Text>
              <Button size="sm" variant="secondary" onPress={() => setRoomOpen(true)}>
                {t('workspace.room.open')}
              </Button>
            </YStack>
          ),
        },
      ]}
      expanded={maximised === 'meeting'}
      onToggleExpand={() => setMaximised(maximised === 'meeting' ? null : 'meeting')}
      minHeight={320}
    />
  )

  const sidePanel = (
    <Panel
      tabs={[
        {
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
        },
        {
          key: 'transcription',
          label: t('workspace.panel.transcription'),
          content: <TranscriptionPanel i18n={i18n} segments={workspace.transcript} />,
        },
      ]}
      expanded={maximised === 'side'}
      onToggleExpand={() => setMaximised(maximised === 'side' ? null : 'side')}
      minHeight={260}
    />
  )

  const recommendationsPanel = (
    <Panel
      tabs={[
        {
          key: 'recommendations',
          label: t('workspace.panel.recommendations'),
          content: (
            <RecommendationsPanel
              i18n={i18n}
              recommendations={workspace.recommendations}
              onSetStatus={async (id, status) => {
                await apiPatch(
                  props,
                  `/api/consultations/${consultation.id}/recommendations/${id}`,
                  { status },
                )
                state.refresh()
              }}
            />
          ),
        },
      ]}
      expanded={maximised === 'recommendations'}
      onToggleExpand={() =>
        setMaximised(maximised === 'recommendations' ? null : 'recommendations')
      }
    />
  )

  const notePanel = (
    <Panel
      tabs={[
        {
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
        },
      ]}
      expanded={maximised === 'note'}
      onToggleExpand={() => setMaximised(maximised === 'note' ? null : 'note')}
    />
  )

  const panels: Record<Exclude<Maximised, null>, React.ReactElement> = {
    meeting: meetingPanel,
    side: sidePanel,
    recommendations: recommendationsPanel,
    note: notePanel,
  }

  return (
    <YStack flex={1} padding="$2" gap="$1.5" $sm={{ padding: '$1' }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <XStack alignItems="center" gap="$1" flexWrap="wrap">
        <Button size="sm" variant="ghost" iconBefore={<ArrowLeft size={15} />} onPress={onBack}>
          {t('workspace.back')}
        </Button>
        <Text fontSize={20} fontWeight="800" color="$color" letterSpacing={-0.3}>
          {label}
        </Text>
        <XStack
          alignItems="center"
          gap="$0.5"
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
          <Badge variant={stream.state.level > 0.01 ? 'success' : 'warning'} size="sm">
            {stream.state.level > 0.01
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
        ) : stream.state.kind === 'error' ? (
          <Badge variant="warning" size="sm">
            {t('workspace.stream.error')}
          </Badge>
        ) : null}

        <XStack flex={1} />

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

        {recording ? (
          <Button
            size="sm"
            variant="danger"
            iconBefore={<Square size={14} />}
            onPress={stopConsultation}
          >
            {t('workspace.stop')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={!canStart}
            iconBefore={<Mic size={14} />}
            onPress={startConsultation}
          >
            {t('workspace.start')}
          </Button>
        )}
      </XStack>

      {/* ── The panels ─────────────────────────────────────────────── */}
      {maximised ? (
        <YStack flex={1} minHeight={480}>
          {panels[maximised]}
        </YStack>
      ) : (
        <XStack flex={1} gap="$1.5" $sm={{ flexDirection: 'column' }} minHeight={560}>
          {/* Left 40 / right 60, as the legacy dock opened. */}
          <YStack flex={4} gap="$1.5" minWidth={320}>
            <YStack flex={55}>{meetingPanel}</YStack>
            <YStack flex={45}>{sidePanel}</YStack>
          </YStack>
          <YStack flex={6} gap="$1.5">
            <YStack flex={1}>{recommendationsPanel}</YStack>
            <YStack flex={1}>{notePanel}</YStack>
          </YStack>
        </XStack>
      )}
    </YStack>
  )
}
