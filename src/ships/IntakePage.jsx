/**
 * /ships/intake — add boats from an operator's web page (Josh 2026-10-19, option A). Admin only (the site's /admin login).
 * Paste a URL → the server reads the page (and each boat's own page), Claude pulls out the boats in the operator's own
 * words, every value is checked against the page, and each boat is matched against our records (same review as
 * scripts/ships/intake.mjs). Josh picks the match (or none) per boat, can edit facts, drop photos, ask Claude to dig
 * deeper, then "Add to EarthAtlas" writes it (lib/ships/intakeApply.js). API: lib/ships/intakeApi.js.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import c from './IntakePage.module.css'
import { TAXONOMY, labelOf } from '../../lib/ships/taxonomy.js'

const api = (op, { body, query = '' } = {}) => fetch(`/api/ships?op=${op}${query}`, {
  method: body ? 'POST' : 'GET', credentials: 'same-origin',
  headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { data: j }); return j })

const FACTS = [['vessel_type', 'What the page calls it'], ['length_ft', 'Length (ft)'], ['builder', 'Builder'], ['build_place', 'Built in'],
  ['year_built', 'Year built'], ['hull_material', 'Hull'], ['max_capacity', 'Capacity (people)'], ['capacity_basis', 'Capacity counts'],
  ['propulsion', 'Engines'], ['speed_kn', 'Speed (knots)'], ['speed_basis', 'Speed is']]
const NUMERIC = new Set(['length_ft', 'year_built', 'max_capacity'])
const day = (t) => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const short = (id) => String(id || '').slice(0, 8)
/**
 * Pick a kind of ship from EarthAtlas's own list (lib/ships/taxonomy.js, the list the map's filters use): sub-types grouped
 * by kind, or a kind with no sub-type. Nothing can be typed in, so no new categories.
 */
function KindSelect({ value, onChange, emptyLabel, className }) {
  return (
    <select className={className} value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {TAXONOMY.filter((g) => !['unknown', 'non_vessel'].includes(g.id)).map((g) => (
        <optgroup key={g.id} label={g.label}>
          {g.classes.filter((k) => !k.id.endsWith('_unspecified')).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          <option value={g.id}>{g.label} (no sub-type)</option>
        </optgroup>
      ))}
    </select>
  )
}

const MODEL = { 'claude-haiku-5-5': 'Claude Haiku 5.5', 'claude-opus-5-5': 'Claude Opus 5.5' }
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }

function SignIn({ onDone }) {
  const [u, setU] = useState(''), [p, setP] = useState(''), [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault(); setErr(null)
    const r = await fetch('/api/admin/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })
    if (r.ok) onDone(); else setErr((await r.json().catch(() => ({}))).error || 'Sign-in failed')
  }
  return (
    <form className={c.box} onSubmit={submit}>
      <div className={c.h2}>Sign in</div>
      <p className={c.note}>Use the EarthAtlas admin username and password.</p>
      <input className={c.input} placeholder="Username" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" />
      <input className={c.input} placeholder="Password" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
      <button className={c.primary} type="submit">Sign in</button>
      {err && <div className={c.error}>{err}</div>}
    </form>
  )
}

function Signals({ list }) {
  return <div className={c.signals}>{list.map((s, i) => <span key={i} className={s.ok === false ? c.bad : c.good}>{s.ok === false ? '✗' : '✓'} {s.text}</span>)}</div>
}

/** "FCC licence, USCG registry, NOAA AIS · 2022–2026" — what one of our records is built from (lib/ships/intakeMatch.js). */
const yr = (d) => String(d || '').slice(0, 4)
const span = (from, to) => (!from ? '' : yr(from) === yr(to) ? (String(from).slice(0, 7) === String(to).slice(0, 7)
  ? new Date(`${from}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : yr(from)) : `${yr(from)}–${yr(to)}`)
function builtText(v) {
  const b = v.built_from || []
  if (!b.length) return ''
  const from = b.map((x) => x.from).filter(Boolean).sort()[0], to = b.map((x) => x.to).filter(Boolean).sort().at(-1)
  // A one-source record over a few days says so in days ("GFW AIS, 5 days, Mar 2026").
  const days = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1 : null
  const when = days != null && days <= 31 ? `${days} day${days === 1 ? '' : 's'}, ${span(from, to)}` : span(from, to)
  return `${[...new Set(b.map((x) => x.source))].join(', ')}${when ? ` · ${when}` : ''}`
}

function Cand({ v, boatKey, chosen, suggested, digPick, onChoose }) {
  return (
    <label className={`${c.cand} ${chosen === v.vessel_id ? c.candOn : ''}`}>
      <input type="radio" name={`m-${boatKey}`} checked={chosen === v.vessel_id} onChange={() => onChoose(v.vessel_id)} />
      <div>
        <div className={c.candTop}>
          <b>{v.names[0]}</b> · MMSI {v.mmsis.join(', ') || '—'} · last on AIS {v.last_ais || '—'}
          {suggested === v.vessel_id && <span className={c.suggested}>Suggested</span>}
          {digPick === v.vessel_id && <span className={c.suggested}>Claude’s pick</span>}
          <a className={c.link} href={`/ships?v=${v.vessel_id}`} target="_blank" rel="noopener noreferrer">open card ↗</a>
        </div>
        {v.built_from?.length > 0 && <div className={c.built}>Built from: {builtText(v)} ({v.records} record{v.records === 1 ? '' : 's'})</div>}
        {v.kind && <div className={c.candMeta}>Kind from its records: <b>{v.kind}</b></div>}
        <div className={c.candMeta}>
          {v.names.length > 1 && <>Also named {v.names.slice(1).join(', ')} · </>}
          {v.parties.length > 0 && <>Licensee / owner: {v.parties.join('; ')} · </>}
          {v.official_numbers.length > 0 && <>USCG {v.official_numbers.join(', ')} · </>}
          {(v.home_ports?.length > 0 || v.flags?.length > 0) && <>Registered: {[...(v.home_ports || []), ...(v.flags || [])].join(', ')} · </>}
          EarthAtlas {short(v.vessel_id)}
        </div>
        {v.fcc?.map((h) => <div key={h.usi} className={c.candMeta}>FCC licence {h.callsign} ({h.status}){h.licensee ? `: ${h.licensee}${h.place ? `, ${h.place}` : ''}` : ''}</div>)}
        <Signals list={v.signals} />
      </div>
    </label>
  )
}

/** Shrink a photo in the browser (≤ 2000 px, JPEG) before it is uploaded, so it fits the upload limit and loads fast. */
async function shrink(file) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) })
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height)
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('could not read the photo'))), 'image/jpeg', 0.85))
}

/**
 * Add a photo by hand: paste its address or upload a file (kept on our storage). Every added photo needs a credit, shown
 * on the ship card; for a photo on the operator's own site it starts as the operator's name and that page.
 */
function AddPhoto({ boat, operator, pageUrl, onAdd }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(''), [credit, setCredit] = useState(operator.name || ''), [creditUrl, setCreditUrl] = useState(boat.page_url || pageUrl || '')
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null)
  const add = (u) => {
    if (!credit.trim()) { setErr('Add a credit (who took or owns the photo)'); return }
    onAdd({ url: u, credit: credit.trim(), ...(/^https?:\/\//.test(creditUrl.trim()) ? { credit_url: creditUrl.trim() } : {}), added: new Date().toISOString().slice(0, 10) })
    setUrl(''); setErr(null); setOpen(false)
  }
  const upload = async (f) => {
    if (!f) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/ships?op=intakePhoto', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: await shrink(f) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `upload failed (HTTP ${r.status})`)
      add(j.url)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  if (!open) return <button type="button" className={c.textBtn} onClick={() => setOpen(true)}>+ Add a photo</button>
  return (
    <div className={c.addPhoto}>
      <div className={c.row}>
        <input className={c.input} placeholder="Paste the photo’s address (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="button" className={c.secondary} disabled={!/^https?:\/\/\S+$/.test(url.trim())} onClick={() => add(url.trim())}>Add</button>
      </div>
      <div className={c.row}>
        <label className={c.secondary}>{busy ? 'Uploading…' : 'Upload a photo'}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} /></label>
        <span className={c.note}>JPEG, PNG or WebP; it’s resized to 2000 px and stored by EarthAtlas.</span>
      </div>
      <div className={c.row}>
        <input className={c.input} placeholder="Credit (shown on the ship card)" value={credit} onChange={(e) => setCredit(e.target.value)} />
        <input className={c.input} placeholder="Credit link (optional)" value={creditUrl} onChange={(e) => setCreditUrl(e.target.value)} />
      </div>
      {err && <div className={c.error}>{err}</div>}
      <button type="button" className={c.textBtn} onClick={() => setOpen(false)}>Cancel</button>
    </div>
  )
}

/** One boat: what the page said (editable), and which of our vessels it is. */
function BoatCard({ anchorId, boat, review, dig, onChange, onDig, digging, applied, onUnlink, operator, pageUrl, pageKind }) {
  const d = boat._decision
  const set = (patch) => onChange({ ...boat, ...patch })
  const setFact = (k, v) => set({ facts: { ...boat.facts, [k]: v === '' ? undefined : NUMERIC.has(k) ? Number(v) : v } })
  const choose = (vessel_id) => set({ _decision: { kind: 'vessel', vessel_id } })
  const ours = review?.ours || []
  // What the boat's kind would be with no pick: the matched ship's records (shown in the picker's empty choice).
  const recordsKind = ours.find((v) => v.vessel_id === d?.vessel_id)?.kind || null
  const candProps = { boatKey: boat._key, chosen: d?.vessel_id, suggested: review?.suggestion?.vessel_id, digPick: dig?.vessel_id, onChoose: choose }
  return (
    <section id={anchorId} className={`${c.boat} ${boat._skip ? c.skipped : ''} ${!boat._skip && !boat._decision ? c.undecided : ''}`}>
      <div className={c.boatHead}>
        <input className={c.nameInput} value={boat.name} onChange={(e) => set({ name: e.target.value })} aria-label="Boat name" />
        {boat.page_url && <a className={c.link} href={boat.page_url} target="_blank" rel="noopener noreferrer">its page ↗</a>}
        <label className={c.skip}><input type="checkbox" checked={!!boat._skip} onChange={(e) => set({ _skip: e.target.checked })} /> Leave this boat out</label>
      </div>
      {!boat._skip && <>
        {boat.photos?.length > 0 && (
          <div className={c.photos}>
            {boat.photos.map((p) => (
              <figure key={p.url} className={c.photo}>
                {/* A photo that won't load (moved, removed, or a bad address from an older read) says so instead of a blank space. */}
                <img src={p.url} alt="" loading="lazy" referrerPolicy="no-referrer"
                  onError={(e) => { e.currentTarget.replaceWith(Object.assign(document.createElement('div'), { className: c.photoBroken, textContent: 'Photo didn’t load' })) }} />
                <button type="button" className={c.x} title="Don't use this photo" onClick={() => set({ photos: boat.photos.filter((x) => x.url !== p.url) })}>×</button>
                {p.added && <figcaption>Added · {p.credit}</figcaption>}
              </figure>
            ))}
          </div>
        )}
        <AddPhoto boat={boat} operator={operator} pageUrl={pageUrl}
          onAdd={(ph) => set({ photos: [...(boat.photos || []).filter((x) => x.url !== ph.url), ph] })} />
        <label className={c.kindRow}><span>Kind of ship</span>
          <KindSelect className={c.input} value={boat.kind} onChange={(v) => set({ kind: v || undefined })}
            emptyLabel={pageKind ? `Same as the page: ${labelOf(pageKind)}`
              : recordsKind ? `None picked: its records say ${recordsKind}` : 'None picked: keeps the kind its records give it (pick a ship below to see it)'} /></label>
        <div className={c.facts}>
          {FACTS.map(([k, label]) => (
            <label key={k} className={c.fact}><span>{label}</span>
              <input className={c.input} value={boat.facts?.[k] ?? ''} onChange={(e) => setFact(k, e.target.value)} placeholder="—" /></label>
          ))}
        </div>
        {boat.description && (
          <details className={c.desc}><summary>The operator’s description ({boat.description.length} characters, word for word from the page)</summary>
            <p>{boat.description}</p>
            <button type="button" className={c.textBtn} onClick={() => set({ description: null })}>Don’t use the description</button>
          </details>
        )}

        <div className={c.matchHead}>Which ship in our records is this?</div>
        {ours.length === 0 && <p className={c.note}>We hold no ship under this name.</p>}
        {ours.filter((v) => !v.fragment_of).map((v) => {
          const frags = ours.filter((f) => f.fragment_of === v.vessel_id)
          return (
            <div key={v.vessel_id}>
              <Cand v={v} {...candProps} />
              {frags.length > 0 && (
                <details className={c.frag} open={frags.some((f) => f.vessel_id === d?.vessel_id)}>
                  <summary>Probably the same boat: {frags.length === 1 ? 'a smaller record' : `${frags.length} smaller records`} with the same MMSI ({frags.map(builtText).join('; ')})</summary>
                  <p className={c.note}>Our records keep these separate until someone merges them, because a shared MMSI alone never merges two ships. Pick the fuller record above unless this one is clearly the boat.</p>
                  {frags.map((f) => <Cand key={f.vessel_id} v={f} {...candProps} />)}
                </details>
              )}
            </div>
          )
        })}
        <label className={`${c.cand} ${d?.kind === 'none' ? c.candOn : ''}`}>
          <input type="radio" name={`m-${boat._key}`} checked={d?.kind === 'none'} onChange={() => set({ _decision: { kind: 'none', why: d?.why || '' } })} />
          <div><b>None of these</b>: keep the boat on file, not on the map
            {d?.kind === 'none' && <input className={c.input} placeholder="Why (e.g. no AIS record anywhere)" value={d.why} onChange={(e) => set({ _decision: { kind: 'none', why: e.target.value } })} />}
          </div>
        </label>
        {(review?.fcc_not_held?.length > 0 || review?.psix_not_held?.length > 0) && (
          <details className={c.more}><summary>Other records under this name ({(review.fcc_not_held?.length || 0) + (review.psix_not_held?.length || 0)}) — not linked to any ship we hold</summary>
            {review.fcc_not_held?.map((h) => <div key={h.usi} className={c.candMeta}>FCC {h.callsign} ({h.status}) MMSI {h.mmsi}{h.length_m ? `, ${h.length_m} m` : ''}{h.licensee ? `: ${h.licensee}${h.place ? `, ${h.place}` : ''}` : ''} <Signals list={h.signals} /></div>)}
            {review.psix_not_held?.map((x) => <div key={x.psix_id} className={c.candMeta}>USCG {x.official_number}: {x.service}, built {x.built || '?'}, {x.status}</div>)}
          </details>
        )}
        {review?.psix_error && <p className={c.note}>The Coast Guard’s vessel records didn’t answer just now; FCC and our own records are shown.</p>}
        {ours.length > 0 && (
          <div className={c.dig}>
            <button type="button" className={c.secondary} onClick={onDig} disabled={digging}>{digging ? 'Asking Claude…' : 'Ask Claude to dig deeper'}</button>
            {dig && !dig.error && (
              <div className={c.digAns}>
                <b>{dig.vessel_id ? `Claude thinks it’s ${short(dig.vessel_id)}` : 'Claude can’t tell from the records'}</b> ({dig.confidence} confidence). {dig.reasoning}
                {dig.vessel_id && d?.vessel_id !== dig.vessel_id && <> <button type="button" className={c.textBtn} onClick={() => choose(dig.vessel_id)}>Use this</button></>}
              </div>
            )}
            {dig?.error && <div className={c.error}>{dig.error}</div>}
          </div>
        )}
        {applied && <div className={c.appliedLine}>{applied.vessel_id
          ? <>On the site: <a className={c.link} href={`/ships?v=${applied.vessel_id}`} target="_blank" rel="noopener noreferrer">open the ship card ↗</a> <button type="button" className={c.textBtn} onClick={onUnlink}>Undo the link</button></>
          : 'Kept on file, not on the map.'}</div>}
      </>}
    </section>
  )
}

function Job({ id, onBack, onOpen }) {
  const [job, setJob] = useState(null), [boats, setBoats] = useState([]), [err, setErr] = useState(null), [pageKind, setPageKind] = useState(null)
  const [busy, setBusy] = useState(null), [digging, setDigging] = useState(null), [digs, setDigs] = useState({})
  const [latest, setLatest] = useState(null)
  useEffect(() => {
    if (job?.status !== 'discarded') return
    api('intakeJobs').then((r) => setLatest(r.jobs.find((x) => x.url === job.url) || null)).catch(() => {})
  }, [job?.status, job?.url])
  const load = useCallback(async () => {
    const j = await api('intakeJob', { query: `&id=${id}` })
    setJob(j); setDigs(j.notes?.dig || {}); setPageKind(j.intake.kind || null)
    setBoats(j.intake.boats.map((b, i) => {
      const r = j.review?.boats?.find((x) => x.name === b.name)
      // Starting point: the saved decision; else the suggested ship; else, when we hold no ship under this name at all,
      // "None of these" with that reason (Josh 2026-10-19: nothing to pick, so nothing to decide).
      const decision = b.match ? (b.match.vessel_id ? { kind: 'vessel', vessel_id: b.match.vessel_id } : { kind: 'none', why: b.match.none || '' })
        : r?.suggestion ? { kind: 'vessel', vessel_id: r.suggestion.vessel_id }
        : r && !r.ours?.length ? { kind: 'none', why: 'We hold no ship under this name' } : null
      return { ...b, _key: i, _decision: decision, _orig: b.name }
    }))
  }, [id])
  useEffect(() => { load().catch((e) => setErr(e.message)) }, [load])
  const reviewFor = (b) => job?.review?.boats?.find((x) => x.name === b._orig)
  const toSave = () => boats.filter((b) => !b._skip).map((b) => {
    const r = reviewFor(b), v = r?.ours?.find((x) => x.vessel_id === b._decision?.vessel_id)
    const dig = digs[b._orig]
    const match = b._decision?.kind === 'vessel' && v ? {
      vessel_id: v.vessel_id, confidence: v.signals.some((s) => s.strong) ? 'high' : 'medium',
      basis: [v.signals.filter((s) => s.ok).map((s) => s.text).join('; '), dig?.vessel_id === v.vessel_id ? `Claude: ${dig.reasoning}` : null].filter(Boolean).join(' · ') || 'chosen by the reviewer',
      decided: `reviewed on earthatlas.org/ships/intake ${new Date().toISOString().slice(0, 10)}` }
      : b._decision?.kind === 'none' ? { none: b._decision.why?.trim() || 'No matching ship in our records', decided: `reviewed on earthatlas.org/ships/intake ${new Date().toISOString().slice(0, 10)}` } : null
    const { _key, _decision, _orig, _skip, ...rest } = b
    return { ...rest, facts: Object.fromEntries(Object.entries(rest.facts || {}).filter(([, x]) => x !== undefined && x !== '' && !(typeof x === 'number' && !Number.isFinite(x)))), match }
  })
  const undecided = boats.filter((b) => !b._skip && !b._decision).map((b) => b.name)
  const save = async () => { await api('intakeSave', { body: { id, boats: toSave(), kind: pageKind || '' } }) }
  const run = async (label, fn) => { setBusy(label); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(null) } }
  if (err && !job) return <div className={c.error}>{err}</div>
  if (!job) return <p className={c.note}>Loading…</p>
  const result = job.result?.boats || []
  const op = job.intake.operator
  return (
    <div>
      <button type="button" className={c.textBtn} onClick={onBack}>← All intakes</button>
      <h2 className={c.h1}>{op.name}</h2>
      <div className={c.sub}>
        <a className={c.link} href={job.url} target="_blank" rel="noopener noreferrer">{hostOf(job.url)} ↗</a>
        {op.place && <> · {op.place}</>}{op.service && <> · “{op.service}”</>} · read {day(job.created_at)}
        {job.status === 'applied' && <> · <b>added {day(job.applied_at)}</b></>}
      </div>
      {/* Haiku reads pages by default (under 1¢); Opus costs about 25–35¢ a page, for pages Haiku got wrong (Josh 2026-10-19). */}
      <div className={c.sub}>
        Read by {MODEL[job.notes?.model] || 'Claude'}.{' '}
        <button type="button" className={c.textBtn} disabled={!!busy} title="Look our records up again (new ships, licences or AIS since this page was read). Free."
          onClick={() => run('Checking…', async () => { await api('intakeRereview', { body: { id } }); await load() })}>{busy === 'Checking…' ? busy : 'Check matches again'}</button>{' · '}
        <button type="button" className={c.textBtn} disabled={!!busy} title="Read the page again with the current reader (under 1¢). This read stays as it is."
          onClick={() => run('Reading again… (about 30 seconds)', async () => { const r = await api('intakeRead', { body: { url: job.url } }); onOpen(r.id) })}>
          {busy?.startsWith('Reading again…') ? busy : 'Read again'}</button>{' · '}
        {job.notes?.model !== 'claude-opus-5-5' && <button type="button" className={c.textBtn} disabled={!!busy}
          title="A slower, more careful read for pages that came out wrong. About 25–35¢ a page."
          onClick={() => run('Reading again with Opus… (about a minute)', async () => { const r = await api('intakeRead', { body: { url: job.url, strong: true } }); onOpen(r.id) })}>
          {busy?.startsWith('Reading again with Opus') ? busy : 'Read again with Opus (about 25–35¢)'}</button>}
      </div>
      {/* A discarded read says so, and points to the newest read of the same page (so nobody edits the wrong one). */}
      {job.status === 'discarded' && <div className={c.error}>
        This read was discarded and isn’t in the Recent list.{latest && latest.id !== job.id ? <> The newest read of this page is{' '}
          <button type="button" className={c.textBtn} onClick={() => onOpen(latest.id)}>{latest.status === 'applied' ? 'the one you added' : 'here'} (read {day(latest.created_at)})</button>.</> : null}
      </div>}
      {job.notes?.warnings?.length > 0 && (
        <details className={c.warn}><summary>{job.notes.warnings.length} value(s) left out because the page doesn’t say them word for word</summary>
          <ul>{job.notes.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
      )}
      <label className={c.pageKind}>
        <span><b>Kind of ship for every boat on this page</b>, from EarthAtlas’s list. Pick one and it becomes each boat’s kind on its ship card (a boat can be set differently below); what AIS and registries say still shows underneath. Leave it on “None picked” and nothing changes.</span>
        <KindSelect className={c.input} value={pageKind} onChange={setPageKind} emptyLabel="None picked: each boat keeps the kind its records give it (shown on each boat)" />
      </label>
      {boats.map((b, i) => (
        <BoatCard key={b._key} anchorId={`boat-${b._key}`} boat={b} review={reviewFor(b)} dig={digs[b._orig]} digging={digging === b._orig} operator={op} pageUrl={job.url} pageKind={pageKind}
          applied={job.status === 'applied' ? result.find((x) => x.name === b.name) : null}
          onChange={(nb) => setBoats((all) => all.map((x, k) => (k === i ? nb : x)))}
          onDig={() => { setDigging(b._orig); api('intakeDig', { body: { id, boat: b._orig } }).then((a) => setDigs((m) => ({ ...m, [b._orig]: a })))
            .catch((e) => setDigs((m) => ({ ...m, [b._orig]: { error: e.message } }))).finally(() => setDigging(null)) }}
          onUnlink={() => run('Undoing…', async () => { await api('intakeUnlink', { body: { id, boat: b.name } }); await load() })} />
      ))}
      <div className={c.actions}>
        {/* Why the button is off, in plain view; each name jumps to its boat. */}
        {undecided.length > 0 && <span className={c.todo}>
          {undecided.length === 1 ? '1 boat still needs' : `${undecided.length} boats still need`} a match choice (a ship, or “None of these”):{' '}
          {boats.filter((b) => !b._skip && !b._decision).map((b, k) => <span key={b._key}>{k > 0 && ', '}
            <button type="button" className={c.textBtn} onClick={() => document.getElementById(`boat-${b._key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{b.name}</button></span>)}
        </span>}
        <button type="button" className={c.secondary} disabled={!!busy} onClick={() => run('Saving…', save)}>Save for later</button>
        <button type="button" className={c.primary} disabled={!!busy || undecided.length > 0 || !boats.some((b) => !b._skip)}
          onClick={() => run('Adding…', async () => { await save(); await api('intakeApply', { body: { id } }); await load() })}>
          {busy || (job.status === 'applied' ? 'Save changes to EarthAtlas' : 'Add to EarthAtlas')}
        </button>
        {job.status === 'draft' && <button type="button" className={c.textBtn} onClick={() => run('…', async () => { await api('intakeDiscard', { body: { id } }); onBack() })}>Discard</button>}
      </div>
      {err && <div className={c.error}>{err}</div>}
    </div>
  )
}

