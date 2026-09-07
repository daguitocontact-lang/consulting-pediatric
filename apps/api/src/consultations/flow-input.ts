/**
 * The `base_input` a consultation hands its flow.
 *
 * This is the server-authoritative half of the exchange, and the reason the
 * browser never talks to Daguito unaided: the panel could ask for a token, but
 * it must not be the thing that decides which template the note is written into
 * or which model writes it. The legacy backend builds exactly this map in
 * `stream_handler.go` (`Start`) and `prerecorded_transcription.go` (`Run`); one
 * builder here keeps the live path and the upload path from drifting, which is
 * how the legacy ended up with two slightly different sets of keys.
 *
 * The keys are the flow's, not ours. They are read by `{{placeholders}}` in the
 * node prompts, interpolated FLAT — so a renamed key does not error, it renders
 * empty, and `c_soap` writes a generic SOAP note while the doctor wonders why
 * their template was ignored. Rename nothing here without the flow.
 */
import type { ConsultationRow } from './repos/consultations-repo'
import { getTemplate } from './repos/templates-repo'

export type FlowBaseInput = {
  language: string
  doctor_name?: string
  patient_name?: string
  /** The markdown structure `c_soap` fills. Blank = the flow's own default. */
  template_body?: string
  /** A model pinned to this consultation; absent means the node's own. */
  model?: string
  /** Ours, not the flow's: it travels back on every emit and makes a stray
   *  event traceable to a consultation in the Daguito run log. */
  consultation_id: string
}

/**
 * Build it for one consultation.
 *
 * The template is READ HERE rather than passed in, because every caller that
 * needs a base_input needs the template and forgetting it is silent — the note
 * simply comes back in the wrong shape. Absent, inactive or another org's
 * template resolves to no body: the flow falls back to its own SOAP structure,
 * which is a worse note but a note.
 */
export async function consultationBaseInput(p: {
  orgId: string
  consultation: ConsultationRow
  /** The doctor running it, from the token's name claim when it carries one. */
  doctorName?: string | null
  /** Extra keys for a flow that reads more (the pre-recorded one: audio_url). */
  extra?: Record<string, unknown>
}): Promise<FlowBaseInput & Record<string, unknown>> {
  const { consultation } = p

  let templateBody = ''
  if (consultation.template_id) {
    const template = await getTemplate(p.orgId, consultation.template_id)
    templateBody = template?.body?.trim() ?? ''
  }

  return {
    language: consultation.language || 'es',
    ...(p.doctorName?.trim() ? { doctor_name: p.doctorName.trim() } : {}),
    ...(consultation.patient_name?.trim()
      ? { patient_name: consultation.patient_name.trim() }
      : {}),
    // Only when there is one: an empty `template_body` and an absent one are
    // the same to the flow, and sending the empty string makes a log read as
    // though a template was chosen.
    ...(templateBody ? { template_body: templateBody } : {}),
    ...(consultation.llm_model?.trim() ? { model: consultation.llm_model.trim() } : {}),
    consultation_id: consultation.id,
    ...p.extra,
  }
}
