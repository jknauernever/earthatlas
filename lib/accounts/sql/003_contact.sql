-- Contact form messages (lib/accounts/contact.js). Every submission that gets past the request checks is
-- kept, including the ones held as likely spam, so a real message caught by a filter can still be found.
-- verdict: accepted (passed every check; emailed to CONTACT_TO) · held (looked like spam; not emailed)
--          · bot (honeypot filled / form timer failed; message truncated)
-- Cleanup (api/cron/accounts-cleanup.js): bot after 30 days, held after 90, accepted after 1 year.
CREATE TABLE IF NOT EXISTS auth.contact_message (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  ip          text,
  name        text NOT NULL,
  email       text NOT NULL,
  topic       text NOT NULL,
  message     text NOT NULL,
  verdict     text NOT NULL CHECK (verdict IN ('accepted', 'held', 'bot')),
  reasons     jsonb NOT NULL DEFAULT '[]'::jsonb,
  emailed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS contact_message_at_idx ON auth.contact_message (at DESC);
CREATE INDEX IF NOT EXISTS contact_message_ip_idx ON auth.contact_message (ip, at DESC);
CREATE INDEX IF NOT EXISTS contact_message_email_idx ON auth.contact_message (lower(email), at DESC);
