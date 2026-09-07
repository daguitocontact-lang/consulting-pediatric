/**
 * A `transcription` consultation: an uploaded recording, transcribed here.
 *
 * This is the third mode, and the one that is NOT a microphone. Its flow,
 * `pre-recorded-consultation`, has a single `s_stt_file` node that reads
 * `audio_url` (or `audio_base64`) and hands the transcript to `c_soap`, which
 * fills the doctor's template. There is no `a_transcribe_stream` anywhere in
 * that graph, so a browser streaming a microphone at it opens a socket that
 * nothing is listening on — which is exactly what a panel wired to "stream
 * every mode" does, silently, for the whole consultation.
 *
 * So the run lives HERE, on the API, the way the legacy backend runs it
 * (`pkg/service/prerecorded_transcription.go`):
 *
 *   upload → R2 (private) → presigned url → flow → transcript + filled note → DB
 *
 * It is detached: the doctor uploads, gets a `processing` consultation back and
 * closes the tab. Nothing about the outcome depends on a client still being
 * there, which is the difference from the live path — there the browser holds
 * the socket, here nobody does.
 */
import { Daguito, WebhookStreamSession } from '@daguito/sdk'
import {
  PRERECORDED_FLOW,
  fetchSessionCost,
  resolveFlowWebhook,
  streamApiUrl,
  isStreamConfigured,
} from './daguito-stream'
import { getObject, presignGet } from './storage'
import { costBucket, costUsdFrom, fieldNamesFrom, fillTemplate, roundUsd } from './template-fill'
import { consultationBaseInput } from '../consultations/flow-input'
import {
  addCosts,
  addDuration,
  getConsultation,
  setTranscriptionError,
  updateConsultation,
} from '../consultations/repos/consultations-repo'
import {
  getTemplate,
  getTemplateSchema,
  saveTemplateSchema,
} from '../consultations/repos/templates-repo'
import { appendTranscript, saveNote } from '../consultations/repos/workspace-repo'

/**
 * The ceiling on one run. Whisper-class models transcribe well over realtime —
 * an hour of audio in under a minute — and the template-fill pass adds seconds.
 * Ten minutes is generous and still fails a stuck flow loudly instead of
 * leaving a consultation in `processing` for ever. The legacy's number.
 */
const RUN_TIMEOUT_MS = 600_000

/**
 * Daguito settles billing fire-and-forget AFTER the flow finishes, so the
 * `cost` emit lands a few dozen milliseconds behind `flow.completed`. Breaking
 * the loop on the terminal event drops the charge; this is how long we keep
 * draining afterwards.
 */
const TERMINAL_GRACE_MS = 1500

/** How long the transcriber has to fetch the recording. It downloads it once,
 *  at the start of the run, so this only has to outlive the queue. */
const AUDIO_URL_TTL_SECONDS = 3600

/**
 * How long to wait before reading the ledger.
 *
 * Daguito settles billing fire-and-forget after the flow finishes, so a read
 * fired the instant the run ends comes back at zero for a run that WAS billed.
 * The legacy waits the same three seconds. Nothing is blocked on it — the
 * transcript and the note are already saved by then.
 */
const LEDGER_SETTLE_MS = 3000

/** Inline audio is a last resort (dev, no R2). Past this a base64 payload is
 *  not a message any more, and the run is refused with something to read. */
const MAX_INLINE_BYTES = 12 * 1024 * 1024

type Cost = { streaming: number; template: number }

/**
 * The schema Daguito infers from the template's `[[placeholders]]`.
 *
 * An LLM call, so it is cached on the template row and re-inferred only when
 * the body changes (the preview's own `bodyHash` is the cache key). A failure
 * is not fatal: the flow still fills what it can, the placeholders just map
 * positionally with no names to go by.
 */
