-- Jitsi meeting rooms, one per consultation.
--
-- The legacy app minted a room only when the mode was not `in_person`, so a
-- consultation held in the office could never pull in a parent from abroad, a
-- second opinion, or the interpreter the family needs — the doctor had to open
-- a different tool and paste a link into WhatsApp. Every consultation gets a
-- room here, whatever its mode; whether anybody joins it is the doctor's
-- decision, not a column's.
--
-- The room NAME is not derived from the consultation id. Jitsi rooms are
-- reachable by name, and when no JITSI_APP_SECRET is configured the server runs
-- in public mode (anyone with the name may join) — a name computed from an id
-- that also travels in urls and logs would be guessable. A random one is not,
-- and it costs nothing.

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS room_name text NOT NULL
    DEFAULT ('pediatric-' || replace(gen_random_uuid()::text, '-', '')),
  -- When the room was first joined and when it was closed. `duration_seconds`
  -- keeps counting the consultation itself; these two say what part of it
  -- happened in the room, which is what a doctor is asked about afterwards.
  ADD COLUMN IF NOT EXISTS meeting_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_ended_at timestamptz;

-- Every room is its own, and the lookup by room (a webhook, a support ticket
-- naming one) has to be exact.
CREATE UNIQUE INDEX IF NOT EXISTS consultations_room_name ON consultations (room_name);
