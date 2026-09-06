-- The consultation workspace: what the detail screen reads and writes.
--
-- Four tables, one per panel of the legacy screen:
--
--   transcript segments  → the Transcripción panel (and what the note is
--                          generated from);
--   recommendations      → the Recomendaciones panel;
--   note                 → the SOAP panel (one per consultation, markdown);
--   chat messages        → the Chatbot IA panel.
--
-- The legacy schema kept the transcript as a `text` column on the consultation
-- (`live_transcript`) plus a row per audio file. A transcript arrives in pieces
-- with a speaker and a time and is READ in pieces (the panel scrolls it,
-- searches it, and highlights who spoke); appending to one text column is what
-- made its live view rewrite the whole string on every partial.
--
-- Everything is org-scoped AND consultation-scoped: the consultation is already
-- the tenant boundary, but a row that carries only `consultation_id` cannot be
-- filtered by org without a join, and the one query that forgets the join is
-- the one that leaks.

CREATE TABLE IF NOT EXISTS consultation_transcript_segments (
  id              bigserial PRIMARY KEY,
  org_id          text NOT NULL,
  consultation_id uuid NOT NULL REFERENCES consultations (id) ON DELETE CASCADE,
  -- 'doctor' | 'patient' | null when the engine could not tell them apart.
  -- Not a CHECK: diarization labels are the engine's, and a new one must not
  -- fail the write that carries the words.
  speaker         text,
  text            text NOT NULL,
  -- Seconds from the start of the recording, so a segment can be played back
  -- and the panel can sort without trusting the arrival order.
  at_seconds      integer NOT NULL DEFAULT 0 CHECK (at_seconds >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcript_by_consultation
  ON consultation_transcript_segments (consultation_id, at_seconds, id);

CREATE TABLE IF NOT EXISTS consultation_recommendations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          text NOT NULL,
  consultation_id uuid NOT NULL REFERENCES consultations (id) ON DELETE CASCADE,
  category        text NOT NULL DEFAULT 'general',
  value           text NOT NULL,
  -- The doctor's verdict: kept on top, struck out, or untouched. Null is the
  -- normal state, not a missing one — most recommendations are never triaged.
  status          text CHECK (status IN ('featured', 'removed')),
  priority        integer,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recommendations_by_consultation
  ON consultation_recommendations (consultation_id, is_active, priority NULLS LAST, created_at);

-- The same suggestion arriving twice (a re-run, a reconnect) must not become
-- two rows. Folded and lowercased so "Solicitar hemograma" and "solicitar
-- hemograma." are one — pediatric_fold comes from 0003.
CREATE UNIQUE INDEX IF NOT EXISTS recommendations_unique_value
  ON consultation_recommendations (
    consultation_id,
    pediatric_fold(regexp_replace(value, '[[:punct:][:space:]]+$', ''))
  );

-- One note per consultation: the SOAP panel edits a document, it does not
-- append to a log. The consultation id IS the key.
CREATE TABLE IF NOT EXISTS consultation_notes (
  consultation_id uuid PRIMARY KEY REFERENCES consultations (id) ON DELETE CASCADE,
  org_id          text NOT NULL,
  -- Markdown, as the flow emits it and as the editor saves it.
  body            text NOT NULL DEFAULT '',
  -- Which template it was rendered with, kept so the panel can title itself
  -- and a re-render knows what to use.
  template_id     uuid REFERENCES consultation_templates (id) ON DELETE SET NULL,
  -- Set the first time a human edits the note. After that a re-render must not
  -- overwrite it: the doctor's wording is the record, the machine's is a draft.
  edited_at       timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consultation_chat_messages (
  id              bigserial PRIMARY KEY,
  org_id          text NOT NULL,
  consultation_id uuid NOT NULL REFERENCES consultations (id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('doctor', 'assistant')),
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_by_consultation
  ON consultation_chat_messages (consultation_id, id);
