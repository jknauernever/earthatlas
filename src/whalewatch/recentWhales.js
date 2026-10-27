/**
 * /whalewatch: whale reports from the last few hours beside the live boats (Josh 2026-10-18).
 *
 * Reports come from the EarthAtlas whale database (/api/whales: Whale Alert with Orca Network and its other channels,
 * SalishSea.io, Orcasound, HappyWhale, iNaturalist), which re-reads the fast Salish Sea feeds every 10 minutes. Only
 * reports with an exact time in the last `hours` show; date-only reports can't be placed in that window. Reports of the
 * same animals (same species, same day, within 2 km and 2 h: lib/whales/precision.js) draw as one dot, labeled with the
 * whales seen and how long ago. Every dot's popup credits and links its reports (prime directive: source beside value).
 * Reports of the same animals over the PATH_HOURS before the time shown are joined into paths (lib/whales/paths.js,
 * drawn by src/lib/whalePathsLayer.js, Josh 2026-10-26); a dot is drawn only for reports not on a path. In replay the
 * same is shown for the hour picked.
 */
import { useEffect, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { fetchWhales, whaleName, whaleSourceLabel, whaleCredit, whaleLinkLabel } from '../lib/whales.js'
import { groupSightings, whalesIn } from '../../lib/whales/precision.js'
import { chainSightings } from '../../lib/whales/paths.js'
import { drawWhalePaths, raiseWhalePaths } from '../lib/whalePathsLayer.js'

export const RECENT_HOURS = 3
export const PATH_HOURS = 12
export const WHALE_COLOR = '#ec4899'   // the whale magenta used on /shiptraffic and /whales
const REFRESH_MS = 5 * 60 * 1000
const BOX = { minLng: -125.5, minLat: 46.8, maxLng: -121.8, maxLat: 50.6 }   // Salish Sea + approaches (PORT_BOX)
const SRC = 'ww-whales', DOT = 'ww-whale-dot', LABEL = 'ww-whale-label'

const esc = (x) => String(x ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
const plural = (name, n) => (n === 1 ? name : /s$/i.test(name) ? name : `${name}s`)
export const fmtAgoMin = (min) => (min < 1 ? 'just now' : min < 60 ? `${Math.round(min)} min ago` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min ago`)
const tOf = (s) => Date.parse(s.observed_at)
// "25 min ago" live; "25 min before" in replay (relative to the hour shown).
const agoAt = (min, live) => (live ? fmtAgoMin(min) : fmtAgoMin(min).replace(/ ago$/, ' before').replace(/^just now$/, 'at that time'))

/**
 * Whale reports with an exact time before `endS` (epoch s; null = now, refreshed every 5 min): paths over the last
 * PATH_HOURS, and the reports of the last `hours` that are on no path, grouped. Fetched once per day range.
 */
export function useRecentWhales(enabled, endS = null, hours = RECENT_HOURS) {
  const [state, setState] = useState({ groups: [], paths: [], fetchedAt: null, error: null, endMs: null })
  const live = endS == null
  const day = (ms) => new Date(ms).toISOString().slice(0, 10)
  const endMs = live ? null : endS * 1000
  const span = live ? 'live' : `${day(endMs - (PATH_HOURS + 24) * 3600e3)}|${day(endMs + 86400e3)}`
  const [rows, setRows] = useState({ span: null, sightings: [] })
  useEffect(() => {
    if (!enabled) return undefined
    let stop = false
    const ac = new AbortController()
    const load = async () => {
      const now = Date.now()
      const [from, to] = live ? [day(now - (PATH_HOURS + 24) * 3600e3), day(now + 86400e3)] : span.split('|')
      try {
        const d = await fetchWhales({ bounds: BOX, from, to, group: 'cetacean', limit: 2000, signal: ac.signal })
        if (!stop) setRows({ span, sightings: d.sightings || [], fetchedAt: now })
      } catch (e) {
        if (!stop && e.name !== 'AbortError') setState((s) => ({ ...s, error: String(e.message || e) }))
      }
    }
    load()
    const id = live ? setInterval(load, REFRESH_MS) : null
    return () => { stop = true; ac.abort(); if (id) clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, span])
  useEffect(() => {
    if (rows.span !== span) return
    const end = live ? rows.fetchedAt : endMs
    const exact = rows.sightings.filter((s) => s.time_precision === 'exact' && s.observed_at && tOf(s) <= end + 5 * 60e3)
    const paths = chainSightings(exact.filter((s) => end - tOf(s) <= PATH_HOURS * 3600e3))
    const onPath = new Set(paths.flatMap((p) => p.members.map((m) => m.id)))
    const recent = exact.filter((s) => end - tOf(s) <= hours * 3600e3 && !onPath.has(s.id))
    const groups = groupSightings(recent).map((g) => {
          // Drawn where the animals were: the newest report that gave the group's number (not a shore station's log).
          const counted = g.members.filter((m) => whalesIn(m) === g.whales)
          const pool = counted.length ? counted : g.members
          const at = pool.reduce((a, b) => (tOf(b) > tOf(a) ? b : a), pool[0])
          const newest = g.members.reduce((a, b) => (tOf(b) > tOf(a) ? b : a), g.members[0])
          return { ...g, at, newestMs: tOf(newest) }
        })
    setState({ groups, paths, fetchedAt: rows.fetchedAt, error: null, endMs: end })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, span, endMs, hours])
  return state
}

/** The nearest recent whale group to a point: { km, group, ageMin } or null. */
export function nearestWhale(groups, lng, lat, paths = []) {
  let best = null
  const pathGroups = paths.filter((p) => Date.now() - p.lastMs <= RECENT_HOURS * 3600e3)
    .map((p) => ({ members: p.members, whales: p.whales, species: p.species, newestMs: p.lastMs }))
  for (const g of [...groups, ...pathGroups]) {
    for (const m of g.members) {
      const k = Math.cos((((lat + m.lat) / 2) * Math.PI) / 180)
      const km = Math.hypot((m.lng - lng) * k * 111.32, (m.lat - lat) * 111.32)
      if (!best || km < best.km) best = { km, group: g, ageMin: (Date.now() - g.newestMs) / 60000 }
    }
  }
  return best
}

/** One line for a live boat's hover: the nearest whale report in the last few hours, with its source. */
export function nearestWhaleHTML(groups, lng, lat, hours = RECENT_HOURS, paths = []) {
  const n = nearestWhale(groups, lng, lat, paths)
  if (!n) return `<div style="padding:0 10px 6px;color:#4b5563;font-size:12px">No whale reports in the last ${hours} hours</div>`
  const g = n.group
  const dist = n.km < 1 ? `${Math.round(n.km * 1000)} m` : `${n.km < 10 ? n.km.toFixed(1) : Math.round(n.km)} km`
  const srcs = [...new Set(g.members.map(whaleSourceLabel))].join(', ')
  return `<div style="padding:0 10px 6px;color:#111827;font-size:12px;line-height:1.45"><b style="color:${WHALE_COLOR}">Nearest whale report</b>: ${dist} away · ` +
    `${g.whales} ${esc(plural(g.species, g.whales))}, ${esc(fmtAgoMin(n.ageMin))}<br><span style="color:#4b5563">Source: ${esc(srcs)}</span></div>`
}

function groupPopupHTML(g, endMs, live) {
  const rows = [...g.members].sort((a, b) => tOf(b) - tOf(a)).slice(0, 6).map((s) => {
    const n = whalesIn(s)
    const link = s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(whaleLinkLabel(s))}</a>` : ''
    return `<div style="margin-top:5px">${esc(whaleName(s))}${n > 1 ? ` × ${n}` : ''}${s.observer ? ` · ${esc(s.observer)}` : ''}<br>` +
      `<span style="color:#4b5563">${esc(agoAt((endMs - tOf(s)) / 60000, live))} · ${esc(whaleCredit(s))}</span>${link}</div>`
  }).join('')
  const more = g.members.length > 6 ? `<div style="color:#4b5563;margin-top:4px">and ${g.members.length - 6} more reports</div>` : ''
  return `<div style="padding:6px 10px;color:#111827;font-size:12px;line-height:1.45;max-width:270px">` +
    `<b>${g.whales} ${esc(plural(g.species, g.whales))}</b>, reported ${esc(agoAt((endMs - g.newestMs) / 60000, live))}` +
    `${g.members.length > 1 ? `<br><span style="color:#4b5563">${g.members.length} reports of the same animals (same species, within 2 km and 2 hours), counted once at the largest number given</span>` : ''}` +
    `${rows}${more}</div>`
}

