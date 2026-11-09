/**
 * EarthAtlas account pages (docs/USER_ACCOUNTS_PLAN.md §4–5):
 *   /account/signin   /account/signup   /account/forgot   /account/reset?token=
 *   /account/invite?token=   /account/verified   /account   /contact
 * Forms carry `ph-no-capture` so analytics never records what's typed.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authClient, errorText, fetchFormConfig, REDIRECT_ERRORS } from './authClient.js'
import { handoffUrl, hostKind } from './crossSite.js'
import Turnstile from './Turnstile.jsx'
import { dropTokenFromAddressBar } from './privacy.js'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import s from './AccountPages.module.css'

function Shell({ title, children, wide = false }) {
  useEffect(() => { document.title = `${title} · EarthAtlas` }, [title])
  return (
    <main className={s.page}>
      <div className={`${s.card} ${wide ? s.wide : ''}`}>
        <Link to="/" className={s.brand}>EarthAtlas</Link>
        <h1 className={s.title}>{title}</h1>
        {children}
      </div>
      <div className={s.credit}><BuiltByCredit variant="light" /></div>
    </main>
  )
}

/** Form config (Turnstile key, signed render time) + the current Turnstile token. */
function useFormGuard() {
  const [cfg, setCfg] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [token, setToken] = useState(null)
  const [resetKey, setResetKey] = useState(0)
  useEffect(() => { fetchFormConfig().then(setCfg).catch((e) => setLoadError(e.message)) }, [])
  const spent = useCallback(() => setResetKey((k) => k + 1), [])
  return { cfg, loadError, token, setToken, resetKey, spent }
}

function Field({ label, hint, ...props }) {
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      <input className={s.input} {...props} />
      {hint && <span className={s.hint}>{hint}</span>}
    </label>
  )
}

function Notice({ kind = 'error', children }) {
  if (!children) return null
  return <p className={kind === 'error' ? s.error : s.ok} role={kind === 'error' ? 'alert' : 'status'}>{children}</p>
}

function GoogleButton({ label = 'Continue with Google', callbackURL = '/account', errorCallbackURL = '/account/signin' }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    await authClient.signIn.social({ provider: 'google', callbackURL, errorCallbackURL })
    setBusy(false)
  }
  return (
    <button type="button" className={s.google} onClick={go} disabled={busy}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      {busy ? 'Opening Google…' : label}
    </button>
  )
}

const Or = () => <div className={s.or}><span>or</span></div>

// Hidden from people (off-screen, not display:none so naive bots still see it); filled → server fakes success.
const Honeypot = ({ value, onChange }) => (
  <div className={s.hp} aria-hidden="true">
    <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} /></label>
  </div>
)

/** ?next= after sign-in: a same-site path only. API paths (the partner-domain handoff) need a full page load. */
function useNext() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const raw = params.get('next')
  const next = raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : '/account'
  const go = () => (next.startsWith('/api/') ? window.location.assign(next) : nav(next))
  return { next, go }
}

export function SignInPage() {
  // Partner domains (explore.sanjuans.org) sign in on earthatlas.org and are handed back (src/accounts/crossSite.js)
  if (typeof window !== 'undefined' && hostKind() === 'partner') {
    const p = new URLSearchParams(window.location.search).get('next')
    const back = p && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/api/') ? p : '/'
    window.location.replace(handoffUrl(window.location.origin + back))
    return null
  }
  return <SignInForm />
}

