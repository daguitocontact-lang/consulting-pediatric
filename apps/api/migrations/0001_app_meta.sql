-- Minimal metadata table. `version` is read by /api/status and the panel to
-- prove the web -> api -> db chain is live. Idempotent.
CREATE TABLE IF NOT EXISTS app_meta (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_meta (key, value) VALUES ('version', '0.1.0')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