/** Draw (or update) the whale paths and the recent-whale dots on the map. `hidden` hides them (switched off). */
export function drawRecentWhales(map, groups, hidden, hoverClass, paths = [], endMs = Date.now(), live = true) {
  drawWhalePaths(map, hidden ? [] : paths, { prefix: 'ww', color: WHALE_COLOR, ago: live, fadeHours: PATH_HOURS, popupClass: hoverClass, now: endMs })
  raiseWhalePaths(map, 'ww')
  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: DOT, type: 'circle', source: SRC, paint: {
      // Size = whales seen (√, so 27 orcas isn't 27× one); fresher = more solid (age in minutes, 0 … RECENT_HOURS h).
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, ['+', 4, ['min', 7, ['*', 1.1, ['sqrt', ['get', 'w']]]]], 12, ['+', 7, ['min', 12, ['*', 1.8, ['sqrt', ['get', 'w']]]]]],
      'circle-color': WHALE_COLOR,
      'circle-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 0.95, RECENT_HOURS * 60, 0.45],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
      'circle-stroke-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 1, RECENT_HOURS * 60, 0.5],
    } })
    map.addLayer({ id: LABEL, type: 'symbol', source: SRC, minzoom: 8.5, layout: {
      'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true,
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
      paint: { 'text-color': '#fce7f3', 'text-halo-color': 'rgba(10,14,23,0.9)', 'text-halo-width': 1.4 } })
    const pop = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, offset: 10, className: hoverClass, maxWidth: '290px' })
    map.on('click', DOT, (e) => {
      const f = e.features[0]
      const g = map.__wwWhaleGroups?.[f?.properties.i]
      if (g) pop.setLngLat(f.geometry.coordinates).setHTML(groupPopupHTML(g, map.__wwWhaleEnd ?? Date.now(), map.__wwWhaleLive ?? true)).addTo(map)
    })
    map.on('mouseenter', DOT, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', DOT, () => { map.getCanvas().style.cursor = '' })
  }
  for (const id of [DOT, LABEL]) map.moveLayer(id)   // on top, also of boat layers added after us
  map.__wwWhaleGroups = groups
  map.__wwWhaleEnd = endMs
  map.__wwWhaleLive = live
  const now = endMs
  map.getSource(SRC).setData({ type: 'FeatureCollection', features: hidden ? [] : groups.map((g, i) => {
    const age = Math.max(0, (now - g.newestMs) / 60000)
    return { type: 'Feature', properties: { i, w: g.whales, age, label: `${g.whales} ${plural(g.species, g.whales)} · ${agoAt(age, live)}` },
      geometry: { type: 'Point', coordinates: [g.at.lng, g.at.lat] } }
  }) })
}
