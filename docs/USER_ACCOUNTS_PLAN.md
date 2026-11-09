# EarthAtlas user accounts — plan

Status: **Phases 1–3 built on localhost 2026-11-05 (uncommitted)** — see "Phase 1 build notes" at the end. Decisions made 2026-11-04: Better Auth + own Neon DB, Resend, `accounts@earthatlas.org`, Google sign-in in Phase 1, **invite-only at launch**.
Scope: accounts for earthatlas.org and every subsite (all paths on earthatlas.org, plus brand hosts such as sanjuans.earthatlas.org). No user-facing features yet. This is the foundation: sign-up, email verification, profile, admin tools, and strong bot and abuse defenses.

Out of scope: Salish Sea Explorer (salishsea.knauernever.com, separate repo and domain), anything users can *do* once signed in.

---

## 1. What we have today

- **No user system.** The only login is the old admin login (`api/admin/login.js`, `lib/auth.js`), used today only by ship intake; the news system it was built for is unused.
- That admin login is weak and should be replaced as part of this work:
  - one shared username/password from env vars (`ADMIN_USER` / `ADMIN_PASSWORD`)
  - plain `!==` comparison (not constant-time), and HMAC check uses `===` too
  - no rate limit, no lockout, no 2FA
  - stateless 24 h token: can't be revoked; a leaked cookie stays valid until it expires
  - `ADMIN_SECRET` also works as a Bearer token for scripts (keep for scripts, rename and scope)
- Stack: Vite + React SPA, Vercel functions (`export default { fetch }`), Neon Postgres via `@neondatabase/serverless`, DNS on Vercel.

## 2. Recommended approach

**Better Auth** (open-source TypeScript auth library) running in our own Vercel functions, storing users in **our own Neon database**.

Why:
- It's a library, not a hosted service: user data stays in our Postgres, no per-user fees, no vendor lock-in.
- It already has, as maintained plugins, everything on the list: email verification, password reset, sessions with revocation, an **admin plugin** (create/edit/ban/delete users, list sessions, revoke), **captcha** (Cloudflare Turnstile), **Have I Been Pwned** password check, **2FA** (TOTP + backup codes), **passkeys**, built-in rate limiting, CSRF/origin checks.
- Works with a plain `fetch(Request)` handler, which is exactly how our `api/*` functions are written. Doesn't need Next.js.
- Rolling our own auth is the most common way to end up insecure. We shouldn't.

Alternatives considered:

| Option | Cost | Why not (for now) |
|---|---|---|
| **Better Auth + own Neon DB** (recommended) | $0 library; Neon compute pennies–few $/mo | — |
| Clerk (hosted) | Free to 10k monthly users, then paid | User data on their servers; their UI/branding to theme; lock-in |
| Neon Auth (hosted Better Auth inside Neon) | Bundled with Neon | Less control over plugins/config; newer |
| Auth0 / Cognito | Free tiers, expensive later | Heavier, lock-in, overkill |
| Hand-rolled (extend `lib/auth.js`) | $0 | Highest risk of subtle security bugs |