function SignInForm() {
  const [params] = useSearchParams()
  const { next, go } = useNext()
  const g = useFormGuard()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(REDIRECT_ERRORS[params.get('error')] || (params.get('error') ? 'Sign-in failed. Please try again.' : ''))

  const [twoFactor, setTwoFactor] = useState(false)
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [trust, setTrust] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    const { data, error: err } = await authClient.signIn.email(
      { email, password, callbackURL: next },
      { headers: { 'x-captcha-response': g.token || '' } },
    )
    setBusy(false); g.spent()
    if (err) return setError(errorText(err))
    if (data?.twoFactorRedirect) return setTwoFactor(true)
    go()
  }
  const submitCode = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    const { error: err } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice: trust })
      : await authClient.twoFactor.verifyTotp({ code: code.trim(), trustDevice: trust })
    setBusy(false)
    if (err) return setError(errorText(err))
    go()
  }
  const passkeySignIn = async () => {
    setError('')
    const { error: err } = await authClient.signIn.passkey()
    if (err) return setError(err.code === 'AUTH_CANCELLED' || /cancel|abort|NotAllowed/i.test(err.message || '') ? '' : errorText(err))
    go()
  }

  if (twoFactor) {
    return (
      <Shell title="Two-step verification">
        <p className={s.text}>{useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.'}</p>
        <form className={`${s.form} ph-no-capture`} onSubmit={submitCode} noValidate>
          <Field label={useBackup ? 'Backup code' : '6-digit code'} inputMode={useBackup ? 'text' : 'numeric'} autoComplete="one-time-code" autoFocus
            maxLength={useBackup ? 20 : 6} value={code} onChange={(e) => setCode(useBackup ? e.target.value : e.target.value.replace(/\D/g, ''))} />
          <label className={s.check}><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> Don't ask again on this device for 30 days</label>
          <Notice>{error}</Notice>
          <button className={s.primary} disabled={busy || (useBackup ? code.trim().length < 6 : code.length !== 6)}>{busy ? 'Checking…' : 'Verify'}</button>
        </form>
        <p className={s.links}><button type="button" className={s.link} onClick={() => { setUseBackup(!useBackup); setCode(''); setError('') }}>{useBackup ? 'Use my authenticator app instead' : 'Lost your phone? Use a backup code'}</button></p>
      </Shell>
    )
  }

  return (
    <Shell title="Sign in">
      <GoogleButton callbackURL={next} errorCallbackURL={`/account/signin${next === '/account' ? '' : `?next=${encodeURIComponent(next)}`}`} />
      {typeof window !== 'undefined' && window.PublicKeyCredential && <button type="button" className={`${s.google} ${s.mt8}`} onClick={passkeySignIn}>Sign in with a passkey</button>}
      <Or />
      <form className={`${s.form} ph-no-capture`} onSubmit={submit} noValidate>
        <Field label="Email" type="email" autoComplete="email webauthn" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {g.cfg && <Turnstile siteKey={g.cfg.turnstileSiteKey} action="signin" onToken={g.setToken} resetKey={g.resetKey} />}
        <Notice>{error || g.loadError}</Notice>
        <button className={s.primary} disabled={busy || !g.token || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className={s.links}><Link to="/account/forgot">Forgot your password?</Link></p>
      {g.cfg?.signupsOpen && <p className={s.links}>New here? <Link to="/account/signup">Create an account</Link></p>}
    </Shell>
  )
}

export function SignUpPage() {
  const g = useFormGuard()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agree, setAgree] = useState(false)
  const [age, setAge] = useState(false)
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  if (g.cfg && !g.cfg.signupsOpen) {
    return (
      <Shell title="Accounts are invite-only">
        <p className={s.text}>EarthAtlas accounts are invite-only for now. If you were invited, use the link in your invitation email.</p>
        <p className={s.links}><Link to="/account/signin">Already have an account? Sign in</Link></p>
      </Shell>
    )
  }
  if (done) {
    return (
      <Shell title="Check your email">
        <p className={s.text}>We sent a link to <strong>{email}</strong>. Click it to confirm your address and finish creating your account. The link expires in 24 hours.</p>
      </Shell>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    const { error: err } = await authClient.signUp.email(
      { email, password, name, website, callbackURL: '/account/verified' },
      { headers: { 'x-captcha-response': g.token || '', 'x-form-token': g.cfg?.formToken || '' } },
    )
    setBusy(false); g.spent()
    if (err) return setError(errorText(err))
    setDone(true)
  }

  return (
    <Shell title="Create an account">
      <form className={`${s.form} ph-no-capture`} onSubmit={submit} noValidate>
        <Field label="Your name" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="new-password" required minLength={12} hint="At least 12 characters. A few random words work well." value={password} onChange={(e) => setPassword(e.target.value)} />
        <Honeypot value={website} onChange={setWebsite} />
        <label className={s.check}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Use</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</label>
        <label className={s.check}><input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} /> I am 13 or older.</label>
        {g.cfg && <Turnstile siteKey={g.cfg.turnstileSiteKey} action="signup" onToken={g.setToken} resetKey={g.resetKey} />}
        <Notice>{error || g.loadError}</Notice>
        <button className={s.primary} disabled={busy || !g.token || !agree || !age || !email || password.length < 12 || !name.trim()}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p className={s.links}>Already have an account? <Link to="/account/signin">Sign in</Link></p>
    </Shell>
  )
}

