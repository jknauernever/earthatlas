-- Audit log: every admin action and account security event (lib/accounts/audit.js).
-- Append-only: a trigger refuses UPDATE and DELETE for every role, so nothing in the app can
-- rewrite history. Rows for a deleted user keep their ids (no foreign keys on purpose).
CREATE TABLE IF NOT EXISTS auth.audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor_id   text,          -- who did it (null = signed-out visitor or the system)
  action     text NOT NULL, -- e.g. admin.ban, user.password_changed, user.signin
  target_id  text,          -- the account it was done to
  ip         text,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON auth.audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON auth.audit_log (target_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON auth.audit_log (actor_id, at DESC);

CREATE OR REPLACE FUNCTION auth.audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auth.audit_log is append-only';
END $$;
DROP TRIGGER IF EXISTS audit_log_no_change ON auth.audit_log;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON auth.audit_log
  FOR EACH ROW EXECUTE FUNCTION auth.audit_log_append_only();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON auth.audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON auth.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION auth.audit_log_append_only();

-- Admin unlock: admin tools need a fresh authenticator code on each session, good for 12 hours
-- (lib/accounts/admin.js). Signing out or revoking the session removes the unlock with it.
CREATE TABLE IF NOT EXISTS auth.admin_unlock (
  session_id  text PRIMARY KEY REFERENCES auth.session (id) ON DELETE CASCADE,
  user_id     text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