*(Prices from my knowledge as of mid-2026; confirm on each vendor's pricing page in Phase 0.)*

## 3. Accounts and services needed

| Service | Purpose | Cost |
|---|---|---|
| **Neon** — new DB `earthatlas-users` + a dev branch for localhost | users, sessions, verification tokens, audit log | Usage-billed on our Launch plan; tiny DB, scales to zero: ≈ $0–3/mo |
| **Resend** | verification, reset, notice emails | Resend free: 3,000/mo, 100/day. Pro $20/mo if we outgrow it |
| **Cloudflare Turnstile** | invisible bot check on sign-up / sign-in / reset | Free |
| Vercel BotID (optional, later) | extra bot scoring on auth endpoints | Basic free; deep analysis paid |
| DNS records on earthatlas.org (Vercel DNS) | DKIM, SPF + bounce MX on Resend's subdomain, DMARC | Free |

**Email sending (decided):** From `EarthAtlas <accounts@earthatlas.org>` via Resend.
- earthatlas.org has **no MX record** (it receives no mail). That's fine for sending: Resend's records don't touch the root domain —
  - DKIM: TXT `resend._domainkey.earthatlas.org`
  - SPF + bounce handling: CNAMEs `send.earthatlas.org` → `send.forge.rmta.net` and `rsend.earthatlas.org` → `rsend.forge.rmta.net`, not the root
  - DMARC: TXT `_dmarc.earthatlas.org`, start at `p=none`, move to `p=quarantine` once a few weeks of mail pass. No `rua` reporting address unless we add a mailbox or report service.
- **Done 2026-11-04:** all four records added in Vercel DNS; Resend shows earthatlas.org **verified** (1:53 PM). No sending API key yet (create when building).
- Do **not** add a "null MX" (`MX 0 .`) — some receivers reject mail from domains that declare they accept none.
- Replies to `accounts@` would bounce, so every email says replies aren't read and points to a contact page instead. If we later want replies, add a Reply-To to a real inbox (or set up receiving) — no change to the sending setup.

Separate DB (not a schema in the news DB) so a bug or leaked connection string elsewhere can't touch user data, and so localhost uses a **dev branch, never prod users**.

## 4. User flows

**Launch mode: invite-only (decided).** Everything below is built, but at launch:
- `SIGNUPS_OPEN=false` (server-side flag). The sign-up page and API refuse new accounts; the only way in is an **admin invite** (§7).
- Invite email → link (single-use, 7 days, hashed) → invitee sets a password *or* uses Continue with Google with the **same email** → account active (invite proves the email, so no separate verify step).
- Continue with Google never auto-creates an account while sign-ups are closed: an uninvited Google email gets "EarthAtlas accounts are invite-only for now".
- No public "Sign in" link in site chrome at launch; invitees use the link in their email, then `/account/signin`.
- All §6 bot defenses ship anyway (they protect sign-in, reset and invite acceptance, and are ready for the day the flag flips). Opening sign-ups later = flip the flag + show the link.

**Sign up** — `/account/signup` (dormant until `SIGNUPS_OPEN=true`)
- Fields: email, password, display name. Checkboxes: agree to Terms + Privacy; "I am 13 or older" (COPPA).
- Passes Turnstile, honeypot, timing and rate checks (§6) before anything is written.
- Account is created as **pending**: cannot sign in until the email is verified.
- Response is always "Check your email", whether or not the address already exists (no account enumeration). If it already exists, that address gets a "someone tried to sign up with your email — sign in or reset your password" email instead.

**Verify email**
- Single-use link, expires in 24 h, token stored hashed. Clicking it activates the account and signs the user in.
- "Resend verification" is rate-limited (1 per 2 min, 5 per day per address).
- Unverified accounts are deleted automatically after 7 days (daily cron).

**Sign in** — `/account/signin`
- Email + password (+ 2FA code if enabled). Passkey sign-in as an option.
- Generic error ("Email or password is incorrect"). Progressive delay and temporary lock after repeated failures per account and per IP; Turnstile on every attempt.
- "New sign-in to your EarthAtlas account" email on sign-in from a new device (optional, recommended).

**Forgot password**
- Always "If that email has an account, we sent a link". Link single-use, 1 h, hashed.
- Reset revokes all other sessions and sends a "your password was changed" email.

**Continue with Google** (on sign-in and invite acceptance; on sign-up once open)
- Google OAuth via Better Auth's built-in Google provider; scopes `openid email profile` only (no Google security review needed).
- Google confirms the email (`email_verified`), so these users skip the verify-email step; still must tick Terms/Privacy + 13+ on first sign-in.
- **Account linking:** if the Google email matches an existing account, link only when Google says the email is verified; otherwise refuse and tell the user to sign in with their password first (prevents takeover).
- Profile shows linked sign-in methods; unlinking Google is allowed only if another sign-in method remains (password or passkey). Google-only users can add a password.
- Callback URLs: `https://earthatlas.org/api/auth/callback/google` and the localhost equivalent; brand hosts sign in via earthatlas.org (shared `.earthatlas.org` cookie).
- Apple sign-in deferred (needs $99/yr developer account, 6-month secret rotation, Private Email Relay registration); add only if iPhone users / an iOS app warrant it.

**Sign out** — current device, or "sign out everywhere" from the profile.

**Sessions**
- Stored in the DB (revocable), cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `__Secure-` prefixed.
- Cookie domain `.earthatlas.org` so one sign-in covers every subsite and `sanjuans.earthatlas.org`.
- 30-day rolling session for users; admin sessions 12 h with re-auth for destructive actions.

## 5. Profile — `/account`

- Display name (editable), email (change flow below), member since.
- **Change email**: confirm current password → verification link to the *new* address → notice to the *old* address with a "this wasn't me" lock link.
- **Change password**: requires current password; signs out other sessions.
- **Security**: turn on 2FA (authenticator app + backup codes), add a passkey, list active sessions (device, approximate location, last active) with "revoke".
- **Download my data** (JSON) and **Delete my account** (password + typed confirmation; immediate hard delete of the user row, sessions and profile; audit log keeps a non-identifying record).
- Kept deliberately small until there are features that need more (no avatars, bios, public profiles yet).

## 6. Bot and abuse defenses

Layered, so no single bypass gets a bot an active account:

1. **Cloudflare Turnstile** on sign-up, sign-in, forgot-password, resend-verification. Verified server-side; token bound to the action and our hostname.
2. **Honeypot field** (hidden from people, filled by naive bots) → silent fake success.
3. **Minimum time-to-submit** (form rendered < ~3 s ago → reject) via a signed timestamp from the server.
4. **Rate limits** stored in Postgres (works across Vercel instances): per IP, per /24 (IPv4) or /64 (IPv6), per email, per endpoint. Example: sign-up 3/hour/IP, 20/day/subnet; sign-in 10/15 min/IP and 5 failures/account before backoff.
5. **Email verification required** before an account is usable — the bot needs a working inbox.
6. **Disposable-email blocklist** (maintained open list, refreshed weekly) + reject role/garbage addresses; MX-record check on the domain.
7. **Breached-password check** (Have I Been Pwned, k-anonymity — the password never leaves our server) + 12-character minimum, no forced composition rules (NIST 800-63B).
8. **Auto-purge** of never-verified accounts after 7 days.
9. **Admin visibility**: sign-up rate chart and an alert (existing failure-triage path or email) if sign-ups spike far above normal.
10. Optional later: Vercel Firewall rules / BotID on `/api/auth/*`; country challenge only if abuse shows up.

## 7. Admin tools — `/admin/users`

Access: users with role `admin` only, **2FA required**, admin session 12 h. Replaces the `ADMIN_USER`/`ADMIN_PASSWORD` login (ship intake moves onto these accounts; news admin is unused and not migrated). Josh becomes the first admin via a one-time CLI script.

- **List / search** by email or name; filter by status (pending, active, banned), role, sign-up date; sort; paginate.
- **User detail**: profile fields, status, verified date, last sign-in, active sessions, recent security events.
- **Create user**: enter email + name + role → user gets an invite email to set their own password (admins never see or set passwords).
- **Edit**: display name, email (sends verification to new address), role, mark verified.
- **Actions**: resend verification, send password-reset link, revoke all sessions, ban / unban with reason (banned users can't sign in; sessions revoked immediately), **delete** (typed-email confirmation + admin re-enters password).
- **Audit log** (read-only, append-only table): every admin action and security event — who, what, target, when, IP. Not editable through the UI.
- **Script access**: replace the `ADMIN_SECRET` Bearer with named, revocable API keys (hashed in DB) for cron/scripts.

## 8. Security baseline (applies throughout)

- Passwords hashed with a memory-hard algorithm (Better Auth default scrypt, or argon2id). Never logged, never emailed.
- All tokens (verify, reset, invite, API keys) random 256-bit, stored only as hashes, single-use, short expiry.
- CSRF: origin check against an allowlist of our hosts + `SameSite` cookies.
- Strict security headers on account and admin pages: CSP, HSTS (with subdomains), `frame-ancestors 'none'`, `Referrer-Policy`.
- No user data in URLs or analytics: PostHog and Sentry configured to never capture emails, form inputs or auth requests.
- Secrets only in Vercel env vars; `.vercelignore` stays as is.
- Constant-time comparisons for every secret check.
- Data minimization: we store email, display name, hashed password, sessions, audit events — nothing else.
- Before launch: `/security-review` on the branch plus a manual test checklist (enumeration, rate limits, token reuse, session fixation, CSRF, XSS in display names, admin privilege escalation).

## 9. Data model (new DB `earthatlas-users`)

Better Auth core tables plus ours:

- `user` — id, email (unique, lowercased), email_verified, name, role (`user`/`admin`), banned, ban_reason, created_at, updated_at
- `account` — password hash and linked Google sign-ins (future providers too)
- `session` — token hash, user_id, expires_at, ip, user_agent
- `verification` — hashed tokens for verify / reset / email-change / invite
- `two_factor`, `passkey` — from plugins
- `rate_limit` — counters per key/window
- `audit_log` — id, at, actor_id, action, target_id, ip, details (jsonb); append-only (DB role without UPDATE/DELETE)
- `api_key` — hashed admin/script keys

## 10. Pages and routes

Frontend (new route group, shared look via `components/panel` / existing frame):
- `/account/signup`, `/account/signin`, `/account/verify`, `/account/forgot`, `/account/reset`, `/account` (profile), `/admin/users`
- Small "Sign in" / account menu in the shared site chrome — **hidden until Josh decides to open sign-ups** (see decisions).

API: one Better Auth handler at `api/auth/[...all].js`, plus `api/admin/users/*` for anything beyond the plugin, plus `api/cron/purge-unverified.js`.

Email templates (plain, branded, text + HTML): verify, welcome, reset, password changed, email changed (to old), new sign-in, invite, account deleted.

Legal pages needed before public launch: Privacy Policy and Terms of Use (I can draft; Josh/lawyer approves).

## 11. Phases

| Phase | What | Where it's proven |
|---|---|---|
| **0. Setup** (Josh) — Resend ✅ 2026-11-04, Google OAuth client (Testing) ✅ 2026-11-05, Turnstile ✅ 2026-11-05 (widget hostname `earthatlas.org` only — covers all subdomains) | Create Neon DB + dev branch, Resend account + verify earthatlas.org (DKIM/SPF/DMARC records in Vercel DNS, no MX on root), Turnstile site keys, Google Cloud OAuth client + consent screen (name, logo, Privacy/Terms links; brand check takes a few days); confirm vendor prices | — |
| **1. Core auth** | DB migrations, Better Auth handler, `SIGNUPS_OPEN` flag, sign-up → verify → sign-in → reset → sign-out, Continue with Google + account linking, emails, all §6 defenses | localhost (`vercel dev`), dev branch, Turnstile test keys, 1–2 test accounts (one Google) |
| **2. Profile** | `/account` page, email/password change, sessions, 2FA, passkeys, export, delete | localhost |
| **3. Admin** | roles, `/admin/users`, audit log, invite flow (the launch entry point), API keys; move ship intake onto admin role; retire old login + `ADMIN_USER`/`ADMIN_PASSWORD`/`ADMIN_SECRET` (see §12.6) | localhost |
| **4. Hardening** | security headers, analytics scrubbing, purge cron, spike alert, `/security-review`, manual test checklist | localhost |
| **5. Launch** | Privacy/Terms, prod env vars, DNS SPF/DKIM/DMARC check, create Josh's admin, smoke test with one real account | prod, when Josh says push |

Rough effort: phases 1–4 ≈ 3–5 working sessions.

## 12. Decisions

Made 2026-11-04:
1. **Approach**: Better Auth + own Neon DB.
2. **Email provider**: Resend.
3. **Sending address**: `accounts@earthatlas.org` (no MX on root; see §3).
4. **Launch**: invite-only (`SIGNUPS_OPEN=false`), no public Sign in link.
5. **Social sign-in**: Google in Phase 1; Apple deferred.
6. **Old admin login**: retired in Phase 3. The news system is unused, so news admin is **not** migrated. The one live user of the old login is **ship intake** (`/ships` intake page `src/ships/IntakePage.jsx` → `api/ships.js` → `lib/ships/intakeApi.js`, which checks `lib/auth.js`); it moves to "signed-in user with role `admin`". Then `api/admin/login.js`, `logout.js`, `session.js` and the old cookie/Bearer code in `lib/auth.js` are removed and `ADMIN_USER` / `ADMIN_PASSWORD` / `ADMIN_SECRET` deleted from Vercel env. Cutover only after Josh's admin account (with 2FA) works on prod. Removing the unused news code itself (`api/news`, `api/admin/{articles,feeds,keys,keywords}`, `src/news`, `src/admin`, `/news` routes + middleware) is a separate cleanup.

All decisions made.

---

## Phase 1 build notes (2026-11-05, localhost only)

**Databases:** Neon `earthatlas-users` (store_eItyB1yqhDoQmuFF, production env only) and `earthatlas-users-dev` (store_K8b4ds8PFV4FBhRm, development env), both iad1, Neon Auth off, env `USERS_DATABASE_URL` (+ `_UNPOOLED`). `.env.local` → dev. Tables in schema `auth`; dev migrated (lib/accounts/migrations/20261105T173425Z.sql). Prod migrated at launch 2026-11-08 (lib/accounts/migrations/20261109T031327Z.sql + sql/001–003).

**Code**
- `lib/accounts/auth.js` — Better Auth 1.7.18 config (pg Pool + Kysely `PostgresDialect`, `schemaName: "auth"`); invite-only via `SIGNUPS_OPEN`; Google `disableSignUp`; captcha (Turnstile; Cloudflare test keys off Vercel); haveIBeenPwned; admin plugin; DB rate limits; hashed verification tokens; 30-day sessions; `earthatlas.*` cookies, `.earthatlas.org` on Vercel.
- `lib/accounts/guard.js` — honeypot, signed form-render token (≥3 s, ≤2 h), disposable-domain list (`data/disposable-domains.txt`, 10,143 domains), MX/A check.
- `lib/accounts/email.js` — Resend REST; prints to console when `RESEND_API_KEY` is unset (localhost only; error on Vercel).
- `lib/accounts/invite.js` + `scripts/accounts/invite.mjs` — admin-created user (emailVerified) + 7-day single-use set-password token (a Better Auth reset-password token, so acceptance runs `/reset-password` with Turnstile + breach check).
- `scripts/accounts/migrate.mjs` — dry run / `--apply`, saves applied SQL.
- `api/auth.js` (+ rewrite `/api/auth/:path*` in vercel.json) — Better Auth handler + `GET /api/auth/ea/form`. Dev: `accountsApiPlugin` in vite.config.js.
- `src/accounts/` — client, Turnstile widget, pages: `/account/signin`, `/signup` (shows "invite-only"), `/forgot`, `/reset`, `/invite`, `/verified`, `/account`.

**Verified on localhost (dev DB):** invite → set password (breached + short rejected, token single-use) → sign in → /account → sign out; wrong password generic error; unknown-email reset gives same answer and sends nothing; foreign `redirectTo` rejected; foreign Origin rejected; sign-in rate limit → 429; public sign-up refused while invite-only; reset link → /account/reset; invite acceptance sends no "password changed" email, a real reset does.

**Google verified by Josh on 5173 (2026-11-05):** invited address links Google and signs in (admin); an uninvited Google account is refused with the invite-only message.

**Per-email sign-in lockout (built + verified 2026-11-05):** `lib/accounts/lockout.js`, table `auth.signin_failure` (`lib/accounts/sql/001_signin_lockout.sql`, applied by `scripts/accounts/migrate.mjs`, keyed by HMAC of the email). 5 wrong passwords within 15 min → that address locked 15 min, doubling per repeat lock within 24 h (max 24 h); success or password reset clears it; unknown addresses behave identically. Verified: 6 wrong guesses from 6 different IPs → locked (correct password refused while locked); same for a non-existent address; 3 wrong + 1 right → counter cleared. `pruneFailures()` exists for a daily cron (not scheduled yet).

**Real email (2026-11-05):** dev `RESEND_API_KEY` (sending-only, earthatlas.org) in `.env.local`; a real reset email sent to Josh through Resend — **arrived in his inbox**. Prod gets its own key at launch.

**Still to do in Phase 1:** unverified-account purge cron + disposable-list refresh (both matter once sign-ups open); prod env vars (`BETTER_AUTH_SECRET`, `GOOGLE_*`, `TURNSTILE_*`, `RESEND_API_KEY`) at launch.

## Phase 2 build notes (2026-11-05, localhost only)

- **Profile page** `src/accounts/ProfilePage.jsx` at `/account`: name edit, Google photo (or initial) with "Remove photo", email change, ways to sign in (password change / "Add" = emailed set-password link; Google connect/remove; passkeys add/remove), two-step verification (QR + manual key, backup codes, turn off, new codes — offered only to accounts with a password, since Google and passkey sign-ins are not 2FA-gated), sessions list with per-device sign-out and "sign out everywhere else", Download my data, Delete account. `/account/deleted` page.
- **Sign-in page:** "Sign in with a passkey" button + passkey autofill; 2FA code step (authenticator or backup code, optional 30-day trusted device).
- **Server** (`lib/accounts/auth.js`): plugins `twoFactor` (issuer EarthAtlas, 10 encrypted backup codes) and `passkey` (`@better-auth/passkey`, rpID earthatlas.org / localhost); `changeEmail` (approval link to the current address, then confirm link to the new one); `deleteUser` (password if the account has one + emailed link that only works while signed in, 1 h); security-notice emails after password change, 2FA off, passkey added/removed, sign-in method removed; `afterDelete` sends "account deleted". Google photo: `databaseHooks.account.create.after` copies the `picture` claim from Google's ID token when Google is linked and the user has no photo (hotlinked from googleusercontent.com — revisit if we want to copy photos to Blob).
- **Export:** `GET /api/auth/ea/export` — profile, sign-in methods, sessions, passkey names; never hashes, tokens, secrets or keys.
- **DB:** dev migrated (`lib/accounts/migrations/20261105T204949Z.sql`: `twoFactor`, `passkey`, `user.twoFactorEnabled`).
- **Verified on dev:** name edit; export contains no secrets; 2FA enable (wrong code refused, right code accepted, secret stored encrypted), next sign-in asks for the code and creates no session until it's entered, disable sends notice; wrong current password refused on change; email change needs approval link (old inbox) then confirm link (new inbox), unchanged until both; delete with wrong password refused, link refused when not signed in, works while signed in, user gone + "deleted" email; sessions list + sign out everywhere else; 2FA QR renders.
- **Passkeys:** add/store/rename verified headlessly with a virtual authenticator (2026-11-05). Fixed: Better Auth sends `addPasskey({name})` as the WebAuthn user name, so password managers filed passkeys as "Chrome on Mac" — now registers unnamed (user name = email) then `updatePasskey` sets the label. 1Password on the Mac doesn't take passkey requests on http://localhost and the phone-QR route can't bind to a localhost login, Josh added a passkey on his Mac on localhost (2026-11-05, using the Mac's own passkey option). So **only the 1Password-on-Mac passkey test is deferred to launch (Josh, on earthatlas.org)** — add it to the Phase 5 checklist.
- **Google photo:** confirmed by Josh on 5173.
- **Rough edge:** a delete link opened while signed out shows a bare JSON error.

## Phase 3 build notes (2026-11-05, localhost only)

- **Gate** (`lib/accounts/admin.js`): role `admin` + two-step verification on + an authenticator code entered on this session ("unlock", `auth.admin_unlock`, 12 h max, removed with the session). Wrong codes count toward a per-admin lockout (same rules as sign-in). Google or passkey sign-in alone never opens admin tools.
- **API** `/api/auth/ea/admin/*` (`api/auth.js`): status, unlock, lock, users (search / status / role / page), user detail, audit log, and `action` (invite, update name/role/mark verified, changeEmail, resendVerification, sendReset — or a fresh invite if no sign-in method yet, revokeSessions, ban with reason (signs out everywhere), unban, delete with typed email + admin password). POSTs need a trusted Origin. No acting on your own account (role, ban, delete, sign-out) — use /account. Better Auth's `/api/auth/admin/*` routes return 404 from the web (they'd skip the gate and include set-password / impersonation).
- **Audit log** `auth.audit_log` (`lib/accounts/audit.js`, SQL `002_audit_admin.sql`): every admin action plus security events (sign-in by method, wrong password, lock, sign-out, password change / reset, 2FA on/off/new codes, passkey add/remove, sign-in method add/remove, email change, profile update, device sign-outs, self-delete). Triggers refuse UPDATE / DELETE / TRUNCATE. No passwords, codes or tokens stored.
- **Page** `/admin/users` (`src/accounts/AdminUsersPage.jsx`): Users tab (list, filters, invite, detail panel with actions + recent activity) and Audit log tab.
- **Ship intake** (`lib/ships/intakeApi.js`): on Vercel accepts an unlocked admin account; the old shared login still works until cutover. Intake page points to /admin/users.
- **Deliberately not built:** named API keys — nothing needs them once the old login goes (scripts use `CRON_SECRET`; intake runs locally). Add when a script needs admin access.
- **Verified on dev** (API script + headless screenshots): non-admin refused; Better Auth admin routes 404; admin without 2FA → needs-2fa; locked → reads refused; wrong code refused + audited; foreign Origin refused; right code unlocks; list/search/filter; self-ban refused; invite (real email to test-invite-2), ban needs reason, ban/unban, role change, delete refused for wrong typed email and wrong admin password, delete works; audit rows correct; UPDATE/DELETE on audit_log refused by trigger; lock re-locks.
- **Cutover (at launch, after Josh's prod admin + 2FA works):** delete `api/admin/login.js`, `logout.js`, `session.js`, `lib/auth.js` cookie/Bearer code, the old intake fallback and sign-in form; remove `ADMIN_USER` / `ADMIN_PASSWORD` / `ADMIN_SECRET` from Vercel. (News admin files using `lib/auth.js` go with the separate news-removal branch.)

## Phase 4 build notes (2026-11-05, localhost only)

- **Security headers** (`vercel.json`): on `/account`, `/account/*`, `/admin/users`: strict CSP (scripts only from self, Google Tag Manager, Cloudflare Turnstile; images self + Google profile photos; Turnstile frame; `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`), `X-Frame-Options: DENY`, nosniff, `Referrer-Policy`, `Permissions-Policy` (camera/mic/location off, passkeys self), `no-store`. Site-wide HSTS `max-age=63072000; includeSubDomains` (every earthatlas.org web name is on Vercel over https; `send`/`rsend` are mail-only). To keep the CSP free of inline scripts, index.html's two inline scripts moved to `public/ga-init.js` and `public/hasown-shim.js`. The vite dev server mirrors these headers on the same paths (plus Vite's inline preamble + HMR socket) so CSP breaks show on localhost. Checked headless: sign-in, forgot, invite, profile, admin pages load with zero CSP violations; Turnstile renders; homepage has no CSP.
- **Analytics / error reports** (`src/accounts/privacy.js`): reset / invite tokens are read once and removed from the address bar; GA, PostHog and Sentry get URLs with `token`/`code`/`secret`/`otp`/`callbackURL` replaced by `redacted`; PostHog drops clicks, rage clicks and recordings on account/admin pages; Sentry takes no error replays there and scrubs breadcrumbs.
- **Nightly cleanup** `api/cron/accounts-cleanup.js` (10:17 UTC, CRON_SECRET; once a day so Neon wakes once): deletes self sign-ups unconfirmed after 7 days (never signed in, never invited, never admin-edited), expired tokens, admin unlocks, day-old rate-limit rows, idle lockout counters. Audit log is never cleaned. Proven on dev: an 8-day-old unconfirmed account deleted, a 2-day-old one kept.
- **Spike alert** `lib/accounts/alerts.js`: checked right after a wrong password, lock, wrong admin code or sign-up (event-driven, no timer, no extra DB wakes). Last hour ≥ 30 wrong passwords / 3 locks / 3 wrong admin codes / 20 sign-ups → GitHub issue (label `account-alert`, assigned to Josh) via `.github/workflows/accounts-alert.yml`, dispatched with GH_DISPATCH_TOKEN; at most one per 6 h. Dedupe proven on dev; the dispatch 404s until the workflow is on main.
- **Disposable list refresh** `scripts/accounts/refresh-disposable.mjs` (`--write` to update; refuses a >20% shrink; never blocks our own or major providers). 2026-11-05: already current (10,143).
- **Security review** (2026-11-05, scoped to the accounts code): no findings at confidence ≥ 8. Checked: path tricks around the `/api/auth/admin/*` block (encoding, case, dot segments, slashes), self-promotion via update-user (refused live: role/banned/emailVerified "not allowed"), admin gate on every read and action, SQL parameterization, CSRF (trusted Origin on admin POSTs, no CORS), token scrubbing, XSS (only `dangerouslySetInnerHTML` is the locally generated QR SVG), cron secret, alert workflow input. Hardening applied: an admin can no longer change another admin's email (that plus a reset link would be a takeover). Noted, not changed: subdomains share the session cookie and trusted origins, so an XSS on any earthatlas.org subdomain could act for an unlocked admin; intake POSTs have no Origin check (same as under the old login).

## Phase 5 prep: Privacy Policy + Terms of Use (draft 2026-11-05)

- Draft pages at `/privacy` and `/terms` (`src/accounts/LegalPages.jsx`), linked from the sign-up checkbox, the account page footers and each other. Written from what the site actually does (analytics: GA, PostHog, Vercel Web Analytics; Sentry; Vercel logs; Mapbox and browser-side data sources; link-preview snapshots; account data incl. security log kept after deletion; Turnstile, HIBP k-anonymity, Resend; Neon in the US; 13+).
- Open facts (yellow "TO CONFIRM" marks on the pages): operator's legal name, a contact address (earthatlas.org has no MX), governing-law state. Effective date set when Josh approves. Josh's review (ideally a lawyer's) before launch.
- Not addressed: EU/UK cookie-consent banner for GA/PostHog — decide before any EU-focused outreach.

### Contact form (2026-11-07, localhost)
- /contact → POST /api/auth/ea/contact (lib/accounts/contact.js); table auth.contact_message (sql/003_contact.sql, applied to dev).
- Layers: same-origin, 20 KB body cap, honeypot + signed form timer (silent fake success), Turnstile (action "contact", hostname checked in prod), 3/hour + 5/day per IP and 3/day per sender, field + permanent-email checks, content filters (links > 2, markup, spam pitches, caps) → held, 20 emailed/day cap. Never mails the sender.
- Delivery: CONTACT_TO=josh@knauernever.com (Josh 2026-11-08; set in .env.local, add to Vercel prod at launch) — plain-text + HTML notice with Reply-To = sender. Unset → printed.
- Cleanup cron: bot 30 d, held 90 d, accepted 1 y. Spike alert on contact.blocked ≥ 50/hour.
- Held messages are only visible in the DB for now (an admin Messages tab would surface them).
- Launch: run migrate on prod users DB; set CONTACT_TO=josh@knauernever.com in Vercel (production).
- Admin → Messages tab (2026-11-08): held / delivered / bots, with Deliver it (sends held message to CONTACT_TO, marks accepted), Reply (mailto) and Delete; both actions audited (admin.contact_release / admin.contact_delete).

### Site-wide legal links + delete-link page (2026-11-08)
- src/components/LegalLinks.jsx (" · Privacy · Terms · Contact") follows the KnauerNever credit in BuiltByCredit, SourcesFooter (panel + sources modal) and the 10 hand-written credits (App, Explore ×2, Birdsong, HappyWhale, Quakes, Carbon, Fire, ForestMonitor, Systems).
- A refused account-deletion email link (signed out, used or expired) now redirects to /account/delete-link?reason=signin|expired instead of raw JSON (api/auth.js deleteCallback).
