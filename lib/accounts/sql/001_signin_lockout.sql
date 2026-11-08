-- Per-email failed-sign-in counter (lib/accounts/lockout.js). Better Auth's own rate limit is per IP;
-- this stops password guessing against one address from many IPs. Keyed by an HMAC of the lowercased
-- email, so addresses people *tried* (including ones with no account) are never stored in the clear.
CREATE TABLE IF NOT EXISTS auth.signin_failure (
  key           text PRIMARY KEY,
  failures      integer NOT NULL DEFAULT 0,
  window_start  timestamptz NOT NULL DEFAULT now(),
  locked_until  timestamptz,
  lock_count    integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signin_failure_updated_idx ON auth.signin_failure (updated_at);
