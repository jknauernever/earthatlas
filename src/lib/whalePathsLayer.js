/**
 * Whale paths on a Mapbox map (Josh 2026-10-26): one shared layer for /whalewatch, /whales and /shiptraffic.
 * Paths come from lib/whales/paths.js chainSightings(): a line through a group's reports in time order, a small dot at
 * each report, a larger dot at the newest with its label ("Orca · T37A, T37A2 · seen 10× over 3 h 25 min"). A click on
 * a path lists its reports, each with its source credited and linked (prime directive: source beside value).
 */
import mapboxgl from 'mapbox-gl'
import { whaleName, whaleCredit, whaleLinkLabel } from './whales.js'
import { pathSpan } from '../../lib/whales/paths.js'
import { whalesIn } from '../../lib/whales/precision.js'

const esc = (x) => String(x ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
const plural = (name, n) => (n === 1 ? name : /s$/i.test(name) ? name : `${name}s`)
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver' })
const fmtAgo = (min) => (min < 1 ? 'just now' : min < 60 ? `${Math.round(min)} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} days ago`)

/** One label per path: species (and named animals), then how often and how long it was followed. */
export function pathLabel(p, { ago = false, now = Date.now() } = {}) {
  const who = `${p.whales > 1 ? `${p.whales} ` : ''}${plural(p.species, p.whales)}${p.ids.length ? ` · ${p.ids.slice(0, 4).join(', ')}${p.ids.length > 4 ? '…' : ''}` : ''}`
  return `${who} · ${pathSpan(p)}${ago ? ` · ${fmtAgo((now - p.lastMs) / 60000)}` : ''}`
}

function pathPopupHTML(p) {
  const rows = [...p.members].reverse().slice(0, 12).map((s) => {
    const n = whalesIn(s)
    const link = s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(whaleLinkLabel(s))}</a>` : ''
    const note = s.remarks ? `<br><span style="color:#374151">${esc(String(s.remarks).replace(/^\[[^\]]+\]\s*/, '').slice(0, 140))}</span>` : ''
    return `<div style="margin-top:6px"><b>${esc(fmtTime(Date.parse(s.observed_at)))}</b> · ${esc(whaleName(s))}${n > 1 ? ` × ${n}` : ''}${note}<br>` +
      `<span style="color:#4b5563">${esc(whaleCredit(s))}</span>${link}</div>`
  }).join('')
  const more = p.members.length > 12 ? `<div style="color:#4b5563;margin-top:4px">and ${p.members.length - 12} earlier reports</div>` : ''
  return `<div style="padding:6px 10px;color:#111827;font-size:12px;line-height:1.45;max-width:290px;max-height:340px;overflow:auto">` +
    `<b>${esc(pathLabel(p))}</b><br><span style="color:#4b5563">${esc(fmtTime(p.firstMs))} – ${esc(fmtTime(p.lastMs))}. Reports of the same animals ` +
    `joined in time order (same species, a plausible swim apart; reports naming different animals are never joined). Newest first:</span>${rows}${more}</div>`
}

/**
 * Draw (or update) whale paths. `prefix` keeps each site's layer ids apart; `color` is a color or a function of the
 * path; `labels` = 'all' | 'none'; `ago` adds "25 min ago" to labels (live views); `fadeHours` fades paths by the age of
 * their newest report (0 = no fade); `beforeId` puts them under that layer; `points: false` draws the lines only (a site
 * that already draws every report as a dot). Pass paths = [] to clear.
 */
export function drawWhalePaths(map, paths, { prefix, color, labels = 'all', ago = false, fadeHours = 0, beforeId, popupClass, now = Date.now(), labelMinZoom = 8.5, points = true } = {}) {
  const SRC = `${prefix}-wpaths`, LINE = `${prefix}-wpath-line`, CASE = `${prefix}-wpath-case`, DOT = `${prefix}-wpath-dot`, END = `${prefix}-wpath-end`, LABEL = `${prefix}-wpath-label`
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined
  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    const fade = (full) => ['interpolate', ['linear'], ['get', 'ageH'], 0, full, Math.max(0.01, fadeHours || 1e6), full * 0.45]
    map.addLayer({ id: CASE, type: 'line', source: SRC, filter: ['==', ['get', 'k'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': 'rgba(10,14,23,0.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.4, 12, 4.5], 'line-opacity': fade(1) } }, before)
    map.addLayer({ id: LINE, type: 'line', source: SRC, filter: ['==', ['get', 'k'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 12, 2.6], 'line-opacity': fade(0.95) } }, before)
    map.addLayer({ id: DOT, type: 'circle', source: SRC, filter: ['==', ['get', 'k'], 'dot'],
      paint: { 'circle-color': ['get', 'c'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.8, 12, 3.6],
        'circle-stroke-color': '#0a0e17', 'circle-stroke-width': 0.8, 'circle-opacity': fade(0.95), 'circle-stroke-opacity': fade(0.8) } }, before)
    map.addLayer({ id: END, type: 'circle', source: SRC, filter: ['==', ['get', 'k'], 'end'],
      paint: { 'circle-color': ['get', 'c'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 12, 7.5],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.6, 'circle-opacity': fade(1), 'circle-stroke-opacity': fade(1) } }, before)
    map.addLayer({ id: LABEL, type: 'symbol', source: SRC, minzoom: labelMinZoom, filter: ['==', ['get', 'k'], 'end'], layout: {
      'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0.9, 0], 'text-anchor': 'left', 'text-optional': true, 'text-max-width': 16,
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
      paint: { 'text-color': '#f8fafc', 'text-halo-color': 'rgba(10,14,23,0.9)', 'text-halo-width': 1.4, 'text-opacity': fade(1) } }, before)
    const pop = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, offset: 10, className: popupClass, maxWidth: '310px' })
    map[`__${prefix}PathPop`] = pop
    for (const id of [LINE, END, DOT]) {
      map.on('click', id, (e) => {
        const p = map[`__${prefix}Paths`]?.[e.features[0]?.properties.i]
        if (p) pop.setLngLat(e.lngLat).setHTML(pathPopupHTML(p)).addTo(map)
      })
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
    }
  }
  map.setLayoutProperty(LABEL, 'visibility', labels === 'none' ? 'none' : 'visible')
  for (const id of [DOT, END]) map.setLayoutProperty(id, 'visibility', points ? 'visible' : 'none')
  // A jump in the time shown (replay) leaves an open path popup describing another moment: close it.
  if (Math.abs(now - (map[`__${prefix}PathsAt`] ?? now)) > 10 * 60e3) map[`__${prefix}PathPop`]?.remove()
  map[`__${prefix}PathsAt`] = now
  map[`__${prefix}Paths`] = paths
  const features = []
  paths.forEach((p, i) => {
    const c = typeof color === 'function' ? color(p) : color
    const ageH = Math.max(0, (now - p.lastMs) / 3600e3)
    const pts = p.members.map((m) => [m.lng, m.lat])
    features.push({ type: 'Feature', properties: { k: 'line', i, c, ageH }, geometry: { type: 'LineString', coordinates: pts } })
    for (const q of pts.slice(0, -1)) features.push({ type: 'Feature', properties: { k: 'dot', i, c, ageH }, geometry: { type: 'Point', coordinates: q } })
    features.push({ type: 'Feature', properties: { k: 'end', i, c, ageH, label: pathLabel(p, { ago, now }) }, geometry: { type: 'Point', coordinates: pts[pts.length - 1] } })
  })
  map.getSource(SRC).setData({ type: 'FeatureCollection', features })
}

/** Move a site's path layers to the top (after layers added later, e.g. boats). */
export function raiseWhalePaths(map, prefix) {
  for (const id of ['wpath-case', 'wpath-line', 'wpath-dot', 'wpath-end', 'wpath-label']) if (map.getLayer(`${prefix}-${id}`)) map.moveLayer(`${prefix}-${id}`)
}
