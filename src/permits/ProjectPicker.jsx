/**
 * "Projects: …" — /permits' top-center pill and popover, the same construct and look as /ships' ShipPicker (Josh
 * 2026-10-15: a search like /ships, instead of a newest-first list in the panel). Search by project name, applicant,
 * permit or file number, island or water; chips narrow by kind of permit or to "Needs review". Picking a project
 * flies to it and opens its record; the pill then names it. Client-side: every record is already loaded.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import styles from '../ships/ShipPicker.module.css'
import Chevron from '../ships/Chevron.jsx'
import { statusShown } from './process.js'

const MAX = 25
const norm = (s) => String(s || '').toLowerCase()

export default function ProjectPicker({ records, layers, picked, onPick, open, onOpen }) {
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState([]) // layer ids, or 'review'
  const [active, setActive] = useState(-1)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) onOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') onOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    inputRef.current?.focus()
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, onOpen])

  // Each record's searchable words: its name, applicant, numbers (Corps file, Ecology id, permit), island, water, type.
  const indexed = useMemo(() => records.map((r) => ({ r, text: norm([r.name, r.applicant, r.island, r.water, r.type, r.tag,
    ...(r.refs || []).map((x) => x.label), r.corpsRef, ...(r.conditions || []).map((c) => c.permit)].join(' ')) })), [records])
  const inKind = (r) => !kinds.length || kinds.some((k) => (k === 'review' ? !!r.review : r.layer === k))
  const results = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean)
    if (!words.length && !kinds.length) return null
    return indexed.filter(({ r, text }) => inKind(r) && words.every((w) => text.includes(w))).map(({ r }) => r)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [indexed, query, kinds]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setActive(-1), [query, kinds])

  const counts = useMemo(() => Object.fromEntries([...layers.map((l) => [l.id, records.filter((r) => r.layer === l.id).length]),
    ['review', records.filter((r) => r.review).length]]), [records, layers])
  const toggle = (k) => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))
  const shown = results?.slice(0, MAX) || []
  const onKey = (e) => {
    if (!shown.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); onPick(shown[Math.max(active, 0)]) }
  }
  const chip = (k, label, title) => (
    <button key={k} type="button" className={`${styles.chip} ${kinds.includes(k) ? styles.chipOn : ''} ${!counts[k] ? styles.chipNa : ''}`} onClick={() => toggle(k)} title={title}>
      {label} <span className={styles.count}>{counts[k]}</span>
    </button>
  )

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button type="button" className={styles.pill} onClick={() => onOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
        title="Find a project by name, applicant, permit or file number, island or water">
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.pillLead}>Projects:</span>
        <span className={styles.pillValue}>{picked || 'Find a project'}</span>
        <span className={styles.chev} aria-hidden="true"><Chevron up={open} size={15} /></span>
      </button>

      {open && (
        <div className={styles.pop} role="dialog" aria-label="Find a project">
          <div className={styles.head}>Find a project</div>
          <input ref={inputRef} className={styles.search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
            placeholder="Name, applicant, permit or file number, island" aria-label="Project name, applicant, permit or file number, island or water" />

          <div className={styles.head}>Kind of permit</div>
          <div className={styles.chips}>
            <button type="button" className={`${styles.chip} ${!kinds.length ? styles.chipOn : ''}`} onClick={() => setKinds([])}>Every kind</button>
            {layers.map((l) => chip(l.id, `${l.label} · ${l.desc}`, l.note))}
            {chip('review', 'Needs review', 'A gap Friends cares about and a way to act (draft rules)')}
          </div>

          {results && <div className={styles.head}>{results.length > MAX ? `First ${MAX} of ${results.length} projects, by name` : `${results.length} project${results.length === 1 ? '' : 's'}`}</div>}
          {results && !results.length && <div className={styles.note}>No projects match.</div>}
          {shown.length > 0 && (
            <div className={styles.results} role="listbox">
              {shown.map((r, i) => (
                <button key={r.id} type="button" role="option" aria-selected={i === active}
                  className={`${styles.result} ${i === active ? styles.resultOn : ''}`} onMouseEnter={() => setActive(i)} onClick={() => onPick(r)}>
                  <span className={styles.resultName}>{r.name}</span>
                  <span className={styles.resultMeta}>{[r.tag, r.type, r.island, statusShown(r.status?.label) || r.status?.raw, r.review && 'Needs review'].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
