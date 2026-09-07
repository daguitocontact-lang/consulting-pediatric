-- What the consultation engine needs and 0002 did not have.
--
-- 0002 modelled the LISTING; this models the ENGINE, which is the legacy app's
-- (midulabs) and reads more from a consultation than a title and a status:
--
--   * a template has a BODY. In the legacy product the template is not a label
--     on a row — it is the markdown the doctor wrote, and it goes to the flow
--     as `template_body` in the base_input. `c_soap` fills THAT structure. A
--     template with only a title cannot steer the note, which is why the picker
--     did nothing.
--   * a consultation can pin an LLM (`llm_model` → base_input `model`), the
--     legacy `consultations.llm_model_id`.
--   * a `transcription` consultation IS an uploaded audio file: the flow that
--     serves it (`pre-recorded-consultation`) reads `audio_url`, so the file
--     has to be stored and the run's outcome recorded.
--   * Daguito bills per step and emits a `cost` event per charge. The legacy
--     schema breaks it into streaming / facts / template / chatbot with a
--     denormalized total, so a listing does not sum four columns per row.
--
-- Idempotent, like every migration here.

ALTER TABLE consultation_templates
  -- Empty, not null: an existing template keeps working (the flow falls back to
  -- its own default SOAP structure when `template_body` is blank), and the
  -- doctor fills it in when they open the editor.
  ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '',

  -- The JSON schema Daguito infers from the body's `[[placeholders]]`, which the
  -- pre-recorded flow needs as `template_schema`. Inferring it is an LLM call,
  -- so it is cached here rather than paid for on every upload; `schema_hash` is
  -- the `bodyHash` the preview returns, and a body that changes invalidates it
  -- by not matching. The legacy kept the same cache in its own table
  -- (`user_consultation_template_preview_cache`).
  ADD COLUMN IF NOT EXISTS schema jsonb,
  ADD COLUMN IF NOT EXISTS schema_hash text;

ALTER TABLE consultations
  -- Null = whatever the flow's own node declares. Only set when somebody
  -- deliberately pins a model to this consultation.
  ADD COLUMN IF NOT EXISTS llm_model text,

  -- The uploaded recording of a `transcription` consultation. The KEY, never a
  -- URL: the bucket is private and only the API signs a link for it, and a key
  -- that leaks is worth nothing (see lib/storage.ts).
  ADD COLUMN IF NOT EXISTS audio_key text,
  ADD COLUMN IF NOT EXISTS audio_mime text,
  ADD COLUMN IF NOT EXISTS audio_bytes bigint,
  -- Why the pre-recorded run failed, in the flow's own words. The status goes
  -- back to `initial` so the doctor can retry; this is what the screen shows
  -- instead of a silent consultation that never finished.
  ADD COLUMN IF NOT EXISTS transcription_error text,

  -- The cost breakdown, in the legacy's buckets. numeric(12,6): a single STT
  -- second is fractions of a cent and rounding it to cents loses every charge.
  ADD COLUMN IF NOT EXISTS streaming_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streaming_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS facts_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS facts_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS template_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS template_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chatbot_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chatbot_count integer NOT NULL DEFAULT 0,
  -- Persisted, not computed on read: the listing and any billing aggregate read
  -- one column instead of summing four per row.
  ADD COLUMN IF NOT EXISTS total_cost_usd numeric(12, 6) NOT NULL DEFAULT 0;