export default function IntakePage() {
  useEffect(() => { document.title = 'Add boats · EarthAtlas Ships' }, [])
  const [auth, setAuth] = useState(null)
  const [jobs, setJobs] = useState([])
  const [url, setUrl] = useState(''), [pasted, setPasted] = useState(''), [showPaste, setShowPaste] = useState(false)
  const [reading, setReading] = useState(false), [err, setErr] = useState(null)
  const jobId = useMemo(() => new URLSearchParams(window.location.search).get('job'), [])
  const [open, setOpen] = useState(jobId)
  const checkAuth = () => api('intakeAuth').then(setAuth).catch(() => setAuth({ authenticated: false }))
  useEffect(() => { checkAuth() }, [])
  useEffect(() => { if (auth?.authenticated && !open) api('intakeJobs').then((j) => setJobs(j.jobs)).catch(() => {}) }, [auth, open])
  const go = (id) => { setOpen(id); window.history.replaceState(null, '', id ? `/ships/intake?job=${id}` : '/ships/intake') }
  const read = async (e) => {
    e.preventDefault(); setErr(null); setReading(true)
    try { const r = await api('intakeRead', { body: { url: url.trim(), ...(showPaste && pasted.trim() ? { text: pasted } : {}) } }); go(r.id) }
    catch (x) { setErr(x.message); if (/paste its text/.test(x.message)) setShowPaste(true) }
    finally { setReading(false) }
  }
  return (
    <div className={c.page}>
      <header className={c.top}><a href="/ships" className={c.brand}>EarthAtlas <span>Ships</span></a></header>
      <main className={c.main}>
        <div className={c.kicker}>Add boats</div>
        {!auth && <p className={c.note}>Loading…</p>}
        {auth && !auth.authenticated && <SignIn onDone={checkAuth} />}
        {auth?.authenticated && (open ? <Job key={open} id={open} onBack={() => go(null)} onOpen={go} /> : <>
          <h1 className={c.h1}>Add boats from a web page</h1>
          <p className={c.sub}>Paste an operator’s fleet page or a single boat’s page. EarthAtlas reads it, pulls out each boat in the operator’s own words, checks every value against the page, and finds the matching ships in our records. You decide each match before anything is added.</p>
          <form className={c.box} onSubmit={read}>
            <input className={c.input} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} disabled={reading} />
            {showPaste && <textarea className={c.textarea} rows={8} placeholder="Paste the page’s text here (for sites that only show their text in a browser)" value={pasted} onChange={(e) => setPasted(e.target.value)} />}
            <div className={c.row}>
              <button className={c.primary} type="submit" disabled={reading || !/^https?:\/\//.test(url.trim())}>{reading ? 'Reading the page… (about a minute)' : 'Read page'}</button>
              {!showPaste && <button type="button" className={c.textBtn} onClick={() => setShowPaste(true)}>Paste the page’s text instead</button>}
            </div>
            {err && <div className={c.error}>{err}</div>}
          </form>
          <h2 className={c.h2}>Recent</h2>
          {jobs.length === 0 && <p className={c.note}>Nothing yet.</p>}
          <ul className={c.jobs}>{jobs.map((j) => (
            <li key={j.id} className={c.jobRow}><button type="button" className={c.jobBtn} onClick={() => go(j.id)}>
              <b>{j.operator || hostOf(j.url)}</b> · {j.boats} boat{j.boats === 1 ? '' : 's'} · {hostOf(j.url)}
              <span className={c[j.status]}>{j.status === 'applied' ? `added ${day(j.applied_at)}` : `read ${day(j.created_at)}, not added yet`}</span>
            </button>
              {/* Hide a read that came out wrong (marked discarded; nothing deleted). Added reads stay: hiding them wouldn't take the boats off the map. */}
              {j.status === 'draft' && <button type="button" className={c.jobX} title="Remove this read from the list"
                onClick={() => api('intakeDiscard', { body: { id: j.id } }).then(() => setJobs((all) => all.filter((x) => x.id !== j.id))).catch((e) => setErr(e.message))}>×</button>}
            </li>))}
          </ul>
        </>)}
      </main>
    </div>
  )
}
