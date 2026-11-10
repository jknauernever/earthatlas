import { useState } from 'react'
import s from './NavAdmin.module.css'

/**
 * Admin editing for a map page's left panel (docs/SITE_CONTENT_ADMIN.md; data: src/lib/siteContent.js).
 * Shown only to admins: visitors never see any of it.
 *
 *   <NavAdminBar sc editing setEditing />          top of the panel: unlock / Edit panel / Done
 *   <NodeTools node siblings sc kit />             under a row while editing: ↑ ↓ Edit Remove, and the edit form
 *   <RemovedList tree sc />                        bottom of the panel while editing: removed items, each with Restore
 *
 * kit (from the page): { glyphs: { id: { label, spec } }, styleLabels, pinUri(spec) }
 */

export function NavAdminBar({ sc, editing, setEditing }) {
  const [code, setCode] = useState('')
  const [asking, setAsking] = useState(false)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!sc.admin) return null
  if (sc.admin.state === 'needs-2fa') return <div className={s.bar}>Turn on two-step verification on your account page to edit this panel.</div>
  if (sc.admin.state === 'locked') {
    if (!asking) return <div className={s.bar}><button type="button" className={s.btn} onClick={() => setAsking(true)}>Edit this panel</button></div>
    const go = async (e) => {
      e.preventDefault(); setBusy(true); setErr(null)
      try { await sc.unlock(code); setEditing(true) } catch (x) { setErr(x.message); setCode('') } finally { setBusy(false) }
    }
    return (
      <form className={`${s.bar} ph-no-capture`} onSubmit={go}>
        <label className={s.field}>Authenticator code
          <input className={s.input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} autoFocus
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </label>
        <button className={s.btn} disabled={busy || code.length !== 6}>Open editing</button>
        {err && <div className={s.err}>{err}</div>}
      </form>
    )
  }
  return (
    <div className={s.bar}>
      <button type="button" className={`${s.btn} ${editing ? s.btnOn : ''}`} onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit panel'}</button>
      {editing && <span className={s.hint}>Changes reach visitors within about a minute.</span>}
    </div>
  )
}

function useBusy() {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null)
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); return true } catch (e) { setErr(e.message); return false } finally { setBusy(false) } }
  return { busy, err, run }
}

const Arrow = ({ up }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
  </svg>
)

/** ↑ ↓ Edit Remove for one node, and its edit form. siblings: the shown nodes at its level, in order. */
export function NodeTools({ node, siblings, sc, kit, compact = false }) {
  const [open, setOpen] = useState(false)
  const b = useBusy()
  const i = siblings.indexOf(node)
  const move = (d) => b.run(() => {
    const ids = siblings.map((x) => x.id)
    ;[ids[i], ids[i + d]] = [ids[i + d], ids[i]]
    return sc.act('order', { ids })
  })
  const isClass = node.kind === 'class'
  const remove = () => {
    if (window.confirm(`Remove “${node.name}” from the panel? It moves to the Removed list, where you can restore it.`)) b.run(() => sc.act('remove', { node: node.id }))
  }
  return (
    <div className={`${s.tools} ${compact ? s.toolsCompact : ''}`}>
      <div className={s.toolRow}>
        <button type="button" className={s.icon} disabled={b.busy || i <= 0} onClick={() => move(-1)} title="Move up" aria-label={`Move ${node.name} up`}><Arrow up /></button>
        <button type="button" className={s.icon} disabled={b.busy || i < 0 || i >= siblings.length - 1} onClick={() => move(1)} title="Move down" aria-label={`Move ${node.name} down`}><Arrow /></button>
        <button type="button" className={`${s.small} ${open ? s.btnOn : ''}`} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit'}</button>
        {!isClass && <button type="button" className={s.small} disabled={b.busy} onClick={remove}>Remove</button>}
        {node.edited && <span className={s.tag}>edited</span>}
      </div>
      {b.err && <div className={s.err}>{b.err}</div>}
      {open && <EditForm node={node} sc={sc} kit={kit} onDone={() => setOpen(false)} />}
    </div>
  )
}

