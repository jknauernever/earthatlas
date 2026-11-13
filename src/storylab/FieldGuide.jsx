/**
 * Mode A — Field Guide (the hub). Left panel: headline, paragraph, view
 * switch, layers as toggles under four plain headings. Globe fills the rest.
 * Legend card bottom right; Explain this view + Fly to a place top right.
 */

import { useState } from 'react'
import GeoSearch from '../components/GeoSearch.jsx'
import PoweredBy from '../components/PoweredBy.jsx'
import LegalLinks from '../components/LegalLinks.jsx'
import { GROUPS, COPY, defFor } from './layers.js'
import LegendCard from './LegendCard.jsx'
import s from './StoryLab.module.css'

export function Brand({ sub }) {
  return (
    <div className={s.brand}>
      <a href="/" className={s.brandName}>EarthAtlas</a>
      <span className={s.brandSub}>{sub}</span>
    </div>
  )
}

export function BuiltBy() {
  return (
    <div className={s.builtBy}>
      <PoweredBy />
      EarthAtlas is built by{' '}
      <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer">KnauerNever.com</a>
      <LegalLinks />
    </div>
  )
}

export function ViewSwitch({ view, setView, compact }) {
  const opts = [['globe', 'Globe'], ['flat', compact ? 'Flat' : 'Flat map']]
  return (
    <div className={s.seg} role="group" aria-label="View as">
      {opts.map(([id, label]) => (
        <button key={id} type="button" className={view === id ? s.segOn : s.segBtn} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>
      ))}
    </div>
  )
}

export function Toggle({ id, on, status, onClick }) {
  const def = defFor(id)
  return (
    <button type="button" className={s.toggle} aria-pressed={on} onClick={onClick}>
      <span className={on ? s.trackOn : s.track}><span className={s.knob} /></span>
      <span className={s.toggleName}>{COPY[id]?.name || def?.name}</span>
      {on && status === 'loading' && <span className={s.toggleNote}>loading…</span>}
      {on && status === 'error' && <span className={s.toggleErr}>unavailable now</span>}
    </button>
  )
}

export function PlaceSearch({ globeRef, onSelect, placeholder = 'Fly to a place', className }) {
  return (
    <div className={`${s.search} ${className || ''}`}>
      <GeoSearch
        placeholder={placeholder}
        className={s.geoSearch}
        proximity={() => {
          const m = globeRef.current?.getMap()
          if (!m) return undefined
          try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined }
        }}
        onSelect={(r) => {
          if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return
          onSelect({ lat: r.lat, lng: r.lng, name: r.name || r.place_formatted || '' })
        }}
      />
    </div>
  )
}

export default function FieldGuide({ globeRef, layers, legendId, status, view, setView, toggleLayer, openHere, openStories, useMyLocation, isMobile }) {
  const [locating, setLocating] = useState(false)
  const [sheet, setSheet] = useState(1) // phone bottom sheet: 0 peek, 1 half, 2 full
  const locate = async () => {
    setLocating(true)
    const ok = await useMyLocation()
    setLocating(false)
    if (!ok) alert('Your location is not available. Search for a place instead.')
  }

  const layerList = (
    <>
      {GROUPS.map((g) => (
        <div key={g.id} className={s.group}>
          <div className={s.eyebrow}>{g.label}</div>
          {isMobile ? (
            <div className={s.chipWrap}>
              {g.ids.map((id) => (
                <button key={id} type="button" className={layers.includes(id) ? s.chipOn : s.chip} aria-pressed={layers.includes(id)} onClick={() => toggleLayer(id)}>
                  {COPY[id]?.name}
                </button>
              ))}
            </div>
          ) : g.ids.map((id) => (
            <Toggle key={id} id={id} on={layers.includes(id)} status={status.layerStatus[id]} onClick={() => toggleLayer(id)} />
          ))}
        </div>
      ))}
    </>
  )

  const explainBtn = (
    <button
      type="button"
      className={s.explainBtn}
      onClick={() => globeRef.current?.explain()}
      disabled={!status.anyExplainable}
      title={status.anyExplainable ? 'Analyze what you’re seeing' : 'Turn on a layer first'}
    >
      {isMobile ? 'Explain' : 'Explain this view'}
    </button>
  )

  if (isMobile) {
    return (
      <>
        <header className={s.phoneHead}>
          <div>
            <span className={s.brandSub}>EARTHATLAS · IN MOTION</span>
            <h1 className={s.phoneTitle}>A planet that never sits still</h1>
          </div>
          <button type="button" className={s.storiesBtn} onClick={openStories}>Stories</button>
        </header>
        <div className={s.phoneTools}>
          <PlaceSearch globeRef={globeRef} onSelect={openHere} placeholder="Search for a place" className={s.phoneSearch} />
          <button type="button" className={s.iconBtn} onClick={locate} aria-label="Use my location" disabled={locating}><LocateIcon /></button>
          {explainBtn}
        </div>
        <section className={`${s.sheet} ${s[`sheet${sheet}`]}`} aria-label="Layers and legend">
          <button type="button" className={s.sheetHandle} onClick={() => setSheet((sheet + 1) % 3)} aria-label={['Show layers', 'Show more about this layer', 'Collapse panel'][sheet]}>
            <span />
          </button>
          <LegendCard id={legendId} status={status} embedded onTitleClick={() => setSheet(sheet === 0 ? 1 : sheet)} />
          {sheet >= 1 && (
            <div className={s.sheetBody}>
              {layerList}
              <BuiltBy />
            </div>
          )}
        </section>
      </>
    )
  }

  return (
    <>
      <aside className={s.panel}>
        <div className={s.panelTop}>
          <Brand sub="IN MOTION" />
          <button type="button" className={s.storiesBtn} onClick={openStories}>Stories</button>
        </div>
        <div className={s.intro}>
          <h1 className={s.h1}>A planet that never sits still</h1>
          <p className={s.lede}>Air, water and life are always moving. Pick something below to watch it flow, then click anywhere on the globe to see what is happening there right now.</p>
        </div>
        <div className={s.rule} />
        {layerList}
        <BuiltBy />
      </aside>
      <div className={s.topRight}>
        {explainBtn}
        <PlaceSearch globeRef={globeRef} onSelect={openHere} />
        <button type="button" className={s.iconBtn} onClick={locate} aria-label="Use my location" title="Use my location" disabled={locating}><LocateIcon /></button>
      </div>
      <div className={s.hint}>Drag to spin. Click anywhere for conditions there.</div>
      <LegendCard id={legendId} status={status} />
    </>
  )
}

export function LocateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  )
}