export function ForgotPage() {
  const g = useFormGuard()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    const { error: err } = await authClient.requestPasswordReset(
      { email, redirectTo: `${window.location.origin}/account/reset` },
      { headers: { 'x-captcha-response': g.token || '' } },
    )
    setBusy(false); g.spent()
    if (err) return setError(errorText(err))
    setDone(true)
  }

  if (done) {
    return (
      <Shell title="Check your email">
        <p className={s.text}>If <strong>{email}</strong> has an EarthAtlas account, we sent it a link to reset the password. The link expires in 1 hour.</p>
        <p className={s.links}><Link to="/account/signin">Back to sign in</Link></p>
      </Shell>
    )
  }
  return (
    <Shell title="Reset your password">
      <p className={s.text}>Enter your email and we'll send you a link to choose a new password.</p>
      <form className={`${s.form} ph-no-capture`} onSubmit={submit} noValidate>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {g.cfg && <Turnstile siteKey={g.cfg.turnstileSiteKey} action="forgot" onToken={g.setToken} resetKey={g.resetKey} />}
        <Notice>{error || g.loadError}</Notice>
        <button className={s.primary} disabled={busy || !g.token || !email}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <p className={s.links}><Link to="/account/signin">Back to sign in</Link></p>
    </Shell>
  )
}

/** Shared by /account/reset (forgot password) and /account/invite (set your first password). */
function SetPasswordForm({ token, invite }) {
  const nav = useNavigate()
  const g = useFormGuard()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (password !== confirm) return setError("The two passwords don't match.")
    setError(''); setBusy(true)
    const { error: err } = await authClient.resetPassword(
      { newPassword: password, token },
      { headers: { 'x-captcha-response': g.token || '' } },
    )
    setBusy(false); g.spent()
    if (err) return setError(errorText(err))
    setDone(true)
  }

  if (!token) return <Notice>This link is missing its code. Use the full link from your email.</Notice>
  if (done) {
    return (
      <>
        <Notice kind="ok">{invite ? 'Your account is ready.' : 'Your password was changed.'} Sign in to continue.</Notice>
        <button className={s.primary} onClick={() => nav('/account/signin')}>Sign in</button>
      </>
    )
  }
  return (
    <form className={`${s.form} ph-no-capture`} onSubmit={submit} noValidate>
      <Field label={invite ? 'Choose a password' : 'New password'} type="password" autoComplete="new-password" required minLength={12} hint="At least 12 characters. A few random words work well." value={password} onChange={(e) => setPassword(e.target.value)} />
      <Field label="Type it again" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {g.cfg && <Turnstile siteKey={g.cfg.turnstileSiteKey} action={invite ? 'invite' : 'reset'} onToken={g.setToken} resetKey={g.resetKey} />}
      <Notice>{error || g.loadError}</Notice>
      <button className={s.primary} disabled={busy || !g.token || password.length < 12 || !confirm}>{busy ? 'Saving…' : invite ? 'Create my account' : 'Save new password'}</button>
    </form>
  )
}

// Read the one-time token once, then take it out of the address bar (src/accounts/privacy.js).
function useOneTimeToken(params) {
  const [token] = useState(() => params.get('token'))
  useEffect(() => { dropTokenFromAddressBar() }, [])
  return token
}

export function ResetPage() {
  const [params] = useSearchParams()
  const token = useOneTimeToken(params)
  const bad = params.get('error')
  return (
    <Shell title="Choose a new password">
      {bad ? <><Notice>{REDIRECT_ERRORS[bad] || 'This link is invalid or has expired.'}</Notice><p className={s.links}><Link to="/account/forgot">Send a new link</Link></p></>
        : <SetPasswordForm token={token} />}
    </Shell>
  )
}

export function InvitePage() {
  const [params] = useSearchParams()
  const token = useOneTimeToken(params)
  return (
    <Shell title="Welcome to EarthAtlas">
      <p className={s.text}>Set up your account with Google, using the same address your invitation was sent to, or choose a password.</p>
      <GoogleButton />
      <Or />
      <SetPasswordForm token={token} invite />
    </Shell>
  )
}

export function VerifiedPage() {
  const [params] = useSearchParams()
  const bad = params.get('error')
  return (
    <Shell title={bad ? 'Link expired' : 'Email confirmed'}>
      {bad ? <Notice>{REDIRECT_ERRORS[bad] || 'This link is invalid or has expired.'} Try signing in and we'll send a new one.</Notice>
        : <p className={s.text}>Thanks — your email is confirmed and your account is active.</p>}
      <p className={s.links}><Link to={bad ? '/account/signin' : '/account'}>{bad ? 'Sign in' : 'Go to your account'}</Link></p>
    </Shell>
  )
}