function EditForm({ node, sc, kit, onDone }) {
  const d = node.defaults
  const isClass = node.kind === 'class'
  const styleKeys = Object.keys(d.style || {})
  const [name, setName] = useState(node.name)
  const [info, setInfo] = useState(node.info || '')
  const [style, setStyle] = useState(node.style)
  const [zoom, setZoom] = useState(node.minZoom ?? '')
  const b = useBusy()
  const defZoom = d.minZoom ?? node.parent?.minZoom ?? null
  const save = () => b.run(async () => {
    const body = { node: node.id }
    if (name.trim() !== node.name) body.name = name.trim() === d.name ? null : name.trim()
    if (!isClass && info.trim() !== (node.info || '')) body.info = info.trim() === (d.info || '') ? null : info.trim()
    const st = {}
    for (const k of styleKeys) if (style[k] !== node.style[k]) st[k] = style[k] === d.style[k] ? null : style[k]
    if (Object.keys(st).length) body.style = st
    if (!isClass && String(zoom) !== String(node.minZoom ?? '')) body.minZoom = zoom === '' || Number(zoom) === defZoom ? null : Number(zoom)
    if (Object.keys(body).length > 1) await sc.act('edit', body)
    onDone()
  })
  const reset = () => {
    if (window.confirm(`Put “${node.name}” back to its original name, text, colors, icon and zoom?`)) b.run(async () => { await sc.act('reset', { node: node.id }); onDone() })
  }
  return (
    <div className={s.form}>
      <label className={s.field}>Name
        <input className={s.input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      {!isClass && (d.info != null || node.kind !== 'item') && (
        <label className={s.field}>Text under (i)
          <textarea className={s.input} rows={4} maxLength={2000} value={info} onChange={(e) => setInfo(e.target.value)} />
          {d.source && <span className={s.note}>The source link ({d.source[1]}) always follows this text.</span>}
        </label>
      )}
      {styleKeys.filter((k) => k !== 'glyph').map((k) => (
        <label key={k} className={s.inline}>
          <input type="color" className={s.color} value={style[k]} onChange={(e) => setStyle({ ...style, [k]: e.target.value })} />
          {kit.styleLabels[k] || k}
          {style[k] !== d.style[k] && <button type="button" className={s.link} onClick={() => setStyle({ ...style, [k]: d.style[k] })}>original</button>}
        </label>
      ))}
      {styleKeys.includes('glyph') && (
        <div className={s.field}>{kit.styleLabels.glyph}
          <div className={s.glyphs}>
            {Object.entries(kit.glyphs).map(([g, v]) => (
              <button key={g} type="button" className={`${s.glyph} ${style.glyph === g ? s.glyphOn : ''}`} title={v.label} aria-label={v.label}
                aria-pressed={style.glyph === g} onClick={() => setStyle({ ...style, glyph: g })}>
                <img src={kit.pinUri({ ...v.spec, color: style.pinColor || v.spec.color })} alt="" width="20" height="22" />
              </button>
            ))}
          </div>
        </div>
      )}
      {!isClass && (
        <label className={s.inline}>Shows from zoom
          <input className={`${s.input} ${s.num}`} type="number" min="0" max="22" step="0.5" value={zoom} onChange={(e) => setZoom(e.target.value)} />
          {defZoom != null && <span className={s.note}>original {defZoom}</span>}
        </label>
      )}
      {node.dataset && <Photos node={node} sc={sc} />}
      <div className={s.toolRow}>
        <button type="button" className={s.btn} disabled={b.busy} onClick={save}>Save</button>
        <button type="button" className={s.small} disabled={b.busy} onClick={onDone}>Cancel</button>
        {node.edited && <button type="button" className={s.link} disabled={b.busy} onClick={reset}>Reset to original</button>}
      </div>
      {b.err && <div className={s.err}>{b.err}</div>}
    </div>
  )
}

/** Default popup images for a dataset: add, caption/credit, order, remove, restore; built-in photos on/off. */
function Photos({ node, sc }) {
  const media = node.media
  const removed = (sc.content?.removedMedia || []).filter((m) => m.nodeId === node.id && !m.recordId)
  const auto = node.style.autoPhotos !== false
  const b = useBusy()
  const [file, setFile] = useState(null), [caption, setCaption] = useState(''), [credit, setCredit] = useState(''), [href, setHref] = useState('')
  const add = (e) => {
    e.preventDefault()
    b.run(async () => {
      await sc.upload(file, { node: node.id, caption, credit, creditHref: href })
      setFile(null); setCaption(''); setHref(''); e.target.reset()
    })
  }
  const order = (i, d) => b.run(() => { const ids = media.map((m) => m.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; return sc.act('mediaOrder', { ids }) })
  return (
    <div className={s.photos}>
      <div className={s.head}>Popup images ({media.length})</div>
      {media.map((m, i) => <PhotoRow key={m.id} m={m} sc={sc} first={i === 0} last={i === media.length - 1} onMove={(d) => order(i, d)} busy={b.busy} />)}
      <form className={s.add} onSubmit={add}>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <input className={s.input} placeholder="Caption (required)" maxLength={300} value={caption} onChange={(e) => setCaption(e.target.value)} />
        <input className={s.input} placeholder="Credit, e.g. photographer or organization (required)" maxLength={200} value={credit} onChange={(e) => setCredit(e.target.value)} />
        <input className={s.input} placeholder="Credit link (https://…)" value={href} onChange={(e) => setHref(e.target.value)} />
        <button className={s.btn} disabled={b.busy || !file || !caption.trim() || !credit.trim()}>{b.busy ? 'Uploading…' : 'Add image'}</button>
      </form>
      <label className={s.inline}>
        <input type="checkbox" checked={auto} disabled={b.busy}
          onChange={(e) => b.run(() => sc.act('edit', { node: node.id, style: { autoPhotos: e.target.checked ? null : false } }))} />
        Also show the built-in photos after these
      </label>
      {removed.length > 0 && (
        <details className={s.removedPhotos}>
          <summary>Removed images ({removed.length})</summary>
          {removed.map((m) => (
            <div key={m.id} className={s.photo}>
              <img src={m.url} alt="" className={s.thumb} />
              <span className={s.cap}>{m.caption}</span>
              <button type="button" className={s.small} disabled={b.busy} onClick={() => b.run(() => sc.act('mediaRestore', { id: m.id }))}>Restore</button>
            </div>
          ))}
        </details>
      )}
      {b.err && <div className={s.err}>{b.err}</div>}
    </div>
  )
}

function PhotoRow({ m, sc, first, last, onMove, busy }) {
  const [caption, setCaption] = useState(m.caption), [credit, setCredit] = useState(m.credit), [href, setHref] = useState(m.creditHref || '')
  const b = useBusy()
  const dirty = caption !== m.caption || credit !== m.credit || href !== (m.creditHref || '')
  return (
    <div className={s.photo}>
      <img src={m.url} alt="" className={s.thumb} />
      <div className={s.photoFields}>
        <input className={s.input} value={caption} maxLength={300} aria-label="Caption" onChange={(e) => setCaption(e.target.value)} />
        <input className={s.input} value={credit} maxLength={200} aria-label="Credit" onChange={(e) => setCredit(e.target.value)} />
        <input className={s.input} value={href} placeholder="Credit link (https://…)" aria-label="Credit link" onChange={(e) => setHref(e.target.value)} />
        <div className={s.toolRow}>
          <button type="button" className={s.icon} disabled={busy || first} onClick={() => onMove(-1)} aria-label="Move image up"><Arrow up /></button>
          <button type="button" className={s.icon} disabled={busy || last} onClick={() => onMove(1)} aria-label="Move image down"><Arrow /></button>
          {dirty && <button type="button" className={s.small} disabled={b.busy} onClick={() => b.run(() => sc.act('mediaEdit', { id: m.id, caption, credit, creditHref: href }))}>Save</button>}
          <button type="button" className={s.small} disabled={b.busy || busy} onClick={() => { if (window.confirm('Remove this image? You can restore it from Removed images.')) b.run(() => sc.act('mediaRemove', { id: m.id })) }}>Remove</button>
        </div>
        {b.err && <div className={s.err}>{b.err}</div>}
      </div>
    </div>
  )
}

/** Every removed category / dataset, each with Restore (back to its old place). */
export function RemovedList({ tree, sc }) {
  const b = useBusy()
  return (
    <div className={s.removed}>
      <div className={s.head}>Removed ({tree.removed.length})</div>
      {!tree.removed.length && <div className={s.note}>Nothing removed.</div>}
      {tree.removed.map((n) => (
        <div key={n.id} className={s.removedRow}>
          <span>{n.name}{n.parent && <span className={s.note}> in {n.parent.name}</span>}</span>
          <button type="button" className={s.small} disabled={b.busy} onClick={() => b.run(() => sc.act('restore', { node: n.id }))}>Restore</button>
        </div>
      ))}
      {b.err && <div className={s.err}>{b.err}</div>}
    </div>
  )
}
