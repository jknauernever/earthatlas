import { useState, useEffect, useCallback } from 'react'
import styles from './AdminApp.module.css'

const SPECIES = [
  'sharks','whales','dolphins','birds','butterflies','bears',
  'condors','elephants','fungi','hippos','lions','monkeys',
  'sloths','tigers','wolves',
]

export default function AdminApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem('admin_token') || '')
  const [authed, setAuthed] = useState(false)
  const [tab, setTab] = useState('feeds')

  const login = (e) => {
    e.preventDefault()
    sessionStorage.setItem('admin_token', token)
    setAuthed(true)
  }

  // Quick auth check
  useEffect(() => {
    if (!token) return
    fetch('/api/admin/feeds', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.ok) setAuthed(true) })
      .catch(() => {})
  }, [])

  if (!authed) {
    return (
      <div className={styles.page}>
        <div className={styles.loginBox}>
          <h1>EarthAtlas Admin</h1>
          <form onSubmit={login}>
            <input
              type="password"
              placeholder="Admin secret"
              value={token}
              onChange={e => setToken(e.target.value)}
              className={styles.input}
              autoFocus
            />
            <button type="submit" className={styles.btnPrimary}>Sign in</button>
          </form>
        </div>
      </div>
    )
  }

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

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
        </header>

        {tab === 'feeds' && <FeedsPanel headers={headers} />}
        {tab === 'articles' && <ArticlesPanel headers={headers} />}
        {tab === 'keys' && <KeysPanel headers={headers} />}
        {tab === 'pipeline' && <PipelinePanel headers={headers} />}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Feeds Panel
   ═══════════════════════════════════════════════════════════════════════════════ */

function FeedsPanel({ headers }) {
  const [feeds, setFeeds] = useState([])
  const [loading, setLoading] = useState(true)
  const [species, setSpecies] = useState('')
  const [form, setForm] = useState({ speciesSlug: '', name: '', url: '' })
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    const q = species ? `?species=${species}` : ''
    fetch(`/api/admin/feeds${q}`, { headers })
      .then(r => r.json())
      .then(d => setFeeds(d.feeds || []))
      .finally(() => setLoading(false))
  }, [species, headers])

  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    await fetch('/api/admin/feeds', { method: 'POST', headers, body: JSON.stringify(form) })
    setForm({ speciesSlug: '', name: '', url: '' })
    setShowForm(false)
    load()
  }

  const toggle = async (feed) => {
    await fetch('/api/admin/feeds', {
      method: 'PUT', headers,
      body: JSON.stringify({ id: feed.id, enabled: !feed.enabled }),
    })
    load()
  }

  const remove = async (id) => {
    if (!confirm('Delete this feed?')) return
    await fetch(`/api/admin/feeds?id=${id}`, { method: 'DELETE', headers })
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
                <td className={styles.muted}>{f.last_fetched ? new Date(f.last_fetched).toLocaleString() : 'Never'}</td>
                <td>
                  <button className={styles.btnDanger} onClick={() => remove(f.id)}>Delete</button>
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

function ArticlesPanel({ headers }) {
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [species, setSpecies] = useState('sharks')
  const [status, setStatus] = useState('published')

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/admin/articles?species=${species}&status=${status}&limit=50`, { headers })
      .then(r => r.json())
      .then(d => setArticles(d.articles || []))
      .finally(() => setLoading(false))
  }, [species, status, headers])

  useEffect(() => { load() }, [load])

  const changeStatus = async (id, newStatus) => {
    await fetch('/api/admin/articles', {
      method: 'PATCH', headers,
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

function KeysPanel({ headers }) {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/admin/keys', { headers })
      .then(r => r.json())
      .then(d => setKeys(d.keys || []))
      .finally(() => setLoading(false))
  }, [headers])

  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    await fetch('/api/admin/keys', {
      method: 'POST', headers,
      body: JSON.stringify({ name: newName }),
    })
    setNewName('')
    load()
  }

  const toggle = async (key) => {
    await fetch('/api/admin/keys', {
      method: 'PUT', headers,
      body: JSON.stringify({ id: key.id, enabled: !key.enabled }),
    })
    load()
  }

  const remove = async (id) => {
    if (!confirm('Revoke this API key? This cannot be undone.')) return
    await fetch(`/api/admin/keys?id=${id}`, { method: 'DELETE', headers })
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

function PipelinePanel({ headers }) {
  const [species, setSpecies] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

  const run = async () => {
    setRunning(true)
    setResult(null)
    const q = species ? `?species=${species}` : ''
    try {
      const res = await fetch(`/api/news/process${q}`, { method: 'POST', headers })
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
