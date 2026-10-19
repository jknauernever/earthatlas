/**
 * "Show live position" on the ship card (Josh 2026-10-19): when the ship's CURRENT MMSI was heard by our live recorder in
 * the last LIVE_MAX_H hours, a button flies the map to that position and drops a marker that says where it came from.
 *
 * Data: the recorder's snapshot (scripts/ships/aisstream/recorder.mjs → Blob ships/live/salish-v6.json, rewritten every
 * 60 s; one row per MMSI, newest position from aisstream.io AIS or Washington State Ferries' own feed). Same file as
 * LiveShips.jsx (?live=1) and /whalewatch. Fetched once per card (cached for a minute), and again on click.
 *
 * Only the vessel's current MMSI (its newest MMSI claim) is looked up: MMSIs get reassigned, and an older MMSI's live
 * position could be another boat. When the boat is broadcasting a name we don't hold for it, the line says so.
 */
import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import styles from './ShipsApp.module.css'

const LIVE_URL = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/live/salish-v6.json'
export const LIVE_MAX_H = 6
const SOURCE = {
  aisstream: { name: 'aisstream.io live AIS', url: 'https://aisstream.io' },
  wsf: { name: 'Washington State Ferries (WSDOT) vessel positions', url: 'https://wsdot.wa.gov/travel/washington-state-ferries' },
}

let cache = null // { at, promise }
function snapshot(force = false) {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.promise
  const promise = fetch(LIVE_URL, { cache: force ? 'reload' : 'default' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  cache = { at: Date.now(), promise }
  return promise
}

/** The snapshot row for `mmsi` as an object, or null. */
async function liveRow(mmsi, force) {
  const s = await snapshot(force)
  if (!s?.ships || !s.fields) return null
  const i = s.fields.indexOf('mmsi')
  const row = s.ships.find((r) => String(r[i]) === String(mmsi))
  return row ? Object.fromEntries(s.fields.map((f, k) => [f, row[k]])) : null
}

const key = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const esc = (x) => String(x ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
const ago = (s) => (s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`)
const clock = (sec) => new Date(sec * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver', timeZoneName: 'short' })

export default function LivePosition({ vessel, getMap }) {
  const [live, setLive] = useState(null)
  const markerRef = useRef(null)
  // The vessel's current MMSI: the newest MMSI claim with a known period.
  const mmsi = (vessel?.assertions || []).filter((a) => a.attribute === 'mmsi' && /^\d{9}$/.test(a.value_norm) && a.period_kind !== 'unknown')
    .sort((x, y) => String(y.to || '9999').localeCompare(String(x.to || '9999')))[0]?.value_norm || null
  const names = new Set((vessel?.assertions || []).filter((a) => a.attribute === 'name').map((a) => key(a.value_raw)))

  useEffect(() => {
    setLive(null)
    if (!mmsi) return undefined
    let on = true
    liveRow(mmsi).then((r) => { if (on) setLive(r) })
    return () => { on = false }
  }, [mmsi])
  useEffect(() => () => markerRef.current?.remove(), [mmsi])

  const age = live ? Date.now() / 1000 - live.t : Infinity
  if (!live || !(age <= LIVE_MAX_H * 3600) || !Number.isFinite(live.lon) || !Number.isFinite(live.lat)) return null
  const src = SOURCE[live.src] || SOURCE.aisstream
  const otherName = live.name && !names.has(key(live.name)) ? live.name : null

  const show = async () => {
    const map = getMap?.()
    if (!map) return
    const r = (await liveRow(mmsi, true)) || live // the freshest report on click
    setLive(r)
    markerRef.current?.remove()
    const el = document.createElement('div')
    el.className = styles.liveMarker
    const moving = r.sog != null && r.sog >= 1
    const popup = new mapboxgl.Popup({ offset: 14, maxWidth: '280px' }).setHTML(
      `<div class="${styles.popup}">` +
      `<div class="${styles.popupHead}">Live position</div>` +
      `<div class="${styles.popupShipHead}">${esc(r.name || 'Unnamed')}</div>` +
      `<div class="${styles.popupMeta}">MMSI ${esc(r.mmsi)} · ${esc(clock(r.t))} (${esc(ago(Date.now() / 1000 - r.t))})</div>` +
      `<div class="${styles.popupMeta}">${moving ? `${esc(r.sog.toFixed(1))} kn${Number.isFinite(r.cog) ? `, course ${esc(Math.round(r.cog))}°` : ''}` : 'Stopped or slow (under 1 kn)'}</div>` +
      `<div class="${styles.popupNote}">Source: <a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.name)}</a>, as broadcast by the ship.</div></div>`)
    markerRef.current = new mapboxgl.Marker({ element: el }).setLngLat([r.lon, r.lat]).setPopup(popup).addTo(map)
    markerRef.current.togglePopup()
    map.easeTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 12), duration: 1200 })
  }

  return (
    <div className={styles.liveLine}>
      <button type="button" className={styles.liveBtn} onClick={show}>Show live position</button>
      <span className={styles.liveMeta}>
        {ago(age)} · <a className={styles.sourceLink} href={src.url} target="_blank" rel="noopener noreferrer" title={`${src.name}: MMSI ${live.mmsi}`}>{live.src === 'wsf' ? 'WSF' : 'aisstream.io'}</a>
        {otherName && <> · broadcasting as {otherName}</>}
      </span>
    </div>
  )
}