async function templateSchemaFor(p: {
  orgId: string
  templateId: string | null
  templateBody: string
}): Promise<Record<string, unknown> | null> {
  if (!p.templateId || !p.templateBody.trim()) return null

  const cached = await getTemplateSchema(p.orgId, p.templateId)
  if (cached) return cached.schema

  try {
    const client = new Daguito({
      apiUrl: streamApiUrl(),
      apiKey: process.env.DAGUITO_STREAM_API_KEY || process.env.DAGUITO_API_KEY || '',
    })
    const preview = await client.templates.preview({ templateBody: p.templateBody })
    const schema: Record<string, unknown> = {
      ...preview.templateSchema,
      // Kept alongside the schema because the fill is POSITIONAL: the Nth
      // placeholder takes the Nth name. See fieldNamesFrom.
      field_names: preview.fieldNames,
    }
    await saveTemplateSchema({
      orgId: p.orgId,
      id: p.templateId,
      schema,
      hash: preview.bodyHash,
    }).catch((err) => console.warn('[prerec] schema cache write failed (continuing):', err))
    return schema
  } catch (err) {
    console.warn('[prerec] template schema inference failed (continuing without):', err)
    return null
  }
}

/**
 * How the flow is given the audio.
 *
 * A URL when there is a bucket: the transcriber downloads it itself and the
 * bytes never pass through a websocket frame. Base64 otherwise — the same node
 * accepts it (`audio_base64_field`) and it is what makes the mode work on a
 * developer's machine with no R2 at all.
 */
async function audioInput(p: {
  key: string
  mime: string
  bytes: number | null
}): Promise<Record<string, unknown>> {
  const url = presignGet(p.key, AUDIO_URL_TTL_SECONDS)
  if (url) return { audio_url: url, mime_type: p.mime }

  if ((p.bytes ?? 0) > MAX_INLINE_BYTES) {
    throw new Error(
      `no R2 configured and the recording is ${Math.round((p.bytes ?? 0) / 1e6)} MB — ` +
        'inline audio is capped at 12 MB; configure R2_* to transcribe files this size',
    )
  }
  const buffer = await getObject(p.key)
  if (!buffer) throw new Error(`the recording is gone from storage (key ${p.key})`)
  return { audio_base64: Buffer.from(buffer).toString('base64'), mime_type: p.mime }
}

/**
 * Split one transcript into the segments the workspace stores.
 *
 * The file node returns ONE string with diarization already applied and the
 * speakers named by the graph's `speaker_roles` — `doctor:` / `paciente:` at
 * the head of each line. The live path stores one row per utterance, and the
 * transcript panel reads rows, so the same shape is rebuilt here rather than
 * storing a wall of text nothing can scroll to.
 */
export function segmentsFromTranscript(transcript: string): {
  speaker: string | null
  text: string
  at_seconds: number
}[] {
  // Two shapes, both observed from the live flow. `[A] …` is what
  // `s_stt_file` writes when diarization ran but `speaker_roles` could not
  // reach the confidence floor, and `doctor: …` is what it writes when it
  // could. The bracket form was NOT handled at first, and the result was worse
  // than an unlabelled line: the label stayed INSIDE the text, so every
  // utterance in the record began with a literal "[A]".
  //
  // The colon form is deliberately narrow — AT MOST TWO WORDS before the colon.
  // A speaker label is "doctor", "paciente", "speaker a"; a sentence is not.
  // A looser bound turned "Le dije lo siguiente: que volviera mañana" into an
  // utterance by somebody called "le dije lo siguiente", and half the sentence
  // vanished from the record with them.
  const LABELLED =
    /^(?:\[\s*([^\]]{1,24})\s*\]|(\p{L}+(?:\s+\p{L}+)?)\s*:)\s*(.+)$/u

  return transcript
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = LABELLED.exec(line)
      if (!match) return { speaker: null, text: line, at_seconds: 0 }
      const raw = (match[1] ?? match[2] ?? '').trim()
      const label = raw.toLowerCase()
      const speaker =
        label.includes('doctor') || label.includes('medico') || label.includes('médico')
          ? 'doctor'
          : label.includes('pacient')
            ? 'patient'
            : // A bare diarization channel is NOT a role and is not guessed —
              // the same rule the live path follows (see flow-transform.ts).
              `speaker_${label}`
      return { speaker, text: match[3]!.trim(), at_seconds: 0 }
    })
}