export function DeletedPage() {
  return (
    <Shell title="Account deleted">
      <p className={s.text}>Your EarthAtlas account and the information stored with it have been permanently deleted. Thanks for being part of EarthAtlas.</p>
      <p className={s.links}><Link to="/">Back to EarthAtlas</Link></p>
    </Shell>
  )
}

/** Where a refused account-deletion email link lands (api/auth.js deleteCallback). */
export function DeleteLinkPage() {
  const [params] = useSearchParams()
  const signin = params.get('reason') === 'signin'
  return (
    <Shell title={signin ? 'Sign in to delete your account' : 'Link expired'}>
      {signin ? (
        <>
          <p className={s.text}>For your protection, the deletion link only works in a browser where you're signed in to EarthAtlas. Nothing has been deleted.</p>
          <p className={s.text}>Sign in here, then click the link in your email again. It works for 1 hour after you asked.</p>
          <p className={s.links}><Link to="/account/signin">Sign in</Link></p>
        </>
      ) : (
        <>
          <p className={s.text}>This deletion link is invalid, already used or expired. Nothing has been deleted.</p>
          <p className={s.text}>To delete your account, start again from your account page.</p>
          <p className={s.links}><Link to="/account">Go to your account</Link></p>
        </>
      )}
    </Shell>
  )
}

// Same list as TOPICS in lib/accounts/contact.js.
const CONTACT_TOPICS = [
  ['question', 'A question about EarthAtlas'], ['data', 'A problem with the data'], ['bug', 'Something is broken'],
  ['partner', 'Working together / sharing data'], ['account', 'My account'], ['other', 'Something else'],
]

/** /contact — spam-hardened contact form (all checks server-side: lib/accounts/contact.js). */
export function ContactPage() {
  const g = useFormGuard()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [topic, setTopic] = useState('question')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  if (done) {
    return (
      <Shell title="Message sent">
        <p className={s.text}>Thanks, {name.trim().split(' ')[0]}. Your message is on its way to the EarthAtlas team. If it needs an answer, we'll reply to <strong>{email}</strong>.</p>
        <p className={s.links}><Link to="/">Back to EarthAtlas</Link></p>
      </Shell>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const r = await fetch('/api/auth/ea/contact', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-captcha-response': g.token || '' },
        body: JSON.stringify({ name, email, topic, message, website, formToken: g.cfg?.formToken || '' }),
      })
      const out = await r.json().catch(() => ({}))
      if (!r.ok) setError(out.message || 'Something went wrong. Please try again.')
      else setDone(true)
    } catch {
      setError('Could not reach EarthAtlas. Check your connection and try again.')
    }
    setBusy(false); g.spent()
  }

  const short = message.trim().length < 20
  return (
    <Shell title="Contact EarthAtlas">
      <p className={s.text}>Questions, corrections to the data, ideas or problems: write to us here.</p>
      <form className={`${s.form} ph-no-capture`} onSubmit={submit} noValidate>
        <Field label="Your name" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Your email" type="email" autoComplete="email" required maxLength={254} hint="Only used to answer you." value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className={s.field}>
          <span className={s.label}>What's it about?</span>
          <select className={s.select} value={topic} onChange={(e) => setTopic(e.target.value)}>
            {CONTACT_TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={s.field}>
          <span className={s.label}>Message</span>
          <textarea className={`${s.input} ${s.textarea}`} required rows={7} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />
          <span className={s.hint}>{message.length.toLocaleString()} / 5,000 characters. If it's about a place or a data point, paste the page's link.</span>
        </label>
        <Honeypot value={website} onChange={setWebsite} />
        {g.cfg && <Turnstile siteKey={g.cfg.turnstileSiteKey} action="contact" onToken={g.setToken} resetKey={g.resetKey} />}
        <Notice>{error || g.loadError}</Notice>
        <button className={s.primary} disabled={busy || !g.token || !name.trim() || !email || short}>{busy ? 'Sending…' : 'Send message'}</button>
      </form>
      <p className={s.hint}>We keep your message as described in our <a href="/privacy">Privacy Policy</a>.</p>
    </Shell>
  )
}

export { default as AccountPage } from './ProfilePage.jsx'
