/**
 * Here, Now readings: real values at a place, from the same baked grids and
 * feeds the globe draws (src/systems loaders). Nothing here is modeled or
 * filled in by the lab; when a source has nothing at the place the card says
 * so.
 *
 *   "now"  → the live grid (what the globe shows at Now)
 *   past   → the layer's 31-day history tape, at that moment
 *
 * Radius: 30 miles (48 km), the US-units version of the sketch's 50 km.
 */

import { loadGridField } from '../systems/windField.js'
import { TapeField } from '../systems/tape.js'
import { defFor } from './layers.js'

export const RADIUS_MI = 30
const RADIUS_KM = RADIUS_MI * 1.609344
const DAY = 8.64e7

const cache = new Map()
const once = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e }))
  return cache.get(key)
}
const grid = (id) => { const d = defFor(id); return once(`g:${id}`, () => loadGridField(d.dataset, d.expectKind)) }
const tape = (id) => { const d = defFor(id); return once(`t:${id}`, () => TapeField.load(d.tape.dataset, d.tape.expectKind)) }

const kmBetween = (a, b) => {
  const R = 6371, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The value at the place, or — for ocean grids at a point on land — the
 * nearest grid value within the radius. Returns { value, km } or null.
 */
function nearest(sampler, place) {
  const at = sampler(place.lng, place.lat)
  if (at && Number.isFinite(at.value)) return { value: at.value, km: 0 }
  let best = null
  const stepDeg = 0.1
  const n = Math.ceil(RADIUS_KM / 111 / stepDeg)
  const cosLat = Math.max(0.2, Math.cos((place.lat * Math.PI) / 180))
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const p = { lat: place.lat + i * stepDeg, lng: place.lng + (j * stepDeg) / cosLat }
      const km = kmBetween(place, p)
      if (km > RADIUS_KM || (best && km >= best.km)) continue
      const v = sampler(p.lng, p.lat)
      if (v && Number.isFinite(v.value)) best = { value: v.value, km }
    }
  }
  return best
}

/** A tape's value at time t (ms) near the place. */
async function tapeValue(id, place, t) {
  const tp = await tape(id)
  tp.setTime(t)
  await tp.whenReady(t)
  tp.setTime(t)
  const v = nearest((lng, lat) => tp.sampleScalar(lng, lat), place)
  return v ? { ...v, valid_ms: tp.metaAt(t)?.valid_ms ?? t } : null
}

async function scalarAt(id, place, t, live) {
  if (live) {
    const g = await grid(id)
    const v = nearest((lng, lat) => g.sampleScalar(lng, lat), place)
    return v ? { ...v, valid_ms: g.meta.valid_ms } : null
  }
  return tapeValue(id, place, t)
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
const wordFor = (words, v) => (words || []).find((w) => v < w.max) || words?.[words.length - 1]
const fmtWhen = (ms) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))

/**
 * All six cards for a place at `daysAgo` (0 = now). Each card:
 * { id, group, name, value, note, warm, layers, legend, source }
 */