/**
 * Run one pre-recorded consultation to completion.
 *
 * Never throws: it is called detached (the upload route does not await it), so
 * the only useful thing it can do with a failure is record it on the row where
 * the doctor will see it and can retry. The consultation goes back to
 * `initial` rather than staying `processing` — a consultation stuck on
 * "procesando" for ever is a bug nobody can act on, and the recording is still
 * attached, so the retry is one button.
 */
export async function runPrerecorded(p: { orgId: string; consultationId: string }): Promise<void> {
  const { orgId, consultationId } = p
  const log = (message: string) => console.log(`[prerec ${consultationId}] ${message}`)

  const fail = async (reason: string) => {
    console.error(`[prerec ${consultationId}] FAILED: ${reason}`)
    await setTranscriptionError({ orgId, id: consultationId, error: reason }).catch(() => {})
    await updateConsultation({ orgId, id: consultationId, patch: { status: 'initial' } }).catch(
      () => {},
    )
  }

  try {
    if (!isStreamConfigured()) return fail('the transcription engine is not configured')

    const consultation = await getConsultation(orgId, consultationId)
    if (!consultation) return fail('the consultation no longer exists')
    if (!consultation.audio_key) return fail('no recording is attached')

    const template = consultation.template_id
      ? await getTemplate(orgId, consultation.template_id)
      : null
    const templateBody = template?.body?.trim() ?? ''
    const schema = await templateSchemaFor({
      orgId,
      templateId: consultation.template_id,
      templateBody,
    })

    const webhook = await resolveFlowWebhook(PRERECORDED_FLOW)
    const audio = await audioInput({
      key: consultation.audio_key,
      mime: consultation.audio_mime ?? 'audio/mpeg',
      bytes: consultation.audio_bytes,
    })

    const baseInput = await consultationBaseInput({
      orgId,
      consultation,
      extra: {
        ...audio,
        ...(schema ? { template_schema: schema } : {}),
      },
    })

    // A session of its OWN, never the consultation id: the consultation id is
    // the live flows' session key, and a re-upload of an already-recorded
    // consultation would land inside that conversation.
    const sessionKey = `prerec:${consultationId}:${crypto.randomUUID().slice(0, 8)}`

    let transcript = ''
    let templateState: Record<string, unknown> = {}
    const cost: Cost = { streaming: 0, template: 0 }
    let terminalError = ''

    const session = new WebhookStreamSession({
      apiUrl: streamApiUrl(),
      webhookId: webhook.webhook_id,
      token: webhook.webhook_token,
      sessionKey,
      // A detached run must not silently reconnect into a second flow run after
      // the first one finished: the outcome is already being written.
      autoReconnect: false,
    })

    await new Promise<void>((resolve) => {
      let settled = false
      let grace: ReturnType<typeof setTimeout> | null = null

      const done = () => {
        if (settled) return
        settled = true
        if (grace) clearTimeout(grace)
        clearTimeout(deadline)
        session.close()
        resolve()
      }
      // A terminal event opens a short window instead of ending the loop: the
      // `cost` emit arrives just after `flow.completed`, and breaking on the
      // terminal event is how the charge gets dropped.
      const startGrace = () => {
        if (grace || settled) return
        grace = setTimeout(done, TERMINAL_GRACE_MS)
      }
      const deadline = setTimeout(() => {
        terminalError = terminalError || 'the flow exceeded its deadline'
        done()
      }, RUN_TIMEOUT_MS)

      session.on('node.emit', ({ nodeId, kind, data }) => {
        const payload = (data ?? {}) as Record<string, unknown>
        if (kind === 'transcript.done') {
          const text = payload.transcript ?? payload.text
          if (typeof text === 'string' && text.trim()) transcript = text.trim()
          return
        }
        if (kind === 'transcript.error') {
          terminalError = `transcription error: ${String(payload.error ?? 'unknown')}`
          startGrace()
          return
        }
        if (kind === 'cost') {
          const usd = costUsdFrom(payload)
          if (!usd) return
          const bucket = costBucket(String(payload.step_type ?? ''), nodeId)
          if (bucket === 'streaming') cost.streaming += usd
          else cost.template += usd
          return
        }
        if (kind === 'collect_data.streaming_update') {
          const full = payload.full_state
          if (full && typeof full === 'object') templateState = full as Record<string, unknown>
        }
      })

      session.on('node.completed', ({ nodeId, output }) => {
        const out = (output ?? {}) as Record<string, unknown>
        // ONLY the collect_data node's `data` is the extracted field set. Other
        // nodes also complete with their own `data`, and taking those would
        // overwrite the good state with something unrelated.
        if (nodeId === 'c_soap') {
          const data = out.data
          if (data && typeof data === 'object' && Object.keys(data).length) {
            templateState = data as Record<string, unknown>
          }
        }
        if (!transcript && typeof out.transcript === 'string' && out.transcript.trim()) {
          transcript = out.transcript.trim()
        }
      })

      session.on('flow.failed', ({ error }) => {
        terminalError = `the flow failed: ${error}`
        startGrace()
      })
      session.on('error', ({ message }) => {
        terminalError = `socket error: ${message}`
        startGrace()
      })
      session.on('flow.completed', startGrace)
      session.on('closed', done)

      session.connect()
      // The trigger message: the flow reads everything it needs from base_input.
      session.send({ kind: 'text', text: 'session_start' }, baseInput)
    })

    if (!transcript) {
      return fail(terminalError || 'the flow produced no transcript')
    }

    // The doctor's template, filled in place. `templateState` empty is fine —
    // every placeholder then reads "_No referido_", which is a true statement
    // about a consultation the model found nothing in, and still their document.
    const rendered = fillTemplate(templateBody, templateState, fieldNamesFrom(schema))

    await appendTranscript({
      orgId,
      consultationId,
      segments: segmentsFromTranscript(transcript),
    })

    if (rendered.trim()) {
      // `engine`: a note the doctor has already edited is never overwritten,
      // so re-running a transcription cannot wipe their words.
      await saveNote({
        orgId,
        consultationId,
        body: rendered,
        templateId: consultation.template_id,
        source: 'engine',
      })
    }

    await setTranscriptionError({ orgId, id: consultationId, error: null })
    await updateConsultation({ orgId, id: consultationId, patch: { status: 'finished' } })

    // ── What it cost, and how long the recording was ───────────────────
    //
    // The ledger is the authority, not the `cost` events drained above: this
    // flow emits NONE of them (measured — a real run reported $0 while Daguito
    // had billed it), because some steps settle straight to the ledger. The
    // drained values stay as the fallback for when the read fails.
    //
    // It also carries the only clock a detached run has: `units` on an STT step
    // is SECONDS of audio. Without it the listing shows 00:00 for every
    // uploaded consultation, since no client was there to report a duration.
    let streamingUsd = roundUsd(cost.streaming)
    let templateUsd = roundUsd(cost.template)
    let sttSeconds = 0

    await new Promise((resolve) => setTimeout(resolve, LEDGER_SETTLE_MS))
    const ledger = await fetchSessionCost(webhook, sessionKey)
    if (ledger && ledger.total_microcents > 0) {
      streamingUsd = 0
      templateUsd = 0
      for (const node of ledger.nodes) {
        const usd = node.microcents / 1e6
        if (costBucket(node.step_type ?? '', node.node_id ?? '') === 'streaming') {
          streamingUsd += usd
          sttSeconds += node.units ?? 0
        } else {
          templateUsd += usd
        }
      }
      streamingUsd = roundUsd(streamingUsd)
      templateUsd = roundUsd(templateUsd)
    }

    await addCosts({
      orgId,
      id: consultationId,
      streaming: streamingUsd,
      streamingCount: streamingUsd ? 1 : 0,
      template: templateUsd,
      templateCount: templateUsd ? 1 : 0,
    })
    if (sttSeconds > 0) {
      await addDuration({ orgId, id: consultationId, seconds: Math.round(sttSeconds) })
    }

    log(
      `finished: transcript ${transcript.length} chars, note ${rendered.length} chars, ` +
        `${sttSeconds}s of audio, cost $${roundUsd(streamingUsd + templateUsd)} ` +
        `(${ledger?.total_microcents ? 'ledger' : 'drained'}, session ${sessionKey})`,
    )
  } catch (err) {
    await fail(err instanceof Error ? err.message : 'the transcription failed')
  }
}
