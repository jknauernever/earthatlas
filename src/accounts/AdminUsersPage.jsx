/**
 * /admin/users — manage EarthAtlas accounts (docs/USER_ACCOUNTS_PLAN.md §7).
 * Admins only, with two-step verification on, after entering an authenticator code on this session
 * (good for 12 hours). Server: /api/auth/ea/admin/* (lib/accounts/admin.js); every action is audited.
 * Admins never see or set passwords: invites and reset links only.
 */
import { useCallback, useEffect, useState } from 'react'
import { Notice, Field, useAction, fmtDate, fmtWhen, device } from './ProfilePage.jsx'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import s from './AccountPages.module.css'
import { rememberAdmin } from '../lib/siteContent.js'

async function api(path, body) {
  const r = await fetch(`/api/auth/ea/admin/${path}`, body
    ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { credentials: 'same-origin' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(j.message || 'Something went wrong. Please try again.'); e.code = j.code; throw e }
  return j
}

const STATUS_LABEL = { active: 'Active', invited: 'Invited', unverified: 'Unverified', banned: 'Banned' }
const Status = ({ v }) => <span className={`${s.st} ${s[`st_${v}`] || ''}`}>{STATUS_LABEL[v] || v}</span>
const METHOD = { credential: 'Password', google: 'Google' }

const ACTION_LABEL = {
  'admin.unlock': 'Opened admin tools', 'admin.unlock_failed': 'Wrong admin code', 'admin.invite': 'Invited', 'admin.reinvite': 'Sent a new invite',
  'admin.update': 'Edited account', 'admin.change_email': 'Changed email', 'admin.resend_verification': 'Resent verification email',
  'admin.send_reset': 'Sent password-reset link', 'admin.revoke_sessions': 'Signed out everywhere', 'admin.ban': 'Banned', 'admin.unban': 'Unbanned',
  'admin.delete': 'Deleted account', 'admin.delete_refused': 'Delete refused (wrong admin password)',
  'user.signin': 'Signed in', 'user.signin_failed': 'Wrong password', 'user.signin_locked': 'Sign-in locked (too many wrong passwords)',
  'user.signout': 'Signed out', 'user.password_changed': 'Changed password', 'user.password_reset': 'Set password from email link',
  'user.2fa_setup_started': 'Started two-step setup', 'user.2fa_on': 'Turned on two-step verification', 'user.2fa_off': 'Turned off two-step verification',
  'user.2fa_new_backup_codes': 'Made new backup codes', 'user.passkey_added': 'Added a passkey', 'user.passkey_removed': 'Removed a passkey',
  'user.signin_method_added': 'Added a sign-in method', 'user.signin_method_removed': 'Removed a sign-in method',
  'user.email_change_requested': 'Asked to change email', 'user.email_verified': 'Confirmed email', 'user.profile_updated': 'Updated profile',
  'user.signup': 'Sign-up', 'system.spike_alert': 'Unusual-activity alert sent', 'system.deleted_unverified': 'Deleted (email never confirmed)',
  'admin.contact_release': 'Delivered a held contact message', 'admin.contact_delete': 'Deleted a contact message',
  'contact.received': 'Contact message delivered', 'contact.held': 'Contact message held as likely spam', 'contact.blocked': 'Contact message blocked',
  'user.session_revoked': 'Signed out a device', 'user.other_sessions_revoked': 'Signed out other devices', 'user.deleted_own_account': 'Deleted their account',
}
function eventText(e) {
  const base = ACTION_LABEL[e.action] || e.action
  const d = e.details || {}
  const extra = d.method ? ` (${METHOD[d.method] || d.method})` : d.reason ? `: ${d.reason}` : d.to && d.from ? ` ${d.from} → ${d.to}` : d.role?.to ? ` (role ${d.role.from} → ${d.role.to})` : ''
  return base + extra
}

function Mini({ u }) {
  const [broken, setBroken] = useState(false)
  if (u.image && !broken) return <img className={s.mini} src={u.image} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  return <div className={`${s.mini} ${s.miniInitial}`} aria-hidden="true">{(u.name || u.email || '?').trim()[0].toUpperCase()}</div>
}

// ---------- gate ----------

function Unlock({ email, onDone }) {
  const [code, setCode] = useState('')
  const a = useAction()
  const submit = async (e) => {
    e.preventDefault()
    if (await a.run(() => api('unlock', { code: code.trim() }))) onDone()
    else setCode('')
  }
  return (
    <div className={s.unlockBox}>
      <p className={s.text}>Signed in as {email}. Enter the 6-digit code from your authenticator app to open the admin tools. They stay open on this device for 12 hours, or until you sign out.</p>
      <form className={`${s.form} ph-no-capture`} onSubmit={submit}>
        <Field label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
        <button className={s.primary} disabled={a.busy || code.length !== 6}>Open admin tools</button>
      </form>
      <Notice>{a.error}</Notice>
    </div>
  )
}

// ---------- users ----------

function InviteForm({ onInvited }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(''), [name, setName] = useState(''), [role, setRole] = useState('user')
  const a = useAction()
  const submit = async (e) => {
    e.preventDefault()
    const r = await a.run(() => api('action', { action: 'invite', email: email.trim(), name: name.trim(), role }), `Invite sent to ${email.trim()}.`)
    if (r) { setEmail(''); setName(''); setRole('user'); setOpen(false); onInvited(r.userId) }
  }
  if (!open) return <><button className={s.small} onClick={() => setOpen(true)}>Invite someone…</button><Notice kind="ok">{a.ok}</Notice></>
  return (
    <form className={`${s.panel} ${s.form} ph-no-capture`} onSubmit={submit}>
      <p className={s.text}>They get an email with a link to set their password (or sign in with Google using this address). The link works for 7 days.</p>
      <Field label="Email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      <Field label="Name (optional)" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      <label className={s.field}><span className={s.label}>Role</span>
        <select className={s.select} value={role} onChange={(e) => setRole(e.target.value)}><option value="user">User</option><option value="admin">Administrator</option></select>
      </label>
      <div className={s.inline}>
        <button className={s.small} disabled={a.busy || !email.trim()}>Send invite</button>
        <button type="button" className={s.smallGhost} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <Notice>{a.error}</Notice>
    </form>
  )
}

function UserDetail({ id, meId, onChanged, onGone }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [mode, setMode] = useState(null) // 'name' | 'email' | 'ban' | 'delete'
  const [v1, setV1] = useState(''), [v2, setV2] = useState('')
  const a = useAction()
  const load = useCallback(() => api(`user?id=${encodeURIComponent(id)}`).then(setD).catch((e) => setErr(e.message)), [id])
  useEffect(() => { setD(null); setMode(null); load() }, [load])
  if (err) return <Notice>{err}</Notice>
  if (!d) return <p className={s.meta}>Loading…</p>
  const u = d.user, self = u.id === meId
  const act = async (action, fields, okText) => {
    const r = await a.run(() => api('action', { action, id: u.id, ...fields }), okText)
    if (r) { setMode(null); setV1(''); setV2(''); if (action === 'delete') onGone(); else { load(); onChanged() } }
  }
  const open = (m, a1 = '', a2 = '') => { setMode(m); setV1(a1); setV2(a2) }
  return (
    <div className={s.panel}>
      <div className={s.profileRow}>
        <Mini u={u} />
        <div className={s.grow}>
          <p className={s.name}>{u.name} <Status v={u.status} />{u.role === 'admin' && <span className={s.badge}>Admin</span>}{self && <span className={s.badge}>You</span>}</p>
          <p className={s.meta}>{u.email}{u.emailVerified ? ' · verified' : ' · not verified'} · joined {fmtDate(u.createdAt)}</p>
        </div>
      </div>
      {u.banned && <p className={s.text}><strong>Banned:</strong> {u.banReason}</p>}

      {mode === 'name' && (
        <form className={`${s.inline} ph-no-capture`} onSubmit={(e) => { e.preventDefault(); act('update', { name: v1 }, 'Name saved.') }}>
          <input className={s.input} aria-label="Name" maxLength={100} value={v1} onChange={(e) => setV1(e.target.value)} autoFocus />
          <button className={s.small} disabled={a.busy || !v1.trim()}>Save</button>
          <button type="button" className={s.smallGhost} onClick={() => setMode(null)}>Cancel</button>
        </form>
      )}
      {mode === 'email' && (
        <form className={`${s.form} ph-no-capture`} onSubmit={(e) => { e.preventDefault(); act('changeEmail', { email: v1 }, 'Email changed. A confirmation link went to the new address, and a notice to the old one.') }}>
          <Field label="New email" type="email" autoComplete="off" value={v1} onChange={(e) => setV1(e.target.value)} autoFocus hint="The account is marked unverified until they click the link sent to the new address." />
          <div className={s.inline}><button className={s.small} disabled={a.busy || !v1.trim()}>Change email</button><button type="button" className={s.smallGhost} onClick={() => setMode(null)}>Cancel</button></div>
        </form>
      )}
      {mode === 'ban' && (
        <form className={`${s.form} ph-no-capture`} onSubmit={(e) => { e.preventDefault(); act('ban', { reason: v1 }, 'Banned and signed out everywhere.') }}>
          <Field label="Reason (kept in the audit log)" autoComplete="off" maxLength={500} value={v1} onChange={(e) => setV1(e.target.value)} autoFocus />
          <div className={s.inline}><button className={s.dangerButton} disabled={a.busy || !v1.trim()}>Ban this account</button><button type="button" className={s.smallGhost} onClick={() => setMode(null)}>Cancel</button></div>
        </form>
      )}
      {mode === 'delete' && (
        <form className={`${s.form} ph-no-capture`} onSubmit={(e) => { e.preventDefault(); act('delete', { confirmEmail: v1, password: v2 }, 'Account deleted.') }}>
          <p className={s.text}>Permanently deletes this account, its sign-in methods, passkeys and devices. The audit log keeps its record. This can't be undone.</p>
          <Field label={`Type their email (${u.email}) to confirm`} type="email" autoComplete="off" value={v1} onChange={(e) => setV1(e.target.value)} autoFocus />
          <Field label="Your password" type="password" autoComplete="current-password" value={v2} onChange={(e) => setV2(e.target.value)} />
          <div className={s.inline}><button className={s.dangerButton} disabled={a.busy || v1.trim().toLowerCase() !== u.email.toLowerCase() || !v2}>Delete permanently</button><button type="button" className={s.smallGhost} onClick={() => setMode(null)}>Cancel</button></div>
        </form>
      )}

      {!mode && (
        <div className={s.actions}>
          <button className={s.smallGhost} onClick={() => open('name', u.name)}>Edit name</button>
          {!self && <button className={s.smallGhost} onClick={() => open('email', u.email)}>Change email</button>}
          {!self && (
            <select className={s.select} aria-label="Role" value={u.role} disabled={a.busy}
              onChange={(e) => { if (window.confirm(`Make ${u.email} ${e.target.value === 'admin' ? 'an administrator' : 'a regular user'}?`)) act('update', { role: e.target.value }, 'Role changed.') }}>
              <option value="user">User</option><option value="admin">Administrator</option>
            </select>
          )}
          {u.status === 'unverified' && <button className={s.smallGhost} onClick={() => act('resendVerification', {}, 'Verification email sent.')}>Resend verification</button>}
          {u.status === 'unverified' && <button className={s.smallGhost} onClick={() => { if (window.confirm('Mark this email as verified without the user clicking the link?')) act('update', { emailVerified: true }, 'Marked verified.') }}>Mark verified</button>}
          <button className={s.smallGhost} onClick={() => act('sendReset', {}, u.status === 'invited' ? 'New invite sent.' : 'Password-reset link sent.')}>{u.status === 'invited' ? 'Send new invite' : 'Send reset link'}</button>
          {!self && d.sessions.length > 0 && <button className={s.smallGhost} onClick={() => { if (window.confirm(`Sign ${u.email} out on every device?`)) act('revokeSessions', {}, 'Signed out everywhere.') }}>Sign out everywhere</button>}
          {!self && (u.banned
            ? <button className={s.smallGhost} onClick={() => act('unban', {}, 'Ban lifted.')}>Unban</button>
            : <button className={s.dangerButton} onClick={() => open('ban')}>Ban…</button>)}
          {!self && <button className={s.dangerButton} onClick={() => open('delete')}>Delete…</button>}
        </div>
      )}
      <Notice>{a.error}</Notice><Notice kind="ok">{a.ok}</Notice>

      <dl className={s.dl}>
        <dt>Sign-in methods</dt><dd>{d.methods.length ? d.methods.map((m) => METHOD[m.method] || m.method).join(', ') : 'None yet (invite not accepted)'}{d.passkeys.length ? ` · ${d.passkeys.length} passkey${d.passkeys.length > 1 ? 's' : ''}` : ''}</dd>
        <dt>Two-step</dt><dd>{u.twoFactorEnabled ? 'On' : 'Off'}</dd>
        <dt>Signed in on</dt><dd>{d.sessions.length ? d.sessions.map((x) => `${device(x.userAgent || '')} (${fmtWhen(x.createdAt)})`).join('; ') : 'No devices'}</dd>
      </dl>
      <h3 className={s.label}>Recent activity</h3>
      <ul className={s.list}>
        {d.events.length === 0 && <li className={s.meta}>Nothing yet.</li>}
        {d.events.map((e, i) => (
          <li key={i} className={s.listRow}><span>{eventText(e)}
            {e.actorId && e.actorId !== u.id ? <span className={s.metaBlock}>by {e.actorEmail || 'a deleted admin'}</span> : null}
            {e.targetId && e.targetId !== u.id ? <span className={s.metaBlock}>on {e.targetEmail || e.details?.email || 'a deleted account'}</span> : null}</span><span className={s.meta}>{fmtWhen(e.at)}</span></li>
        ))}
      </ul>
    </div>
  )
}

function UsersTab({ meId }) {
  const [search, setSearch] = useState(''), [status, setStatus] = useState(''), [role, setRole] = useState(''), [page, setPage] = useState(1)
  const [data, setData] = useState(null), [err, setErr] = useState('')
  const [selected, setSelected] = useState(null)
  const load = useCallback(() => {
    const p = new URLSearchParams({ search, status, role, page: String(page) })
    return api(`users?${p}`).then((j) => { setData(j); setErr('') }).catch((e) => setErr(e.message))
  }, [search, status, role, page])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  return (
    <>
      <div className={s.toolbar}>
        <input className={s.input} type="search" placeholder="Search name or email" aria-label="Search users" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        <select className={s.select} aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={s.select} aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }}>
          <option value="">All roles</option><option value="user">Users</option><option value="admin">Administrators</option>
        </select>
      </div>
      <div className={s.mt8} style={{ marginBottom: 16 }}><InviteForm onInvited={(uid) => { load(); setSelected(uid) }} /></div>
      <Notice>{err}</Notice>
      <div className={s.split}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th></th><th>Name</th><th>Status</th><th>Joined</th><th>Last sign-in</th></tr></thead>
            <tbody>
              {data?.users.map((u) => (
                <tr key={u.id} className={`${s.rowLink} ${selected === u.id ? s.rowOn : ''}`} onClick={() => setSelected(u.id)}>
                  <td><Mini u={u} /></td>
                  <td>{u.name}{u.role === 'admin' && <span className={s.badge}>Admin</span>}<span className={s.metaBlock}>{u.email}</span></td>
                  <td><Status v={u.status} /></td>
                  <td>{fmtDate(u.createdAt)}</td>
                  <td>{u.lastSignIn ? fmtWhen(u.lastSignIn) : '—'}</td>
                </tr>
              ))}
              {data && data.users.length === 0 && <tr><td colSpan={5} className={s.meta}>No accounts match.</td></tr>}
            </tbody>
          </table>
          {data && <div className={s.pager}>
            <span>{data.total} account{data.total === 1 ? '' : 's'}</span>
            {pages > 1 && <><button className={s.link} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className={s.link} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></>}
          </div>}
        </div>
        <div>{selected ? <UserDetail id={selected} meId={meId} onChanged={load} onGone={() => { setSelected(null); load() }} /> : <p className={s.meta}>Pick an account to see details and actions.</p>}</div>
      </div>
    </>
  )
}