export async function readPlace(place, daysAgo = 0) {
  const live = daysAgo === 0
  const t = Date.now() - daysAgo * DAY

  const [wind, pm, sst, anom, ph, fires, quakes, birds] = await Promise.all([
    settle(live ? grid('wind') : Promise.resolve(null)),
    settle(scalarAt('pm25', place, t, live)),
    settle(scalarAt('sst', place, t, live)),
    settle(scalarAt('sstanom', place, t, live)),
    settle(scalarAt('acidity', place, t, live)),
    settle(live ? once('hotspots', () => defFor('hotspots').load()) : Promise.resolve(null)),
    settle(once('quakes', () => defFor('quakes').load())),
    settle(birdsPeak(place, t)),
  ])

  const cards = []

  // Wind — live only (/inmotion keeps no wind history).
  {
    const def = defFor('wind')
    let value = '—', note = 'No wind reading here right now'
    if (!live) {
      note = 'Wind has no history in our data; set the slider to Now'
    } else if (wind.ok && wind.v) {
      const s = wind.v.sample(place.lng, place.lat)
      if (s) {
        const from = compass((Math.atan2(-s.u, -s.v) * 180) / Math.PI)
        value = `${Math.round(s.speed * 2.23694)} mph from the ${from}`
        note = `${wordFor(def.words, s.speed)?.label || ''} · NOAA GFS, ${fmtWhen(wind.v.meta.valid_ms)}`
      }
    }
    cards.push({ id: 'wind', group: 'Air', name: 'Wind', value, note, layers: ['wind'], legend: 'wind' })
  }

  // Fine particles.
  {
    const def = defFor('pm25')
    let value = '—', note = 'No reading here'
    if (pm.ok && pm.v) {
      value = `${Math.round(pm.v.value)} µg/m³`
      note = `${wordFor(def.words, pm.v.value)?.label || ''} · Copernicus CAMS, ${fmtWhen(pm.v.valid_ms)}`
    } else if (!pm.ok) note = 'Live data unavailable right now'
    cards.push({ id: 'pm25', group: 'Air', name: 'Fine particles', value, note, layers: ['pm25'], legend: 'pm25' })
  }

  // Sea temperature + difference from normal.
  {
    let value = '—', note = `No ocean within ${RADIUS_MI} miles`, warm = false
    if (sst.ok && sst.v) {
      value = `${Math.round(sst.v.value * 1.8 + 32)} °F`
      if (anom.ok && anom.v) {
        const d = anom.v.value * 1.8
        warm = d >= 1
        note = Math.abs(d) < 0.5 ? 'About normal for the date'
          : `${Math.abs(d).toFixed(1)} °F ${d > 0 ? 'warmer' : 'cooler'} than normal`
      } else note = `NOAA Coral Reef Watch, ${fmtDay(sst.v.valid_ms)}`
      if (sst.v.km > 3) note += ` · nearest water, ${Math.round(sst.v.km / 1.609)} mi`
    } else if (!sst.ok) note = 'Live data unavailable right now'
    cards.push({ id: 'sst', group: 'Water', name: 'Sea temperature', value, note, warm, layers: ['sst'], legend: 'sst' })
  }

  // Ocean acidity.
  {
    const def = defFor('acidity')
    let value = '—', note = `No ocean within ${RADIUS_MI} miles`
    if (ph.ok && ph.v) {
      value = `pH ${ph.v.value.toFixed(2)}`
      note = `${wordFor(def.words, ph.v.value)?.label || ''} · Copernicus Marine, ${fmtDay(ph.v.valid_ms)}`
    } else if (!ph.ok) note = 'Live data unavailable right now'
    cards.push({ id: 'acidity', group: 'Water', name: 'Ocean acidity', value, note, layers: ['acidity'], legend: 'acidity' })
  }

  // Fires (live 24 h) and quakes (the 30 days before the slider time).
  {
    let nf = null
    if (live && fires.ok && fires.v) {
      nf = fires.v.events.filter((e) => kmBetween(place, e) <= RADIUS_KM).reduce((a, e) => a + (e.n || 1), 0)
    }
    let nq = null
    if (quakes.ok && quakes.v) {
      nq = quakes.v.events.filter((e) => e.time != null ? e.time <= t && e.time > t - 30 * DAY && kmBetween(place, e) <= RADIUS_KM : kmBetween(place, e) <= RADIUS_KM).length
    }
    const parts = []
    if (nf != null) parts.push(`${nf.toLocaleString()} fire${nf === 1 ? '' : 's'}`)
    if (nq != null) parts.push(`${nq} quake${nq === 1 ? '' : 's'}`)
    const note = live ? 'Fire hot spots past 24 h · quakes M3+ past 30 days'
      : 'Quakes M3+ in the 30 days before this date · fire counts are live only'
    cards.push({ id: 'hotspots', group: 'Land', name: 'Fires and quakes', value: parts.join(' · ') || '—', note, layers: ['hotspots', 'quakes'], legend: 'hotspots' })
  }

  // Bird migration — peak radar reading in the 24 h before the slider time.
  {
    const def = defFor('birds')
    let value = '—', note = 'Not covered here: U.S. weather radar only'
    if (birds.ok && birds.v) {
      const w = wordFor(def.words, birds.v.value)
      value = w?.label || '—'
      note = `Peak ${Math.round(birds.v.value).toLocaleString()} birds/km/h, ${fmtWhen(birds.v.valid_ms)} · radar-observed`
    } else if (!birds.ok) note = 'Radar data unavailable right now'
    cards.push({ id: 'birds', group: 'Life', name: 'Bird migration', value, note, layers: ['birds'], legend: 'birds' })
  }

  return cards
}

async function birdsPeak(place, t) {
  const def = defFor('birds')
  const tp = await tape('birds')
  const frames = tp.frames.map((f, i) => ({ ...f, i })).filter((f) => f.valid_ms <= t && f.valid_ms > t - DAY)
  if (!frames.length) return null
  let best = null
  for (const f of frames) {
    await tp.ensureFrame(f.i)
    tp.setTime(f.valid_ms)
    const v = tp.sampleScalar(place.lng, place.lat)
    if (!v || !Number.isFinite(v.value)) continue
    const mtr = def.toValue(v.value)
    if (!best || mtr > best.value) best = { value: mtr, valid_ms: f.valid_ms }
  }
  return best
}
