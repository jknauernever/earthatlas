import { useState, useEffect, useCallback } from 'react'
import styles from './AdminApp.module.css'

const SPECIES = [
  'general',
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
            {['feeds', 'articles', 'keywords', 'keys', 'pipeline'].map(t => (
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
        {tab === 'keywords' && <KeywordsPanel />}
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
  const [feedStatus, setFeedStatus] = useState({}) // feedId → { ok, message }

  // silent=true skips the loading spinner so the table doesn't flash
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true)
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
    load(true)
  }

  const toggle = async (feed) => {
    await apiFetch('/api/admin/feeds', {
      method: 'PUT',
      body: JSON.stringify({ id: feed.id, enabled: !feed.enabled }),
    })
    load(true)
  }

  const remove = async (id) => {
    if (!confirm('Delete this feed?')) return
    await apiFetch(`/api/admin/feeds?id=${id}`, { method: 'DELETE' })
    load(true)
  }

  const updateFeed = async (feedId) => {
    setProcessing(p => ({ ...p, [feedId]: true }))
    setFeedStatus(s => ({ ...s, [feedId]: null }))
    try {
      const res = await apiFetch(`/api/news/process?feed=${feedId}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setFeedStatus(s => ({ ...s, [feedId]: { ok: false, message: data.error || `Error ${res.status}` } }))
      } else {
        setFeedStatus(s => ({ ...s, [feedId]: { ok: true, message: `${data.processed || 0} new, ${data.skipped || 0} skipped` } }))
      }
    } catch (err) {
      setFeedStatus(s => ({ ...s, [feedId]: { ok: false, message: err.message || 'Request failed' } }))
    }
    setProcessing(p => ({ ...p, [feedId]: false }))
    load(true)
  }

  const [dispatchStatus, setDispatchStatus] = useState(null) // { ok, message }
  const [polling, setPolling] = useState(false)

  // Poll feed list every 5s while dispatch is active so Last Fetched updates live
  useEffect(() => {
    if (!polling) return
    const id = setInterval(() => load(true), 5000)
    return () => clearInterval(id)
  }, [polling, load])

  const updateAll = async () => {
    setUpdatingAll(true)
    setDispatchStatus({ ok: true, message: 'Dispatching feeds...' })
    const q = species ? `?species=${species}` : ''
    try {
      const res = await apiFetch(`/api/news/dispatch${q}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setDispatchStatus({ ok: false, message: data.error || `Error ${res.status}` })
      } else {
        setDispatchStatus({ ok: true, message: `Dispatched ${data.dispatched} feeds — updating live...` })
        // Start polling — stop after 2 minutes (workers should be done by then)
        setPolling(true)
        setTimeout(() => {
          setPolling(false)
          setDispatchStatus(s => s?.ok ? { ok: true, message: `Dispatched ${data.dispatched} feeds — done` } : s)
        }, 120_000)
      }
    } catch (err) {
      setDispatchStatus({ ok: false, message: err.message || 'Request failed' })
    }
    setUpdatingAll(false)
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
          {updatingAll ? 'Dispatching...' : 'Update Feeds'}
        </button>
        {dispatchStatus && (
          <span className={dispatchStatus.ok ? styles.statusOk : styles.statusErr}>
            {dispatchStatus.message}
          </span>
        )}
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
                  {processing[f.id]
                    ? 'Updating...'
                    : feedStatus[f.id]
                      ? <span className={feedStatus[f.id].ok ? styles.statusOk : styles.statusErr}>{feedStatus[f.id].message}</span>
                      : f.last_fetched ? new Date(f.last_fetched).toLocaleString() : 'Never'}
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
   Keywords Panel
   ═══════════════════════════════════════════════════════════════════════════════ */

function KeywordsPanel() {
  const [keywords, setKeywords] = useState([])
  const [grouped, setGrouped] = useState({})
  const [loading, setLoading] = useState(true)
  const [species, setSpecies] = useState('')
  const [form, setForm] = useState({ speciesSlug: '', keyword: '' })
  const [suggesting, setSuggesting] = useState({}) // slug → true while loading
  const [suggestions, setSuggestions] = useState({}) // slug → ['kw1', 'kw2', ...]

  const load = useCallback(() => {
    setLoading(true)
    apiFetch('/api/admin/keywords')
      .then(r => r.json())
      .then(d => {
        setKeywords(d.keywords || [])
        setGrouped(d.grouped || {})
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const add = async (e) => {
    e.preventDefault()
    if (!form.speciesSlug || !form.keyword.trim()) return
    await apiFetch('/api/admin/keywords', {
      method: 'POST',
      body: JSON.stringify(form),
    })
    setForm(f => ({ ...f, keyword: '' }))
    load()
  }

  const remove = async (id) => {
    await apiFetch(`/api/admin/keywords?id=${id}`, { method: 'DELETE' })
    load()
  }

  const suggest = async (slug) => {
    setSuggesting(s => ({ ...s, [slug]: true }))
    try {
      const res = await apiFetch(`/api/admin/keywords?species=${slug}`, { method: 'PUT' })
      const data = await res.json()
      setSuggestions(s => ({ ...s, [slug]: data.suggestions || [] }))
    } catch {
      setSuggestions(s => ({ ...s, [slug]: [] }))
    }
    setSuggesting(s => ({ ...s, [slug]: false }))
  }

  const acceptSuggestion = async (slug, keyword) => {
    await apiFetch('/api/admin/keywords', {
      method: 'POST',
      body: JSON.stringify({ speciesSlug: slug, keyword }),
    })
    // Remove from suggestions list
    setSuggestions(s => ({
      ...s,
      [slug]: (s[slug] || []).filter(k => k !== keyword),
    }))
    load()
  }

  const dismissSuggestion = (slug, keyword) => {
    setSuggestions(s => ({
      ...s,
      [slug]: (s[slug] || []).filter(k => k !== keyword),
    }))
  }

  const acceptAll = async (slug) => {
    const items = suggestions[slug] || []
    for (const keyword of items) {
      await apiFetch('/api/admin/keywords', {
        method: 'POST',
        body: JSON.stringify({ speciesSlug: slug, keyword }),
      })
    }
    setSuggestions(s => ({ ...s, [slug]: [] }))
    load()
  }

  // Filter species to show (exclude 'general' — it's not a target category)
  const KEYWORD_SPECIES = SPECIES.filter(s => s !== 'general')
  const displaySpecies = species
    ? KEYWORD_SPECIES.filter(s => s === species)
    : KEYWORD_SPECIES

  return (
    <section>
      <div className={styles.sectionHeader}>
        <h2>Species Keywords</h2>
        <select value={species} onChange={e => setSpecies(e.target.value)} className={styles.select}>
          <option value="">All species</option>
          {KEYWORD_SPECIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <p className={styles.muted}>
        Map related terms to species categories. These keywords help the AI classify articles from general news feeds
        (Reuters, AP, BBC, etc.) into the correct species pages.
      </p>

      <form onSubmit={add} className={styles.formRow}>
        <select
          value={form.speciesSlug}
          onChange={e => setForm(f => ({ ...f, speciesSlug: e.target.value }))}
          className={styles.select}
          required
        >
          <option value="">Species...</option>
          {KEYWORD_SPECIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          placeholder="Keyword (e.g. mushroom, spores, mycelium)"
          value={form.keyword}
          onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
          className={styles.input}
          required
        />
        <button type="submit" className={styles.btnPrimary}>Add</button>
      </form>

      {loading ? (
        <p className={styles.muted}>Loading...</p>
      ) : (
        <div className={styles.keywordGrid}>
          {displaySpecies.map(slug => {
            const items = grouped[slug] || []
            const slugSuggestions = suggestions[slug] || []
            const isSuggesting = suggesting[slug]
            return (
              <div key={slug} className={styles.keywordGroup}>
                <div className={styles.keywordGroupHeader}>
                  <h3 className={styles.keywordGroupTitle}>{slug}</h3>
                  <button
                    className={styles.btnSmall}
                    onClick={() => suggest(slug)}
                    disabled={isSuggesting}
                  >
                    {isSuggesting ? 'Thinking...' : 'AI Suggest'}
                  </button>
                </div>
                {items.length === 0 && slugSuggestions.length === 0 && (
                  <p className={styles.muted}>No keywords yet</p>
                )}
                {items.length > 0 && (
                  <div className={styles.keywordTags}>
                    {items.map(kw => (
                      <span key={kw.id} className={styles.keywordTag}>
                        {kw.keyword}
                        <button
                          className={styles.keywordRemove}
                          onClick={() => remove(kw.id)}
                          title="Remove"
                        >&times;</button>
                      </span>
                    ))}
                  </div>
                )}
                {slugSuggestions.length > 0 && (
                  <div className={styles.suggestionsBlock}>
                    <div className={styles.suggestionsHeader}>
                      <span className={styles.suggestionsLabel}>Suggestions</span>
                      <button className={styles.btnSmall} onClick={() => acceptAll(slug)}>Accept All</button>
                      <button className={styles.btnSmall} onClick={() => setSuggestions(s => ({ ...s, [slug]: [] }))}>Dismiss All</button>
                    </div>
                    <div className={styles.keywordTags}>
                      {slugSuggestions.map(kw => (
                        <span key={kw} className={`${styles.keywordTag} ${styles.keywordSuggestion}`}>
                          {kw}
                          <button
                            className={styles.keywordAccept}
                            onClick={() => acceptSuggestion(slug, kw)}
                            title="Accept"
                          >+</button>
                          <button
                            className={styles.keywordRemove}
                            onClick={() => dismissSuggestion(slug, kw)}
                            title="Dismiss"
                          >&times;</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
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