function AuditTab() {
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null), [err, setErr] = useState('')
  useEffect(() => { api(`audit?page=${page}`).then(setData).catch((e) => setErr(e.message)) }, [page])
  return (
    <>
      <p className={s.text}>Every admin action and account security event. This log can't be edited or deleted.</p>
      <Notice>{err}</Notice>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th>When</th><th>What</th><th>Account</th><th>By</th><th>IP</th></tr></thead>
          <tbody>
            {data?.events.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtWhen(e.at)}</td>
                <td>{eventText(e)}</td>
                <td>{e.targetEmail || (e.targetId ? (e.details?.email || 'deleted account') : e.details?.account === 'none' ? 'no such account' : '—')}</td>
                <td>{e.actorId ? (e.actorId === e.targetId ? 'self' : e.actorEmail || 'deleted account') : '—'}</td>
                <td>{e.ip && !/^[0:.]*1?$|^127\./.test(e.ip) ? e.ip : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <div className={s.pager}>
        <button className={s.link} disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
        <span>Page {page}</span>
        <button className={s.link} disabled={data.events.length < data.pageSize} onClick={() => setPage(page + 1)}>Older</button>
      </div>}
    </>
  )
}

const TOPIC = { question: 'Question', data: 'Data problem', bug: 'Something broken', partner: 'Working together', account: 'Account', other: 'Other' }
const REASON = {
  links: 'more than 2 links', markup: 'link code', pitch: 'sales/spam wording', 'link-in-name': 'link in the name', caps: 'mostly capitals',
  'daily-cap': 'over the 20-a-day limit', honeypot: 'filled the hidden bot field', 'form-too-fast': 'sent too fast', 'form-missing': 'no form timer',
  'form-bad-signature': 'faked form timer', 'form-expired': 'form open over 2 hours',
}
const VERDICT = [['held', 'Held as spam'], ['accepted', 'Delivered'], ['bot', 'Bots']]
const VERDICT_HELP = {
  held: 'Messages that got past the bot checks but looked like spam, so they were not emailed. Deliver any that are real. Deleted automatically after 90 days.',
  accepted: 'Messages emailed to the contact address. Deleted automatically after a year.',
  bot: 'Submissions caught by the bot traps (only the first 500 characters are kept). Deleted automatically after 30 days.',
}

