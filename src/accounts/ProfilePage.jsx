/**
 * /account — the signed-in user's profile and security settings (docs/USER_ACCOUNTS_PLAN.md §5):
 * name + photo, email change, password, Google, passkeys, two-step verification, sessions,
 * download my data, delete account. Everything goes through Better Auth (/api/auth) except the
 * data export (/api/auth/ea/export). Forms carry `ph-no-capture` so analytics never records input.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authClient, errorText, fetchFormConfig, signOut, useSession } from './authClient.js'
import Turnstile from './Turnstile.jsx'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import s from './AccountPages.module.css'

const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
const fmtWhen = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

function device(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

function Notice({ kind = 'error', children }) {
  if (!children) return null
  return <p className={kind === 'error' ? s.error : s.ok} role={kind === 'error' ? 'alert' : 'status'}>{children}</p>
}

function Section({ title, children, danger = false }) {
  return (
    <section className={`${s.section} ${danger ? s.danger : ''}`}>
      <h2 className={s.h2}>{title}</h2>
      {children}
    </section>
  )
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

/** One async action with busy / error / ok state. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const run = useCallback(async (fn, okText = '') => {
    setBusy(true); setError(''); setOk('')
    try {
      const res = await fn()
      if (res?.error) { setError(errorText(res.error)); return null }
      if (okText) setOk(okText)
      return res?.data ?? res ?? true
    } catch (e) {
      setError(e?.message || 'Something went wrong. Please try again.')
      return null
    } finally { setBusy(false) }
  }, [])
  return { busy, error, ok, run, setError, setOk }
}

function Avatar({ user }) {
  const [broken, setBroken] = useState(false)
  if (user.image && !broken) return <img className={s.avatar} src={user.image} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  return <div className={`${s.avatar} ${s.avatarInitial}`} aria-hidden="true">{(user.name || user.email || '?').trim()[0].toUpperCase()}</div>
}

function ProfileSection({ user, refetch }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user.name)
  const a = useAction()
  const save = async (e) => {
    e.preventDefault()
    if (await a.run(() => authClient.updateUser({ name: name.trim() }), 'Name saved.')) { setEditing(false); refetch() }
  }
  const removePhoto = async () => { if (await a.run(() => authClient.updateUser({ image: null }), 'Photo removed.')) refetch() }
  return (
    <Section title="Profile">
      <div className={s.profileRow}>
        <Avatar user={user} />
        <div className={s.grow}>
          {editing ? (
            <form className={`${s.inline} ph-no-capture`} onSubmit={save}>
              <input className={s.input} aria-label="Your name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <button className={s.small} disabled={a.busy || !name.trim()}>Save</button>
              <button type="button" className={s.smallGhost} onClick={() => { setEditing(false); setName(user.name) }}>Cancel</button>
            </form>
          ) : (
            <p className={s.name}>{user.name} <button className={s.link} onClick={() => setEditing(true)}>Edit</button></p>
          )}
          <p className={s.meta}>Member since {fmtDate(user.createdAt)}{user.role === 'admin' ? ' · Administrator' : ''}</p>
          {user.image && <button className={s.link} onClick={removePhoto} disabled={a.busy}>Remove photo</button>}
        </div>
      </div>
      <Notice>{a.error}</Notice><Notice kind="ok">{a.ok}</Notice>
    </Section>
  )
}

function EmailSection({ user }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const a = useAction()
  const submit = async (e) => {
    e.preventDefault()
    if (await a.run(() => authClient.changeEmail({ newEmail: email.trim(), callbackURL: '/account?email=changed' }),
      `We sent an approval link to ${user.email}. After you approve, we'll send a confirmation link to ${email.trim()}.`)) setOpen(false)
  }
  return (
    <Section title="Email">
      <p className={s.text}>{user.email} {!open && <button className={s.link} onClick={() => setOpen(true)}>Change</button>}</p>
      {open && (
        <form className={`${s.form} ph-no-capture`} onSubmit={submit}>
          <Field label="New email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="For your security, we email your current address to approve the change first." />
          <div className={s.inline}>
            <button className={s.small} disabled={a.busy || !email.includes('@')}>Send approval link</button>
            <button type="button" className={s.smallGhost} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      <Notice>{a.error}</Notice><Notice kind="ok">{a.ok}</Notice>
    </Section>
  )
}

function PasswordBlock({ user, hasPassword }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [cfg, setCfg] = useState(null)
  const [token, setToken] = useState(null)
  const a = useAction()
  useEffect(() => { if (open && !hasPassword && !cfg) fetchFormConfig().then(setCfg).catch(() => {}) }, [open, hasPassword, cfg])

  const change = async (e) => {
    e.preventDefault()
    if (next !== confirm) return a.setError("The two new passwords don't match.")
    if (await a.run(() => authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true }),
      'Password changed. You were signed out on your other devices.')) { setOpen(false); setCurrent(''); setNext(''); setConfirm('') }
  }
  const sendSetLink = async () => {
    if (await a.run(() => authClient.requestPasswordReset({ email: user.email, redirectTo: `${window.location.origin}/account/reset` }, { headers: { 'x-captcha-response': token || '' } }),
      `We sent a link to ${user.email} to set your password.`)) setOpen(false)
  }

  return (
    <div className={s.methodRow}>
      <div className={s.grow}>
        <p className={s.methodName}>Password</p>
        <p className={s.meta}>{hasPassword ? 'Set' : 'Not set — you sign in with Google or a passkey.'}</p>
        {open && hasPassword && (
          <form className={`${s.form} ph-no-capture`} onSubmit={change}>
            <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <Field label="New password" type="password" autoComplete="new-password" minLength={12} hint="At least 12 characters." value={next} onChange={(e) => setNext(e.target.value)} />
            <Field label="Type the new password again" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <div className={s.inline}>
              <button className={s.small} disabled={a.busy || !current || next.length < 12 || !confirm}>Change password</button>
              <button type="button" className={s.smallGhost} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        )}
        {open && !hasPassword && (
          <div className={s.form}>
            <p className={s.text}>We'll email you a link to choose a password.</p>
            {cfg && <Turnstile siteKey={cfg.turnstileSiteKey} action="setpassword" onToken={setToken} />}
            <div className={s.inline}>
              <button className={s.small} onClick={sendSetLink} disabled={a.busy || !token}>Email me a link</button>
              <button type="button" className={s.smallGhost} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        )}
        <Notice>{a.error}</Notice><Notice kind="ok">{a.ok}</Notice>
      </div>
      {!open && <button className={s.smallGhost} onClick={() => setOpen(true)}>{hasPassword ? 'Change' : 'Add'}</button>}
    </div>
  )
}

function GoogleBlock({ googleAccount, canRemove, onChange }) {
  const a = useAction()
  const connect = () => a.run(() => authClient.linkSocial({ provider: 'google', callbackURL: '/account?google=linked', errorCallbackURL: '/account' }))
  const remove = async () => {
    if (!window.confirm('Remove Google sign-in from your EarthAtlas account?')) return
    if (await a.run(() => authClient.unlinkAccount({ accountId: googleAccount.id }), 'Google sign-in removed.')) onChange()
  }
  return (
    <div className={s.methodRow}>
      <div className={s.grow}>
        <p className={s.methodName}>Google</p>
        <p className={s.meta}>{googleAccount ? `Connected ${fmtDate(googleAccount.createdAt)}` : 'Not connected'}</p>
        <Notice>{a.error}</Notice><Notice kind="ok">{a.ok}</Notice>
      </div>
      {googleAccount
        ? <button className={s.smallGhost} onClick={remove} disabled={a.busy || !canRemove} title={canRemove ? '' : 'Add a password or passkey first, so you can still sign in.'}>Remove</button>
        : <button className={s.smallGhost} onClick={connect} disabled={a.busy}>Connect</button>}
    </div>
  )
}

function PasskeysBlock({ passkeys, canRemoveLast, onChange }) {
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const a = useAction()
  const supported = typeof window !== 'undefined' && !!window.PublicKeyCredential
  const add = async (e) => {
    e.preventDefault()
    // No name on addPasskey: Better Auth sends it as the WebAuthn user name, so password
    // managers would file the passkey under "Chrome on Mac" instead of the account email.
    // Register first (user name = email), then label the stored passkey.
    const name = label.trim() || device(navigator.userAgent)
    const ok = await a.run(async () => {
      const res = await authClient.passkey.addPasskey()
      if (res?.error || !res?.data?.id) return res
      return authClient.passkey.updatePasskey({ id: res.data.id, name })
    }, 'Passkey added.')
    if (ok) { setAdding(false); setLabel(''); onChange() }
  }
  const remove = async (pk) => {
    if (!window.confirm(`Remove the passkey "${pk.name || 'Passkey'}"?`)) return
    if (await a.run(() => authClient.passkey.deletePasskey({ id: pk.id }), 'Passkey removed.')) onChange()
  }
  return (
    <div className={s.methodRow}>
      <div className={s.grow}>
        <p className={s.methodName}>Passkeys</p>
        <p className={s.meta}>Sign in with your fingerprint, face or device PIN instead of a password.</p>
        {passkeys.length > 0 && (
          <ul className={s.list}>
            {passkeys.map((pk) => (
              <li key={pk.id} className={s.listRow}>
                <span>{pk.name || 'Passkey'} <span className={s.meta}>· added {fmtDate(pk.createdAt)}</span></span>
                <button className={s.link} onClick={() => remove(pk)} disabled={a.busy || (passkeys.length === 1 && !canRemoveLast)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        {adding && (
          <form className={`${s.inline} ph-no-capture`} onSubmit={add}>
            <input className={s.input} aria-label="Passkey name" placeholder={device(navigator.userAgent)} maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
            <button className={s.small} disabled={a.busy}>Create</button>
            <button type="button" className={s.smallGhost} onClick={() => setAdding(false)}>Cancel</button>
          </form>
        )}
        {!supported && <p className={s.meta}>This browser doesn't support passkeys.</p>}
        <Notice>{a.error}</Notice><Notice kind="ok">{a.ok}</Notice>
      </div>
      {!adding && supported && <button className={s.smallGhost} onClick={() => setAdding(true)}>Add</button>}
    </div>
  )
}

function QrCode({ text }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let live = true
    import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M'); qr.addData(text); qr.make()
      if (live) setSvg(qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }))
    })
    return () => { live = false }
  }, [text])
  // eslint-disable-next-line react/no-danger -- SVG generated locally by qrcode-generator from our own TOTP URI
  return <div className={s.qr} dangerouslySetInnerHTML={{ __html: svg }} />
}

function TwoFactorSection({ user, hasPassword, refetch }) {
  const [step, setStep] = useState('idle') // idle | password | scan | codes | off | regen
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState(null) // { totpURI, backupCodes }
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(null)
  const a = useAction()
  const on = !!user.twoFactorEnabled
  const reset = () => { setStep('idle'); setPassword(''); setCode(''); setSetup(null) }

  if (!hasPassword) {
    return (
      <Section title="Two-step verification">
        <p className={s.text}>Two-step verification protects password sign-in. Your account has no password, and Google and passkey sign-ins are already strong, so there's nothing to turn on.</p>
      </Section>
    )
  }

  const start = async (e) => {
    e.preventDefault()
    const d = await a.run(() => authClient.twoFactor.enable({ password }))
    if (d?.totpURI) { setSetup(d); setStep('scan'); setPassword('') }
  }
  const verify = async (e) => {
    e.preventDefault()
    if (await a.run(() => authClient.twoFactor.verifyTotp({ code: code.trim() }))) { setCodes(setup.backupCodes); setStep('codes'); setCode(''); refetch() }
  }
  const turnOff = async (e) => {
    e.preventDefault()
    if (await a.run(() => authClient.twoFactor.disable({ password }), 'Two-step verification is off.')) { reset(); refetch() }
  }
  const regen = async (e) => {
    e.preventDefault()
    const d = await a.run(() => authClient.twoFactor.generateBackupCodes({ password }))
    if (d?.backupCodes) { setCodes(d.backupCodes); setStep('codes'); setPassword('') }
  }
  const secret = setup ? new URL(setup.totpURI).searchParams.get('secret') : ''

  return (
    <Section title="Two-step verification">
      <p className={s.text}>
        {on ? 'On. When you sign in with your password, we also ask for a code from your authenticator app.'
          : 'Off. Turn it on to also ask for a code from an authenticator app (such as Google Authenticator, 1Password or Authy) when you sign in with your password.'}
      </p>
      {step === 'idle' && (
        <div className={s.inline}>
          {on ? <>
            <button className={s.smallGhost} onClick={() => setStep('regen')}>New backup codes</button>
            <button className={s.smallGhost} onClick={() => setStep('off')}>Turn off</button>
          </> : <button className={s.small} onClick={() => setStep('password')}>Turn on</button>}
        </div>
      )}
      {(step === 'password' || step === 'off' || step === 'regen') && (
        <form className={`${s.form} ph-no-capture`} onSubmit={step === 'password' ? start : step === 'off' ? turnOff : regen}>
          <Field label="Confirm your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className={s.inline}>
            <button className={s.small} disabled={a.busy || !password}>{step === 'password' ? 'Continue' : step === 'off' ? 'Turn off' : 'Make new codes'}</button>
            <button type="button" className={s.smallGhost} onClick={reset}>Cancel</button>
          </div>
        </form>
      )}
      {step === 'scan' && setup && (
        <form className={`${s.form} ph-no-capture`} onSubmit={verify}>
          <p className={s.text}>Scan this with your authenticator app, then type the 6-digit code it shows.</p>
          <QrCode text={setup.totpURI} />
          <p className={s.meta}>Can't scan? Enter this key instead: <code className={s.code}>{secret}</code></p>
          <Field label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <div className={s.inline}>
            <button className={s.small} disabled={a.busy || code.length !== 6}>Turn on</button>
            <button type="button" className={s.smallGhost} onClick={reset}>Cancel</button>
          </div>
        </form>
      )}
      {step === 'codes' && codes && (
        <div className={s.form}>
          <Notice kind="ok">Save these backup codes somewhere safe. Each one works once, if you lose your phone. They won't be shown again.</Notice>
          <ul className={s.codes}>{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
          <div className={s.inline}>
            <button className={s.smallGhost} onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>Copy</button>
            <button className={s.small} onClick={() => { setCodes(null); reset() }}>I saved them</button>
          </div>
        </div>
      )}
      <Notice>{a.error}</Notice><Notice kind="ok">{a.ok}</Notice>
    </Section>
  )
}

function SessionsSection({ currentToken }) {
  const [list, setList] = useState(null)
  const a = useAction()
  const load = useCallback(() => authClient.listSessions().then(({ data }) => setList(data || [])), [])
  useEffect(() => { load() }, [load])
  const revoke = async (token) => { if (await a.run(() => authClient.revokeSession({ token }), 'Signed out that device.')) load() }
  const revokeOthers = async () => { if (await a.run(() => authClient.revokeOtherSessions(), 'Signed out everywhere else.')) load() }
  const sorted = (list || []).slice().sort((x, y) => (x.token === currentToken ? -1 : y.token === currentToken ? 1 : new Date(y.updatedAt) - new Date(x.updatedAt)))
  return (
    <Section title="Where you're signed in">
      {!list ? <p className={s.meta}>Loading…</p> : (
        <ul className={s.list}>
          {sorted.map((ss) => (
            <li key={ss.id} className={s.listRow}>
              <span>
                {device(ss.userAgent)}{ss.token === currentToken && <span className={s.badge}>This device</span>}
                <span className={s.metaBlock}>Signed in {fmtWhen(ss.createdAt)}{ss.ipAddress && !/^[0:.]*1?$|^127\./.test(ss.ipAddress) ? ` · ${ss.ipAddress}` : ''}</span>
              </span>
              {ss.token !== currentToken && <button className={s.link} onClick={() => revoke(ss.token)} disabled={a.busy}>Sign out</button>}
            </li>
          ))}
        </ul>
      )}
      {list && list.length > 1 && <button className={s.smallGhost} onClick={revokeOthers} disabled={a.busy}>Sign out everywhere else</button>}
      <Notice>{a.error}</Notice><Notice kind="ok">{a.ok}</Notice>
    </Section>
  )
}

function DataSection() {
  return (
    <Section title="Your data">
      <p className={s.text}>Download everything EarthAtlas stores about your account: your profile, sign-in methods, devices and passkey names.</p>
      <a className={s.smallGhost} href="/api/auth/ea/export" download>Download my data</a>
    </Section>
  )
}

function DeleteSection({ user, hasPassword }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const a = useAction()
  const submit = async (e) => {
    e.preventDefault()
    if (await a.run(() => authClient.deleteUser({ ...(hasPassword ? { password } : {}), callbackURL: '/account/deleted' }),
      `We sent a confirmation link to ${user.email}. Your account is deleted when you click it (on this device, within 1 hour).`)) { setOpen(false); setPassword(''); setTyped('') }
  }
  return (
    <Section title="Delete account" danger>
      <p className={s.text}>Permanently delete your EarthAtlas account and everything stored with it. This can't be undone.</p>
      {!open ? <button className={s.dangerButton} onClick={() => setOpen(true)}>Delete my account…</button> : (
        <form className={`${s.form} ph-no-capture`} onSubmit={submit}>
          <Field label={`Type your email (${user.email}) to confirm`} type="email" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          {hasPassword && <Field label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          <div className={s.inline}>
            <button className={s.dangerButton} disabled={a.busy || typed.trim().toLowerCase() !== user.email.toLowerCase() || (hasPassword && !password)}>Email me the confirmation link</button>
            <button type="button" className={s.smallGhost} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      <Notice>{a.error}</Notice><Notice kind="ok">{a.ok}</Notice>
    </Section>
  )
}

const BANNERS = {
  'email=changed': 'Thanks! If we asked you to confirm your new address, check that inbox for the last step. The email shown below is the one your account uses now.',
  'google=linked': 'Google sign-in is connected.',
}

export default function ProfilePage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { data, isPending, refetch } = useSession()
  const [accounts, setAccounts] = useState(null)
  const [passkeys, setPasskeys] = useState([])
  const loadMethods = useCallback(async () => {
    const [acc, pk] = await Promise.all([authClient.listAccounts(), authClient.passkey.listUserPasskeys()])
    setAccounts(acc.data || []); setPasskeys(pk.data || [])
  }, [])
  useEffect(() => { document.title = 'Your account · EarthAtlas' }, [])
  useEffect(() => { if (!isPending && !data) nav('/account/signin', { replace: true }) }, [isPending, data, nav])
  useEffect(() => { if (data) loadMethods() }, [data, loadMethods])

  const banner = Object.entries(BANNERS).find(([k]) => { const [p, v] = k.split('='); return params.get(p) === v })?.[1]
  const errParam = params.get('error')

  if (isPending || !data || !accounts) {
    return <main className={s.page}><div className={`${s.card} ${s.wide}`}><p className={s.text}>Loading…</p></div></main>
  }
  const user = data.user
  const hasPassword = accounts.some((x) => x.providerId === 'credential')
  const googleAccount = accounts.find((x) => x.providerId === 'google')
  const otherMethods = (hasPassword ? 1 : 0) + passkeys.length
  return (
    <main className={s.page}>
      <div className={`${s.card} ${s.wide}`}>
        <div className={s.topRow}>
          <a href="/" className={s.brand}>EarthAtlas</a>
          <button className={s.link} onClick={async () => { await signOut(); nav('/account/signin') }}>Sign out</button>
        </div>
        <h1 className={s.title}>Your account</h1>
        <Notice kind="ok">{banner}</Notice>
        <Notice>{errParam ? 'That didn’t work. Please try again.' : ''}</Notice>
        <ProfileSection user={user} refetch={refetch} />
        <EmailSection user={user} />
        <Section title="Ways to sign in">
          <PasswordBlock user={user} hasPassword={hasPassword} />
          <GoogleBlock googleAccount={googleAccount} canRemove={otherMethods > 0} onChange={loadMethods} />
          <PasskeysBlock passkeys={passkeys} canRemoveLast={hasPassword || !!googleAccount} onChange={loadMethods} />
        </Section>
        <TwoFactorSection user={user} hasPassword={hasPassword} refetch={refetch} />
        <SessionsSection currentToken={data.session.token} />
        <DataSection />
        <DeleteSection user={user} hasPassword={hasPassword} />
      </div>
      <div className={`${s.credit} ${s.creditWide}`}><BuiltByCredit variant="light" /></div>
    </main>
  )
}

// Shared with the admin page (AdminUsersPage.jsx).
export { Notice, Section, Field, useAction, Avatar, fmtDate, fmtWhen, device }
