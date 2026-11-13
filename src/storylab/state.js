/**
 * Story Lab shared state ⇄ URL.
 *
 * One state for all three modes (Field Guide, Chapters, Here Now): which
 * layers are on, the camera, the view (globe / flat), the layer the legend
 * describes, the place, the time and the chapter. Every state has its own URL.
 *
 *   /storylab                       Field Guide
 *   /storylab/chapters/2            Chapters (layers + camera come from the chapter)
 *   /storylab/here                  Here, Now
 *
 * Query keys. Layer keys are /inmotion's own (layerDefs `param`: w, k, f …,
 * written only away from their defaults), so a layer key means the same thing
 * on both pages. Lab-only keys were checked against every layer key:
 *   lat, lng, z     camera centre + zoom (same as /inmotion)
 *   br, pi          camera bearing (rotation) and pitch (tilt)
 *   vw              'flat' for the flat map (globe is the default)
 *   lg              layer the legend card describes
 *   plat, plng, pn  Here, Now place (lat, lng, name)
 *   tm              Here, Now time slider, days before now (0 = now)
 *   first           Here, Now card shown first (a layer id)
 */

import { LAYERS } from '../systems/layerDefs.js'

export const BASE = '/storylab'

const LAB_KEYS = ['lat', 'lng', 'z', 'br', 'pi', 'vw', 'lg', 'plat', 'plng', 'pn', 'tm', 'first']
if (import.meta.env.DEV) {
  const clash = LAYERS.filter((d) => LAB_KEYS.includes(d.param) || LAB_KEYS.includes(d.legacyParam))
  if (clash.length) console.error('[storylab] URL key clash with layerDefs:', clash.map((d) => d.id))
}

const num = (sp, k) => {
  const v = sp.get(k)
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Layers on, from the query — null when the URL names none (use defaults). */
function layersFrom(sp) {
  let named = false
  const on = []
  for (const def of LAYERS) {
    if (!def.param) continue
    const v = sp.get(def.param) ?? (def.legacyParam && ['0', '1'].includes(sp.get(def.legacyParam)) ? sp.get(def.legacyParam) : null)
    if (v != null) named = true
    if (def.defaultOn ? v !== '0' : v === '1') on.push(def.id)
  }
  return named ? on : null
}

export function defaultLayers() {
  return LAYERS.filter((d) => d.defaultOn && d.param).map((d) => d.id)
}

export function parseLocation(pathname, search) {
  const sp = new URLSearchParams(search)
  const rest = pathname.replace(/\/+$/, '').slice(BASE.length)
  let mode = 'guide'
  let chapter = null
  const m = rest.match(/^\/chapters(?:\/(\d+))?$/)
  if (m) { mode = 'chapters'; chapter = m[1] ? Math.max(1, Number(m[1])) : 1 }
  else if (rest === '/here') mode = 'here'
  const lat = num(sp, 'lat'), lng = num(sp, 'lng'), z = num(sp, 'z')
  const plat = num(sp, 'plat'), plng = num(sp, 'plng')
  return {
    mode,
    chapter,
    layers: layersFrom(sp),
    camera: lat != null && lng != null && z != null
      ? { lat, lng, zoom: z, bearing: num(sp, 'br') || 0, pitch: num(sp, 'pi') || 0 }
      : null,
    view: sp.get('vw') === 'flat' ? 'flat' : 'globe',
    legend: sp.get('lg') || null,
    place: plat != null && plng != null ? { lat: plat, lng: plng, name: sp.get('pn') || '' } : null,
    time: Math.max(0, Math.min(30, num(sp, 'tm') || 0)),
    first: sp.get('first') || null,
  }
}

const r = (v, d) => String(Number(v.toFixed(d)))

/** The URL for a state. Chapters carry only the chapter number. */
export function buildUrl(s) {
  if (s.mode === 'chapters') return `${BASE}/chapters/${s.chapter || 1}`
  const sp = new URLSearchParams()
  const on = new Set(s.layers || [])
  for (const def of LAYERS) {
    if (!def.param) continue
    if (def.defaultOn && !on.has(def.id)) sp.set(def.param, '0')
    if (!def.defaultOn && on.has(def.id)) sp.set(def.param, '1')
  }
  if (s.mode === 'guide' && s.camera) {
    sp.set('lat', r(s.camera.lat, 3))
    sp.set('lng', r(s.camera.lng, 3))
    sp.set('z', r(s.camera.zoom, 1))
    if (Math.abs(s.camera.bearing || 0) >= 0.5) sp.set('br', r(s.camera.bearing, 0))
    if ((s.camera.pitch || 0) >= 0.5) sp.set('pi', r(s.camera.pitch, 0))
  }
  if (s.view === 'flat') sp.set('vw', 'flat')
  if (s.legend && on.has(s.legend)) sp.set('lg', s.legend)
  if (s.mode === 'here' && s.place) {
    sp.set('plat', r(s.place.lat, 3))
    sp.set('plng', r(s.place.lng, 3))
    if (s.place.name) sp.set('pn', s.place.name)
    if (s.time) sp.set('tm', String(Math.round(s.time)))
    if (s.first) sp.set('first', s.first)
  }
  const qs = sp.toString()
  return `${BASE}${s.mode === 'here' ? '/here' : ''}${qs ? `?${qs}` : ''}`
}
