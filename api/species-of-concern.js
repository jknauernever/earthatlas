/**
 * GET /api/species-of-concern — listed species recorded near a point (lib/speciesOfConcern/lookup.js).
 *
 *   lat, lng            the point (rounded to 3 decimals, ~100 m, so visitors share cache entries)
 *   radius_km           default 5, max 50
 *   window              30d | 1y (default) | 10y | all
 *
 * Status lists: Washington State, federal ESA (+ USFWS Species of Concern), WA rare plants (DNR),
 * WA Species of Greatest Conservation Need, WA Priority Habitats and Species
 * (data/species-of-concern/). Records: iNaturalist, GBIF, eBird and the EarthAtlas whales database.
 * Returns { query, groups, species:[…one row per listed species, each with its records…], sources, lists, notes }.
 */
import { lookupSpeciesOfConcern, WINDOWS, DEFAULT_RADIUS_KM, MAX_RADIUS_KM } from '../lib/speciesOfConcern/lookup.js'

export const maxDuration = 60

const CACHE = {
  '30d': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=21600',
  '1y': 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400',
  '10y': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
  all: 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
}

function send(res, status, body, cache) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', status === 200 && cache ? cache : 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' })
  const sp = new URL(req.url, 'http://x').searchParams
  const lat = Math.round(parseFloat(sp.get('lat')) * 1000) / 1000
  const lng = Math.round(parseFloat(sp.get('lng')) * 1000) / 1000
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return send(res, 400, { error: 'lat and lng are required' })
  const radiusKm = sp.has('radius_km') ? parseFloat(sp.get('radius_km')) : DEFAULT_RADIUS_KM
  if (!(radiusKm > 0 && radiusKm <= MAX_RADIUS_KM)) return send(res, 400, { error: `radius_km must be 0–${MAX_RADIUS_KM}` })
  const window = sp.get('window') || '1y'
  if (!(window in WINDOWS)) return send(res, 400, { error: `window must be one of ${Object.keys(WINDOWS).join(', ')}` })
  try {
    const out = await lookupSpeciesOfConcern({ lat, lng, radiusKm: Math.round(radiusKm * 100) / 100, window })
    // A source that failed makes the answer incomplete: don't let the edge keep it for hours.
    return send(res, 200, out, out.sources.every(s => s.ok) ? CACHE[window] : 'public, max-age=0, s-maxage=120')
  } catch (e) {
    return send(res, 502, { error: 'lookup failed', detail: String(e?.message || e) })
  }
}