function MessagesTab() {
  const [verdict, setVerdict] = useState('held')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null), [err, setErr] = useState('')
  const a = useAction()
  const load = useCallback(() => api(`messages?verdict=${verdict}&page=${page}`).then((j) => { setData(j); setErr('') }).catch((e) => setErr(e.message)), [verdict, page])
  useEffect(() => { load() }, [load])
  const act = async (action, m, okText) => { if (await a.run(() => api('action', { action, id: m.id }), okText)) load() }
  return (
    <>
      <div className={s.toolbar}>
        {VERDICT.map(([v, l]) => (
          <button key={v} className={`${s.tab} ${verdict === v ? s.tabOn : ''}`} onClick={() => { setVerdict(v); setPage(1) }}>{l} ({data?.counts?.[v] || 0})</button>
        ))}
      </div>
      <p className={s.meta}>{VERDICT_HELP[verdict]}</p>
      <Notice>{err || a.error}</Notice>
      <Notice kind="ok">{a.ok}</Notice>
      {data && !data.messages.length && <p className={s.text}>No messages here.</p>}
      {data?.messages.map((m) => (
        <article key={m.id} className={s.msg}>
          <div className={s.msgHead}>
            <strong>{m.name}</strong> <span className={s.meta}>&lt;{m.email}&gt; · {TOPIC[m.topic] || m.topic} · {fmtWhen(m.at)} · #{m.id}</span>
          </div>
          {m.reasons?.length > 0 && <p className={s.msgWhy}>Why: {m.reasons.map((r) => REASON[r] || r).join(', ')}</p>}
          <p className={s.msgBody}>{m.message}</p>
          <div className={s.actions}>
            {m.verdict !== 'accepted' && <button className={s.small} disabled={a.busy} onClick={() => act('releaseMessage', m, 'Delivered to the contact inbox.')}>Deliver it</button>}
            <a className={s.smallGhost} href={`mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent('Re: your message to EarthAtlas')}`}>Reply</a>
            <button className={s.dangerButton} disabled={a.busy} onClick={() => { if (window.confirm(`Delete message #${m.id} from ${m.email}? This can't be undone.`)) act('deleteMessage', m, 'Message deleted.') }}>Delete</button>
          </div>
        </article>
      ))}
      {data && (data.page > 1 || data.messages.length === data.pageSize) && <div className={s.pager}>
        <button className={s.link} disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
        <span>Page {page}</span>
        <button className={s.link} disabled={data.messages.length < data.pageSize} onClick={() => setPage(page + 1)}>Older</button>
      </div>}
    </>
  )
}

