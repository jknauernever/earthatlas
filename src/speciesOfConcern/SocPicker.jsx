/**
 * "Species of concern: …" — the top-right pill and its popover, the same construct and look as /ships' ShipPicker and
 * /permits' ProjectPicker (results live here, not in the left panel). The popover lists what agencies have mapped
 * around the spot, then the listed species reported there, grouped by status. Picking one closes the popover; the pill
 * then names it and its card hangs under the pill (rendered by the caller as children).
 */
import { useEffect, useRef, useState } from 'react'
import styles from '../ships/ShipPicker.module.css'
import Chevron from '../ships/Chevron.jsx'
import { Loading } from '../components/panel'
import { NOT_CONFIRMED, BLURRED_ONLY } from '../../lib/speciesOfConcern/statusOrder.js'
import s from './SpeciesOfConcernApp.module.css'
import { colorOf, REG_COLORS, fmtDate, fmtKm, shortStatus } from './socShared.js'

export default function SocPicker({ point, loading, error, data, rows, groups, exactCount, radius, unit, windowWords, picked, onPick, open, onOpen, children }) {
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) onOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') onOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, onOpen])

  const value = picked || (!point ? 'click the map to choose a spot' : loading ? 'looking…' : error ? 'lookup unavailable'
    : data ? `${exactCount} listed within ${radius} ${unit}` : '')
  const reg = data?.regulatory
  const pick = (sel) => { onPick(sel); onOpen(false) }

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button type="button" className={styles.pill} onClick={() => onOpen(!open)} aria-expanded={open} aria-haspopup="dialog" disabled={!point}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.pillLead}>Species of concern:</span>
        <span className={styles.pillValue}>{value}</span>
        {point && <span className={styles.chev} aria-hidden="true"><Chevron up={open} size={15} /></span>}
      </button>

      {open && point && (
        <div className={styles.pop} role="dialog" aria-label="What is recorded near this spot">
          {loading && <Loading kind="slow" />}
          {error && <div className={s.error}>{error}</div>}
          {data && !loading && (
            <>
              {reg && <AgencyList reg={reg} radius={radius} unit={unit} onPick={pick} />}
              <div className={styles.head}>Sightings within {radius} {unit}, {windowWords}</div>
              <div className={styles.note} style={{ marginTop: 0 }}>No records does not mean a species is absent; it means none was reported to these sources in this time.</div>
              {groups.map((g) => <Group key={g} group={g} rows={rows.filter((r) => r.group === g)} unit={unit} onPick={pick} />)}
              {!rows.length && <div className={styles.note}>No listed species reported here in this time.</div>}
            </>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

function AgencyList({ reg, radius, unit, onPick }) {
  const [habOpen, setHabOpen] = useState(false)
  const species = reg.phs.filter((p) => p.kind === 'species')
  const habitats = reg.phs.filter((p) => p.kind === 'habitat')
  const failed = reg.sources.filter((x) => !x.ok)
  const item = (it, color, sub) => (
    <button key={it.id} type="button" className={styles.result} onClick={() => onPick(`reg:${it.id}`)}>
      <span className={styles.resultName}><span className={s.swatchSq} style={{ background: color }} />{it.info?.photo && <img className={s.thumb} src={it.info.photo.thumb} alt="" loading="lazy" />}{it.name}</span>
      <span className={styles.resultMeta}>{sub}</span>
    </button>
  )
  return (
    <>
      <div className={styles.head}>What agencies have mapped here</div>
      {failed.length > 0 && <div className={s.error} title={failed.map((x) => `${x.label}: ${x.error}`).join('\n')}>Not available right now: {failed.map((x) => x.label).join(', ')}. Try again in a minute.</div>}
      {reg.critical_habitat.map((c) => item(c, REG_COLORS['critical-habitat'], `Federal critical habitat${c.unit ? ` · ${c.unit}` : ''} · ${c.contains_point ? 'this spot is inside it' : `within ${radius} ${unit}`}`))}
      {species.map((p) => item(p, REG_COLORS['phs-species'], `WDFW priority species${p.priority_area ? ` · ${p.priority_area.toLowerCase()}` : ''}${p.source_dataset ? ` · ${p.source_dataset.label.replace(/ \(.*\)$/, '')}` : ''} · ${p.resolution === 'as mapped' ? (p.contains_point ? 'at this spot' : `within ${radius} ${unit}`) : p.resolution.replace('shown only to the ', 'in the ')}`))}
      {habitats.length > 0 && (
        <>
          <button type="button" className={styles.result} onClick={() => setHabOpen((o) => !o)} aria-expanded={habOpen}>
            <span className={styles.resultName}><span className={s.swatchSq} style={{ background: REG_COLORS['phs-habitat'] }} />WDFW priority habitats ({habitats.length}) <Chevron up={habOpen} size={13} /></span>
          </button>
          {habOpen && habitats.map((p) => item(p, REG_COLORS['phs-habitat'], `${p.priority_area ? `${p.priority_area} · ` : ''}${p.source_dataset ? `${p.source_dataset.label.replace(/ \(.*\)$/, '')} · ` : ''}${p.contains_point ? 'this spot is inside it' : `within ${radius} ${unit}`}`))}
        </>
      )}
      {!reg.critical_habitat.length && !reg.phs.length && <div className={styles.note}>Nothing mapped by NOAA, USFWS or WDFW within {radius} {unit}.</div>}
    </>
  )
}

function Group({ group, rows, unit, onPick }) {
  const folded = group === NOT_CONFIRMED || group === BLURRED_ONLY
  const [open, setOpen] = useState(!folded)
  const label = group === NOT_CONFIRMED ? 'Related species recorded' : group
  return (
    <>
      <button type="button" className={`${styles.head} ${s.groupBtn}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={s.swatch} style={{ background: colorOf(group) }} />{label} <span className={styles.count}>{rows.length}</span> <Chevron up={open} size={13} />
      </button>
      {open && group === BLURRED_ONLY && <div className={styles.note} style={{ marginTop: 0 }}>Every record has a location iNaturalist blurs to protect the species: possibly inside the circle, possibly up to ~28 km away.</div>}
      {open && group === NOT_CONFIRMED && <div className={styles.note} style={{ marginTop: 0 }}>A listed subspecies or population whose species was recorded; the records don’t show it was the listed one.</div>}
      {open && rows.map((r) => (
        <button key={r.scientific_name} type="button" className={styles.result} onClick={() => onPick(`sp:${r.scientific_name}`)}>
          <span className={styles.resultName}>{r.info?.photo && <img className={s.thumb} src={r.info.photo.thumb} alt="" loading="lazy" />}{r.common_name || r.scientific_name} <i className={s.sci}>{r.common_name ? r.scientific_name : ''}</i></span>
          <span className={styles.resultMeta}>
            {r.statuses.filter((x) => x.confirmed).slice(0, 2).map(shortStatus).join(' · ')}
            {' · '}{r.records_count} record{r.records_count === 1 ? '' : 's'}, latest {fmtDate(r.latest_date)}{r.nearest_km != null ? `, nearest ${fmtKm(r.nearest_km, unit)}` : ''}
          </span>
        </button>
      ))}
    </>
  )
}
