// The basemap button + menu shared by every EarthAtlas map: basemap styles, and on Satellite /ships' Photos picker
// (Josh 2026-10-18: one choice, and the map shows exactly that). State comes from useMapPhotos.
import { useEffect, useRef, useState } from 'react'
import { BASE_IMAGERY, BEST_BASE, LOCAL_AERIALS, LOCAL_AERIALS_SHOW_FROM, YEAR_NOTES } from '../../lib/localAerials.js'
import s from './BasemapMenu.module.css'

/**
 * basemaps: [{ id, label }]; basemap / onBasemap: the app's basemap state; photos: useMapPhotos(); className: the
 * wrapper's position on this site's map (each site stacks its own controls).
 */
export default function BasemapMenu({ basemaps, basemap, onBasemap, photos, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className={`${s.wrap} ${className}`} ref={ref}>
      <button type="button" className={open ? s.toggleActive : s.toggle} onClick={() => setOpen((o) => !o)}
        aria-label="Choose basemap and photos" title="Basemap and photos">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
        </svg>
      </button>
      {open && (
        <div className={s.panel}>
          {basemaps?.length > 1 && <>
            <div className={s.title}>Basemap</div>
            {basemaps.map((b) => (
              <button key={b.id} type="button" className={b.id === basemap ? s.itemActive : s.item}
                onClick={() => { onBasemap(b.id); if (b.id !== 'satellite') setOpen(false) }}>
                <span className={s.itemLabel}>{b.label}</span>
                {b.id === basemap && <span className={s.check}>✓</span>}
              </button>
            ))}
          </>}
          {photos && basemap === 'satellite' && <PhotoChoices photos={photos} />}
        </div>
      )}
    </div>
  )
}

function PhotoChoices({ photos }) {
  const { photo, setPhoto, aerialsHere } = photos
  const item = (id, label, sub) => (
    <button key={id} type="button" className={photo === id ? s.itemActive : s.item} onClick={() => setPhoto(id)}>
      <span className={s.itemLabel}>{label}{sub && <span className={s.sub}>{sub}</span>}</span>
      {photo === id && <span className={s.check}>✓</span>}
    </button>)
  const yearChips = (prefix, years) => (
    <div className={s.yearChips}>
      {years.map((y) => {
        const id = `${prefix}-${y}`
        return <button key={y} type="button" className={photo === id ? s.yearChipOn : s.yearChip} onClick={() => setPhoto(id)}
          title={YEAR_NOTES[id] ? `${y}: ${YEAR_NOTES[id]}` : undefined}>{y}{YEAR_NOTES[id] ? '*' : ''}</button>
      })}
    </div>)
  // Local sources: those in view, plus the picked one wherever the map is.
  const here = new Set(aerialsHere.map((a) => a.key))
  const pickedKey = photo.split('-')[0]
  const locals = LOCAL_AERIALS.filter((a) => here.has(a.key) || (a.key === pickedKey && /^\w+-\d{4}$/.test(photo)))
  const note = YEAR_NOTES[photo]
  return <>
    <div className={s.title}>Photos</div>
    {item('best', 'Best available', `Sentinel-2 2025 zoomed out; from zoom ${LOCAL_AERIALS_SHOW_FROM}, newest local photos where we have them, Mapbox elsewhere`)}
    {locals.map((a) => (
      <div key={a.key} className={s.group}>
        <div className={s.groupName}>{a.name}</div>
        {yearChips(a.key, [...a.years].reverse())}
      </div>
    ))}
    {!locals.length && <div className={s.hint}>Zoom in on the San Juan Islands, Greater Vancouver or Nanaimo to pick local photos by year.</div>}
    {note && <div className={s.hint}>* {photo.split('-')[1]}: {note}</div>}
    {item('mapbox', 'Mapbox satellite')}
    {item('usgs', 'USGS aerial photos', 'US only')}
    <div className={s.group}>
      <div className={s.groupName}>Sentinel-2 cloudless</div>
      {yearChips('s2', BASE_IMAGERY.filter((b) => b.id.startsWith('s2-')).map((b) => b.year))}
    </div>
  </>
}

/** The photos on screen: local sources drawn ({ key, name, year, href }) over the base imagery ({ id, label, href }). */
function photosOnScreen({ base, zoom, aerialsHere }) {
  // 'best' below z11 is Sentinel-2 2025; from z11, Mapbox under any local photos.
  const bestFar = base === 'best' && zoom != null && zoom < LOCAL_AERIALS_SHOW_FROM
  const b = BASE_IMAGERY.find((x) => x.id === (bestFar ? BEST_BASE : base)) || BASE_IMAGERY[0]
  const label = b.id === 'mapbox' ? 'Mapbox satellite (dates vary)' : b.label
  return { shown: aerialsHere.filter((a) => a.shown), base: { id: b.id, label, href: b.href || (b.source?.attribution.match(/href="([^"]+)"/) || [])[1] } }
}

/** One plain-text line for clips and share cards, e.g. "Photos: San Juan County 2025 over Mapbox satellite · © Mapbox © Maxar". */
export function photoCreditText(photos) {
  if (!photos?.mapReady || !photos.satellite) return '© Mapbox © OpenStreetMap'
  const { shown, base } = photosOnScreen(photos)
  const local = shown.map((a) => `${a.name} ${a.year}`).join(', ')
  return `Photos: ${local ? `${local} over ` : ''}${base.label} · © Mapbox${base.id === 'mapbox' || shown.length ? ' © Maxar' : ''}`
}

/**
 * Which photos are on screen, each linked to where they come from (Josh 2026-10-16), just above the map credits.
 * Satellite basemap only. raise: extra px for a site with its own bar along the bottom (e.g. /whalewatch's time bar).
 */
export function ImageryLine({ photos, mapRef, className = '', raise = 0 }) {
  const [creditsH, setCreditsH] = useState(24)
  const { mapReady, satellite } = photos || {}
  useEffect(() => {
    const el = mapRef?.current?.getContainer().querySelector('.mapboxgl-ctrl-bottom-right')
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setCreditsH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [mapRef, mapReady])
  if (!photos || !mapReady || !satellite) return null
  const { shown, base: b } = photosOnScreen(photos)
  return (
    <div className={`${s.imageryLine} ${className}`} style={{ bottom: creditsH + 6 + raise }}>
      Photos:{' '}
      {shown.map((a, i) => <span key={a.key}>{i > 0 && ', '}<a href={a.href} target="_blank" rel="noopener noreferrer">{a.name} {a.year}</a></span>)}
      {shown.length > 0 && ' over '}
      <a href={b.href} target="_blank" rel="noopener noreferrer">{b.label}</a>
    </div>
  )
}