// ---------- page ----------

export default function AdminUsersPage() {
  const [st, setSt] = useState(null)
  const [tab, setTab] = useState('users')
  const [meId, setMeId] = useState(null)
  // Remember this browser has an admin, so map pages offer "Edit panel" (src/lib/siteContent.js)
  const refresh = useCallback(() => api('status').then((x) => { rememberAdmin(['locked', 'unlocked', 'needs-2fa'].includes(x.state)); setSt(x) }).catch(() => setSt({ state: 'error' })), [])
  useEffect(() => { document.title = 'Users · EarthAtlas admin'; refresh() }, [refresh])
  useEffect(() => { if (st?.state === 'unlocked') fetch('/api/auth/get-session', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => setMeId(j?.user?.id || null)) }, [st?.state])
  const lockNow = async () => { await api('lock', {}).catch(() => {}); refresh() }

  let body
  if (!st) body = <p className={s.text}>Loading…</p>
  else if (st.state === 'signed-out') body = <p className={s.text}>Admin tools need an EarthAtlas admin account. <a href="/account/signin">Sign in</a>, then come back to this page.</p>
  else if (st.state === 'not-admin') body = <p className={s.text}>This page is for EarthAtlas administrators only.</p>
  else if (st.state === 'needs-2fa') body = <p className={s.text}>Admin tools need two-step verification. Turn it on under <a href="/account">Your account → Two-step verification</a>, then come back.</p>
  else if (st.state === 'locked') body = <Unlock email={st.email} onDone={refresh} />
  else if (st.state === 'unlocked') {
    body = (
      <>
        <div className={s.tabs} role="tablist">
          <button role="tab" className={`${s.tab} ${tab === 'users' ? s.tabOn : ''}`} onClick={() => setTab('users')}>Users</button>
          <button role="tab" className={`${s.tab} ${tab === 'messages' ? s.tabOn : ''}`} onClick={() => setTab('messages')}>Messages</button>
          <button role="tab" className={`${s.tab} ${tab === 'audit' ? s.tabOn : ''}`} onClick={() => setTab('audit')}>Audit log</button>
        </div>
        {tab === 'users' ? <UsersTab meId={meId} /> : tab === 'messages' ? <MessagesTab /> : <AuditTab />}
      </>
    )
  } else body = <Notice>Couldn't reach the server. Reload to try again.</Notice>

  return (
    <main className={s.page}>
      <div className={`${s.card} ${s.adminCard}`}>
        <div className={s.topRow}>
          <a href="/" className={s.brand}>EarthAtlas</a>
          <span className={s.meta}>
            <a href="/account" className={s.link}>Your account</a>
            {st?.state === 'unlocked' && <> · Open until {fmtWhen(st.unlockedUntil)} · <button className={s.link} onClick={lockNow}>Lock</button></>}
          </span>
        </div>
        <h1 className={s.title}>Users</h1>
        <div>{body}</div>
      </div>
      <div className={`${s.credit} ${s.creditAdmin}`}><BuiltByCredit variant="light" /></div>
    </main>
  )
}
