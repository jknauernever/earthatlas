/**
 * Mode C — Here, Now (place-first). Place search, "Use my location", jump-to
 * places, a framed globe centered on the place with a 30-day slider, and six
 * cards answering "What is moving around [place]". Tapping a card opens that
 * layer in the Field Guide, centered on the place (C → A).
 */

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { Brand, PlaceSearch, LocateIcon, BuiltBy } from './FieldGuide.jsx'
import { readPlace, RADIUS_MI } from './here.js'
import s from './StoryLab.module.css'

export const JUMPS = [
  { name: 'Salish Sea', lat: 48.45, lng: -123.05 },
  { name: 'Gulf of Mexico', lat: 25.6, lng: -90.2 },
  { name: 'Amazon', lat: -3.4, lng: -62.2 },
  { name: 'Sahara to Caribbean', lat: 18, lng: -42, zoom: 2.6 },
  { name: 'Great Barrier Reef', lat: -18.3, lng: 147.7 },
  { name: 'Whole planet', planet: true },
]

const RING_SRC = 'storylab-place-ring'

function circle(lat, lng, miles, n = 96) {
  const km = miles * 1.609344
  const coords = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI
    const dLat = (km / 111.32) * Math.cos(a)
    const dLng = (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(a)
    coords.push([lng + dLng, lat + dLat])
  }
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }
}

