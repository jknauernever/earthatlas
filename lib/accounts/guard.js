/**
 * Bot and abuse checks that run before Better Auth sees a sign-up / invite-acceptance request
 * (docs/USER_ACCOUNTS_PLAN.md §6). Turnstile and rate limits are handled by Better Auth itself
 * (captcha plugin, rateLimit); this file adds the rest:
 *
 *  - honeypot: a hidden form field people never fill → silent fake success
 *  - form timing: a server-signed timestamp issued when the form renders; submitted < 3 s later
 *    (or > 2 h later, or tampered) → reject
 *  - email checks: syntax, disposable-domain blocklist (lib/accounts/data/disposable-domains.txt,
 *    from github.com/disposable-email-domains), and the domain must accept mail (MX, or A fallback)
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolveMx, resolve4, resolve6 } from 'node:dns/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIN_MS = 3_000
const MAX_MS = 2 * 60 * 60 * 1000

function secret() {
  const s = process.env.BETTER_AUTH_SECRET
  if (!s) throw new Error('BETTER_AUTH_SECRET not set')
  return s
}

const sign = (payload) => createHmac('sha256', secret()).update(`form-token:${payload}`).digest('base64url')

/** Token the form page fetches when it renders: "<ms>.<sig>". */
export function issueFormToken(now = Date.now()) {
  return `${now}.${sign(String(now))}`
}

/** null when the token is fine, else a short reason (for logs, not for users). */
export function checkFormToken(token, now = Date.now()) {
  if (typeof token !== 'string' || !/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(token)) return 'missing'
  const [ts, sig] = token.split('.')
  const want = Buffer.from(sign(ts))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return 'bad-signature'
  const age = now - Number(ts)
  if (age < MIN_MS) return 'too-fast'
  if (age > MAX_MS) return 'expired'
  return null
}

let disposable = null
function disposableSet() {
  if (!disposable) {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'disposable-domains.txt')
    disposable = new Set(readFileSync(file, 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')))
  }
  return disposable
}

const EMAIL_RE = /^[^\s@"(),:;<>[\]\\]{1,64}@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/i

export function isDisposableDomain(domain) {
  const set = disposableSet()
  const parts = domain.toLowerCase().split('.')
  // Blocks the listed domain and any subdomain of it.
  for (let i = 0; i < parts.length - 1; i++) if (set.has(parts.slice(i).join('.'))) return true
  return false
}

async function acceptsMail(domain) {
  const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('dns-timeout')), 3000))])
  try {
    const mx = await withTimeout(resolveMx(domain))
    if (mx.some((r) => r.exchange && r.exchange !== '.')) return true
    return false // only a null MX ("."): the domain says it takes no mail
  } catch (e) {
    if (e.message === 'dns-timeout') return true // don't lock people out over a slow resolver
    // No MX record: RFC 5321 falls back to the A/AAAA record.
    try { await withTimeout(resolve4(domain)); return true } catch {}
    try { await withTimeout(resolve6(domain)); return true } catch {}
    return false
  }
}

/** null when the address may register, else a user-facing reason. */
export async function checkEmail(email) {
  const m = typeof email === 'string' ? email.trim().match(EMAIL_RE) : null
  if (!m || email.length > 254) return 'Enter a valid email address.'
  const domain = m[1].toLowerCase()
  if (isDisposableDomain(domain)) return 'Please use a permanent email address, not a disposable one.'
  if (!(await acceptsMail(domain))) return "That email domain can't receive mail. Check the address."
  return null
}
