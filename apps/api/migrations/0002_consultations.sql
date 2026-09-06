-- The consultations section, ported from the legacy app's
-- /dashboard/consultations. Idempotent, like every migration here.
--
-- Two tables: the consultation itself and the note templates a consultation can
-- be rendered with. Everything is org-scoped — the tenant boundary this API
-- enforces on every route (lib/guard.ts) has to exist in the data too, or a
-- forgotten WHERE turns into another client's records.
--
-- What the legacy schema had and this does NOT: the transcription costs, the
-- LLM model id, the audio rows, the chatbot messages and the clinical facts.
-- Those belong to its AI service, not to the listing this section renders.

CREATE TABLE IF NOT EXISTS consultation_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     text NOT NULL,
  title      text NOT NULL,
  -- A template the whole org sells vs. one a single doctor keeps. The legacy
  -- app split these into two tables (global + per-user) and then had to merge
  -- them in the client to render one column; one table with a flag says the
  -- same thing and sorts in one query.
  scope      text NOT NULL DEFAULT 'org' CHECK (scope IN ('org', 'personal')),
  owner_id   uuid,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A personal template belongs to somebody; an org one belongs to nobody.
  CONSTRAINT consultation_templates_owner CHECK (
    (scope = 'personal' AND owner_id IS NOT NULL) OR (scope = 'org' AND owner_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS consultation_templates_title
  ON consultation_templates (org_id, lower(title), COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS consultations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     text NOT NULL,

  -- The patient is a CONTACT in Daguito's CRM, so only the id is authoritative
  -- here. `patient_name` is a denormalized copy taken when the consultation is
  -- created: the listing sorts and filters by name server-side, and a name that
  -- only exists in the core cannot appear in an ORDER BY. It is a label, never
  -- the identity — the id is.
  patient_contact_id uuid,
  patient_name       text,

  -- What the doctor renamed the consultation to. Null until they do; the
  -- listing falls back to the patient's name, then to the date.
  name       text,
  language   text NOT NULL DEFAULT 'es',
  mode       text NOT NULL DEFAULT 'in_person'
             CHECK (mode IN ('video', 'in_person', 'transcription')),
  -- `draft` is the row a half-finished create dialog leaves behind: it exists
  -- so an upload can attach to it, and the listing hides it.
  status     text NOT NULL DEFAULT 'initial'
             CHECK (status IN ('draft', 'initial', 'recording', 'processing', 'finished')),
  template_id uuid REFERENCES consultation_templates (id) ON DELETE SET NULL,
  -- Seconds. The legacy column was called `time`, which is a reserved-ish word
  -- and said nothing about its unit.
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  notes      text,
  -- Stamped the moment the doctor confirms the patient gave verbal consent to
  -- record. Null until then, and the recording routes are what read it.
  patient_consent_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The listing's default order, and the page it draws first.
CREATE INDEX IF NOT EXISTS consultations_org_created
  ON consultations (org_id, created_at DESC);

-- The tab filter (mode) and the status column, both narrowed by org first.
CREATE INDEX IF NOT EXISTS consultations_org_mode
  ON consultations (org_id, mode);
CREATE INDEX IF NOT EXISTS consultations_org_status
  ON consultations (org_id, status);

-- The name search runs over COALESCE(name, patient_name) lowercased, which is
-- exactly what the listing renders and sorts by. Indexing the same expression
-- keeps the search from degrading into a scan as the table grows.
CREATE INDEX IF NOT EXISTS consultations_org_name
  ON consultations (org_id, lower(COALESCE(name, patient_name)));

-- There is deliberately NO index on `created_at::date`: casting a timestamptz
-- to a date depends on the session's TimeZone, so the expression is STABLE and
-- Postgres refuses to index it ("functions in index expression must be marked
-- IMMUTABLE"). The day filter is written as a half-open range on created_at
-- instead (see consultations-repo.ts), which the org_created index above
-- serves directly.