/** Place dot + 30-mile ring on the shared globe while Here, Now is open. */
function usePlaceMarker(globeRef, place, mapReady) {
  useEffect(() => {
    const map = globeRef.current?.getMap()
    if (!map || !mapReady || !place) return
    const el = document.createElement('div')
    el.className = s.placeDot
    const marker = new mapboxgl.Marker({ element: el }).setLngLat([place.lng, place.lat]).addTo(map)
    const data = circle(place.lat, place.lng, RADIUS_MI)
    const add = () => {
      try {
        if (!map.getSource(RING_SRC)) map.addSource(RING_SRC, { type: 'geojson', data })
        else map.getSource(RING_SRC).setData(data)
        if (!map.getLayer(RING_SRC)) {
          map.addLayer({ id: RING_SRC, type: 'line', source: RING_SRC, paint: { 'line-color': '#F2B544', 'line-width': 2.4, 'line-dasharray': [3, 2], 'line-opacity': 0.95 } })
        }
      } catch { /* style mid-load; style.load below re-adds */ }
    }
    add()
    map.on('style.load', add)
    return () => {
      marker.remove()
      map.off('style.load', add)
      try {
        if (map.getLayer(RING_SRC)) map.removeLayer(RING_SRC)
        if (map.getSource(RING_SRC)) map.removeSource(RING_SRC)
      } catch { /* map gone */ }
    }
  }, [globeRef, place?.lat, place?.lng, mapReady]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** 30-day slider: drives the cards and the globe's replay to the same moment. */
function TimeSlider({ time, setTime, replay }) {
  const [playing, setPlaying] = useState(false)
  const [drag, setDrag] = useState(null)
  const shown = drag ?? time
  useEffect(() => {
    if (!playing) return
    let d = time > 0 ? time : 30
    setTime(d)
    const id = setInterval(() => {
      d -= 1
      if (d <= 0) { setTime(0); setPlaying(false); clearInterval(id); return }
      setTime(d)
    }, 650)
    return () => clearInterval(id)
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps
  // The globe follows the slider (its own transport bar is hidden here).
  useEffect(() => {
    if (!replay?.seek) return
    try {
      replay.pause?.()
      if (time === 0) replay.toLive?.()
      else replay.seek(Date.now() - time * 8.64e7)
    } catch { /* controller torn down */ }
  }, [time, replay])
  const label = shown === 0 ? 'Now' : shown === 1 ? '1 day ago' : `${shown} days ago`
  return (
    <div className={s.slider}>
      <button type="button" className={s.playBtn} onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play past 30 days'}>
        {playing
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>}
      </button>
      <label className={s.sliderLabel}>
        <span>{label}</span>
        <input
          type="range" min="0" max="30" step="1"
          value={30 - shown}
          onChange={(e) => setDrag(30 - Number(e.target.value))}
          onPointerUp={() => { if (drag != null) { setTime(drag); setDrag(null) } }}
          onKeyUp={() => { if (drag != null) { setTime(drag); setDrag(null) } }}
          onBlur={() => { if (drag != null) { setTime(drag); setDrag(null) } }}
          aria-label="Days before now"
        />
      </label>
      <span className={s.sliderNow}>Now</span>
    </div>
  )
}

export default function HereNow({ globeRef, place, setPlace, time, setTime, firstCard, openHere, openGuide, useMyLocation, replay, mapReady, isMobile }) {
  usePlaceMarker(globeRef, place, mapReady)
  const [cards, setCards] = useState(null)
  const [loading, setLoading] = useState(false)
  const [updated, setUpdated] = useState(null)
  const [locating, setLocating] = useState(false)
  const [phoneView, setPhoneView] = useState('list')
  const reqRef = useRef(0)

  useEffect(() => {
    if (!place) { setCards(null); return }
    const req = ++reqRef.current
    setLoading(true)
    const t = setTimeout(() => {
      readPlace(place, time)
        .then((c) => { if (reqRef.current === req) { setCards(c); setUpdated(Date.now()) } })
        .catch(() => { if (reqRef.current === req) setCards([]) })
        .finally(() => { if (reqRef.current === req) setLoading(false) })
    }, 120)
    return () => clearTimeout(t)
  }, [place?.lat, place?.lng, time]) // eslint-disable-line react-hooks/exhaustive-deps

  const ordered = cards && firstCard ? [...cards.filter((c) => c.layers.includes(firstCard)), ...cards.filter((c) => !c.layers.includes(firstCard))] : cards
  const locate = async () => {
    setLocating(true)
    const ok = await useMyLocation()
    setLocating(false)
    if (!ok) alert('Your location is not available. Search for a place instead.')
  }
  const jump = (j) => {
    if (j.planet) { openGuide({ center: { lat: 24, lng: -40 }, zoom: 1.9 }); return }
    openHere({ lat: j.lat, lng: j.lng, name: j.name }, { first: firstCard })
    if (j.zoom) setTimeout(() => globeRef.current?.flyTo({ center: [j.lng, j.lat], zoom: j.zoom, duration: 1600 }), 50)
  }
  const placeName = place?.name || (place ? `${Math.abs(place.lat).toFixed(2)}° ${place.lat >= 0 ? 'N' : 'S'}, ${Math.abs(place.lng).toFixed(2)}° ${place.lng >= 0 ? 'E' : 'W'}` : '')
  const zoomBy = (d) => { const m = globeRef.current?.getMap(); if (m) m.easeTo({ zoom: m.getZoom() + d, duration: 300 }) }
  const recenter = () => place && globeRef.current?.flyTo({ center: [place.lng, place.lat], zoom: 6.2, bearing: 0, pitch: 0, duration: 1000 })

  const cardGrid = (
    <section className={s.cards} aria-label="Conditions here">
      <h1 className={s.hereTitle}>{place ? <>What is moving around {placeName}</> : 'Pick a place'}</h1>
      <p className={s.hereSub}>
        {place
          ? <>Within {RADIUS_MI} miles · {loading ? 'reading the data…' : updated ? `updated ${new Date(updated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''} · tap any card to show it on the globe</>
          : 'Search for a place, use your location, or jump to one below.'}
      </p>
      {place && (
        <div className={s.cardGrid}>
          {(ordered || Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, skeleton: true }))).map((c) => (
            c.skeleton
              ? <div key={c.id} className={`${s.card} ${s.cardSkeleton}`} />
              : (
                <button key={c.id} type="button" className={s.card} onClick={() => openGuide({ layers: c.layers, legend: c.legend, center: place, zoom: 6 })}>
                  <span className={s.eyebrow}>{c.group}</span>
                  <span className={s.cardName}>{c.name}</span>
                  <span className={s.cardValue}>{c.value}</span>
                  <span className={c.warm ? s.cardNoteWarm : s.cardNote}>{c.note}</span>
                </button>
              )
          ))}
        </div>
      )}
      <p className={s.hereFoot}>Each card shows its source and time. Tap a card, then the (i) on its legend for how we get the data.</p>
    </section>
  )

  const header = (
    <header className={s.hereHead}>
      <button type="button" className={s.brandBtn} onClick={() => openGuide({})} title="Back to the Field Guide"><Brand sub="IN MOTION · HERE, NOW" /></button>
      <PlaceSearch globeRef={globeRef} onSelect={(p) => openHere(p, { first: firstCard })} placeholder={placeName || 'Search for a place'} className={s.hereSearch} />
      <button type="button" className={s.pillBtn} onClick={locate} disabled={locating}>{isMobile ? <LocateIcon /> : 'Use my location'}</button>
    </header>
  )
  const jumps = (
    <div className={s.jumps}>
      {!isMobile && <span className={s.eyebrow}>Jump to</span>}
      {JUMPS.filter((j) => !isMobile || j.name !== 'Sahara to Caribbean').map((j) => (
        <button key={j.name} type="button" className={place?.name === j.name ? s.chipOn : s.chip} onClick={() => jump(j)}>{j.name}</button>
      ))}
    </div>
  )
  const globeTools = (
    <>
      <div className={s.zoomBtns}>
        <button type="button" onClick={() => zoomBy(1)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Zoom out">−</button>
        <button type="button" onClick={recenter} aria-label="Reset view"><LocateIcon /></button>
      </div>
      <TimeSlider time={time} setTime={setTime} replay={replay} />
    </>
  )

  return (
    <div className={`${s.here} ${isMobile ? s[`here_${phoneView}`] : ''}`}>
      {header}
      {jumps}
      {isMobile && (
        <div className={s.seg} role="group" aria-label="Show as">
          <button type="button" className={phoneView === 'list' ? s.segOn : s.segBtn} aria-pressed={phoneView === 'list'} onClick={() => setPhoneView('list')}>List</button>
          <button type="button" className={phoneView === 'globe' ? s.segOn : s.segBtn} aria-pressed={phoneView === 'globe'} onClick={() => setPhoneView('globe')}>Globe</button>
        </div>
      )}
      {/* The shared globe is positioned under this frame by StoryLab.module.css. */}
      <div className={s.globeFrame} data-here-frame>{globeTools}</div>
      {(!isMobile || phoneView === 'list') && cardGrid}
      {!isMobile && <div className={s.hereBuilt}><BuiltBy /></div>}
    </div>
  )
}
