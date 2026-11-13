import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ACCOUNTS_LIVE } from '../accounts/live.js'
import { rememberAdmin } from '../lib/siteContent.js'
import { handoffUrl, hostKind, mainOrigin } from '../accounts/crossSite.js'
import s from './AccountAvatar.module.css'

/**
 * The signed-in person's avatar, top right on every EarthAtlas page and partner host (Josh 2026-11-09: "how would I
 * know if I'm logged in?"). Their photo, else their initials on a color picked from their name. Click → menu:
 * name + email, Your account, Admin (admins), Sign out.
 *
 * Visitors cost nothing: the session is only looked up when the `earthatlas.signed_in` hint cookie is there (set and
 * cleared with the session cookie by api/auth.js), or on the account / admin pages. While shown, <html> carries
 * `ea-signed-in`, which moves every site's right-edge controls down by --ea-avatar-inset (src/index.css).
 */
const HINT = 'earthatlas.signed_in'
const hasHint = () => document.cookie.split(';').some((c) => c.trim().startsWith(`${HINT}=1`))
function dropHint() {
  // The server sets it on .earthatlas.org in production; clear both forms
  const base = `${HINT}=; Path=/; Max-Age=0; SameSite=Lax`
  document.cookie = base
  if (/(^|\.)earthatlas\.org$/.test(window.location.hostname)) document.cookie = `${base}; Domain=earthatlas.org`
}
// Account pages live on earthatlas.org; subdomains (sanjuans.earthatlas.org) and partner domains link there
const accountBase = () => mainOrigin()

// Partner domains (explore.sanjuans.org) have their own cookie, made by a handoff from earthatlas.org
// (src/accounts/crossSite.js). A signed-out visit with ?edit or ?signin in the URL starts that handoff; if it
// comes back still signed out (no earthatlas.org sign-in finished), don't bounce again for a minute.
const HANDOFF_TRIED = 'ea-handoff-tried'
// The address as the page loaded: map pages rewrite their query string (dropping ?edit) on mount, before this runs
const LOAD_HREF = typeof window !== 'undefined' ? window.location.href : ''
const asksSignIn = (href) => {
  if (hostKind() !== 'partner') return false
  const q = new URL(href).searchParams
  return q.has('edit') || q.has('signin')
}
function firstTryThisMinute() {
  try {
    if (Date.now() - Number(sessionStorage.getItem(HANDOFF_TRIED) || 0) < 60_000) return false
    sessionStorage.setItem(HANDOFF_TRIED, String(Date.now()))
  } catch { /* storage blocked: still try once per page load */ }
  return true
}

export function initialsOf(user) {
  const name = (user?.name || '').trim()
  const words = name.split(/\s+/).filter((w) => /\p{L}/u.test(w))
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (user?.email || '?').slice(0, 1).toUpperCase()
}
const HUES = ['#0f766e', '#1d4ed8', '#7c3aed', '#b45309', '#be123c', '#047857', '#4338ca', '#a21caf']
function colorOf(user) {
  const k = user?.email || user?.name || ''
  let h = 0
  for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return HUES[h % HUES.length]
}

export default function AccountAvatar() {
  const { pathname } = useLocation()
  const [user, setUser] = useState(null)
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState(false)
  const boxRef = useRef(null)
  const accountPage = /^\/(account|admin)(\/|$)/.test(pathname)
  // Story pages (src/stories) show only the story: no avatar (Josh 2026-11-12)
  const storyPage = /^\/[^/]+\/stories(\/|$)/.test(pathname)

  useEffect(() => {
    if (!ACCOUNTS_LIVE) return
    const startHref = new URL(LOAD_HREF).pathname === pathname ? LOAD_HREF : window.location.href
    const askHandoff = asksSignIn(startHref)
    if (!hasHint() && !accountPage && !askHandoff) { setUser(null); return }
    let live = true
    fetch('/api/auth/get-session', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => {
        if (!live) return
        const u = j?.user || null
        if (!u && hasHint()) dropHint()
        if (!u && askHandoff && firstTryThisMinute()) { window.location.replace(handoffUrl(startHref)); return }
        if (u?.role === 'admin') rememberAdmin(true)
        setUser(u)
      })
    return () => { live = false }
  }, [pathname, accountPage])

  // The right-edge controls make room while the avatar shows
  useEffect(() => {
    document.documentElement.classList.toggle('ea-signed-in', !!user)
    return () => document.documentElement.classList.remove('ea-signed-in')
  }, [user])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const down = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key) }
  }, [open])

  if (!user || storyPage) return null
  const base = accountBase()
  const signOut = async () => {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
    dropHint()
    setUser(null)
    setOpen(false)
    if (accountPage) window.location.href = '/'
  }
  const label = user.name || user.email
  return (
    <div className={s.box} ref={boxRef}>
      <button type="button" className={s.avatar} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Signed in as ${label}. Account menu`} title={`Signed in as ${label}`}
        style={user.image && !broken ? undefined : { background: colorOf(user) }}>
        {user.image && !broken
          ? <img src={user.image} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
          : <span>{initialsOf(user)}</span>}
      </button>
      {open && (
        <div className={s.menu} role="menu">
          <div className={s.who}>
            <div className={s.name}>{user.name || 'Signed in'}</div>
            <div className={s.email}>{user.email}</div>
          </div>
          <a className={s.item} role="menuitem" href={`${base}/account`}>Your account</a>
          {user.role === 'admin' && <a className={s.item} role="menuitem" href={`${base}/admin/users`}>Admin: users</a>}
          <button type="button" className={s.item} role="menuitem" onClick={signOut}>Sign out</button>
        </div>
      )}
    </div>
  )
}
