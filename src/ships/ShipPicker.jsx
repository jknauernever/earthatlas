/**
 * "Ships: …" — the top-center pill and its popover. Same construct as
 * /inmotion's MeasurePicker (Emission sources): a pill naming what's shown,
 * a popover holding the choices. The popover has a ship search (name, IMO,
 * MMSI, call sign), chips for kinds of ship (GFW's classification, with live
 * counts), and the matching ships. Picking one closes the popover, and the
 * pill then names that ship. The ship's card hangs under the pill (rendered
 * by the caller).
 */
import { useEffect, useRef, useState } from 'react'
import styles from './ShipPicker.module.css'
import Chevron from './Chevron.jsx'
import { Loading } from '../components/panel'

const KIND_LABEL = {
  PASSENGER: 'Passenger', CARGO: 'Cargo', FISHING: 'Fishing', CARRIER: 'Fish carrier', BUNKER: 'Bunker',
  SUPPORT: 'Support', SEISMIC_VESSEL: 'Seismic', GEAR: 'Fishing gear', DISCREPANCY: 'Conflicting', OTHER: 'Other',
}
export const kindLabel = (k) => KIND_LABEL[k] || String(k).replaceAll('_', ' ').toLowerCase()

// Why an owner search matched (the card's role rows).
const OWNER_LABEL = { registry_owner: 'Owner (registry)', owner: 'Owner', registered_owner: 'Registered owner', beneficial_owner: 'Beneficial owner',
  operator: 'Operator', ship_manager: 'Ship manager', technical_manager: 'Technical manager', commercial_manager: 'Commercial manager',
  ism_manager: 'ISM manager', bareboat_charterer: 'Bareboat charterer' }

export default function ShipPicker({ onShowKind, shipName, query, onQuery, kinds, onKinds, onPick, open, onOpen, children }) {
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const [kindCounts, setKindCounts] = useState(null)
  const [results, setResults] = useState(null)
  const [found, setFound] = useState(null) // kind-of-ship reading + total (api/ships op=search `type`, `total`)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
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

  useEffect(() => {
    if (!open || kindCounts) return
    fetch('/api/ships?op=kinds').then((r) => r.json()).then((d) => setKindCounts(d.kinds || [])).catch(() => setKindCounts([]))
  }, [open, kindCounts])

  useEffect(() => {
    const text = query.trim()
    if (text.length < 2 && !kinds.length) { setResults(null); setError(null); return }
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams({ op: 'search', q: text })
        if (kinds.length) qs.set('kinds', kinds.join(','))
        const r = await fetch(`/api/ships?${qs}`, { signal: ctl.signal })
        if (!r.ok) throw new Error(`Search failed (${r.status})`)
        const b = await r.json()
        setResults(b.results); setFound(b.type ? { ...b.type, total: b.total, capped: b.capped } : null); setError(null); setActive(-1)
      } catch (e) { if (e.name !== 'AbortError') setError(e.message) } finally { setLoading(false) }
    }, 250)
    return () => { clearTimeout(t); ctl.abort() }
  }, [query, kinds])

  const toggleKind = (k) => onKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k])
  const onKey = (e) => {
    if (!results?.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); onPick(results[Math.max(active, 0)]) }
  }

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button type="button" className={styles.pill} onClick={() => onOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
        title="Find a ship by name, IMO, MMSI or call sign">
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.pillLead}>Ships:</span>
        <span className={styles.pillValue}>{shipName || 'Find a ship'}{kinds.length ? ` · ${kinds.length} kind${kinds.length === 1 ? '' : 's'}` : ''}</span>
        <span className={styles.chev} aria-hidden="true"><Chevron up={open} size={15} /></span>
      </button>

      {open && (
        <div className={styles.pop} role="dialog" aria-label="Find a ship">
          <div className={styles.head}>Find a ship</div>
          <input ref={inputRef} className={styles.search} type="search" value={query} onChange={(e) => onQuery(e.target.value)} onKeyDown={onKey}
            placeholder="Name, IMO, MMSI, owner or kind (ferry)" aria-label="Ship name, IMO, MMSI, call sign, owner or kind of ship" />

          <div className={styles.head}>Kind of ship</div>
          <div className={styles.chips}>
            <button type="button" className={`${styles.chip} ${!kinds.length ? styles.chipOn : ''}`} onClick={() => onKinds([])}>Every kind</button>
            {(kindCounts || []).map(({ kind, n }) => (
              <button key={kind} type="button" className={`${styles.chip} ${kinds.includes(kind) ? styles.chipOn : ''} ${!n ? styles.chipNa : ''}`}
                onClick={() => toggleKind(kind)} title={`${n.toLocaleString()} ships classified ${kindLabel(kind).toLowerCase()} by Global Fishing Watch`}>
                {kindLabel(kind)} <span className={styles.count}>{n.toLocaleString()}</span>
              </button>
            ))}
          </div>
          <div className={styles.note}>Kinds are Global Fishing Watch’s classification (AIS + registries + models), not what each ship reports about itself.</div>

          {(results || loading || error) && <div className={styles.head}>{!results ? 'Ships'
            : found ? `${found.total}${found.capped ? '+' : ''} ${found.class ? found.label.replace(/\s*\(.*\)$/, '') : `${found.label} ship`}${found.total === 1 ? '' : 's'}${found.rest ? ` · “${found.rest}”` : ''}${found.total > results.length ? ` · first ${results.length} by name` : ''}`
            : `${results.length === 25 ? 'First 25' : results.length} ship${results.length === 1 ? '' : 's'}`}</div>}
          {found && <div className={styles.note}>Kind of ship as EarthAtlas reads it from every source (the card’s “Kind of ship”). Add a name or owner to narrow it: “Washington ferry”.</div>}
          {found && onShowKind && found.total > 0 && (
            <button type="button" className={styles.showKind} onClick={() => onShowKind(found)}>
              Show all {found.class ? found.label.replace(/\s*\(.*\)$/, '').toLowerCase() : `${found.label.toLowerCase()} ship`}s on the map
            </button>
          )}
          {loading && !results && <Loading kind="search" className={styles.note} />}
          {error && <div className={styles.note}>{error}</div>}
          {results && !results.length && !loading && <div className={styles.note}>No ships match.</div>}
          {results?.length > 0 && (
            <div className={styles.results} role="listbox">
              {results.map((r, i) => (
                <button key={r.id} type="button" role="option" aria-selected={i === active}
                  className={`${styles.result} ${i === active ? styles.resultOn : ''}`} onMouseEnter={() => setActive(i)} onClick={() => onPick(r)}>
                  <span className={styles.resultName}>{r.latest.name?.value || 'Unnamed vessel'}</span>
                  <span className={styles.resultMeta}>
                    {[r.latest.flag?.value, r.latest.imo && `IMO ${r.latest.imo.value}`, r.latest.mmsi && `MMSI ${r.latest.mmsi.value}`,
                      r.latest.vessel_type && kindLabel(r.latest.vessel_type.value)].filter(Boolean).join(' · ')}
                  </span>
                  {r.match?.kind === 'owner' && <span className={styles.resultMeta}>{OWNER_LABEL[r.match.attribute] || 'Owner'}: {r.match.value}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* The picked ship's card hangs under the pill while the popover is closed. */}
      {!open && children}
    </div>
  )
}
