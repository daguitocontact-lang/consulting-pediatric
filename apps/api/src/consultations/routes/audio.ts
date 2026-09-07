/**
 * The recording of a `transcription` consultation.
 *
 *   POST   /api/consultations/:id/audio  → upload it and start transcribing
 *   GET    /api/consultations/:id/audio  → play it back (bytes, with the token)
 *   DELETE /api/consultations/:id/audio  → drop it
 *
 * This is the third mode's whole input. The legacy app's equivalent
 * (`consultation.go`, the pre-recorded upload) is the same three decisions: a
 * size limit, a MIME whitelist, and a run started detached so the doctor is not
 * holding a request open for the length of an hour of audio.
 *
 * The bytes go to the PRIVATE bucket and only the key is stored (lib/storage.ts).
 * The panel plays the recording back by fetching it here with the token and
 * building a blob URL — an `<audio src>` cannot carry an Authorization header.
 */
import { Elysia, t } from 'elysia'
import { requireOrg } from '../../lib/guard'
import { isStreamConfigured } from '../../lib/daguito-stream'
import { runPrerecorded } from '../../lib/prerecorded'
import {
  consultationAudioKey,
  deleteObject,
  getObject,
  isAudioMime,
  putObject,
  AUDIO_MIME,
} from '../../lib/storage'
import {
  attachAudio,
  detachAudio,
  getConsultation,
  setTranscriptionError,
  updateConsultation,
} from '../repos/consultations-repo'

/**
 * The ceiling on an upload. The legacy's, and it is about the transcriber more
 * than about us: a consultation is an hour of speech, which is ~30 MB of mp3 and
 * nowhere near this. A file above it is a video or a mistake.
 */
const MAX_BYTES = 200 * 1024 * 1024

export const audioRoutes = new Elysia({ prefix: '/api/consultations/:id/audio' })
  .post(
    '/',
    async ({ request, params, body, set }) => {
      const guard = await requireOrg(request)
      if (!guard.ok) {
        set.status = guard.status
        return { error: guard.error }
      }
      const consultation = await getConsultation(guard.orgId, params.id)
      if (!consultation) {
        set.status = 404
        return { error: 'not found' }
      }
      if (consultation.mode !== 'transcription') {
        // A video or in-person consultation is transcribed live from a
        // microphone; attaching a file to one would run a second, different
        // engine over the same consultation and write a second note.
        set.status = 409
        return { error: 'mode_not_upload', detail: 'only a transcription consultation is uploaded' }
      }

      const file = body.file
      if (!isAudioMime(file.type)) {
        set.status = 415
        return { error: 'unsupported_audio', accepted: AUDIO_MIME }
      }
      if (file.size > MAX_BYTES) {
        set.status = 413
        return { error: 'audio_too_large', max_bytes: MAX_BYTES }
      }
      if (!isStreamConfigured()) {
        // Refuse the upload rather than store a recording nothing will ever
        // transcribe: a consultation sitting on an audio file with no engine
        // looks finished and is not.
        set.status = 503
        return { error: 'stream_not_configured' }
      }

      const key = consultationAudioKey({
        orgId: guard.orgId,
        consultationId: consultation.id,
        mime: file.type,
      })
      await putObject(key, await file.arrayBuffer(), file.type)

      // The previous recording, if this is a re-upload, once the new one is
      // safely stored — never before.
      if (consultation.audio_key && consultation.audio_key !== key) {
        await deleteObject(consultation.audio_key)
      }

      await attachAudio({
        orgId: guard.orgId,
        id: consultation.id,
        key,
        mime: file.type,
        bytes: file.size,
      })
      const updated = await updateConsultation({
        orgId: guard.orgId,
        id: consultation.id,
        patch: { status: 'processing' },
      })

      // Detached, on purpose: an hour of audio is minutes of flow, and the
      // doctor is not going to hold a request open for it. The run writes its
      // own outcome to the row — including its failure (see runPrerecorded).
      void runPrerecorded({ orgId: guard.orgId, consultationId: consultation.id })

      set.status = 202
      return { consultation: updated }
    },
    {
      // Elysia parses multipart into a File here; the panel sends FormData
      // because the alternative is base64 in JSON, which is a third bigger and
      // has to be held in memory twice.
      body: t.Object({ file: t.File() }),
    },
  )

  /**
   * Retry a run that failed.
   *
   * The recording is already stored, so a retry is not a re-upload: a flow that
   * timed out or a model that was briefly unavailable should not cost the
   * doctor a second upload of an hour of audio over clinic wifi.
   */
  .post('/retry', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    const consultation = await getConsultation(guard.orgId, params.id)
    if (!consultation) {
      set.status = 404
      return { error: 'not found' }
    }
    if (!consultation.audio_key) {
      set.status = 409
      return { error: 'no_audio' }
    }
    await setTranscriptionError({ orgId: guard.orgId, id: consultation.id, error: null })
    const updated = await updateConsultation({
      orgId: guard.orgId,
      id: consultation.id,
      patch: { status: 'processing' },
    })
    void runPrerecorded({ orgId: guard.orgId, consultationId: consultation.id })
    set.status = 202
    return { consultation: updated }
  })

  .get('/', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    const consultation = await getConsultation(guard.orgId, params.id)
    if (!consultation?.audio_key) {
      set.status = 404
      return { error: 'not found' }
    }
    const bytes = await getObject(consultation.audio_key)
    if (!bytes) {
      // The row points at an object that is gone. That is worth saying plainly
      // rather than serving an empty body the player would call corrupt.
      set.status = 404
      return { error: 'audio_missing' }
    }
    set.headers['content-type'] = consultation.audio_mime ?? 'application/octet-stream'
    // The bucket is private and the bytes came back behind a token; a shared
    // cache holding them would undo that.
    set.headers['cache-control'] = 'private, max-age=300'
    return new Response(bytes)
  })

  .delete('/', async ({ request, params, set }) => {
    const guard = await requireOrg(request)
    if (!guard.ok) {
      set.status = guard.status
      return { error: guard.error }
    }
    const consultation = await getConsultation(guard.orgId, params.id)
    if (!consultation) {
      set.status = 404
      return { error: 'not found' }
    }
    if (consultation.audio_key) await deleteObject(consultation.audio_key)
    await detachAudio(guard.orgId, consultation.id)
    return { ok: true }
  })
