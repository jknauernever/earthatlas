/**
 * Hidden live view for /ships (Josh 2026-10-18): earthatlas.org/ships?live=1 shows where every ship our aisstream.io
 * recorder hears in the Salish Sea box is now (its newest AIS report), like /whalewatch's LIVE. No button or link yet.
 *
 * Data: the recorder's snapshot (scripts/ships/aisstream/recorder.mjs → Blob ships/live/salish-v6.json, rewritten every
 * 60 s: the latest position per MMSI from the last 24 h, and 30-minute trails for ships under way). Polled every minute
 * while the tab is visible. Shown: ships reported in the last SHOW_H hours, colored by the AIS ship type they broadcast
 * (the same kinds as the track filter), arrows for ships under way (pointing along heading, or course when no heading),
 * dots for the rest, fainter the older the report. Hover: name, kind, speed, heading, how long ago, source. Click: the
 * ship's card (openShipRef, the track click's opener). Localhost falls back to public/dev-data/aisstream-live.json.
 */
import { useEffect, useMemo, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { TRACK_KINDS } from './TrackControls.jsx'

const LIVE_URL = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/live/salish-v6.json'
const LIVE_DEV_URL = '/dev-data/aisstream-live.json'
const AISSTREAM = 'https://aisstream.io'
const POLL_MS = 60_000
const SHOW_H = 2              // ships reported in the last 2 hours ("where ships are now")
const MOVING_KN = 1
const SRC = 'live-ships', TRAILS = 'live-ships-trails', ARROW = 'live-ships-arrow', DOT = 'live-ships-dot', TRAIL = 'live-ships-trail'
// Each recorded position on a trail, as a dot (Josh 2026-10-18: see the observations behind a line that crosses land).
const TRAIL_PTS = 'live-ships-trail-pts', TRAIL_PT = 'live-ships-trail-pt'
// Categorical colors, readable on the satellite basemap.
export const LIVE_KIND_COLOR = { cargo: '#60a5fa', tanker: '#f87171', passenger: '#c084fc', fishing: '#34d399', tug: '#fb923c',
  pleasure: '#f472b6', other: '#e5e7eb', unknown: '#9ca3af' }
const KIND_LABEL = Object.fromEntries(TRACK_KINDS)
// AIS ship & cargo code → kind (scripts/ships/bake-ais/build_tracks.py KIND_SQL).
function kindOf(v) {
  if (!v) return 'unknown'
  if ([30, 1001, 1002].includes(v)) return 'fishing'
  if ([31, 32, 52, 1023, 1025].includes(v)) return 'tug'
  if ([36, 37, 1019].includes(v)) return 'pleasure'
  if ([40, 1012, 1013, 1014, 1015].includes(v) || (v >= 60 && v <= 69)) return 'passenger'
  if ((v >= 70 && v <= 79) || [1003, 1004, 1016].includes(v)) return 'cargo'
  if ((v >= 80 && v <= 89) || [1017, 1024].includes(v)) return 'tanker'
  return 'other'
}
const esc = (x) => String(x ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
const fmtAgo = (s) => (s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 360) / 10} h ago`)
const fmtClock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver', timeZoneName: 'short' })
const pad3 = (d) => String(Math.round(d) % 360).padStart(3, '0')

function tipHTML(p) {
  const kind = KIND_LABEL[p.kind] || 'Not reported'
  const motion = p.moving ? `${Number(p.sog).toFixed(1)} kn · heading ${pad3(p.dir)}°`
    : `<span style="color:#4b5563">${p.sog != null ? `${Number(p.sog).toFixed(1)} kn` : 'Speed not reported'} (not under way)</span>`
  return `<div style="padding:6px 10px;color:#111827;font-size:12px;line-height:1.45">`
    + `<b>${esc(p.name || 'Name not broadcast')}</b><br><span style="color:#4b5563">${esc(kind)} (AIS type${p.vtype ? ` ${p.vtype}` : ' not reported'}) · MMSI ${p.mmsi}</span><br>`
    + `<b style="color:#047857">Live AIS</b>, reported ${fmtAgo(p.ageS)} (${fmtClock(p.t * 1000)})<br>${motion}<br>`
    + `<span style="color:#4b5563">Source: aisstream.io live AIS · click for the ship’s card</span></div>`
}

// A white arrow (pointing north) for an SDF icon, recolored per kind by the layer.
function arrowImage() {
  const s = 48, c = document.createElement('canvas'); c.width = c.height = s
  const g = c.getContext('2d')
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(s / 2, 3); g.lineTo(s - 9, s - 6); g.lineTo(s / 2, s - 15); g.lineTo(9, s - 6); g.closePath(); g.fill()
  return g.getImageData(0, 0, s, s)
}

export default function LiveShips({ map, mapReady, styleVersion, openShipRef, tipClass }) {
  const [snap, setSnap] = useState(null)
  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    let stop = false
    const load = async () => {
      if (document.hidden) return
      setNowS(Math.floor(Date.now() / 1000))
      let s = await fetch(LIVE_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      if (!s && import.meta.env.DEV) s = await fetch(LIVE_DEV_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      if (!stop && s?.ships) setSnap(s)
    }
    load()
    const id = setInterval(load, POLL_MS)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { stop = true; clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  const data = useMemo(() => {
    const points = [], trails = [], trailPts = [], byKind = {}
    for (const [mmsi, t, lon, lat, sog, cog, heading, , , name, vtype] of snap?.ships || []) {
      const ageS = nowS - t
      if (ageS > SHOW_H * 3600) continue
      const kind = kindOf(vtype)
      const moving = (sog ?? 0) >= MOVING_KN
      byKind[kind] = (byKind[kind] || 0) + 1
      points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { mmsi, t, sog, dir: heading ?? cog ?? 0, moving: moving ? 1 : 0, kind, color: LIVE_KIND_COLOR[kind], name: name || '', vtype: vtype || 0, ageS } })
      const tr = moving ? snap.trails?.[mmsi] : null
      if (tr?.length >= 2) {
        trails.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: tr.map((q) => [q[0], q[1]]) }, properties: { color: LIVE_KIND_COLOR[kind] } })
        tr.forEach((q, i) => trailPts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [q[0], q[1]] },
          properties: { color: LIVE_KIND_COLOR[kind], name: name || `MMSI ${mmsi}`, t: q[2] ?? null, i: i + 1, n: tr.length } }))
      }
    }
    return { points, trails, trailPts, byKind }
  }, [snap, nowS])

  // Layers (re-added after a basemap swap: styleVersion).
  useEffect(() => {
    if (!map || !mapReady) return
    if (!map.getSource(SRC)) {
      if (!map.hasImage('live-arrow')) map.addImage('live-arrow', arrowImage(), { sdf: true, pixelRatio: 2 })
      map.addSource(TRAILS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource(TRAIL_PTS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] },
        attribution: 'Live ships: AIS from <a href="https://aisstream.io" target="_blank" rel="noopener">aisstream.io</a>, recorded by EarthAtlas' })
      const fade = ['interpolate', ['linear'], ['get', 'ageS'], 0, 1, 1800, 0.85, SHOW_H * 3600, 0.4]
      map.addLayer({ id: TRAIL, type: 'line', source: TRAILS, layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 12, 2.5], 'line-opacity': 0.75 } })
      map.addLayer({ id: TRAIL_PT, type: 'circle', source: TRAIL_PTS, minzoom: 10,
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 3.5],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } })
      map.addLayer({ id: DOT, type: 'circle', source: SRC, filter: ['!=', ['get', 'moving'], 1],
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2.2, 12, 4.5],
          'circle-stroke-color': '#0a0e17', 'circle-stroke-width': 1, 'circle-opacity': fade, 'circle-stroke-opacity': fade } })
      map.addLayer({ id: ARROW, type: 'symbol', source: SRC, filter: ['==', ['get', 'moving'], 1],
        layout: { 'icon-image': 'live-arrow', 'icon-rotate': ['get', 'dir'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true,
          'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.45, 12, 0.85] },
        paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': '#0a0e17', 'icon-halo-width': 1.2, 'icon-opacity': fade } })
      const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: tipClass, maxWidth: '280px' })
      map.on('mousemove', TRAIL_PT, (e) => {
        const f = e.features[0]
        if (!f) return
        const q = f.properties
        tip.setLngLat(f.geometry.coordinates).setHTML(`<div style="padding:6px 10px;color:#111827;font-size:12px;line-height:1.45"><b>${String(q.name).replace(/[<>&]/g, '')}</b>`
          + `<br>Recorded position ${q.i} of ${q.n}${q.t ? ` · ${fmtClock(q.t * 1000)}` : ''}<br><span style="color:#4b5563">${f.geometry.coordinates[1].toFixed(5)}, ${f.geometry.coordinates[0].toFixed(5)} · aisstream.io</span></div>`).addTo(map)
      })
      map.on('mouseleave', TRAIL_PT, () => tip.remove())
      for (const id of [ARROW, DOT]) {
        map.on('mousemove', id, (e) => {
          map.getCanvas().style.cursor = 'pointer'
          const f = e.features[0]
          if (f) tip.setLngLat(f.geometry.coordinates).setHTML(tipHTML(f.properties)).addTo(map)
        })
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; tip.remove() })
        map.on('click', id, (e) => {
          const p = e.features[0]?.properties
          if (!p) return
          tip.remove()
          openShipRef?.current?.(p.mmsi, p.t, new Date(p.t * 1000).toISOString().slice(0, 7))
        })
      }
    }
    map.getSource(TRAILS).setData({ type: 'FeatureCollection', features: data.trails })
    map.getSource(TRAIL_PTS).setData({ type: 'FeatureCollection', features: data.trailPts })
    map.getSource(SRC).setData({ type: 'FeatureCollection', features: data.points })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapReady, styleVersion, data])

  const updated = snap?.generated ? Date.parse(snap.generated) : null
  const narrow = typeof window !== 'undefined' && window.innerWidth < 768
  const kinds = TRACK_KINDS.filter(([k]) => data.byKind[k])
  return (
    // Beside the left panel on desktop (it is ~330 px wide); full width under the top bar on phones.
    <div style={{ position: 'absolute', top: 64, ...(narrow ? { left: 16, right: 16 } : { left: 344, maxWidth: 'min(560px, calc(100vw - 620px))' }), zIndex: 5,
      background: 'rgba(10,14,23,0.88)', color: '#e5e7eb', borderRadius: 10, padding: '8px 12px', fontSize: 12, lineHeight: 1.45,
      boxShadow: '0 2px 10px rgba(0,0,0,0.35)', pointerEvents: 'auto' }}>
      <div>
        <b style={{ color: '#fbbf24', letterSpacing: 0.5 }}>LIVE</b>{' '}
        {snap ? <>{data.points.length.toLocaleString('en-US')} ships reported in the last {SHOW_H} hours · arrows are under way ·{' '}
          <a href={AISSTREAM} target="_blank" rel="noopener noreferrer" style={{ color: '#93c5fd' }}>aisstream.io</a> live AIS, updated {fmtClock(updated)}</>
          : 'Loading live AIS…'}
      </div>
      {kinds.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginTop: 4 }}>
          {kinds.map(([k, label]) => (
            <span key={k} style={{ whiteSpace: 'nowrap' }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: LIVE_KIND_COLOR[k], marginRight: 4 }} />
              {label} {data.byKind[k]}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
