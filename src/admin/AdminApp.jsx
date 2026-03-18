import { useState, useEffect, useCallback } from 'react'
import styles from './AdminApp.module.css'

const SPECIES = [
  'sharks','whales','dolphins','birds','butterflies','bears',
  'condors','elephants','fungi','hippos','lions','monkeys',
  'sloths','tigers','wolves',
]

// All admin API calls use credentials so the browser sends the session cookie
const apiFetch = (url, opts = {}) =>
  fetch(url, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })

export default function AdminApp() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState('feeds')

  // Check for existing session on mount
  useEffect(() => {
    fetch('/api/admin/session', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => { if (d.authenticated) setAuthed(true) })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  const login = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (res.ok) {
        setAuthed(true)
        setPassword('')
      } else {
        setError(data.error || 'Login failed')
      }
    } catch {
      setError('Network error')
    }
  }

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
    setAuthed(false)
    setUsername('')
  }

  if (checking) {
    return <div className={styles.page}><div className={styles.loginBox}><p className={styles.muted}>Loading...</p></div></div>
  }

  if (!authed) {
    return (
      <div className={styles.page}>
        <div className={styles.loginBox}>
          <h1>EarthAtlas Admin</h1>
          <form onSubmit={login}>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className={styles.input}
              autoFocus
              autoComplete="username"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={styles.input}
              autoComplete="current-password"
            />
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.btnPrimary}>Sign in</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>EarthAtlas Admin</h1>
          <nav className={styles.tabs}>
            {['feeds', 'articles', 'keys', 'pipeline'].map(t => (
              <button
                key={t}
                className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
                onClick={() => setTab(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>
          <button className={styles.btnDanger} onClick={logout}>Logout</button>
        </header>

        {tab === 'feeds' && <FeedsPanel />}
        {tab === 'articles' && <ArticlesPanel />}
        {tab === 'keys' && <KeysPanel />}
        {tab === 'pipeline' && <PipelinePanel />}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Feeds Panel
   ═══════════════════════════════════════════════════════════════════════════════ */

function FeedsPanel() {
  const [feeds, setFeeds] = useState([])
  const [loading, setLoading] = useState(true)
  const [species, setSpecies] = useState('')
  const [form, setForm] = useState({ speciesSlug: '', name: '', url: '' })
  const [showForm, setShowForm] = useState(false)
  const [processing, setProcessing] = useState({}) // feedId → true while updating
  const [updatingAll, setUpdatingAll] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    const q = species ? `?species=${species}` : ''
    apiFetch(`/api/admin/feeds${q}`)
      .then(r => r.json())
      .then(d => setFeeds(d.feeds || []))
      .finally(() => setLoading(false))
  }, [species])

  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    await apiFetch('/api/admin/feeds', { method: 'POST', body: JSON.stringify(form) })
    setForm({ speciesSlug: '', name: '', url: '' })
    setShowForm(false)
    load()
  }

  const toggle = async (feed) => {
    await apiFetch('/api/admin/feeds', {
      method: 'PUT',
      body: JSON.stringify({ id: feed.id, enabled: !feed.enabled }),
    })
    load()
  }

  const remove = async (id) => {
    if (!confirm('Delete this feed?')) return
    await apiFetch(`/api/admin/feeds?id=${id}`, { method: 'DELETE' })
    load()
  }

  const updateFeed = async (feedId) => {
    setProcessing(p => ({ ...p, [feedId]: true }))
    try {
      await apiFetch(`/api/news/process?feed=${feedId}`, { method: 'POST' })
    } catch {}
    setProcessing(p => ({ ...p, [feedId]: false }))
    load()
  }

  const updateAll = async () => {
    setUpdatingAll(true)
    const q = species ? `?species=${species}` : ''
    try {
      await apiFetch(`/api/news/dispatch${q}`, { method: 'POST' })
    } catch {}
    setUpdatingAll(false)
    load()
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <h2>RSS Feeds</h2>
        <select value={species} onChange={e => setSpecies(e.target.value)} className={styles.select}>
          <option value="">All species</option>
          {SPECIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className={styles.btnPrimary} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Feed'}
        </button>
        <button className={styles.btnPrimary} onClick={updateAll} disabled={updatingAll}>
          {updatingAll ? 'Updating...' : 'Update Feeds'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={create} className={styles.formRow}>
          <select
            value={form.speciesSlug}
            onChange={e => setForm(f => ({ ...f, speciesSlug: e.target.value }))}
            className={styles.select}
            required
          >
            <option value="">Species...</option>
            {SPECIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            placeholder="Feed name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className={styles.input}
            required
          />
          <input
            placeholder="RSS URL"
            value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            className={styles.input}
            style={{ flex: 2 }}
            required
          />
          <button type="submit" className={styles.btnPrimary}>Create</button>
        </form>
      )}

      {loading ? (
        <p className={styles.muted}>Loading...</p>
      ) : feeds.length === 0 ? (
        <p className={styles.muted}>No feeds found. Add one above.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr><th>Species</th><th>Name</th><th>URL</th><th>Status</th><th>Last Fetched</th><th></th></tr>
          </thead>
          <tbody>
            {feeds.map(f => (
              <tr key={f.id}>
                <td><span className={styles.badge}>{f.species_slug}</span></td>
                <td>{f.name}</td>
                <td className={styles.urlCell}>{f.url}</td>
                <td>
                  <button
                    className={`${styles.statusBtn} ${f.enabled ? styles.statusOn : styles.statusOff}`}
                    onClick={() => toggle(f)}
                  >
                    {f.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </td>
                <td className={styles.muted}>
                  {processing[f.id] ? 'Updating...' : f.last_fetched ? new Date(f.last_fetched).toLocaleString() : 'Never'}
                </td>
                <td>
                  <div className={styles.rowActions}>
                    <button className={styles.btnSmall} onClick={() => updateFeed(f.id)} disabled={processing[f.id]}>
                      {processing[f.id] ? 'Updating...' : 'Update'}
                    </button>
                    <button className={styles.btnDanger} onClick={() => remove(f.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Articles Panel
   ═══════════════════════════════════════════════════════════════════════════════ */

function ArticlesPanel() {
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [species, setSpecies] = useState('sharks')
  const [status, setStatus] = useState('published')

  const load = useCallback(() => {
    setLoading(true)
    apiFetch(`/api/admin/articles?species=${species}&status=${status}&limit=50`)
      .then(r => r.json())
      .then(d => setArticles(d.articles || []))
      .finally(() => setLoading(false))
  }, [species, status])

  useEffect(() => { load() }, [load])

  const changeStatus = async (id, newStatus) => {
    await apiFetch('/api/admin/articles', {
      method: 'PATCH',
      body: JSON.stringify({ id, status: newStatus }),
    })
    load()
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <h2>Articles</h2>
        <select value={species} onChange={e => setSpecies(e.target.value)} className={styles.select}>
          {SPECIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className={styles.select}>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {loading ? (
        <p className={styles.muted}>Loading...</p>
      ) : articles.length === 0 ? (
        <p className={styles.muted}>No {status} articles for {species}.</p>
      ) : (
        <div className={styles.articleList}>
          {articles.map(a => (
            <div key={a.id} className={styles.articleRow}>
              {a.image_url && (
                <img src={a.image_url} alt="" className={styles.articleThumb} />
              )}
              <div className={styles.articleInfo}>
                <a
                  href={`/news/${a.species_slug}/${a.slug}`}
                  target="_blank"
                  rel="noopener"
                  className={styles.articleTitle}
                >
                  {a.title}
                </a>
                <div className={styles.articleMeta}>
                  <span>{a.source_name}</span>
                  {a.pub_date && <span>{new Date(a.pub_date).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className={styles.articleActions}>
                {status !== 'published' && (
                  <button className={styles.btnSmall} onClick={() => changeStatus(a.id, 'published')}>Publish</button>
                )}
                {status !== 'draft' && (
                  <button className={styles.btnSmall} onClick={() => changeStatus(a.id, 'draft')}>Draft</button>
                )}
                {status !== 'rejected' && (
                  <button className={styles.btnSmallDanger} onClick={() => changeStatus(a.id, 'rejected')}>Reject</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   API Keys Panel
   ═══════════════════════════════════════════════════════════════════════════════ */

function KeysPanel() {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    apiFetch('/api/admin/keys')
      .then(r => r.json())
      .then(d => setKeys(d.keys || []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    await apiFetch('/api/admin/keys', {
      method: 'POST',
      body: JSON.stringify({ name: newName }),
    })
    setNewName('')
    load()
  }

  const toggle = async (key) => {
    await apiFetch('/api/admin/keys', {
      method: 'PUT',
      body: JSON.stringify({ id: key.id, enabled: !key.enabled }),
    })
    load()
  }

  const remove = async (id) => {
    if (!confirm('Revoke this API key? This cannot be undone.')) return
    await apiFetch(`/api/admin/keys?id=${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <h2>API Keys</h2>
      </div>

      <form onSubmit={create} className={styles.formRow}>
        <input
          placeholder="Key name (e.g. Partner App)"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          className={styles.input}
          required
        />
        <button type="submit" className={styles.btnPrimary}>Generate Key</button>
      </form>

      {loading ? (
        <p className={styles.muted}>Loading...</p>
      ) : keys.length === 0 ? (
        <p className={styles.muted}>No API keys. Create one above.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr><th>Name</th><th>Key</th><th>Status</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td><code className={styles.keyCode}>{k.key}</code></td>
                <td>
                  <button
                    className={`${styles.statusBtn} ${k.enabled ? styles.statusOn : styles.statusOff}`}
                    onClick={() => toggle(k)}
                  >
                    {k.enabled ? 'Active' : 'Revoked'}
                  </button>
                </td>
                <td className={styles.muted}>{new Date(k.created_at).toLocaleDateString()}</td>
                <td>
                  <button className={styles.btnDanger} onClick={() => remove(k.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Pipeline Panel
   ═══════════════════════════════════════════════════════════════════════════════ */

function PipelinePanel() {
  const [species, setSpecies] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

  const run = async () => {
    setRunning(true)
    setResult(null)
    const q = species ? `?species=${species}` : ''
    try {
      const res = await apiFetch(`/api/news/process${q}`, { method: 'POST' })
      const data = await res.json()
      setResult(data)
    } catch (err) {
      setResult({ error: err.message })
    } finally {
      setRunning(false)
    }
  }

  return (
    <section>
      <div className={styles.sectionHeader}>
        <h2>Processing Pipeline</h2>
      </div>

      <p className={styles.muted}>
        Manually trigger the news processing pipeline. This fetches RSS feeds, AI-rewrites new articles,
        resolves images, and stores them in the database. Normally runs automatically every 2 hours via cron.
      </p>

      <div className={styles.formRow}>
        <select value={species} onChange={e => setSpecies(e.target.value)} className={styles.select}>
          <option value="">All species</option>
          {SPECIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className={styles.btnPrimary} onClick={run} disabled={running}>
          {running ? 'Running...' : 'Run Pipeline'}
        </button>
      </div>

      {result && (
        <pre className={styles.resultBox}>{JSON.stringify(result, null, 2)}</pre>
      )}
    </section>
  )
}
