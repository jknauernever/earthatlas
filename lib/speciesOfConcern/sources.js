/**
 * Record sources for the species-of-concern lookup. Each fetcher takes a point, radius and date window
 * plus the listed taxon IDs, and returns { records, note } with records in one shape:
 *   { source, id, url, date, lat, lng, obscured, taxon_name, common_name, ids: { inat|gbif|ebird }, observer, remarks, quality }
 * Only listed taxa are requested, so nothing else comes back.
 */
import { EBIRD_BASE } from '../../api/_ebird-core.js'
import { whalesHttp, DEFAULT_SCHEMA } from '../whales/db.js'
import { parseWhaleQuery, queryWhales } from '../whales/query.js'

const UA = { 'User-Agent': 'EarthAtlas species-of-concern lookup (earthatlas.org)' }
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

async function getJson(url, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { ...UA, ...headers } })
    if (res.ok) return res.json()
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} ${new URL(url).host}`)
    await new Promise(r => setTimeout(r, 1500 * attempt))
  }
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = Math.PI / 180
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// iNaturalist hides a sensitive record's true location somewhere in the same 0.2° x 0.2° grid cell
// as its public coordinates. A blurred record can be inside the circle only if that cell touches it.
export const INAT_CELL = 0.2
export function obscuredCellNearestKm(lat, lng, pLat, pLng) {
  const s = Math.floor(lat / INAT_CELL) * INAT_CELL, w = Math.floor(lng / INAT_CELL) * INAT_CELL
  const cLat = Math.min(Math.max(pLat, s), s + INAT_CELL), cLng = Math.min(Math.max(pLng, w), w + INAT_CELL)
  return distanceKm(pLat, pLng, cLat, cLng)
}
const CELL_REACH_KM = 30  // a 0.2° cell is at most ~28 km corner to corner in WA

// ─── iNaturalist ────────────────────────────────────────────────────────────
async function inatPages(params, ids) {
  const out = []
  for (const group of chunk(ids, 200)) {
    let idAbove = 0
    for (let page = 0; page < 15; page++) {  // ≤ 3,000 records per taxon group
      const u = new URL('https://api.inaturalist.org/v1/observations')
      for (const [k, v] of Object.entries({ ...params, taxon_id: group.join(','), per_page: 200, order_by: 'id', order: 'asc', id_above: idAbove })) u.searchParams.set(k, v)
      const { results = [] } = await getJson(u)
      out.push(...results)
      if (results.length < 200) break
      idAbove = results[results.length - 1].id
    }
  }
  return out
}

export async function fetchInat({ lat, lng, radiusKm, from, to }, ids) {
  const base = { captive: 'false', d1: from, d2: to, lat, lng }
  const [exact, blurred] = await Promise.all([
    inatPages({ ...base, radius: radiusKm }, ids),
    // Blurred records whose true spot may be inside the circle can sit up to a cell away.
    inatPages({ ...base, radius: radiusKm + CELL_REACH_KM, obscuration: 'obscured' }, ids),
  ])
  const seen = new Set()
  const records = []
  for (const o of [...exact, ...blurred]) {
    if (seen.has(o.id) || !o.geojson?.coordinates || !o.taxon) continue
    seen.add(o.id)
    const [oLng, oLat] = o.geojson.coordinates
    const obscured = !!o.obscured
    if (obscured && obscuredCellNearestKm(oLat, oLng, lat, lng) > radiusKm) continue
    if (!obscured && distanceKm(lat, lng, oLat, oLng) > radiusKm) continue
    records.push({
      source: 'inaturalist', id: String(o.id), url: o.uri || `https://www.inaturalist.org/observations/${o.id}`,
      date: o.observed_on || null, lat: oLat, lng: oLng, obscured,
      taxon_name: o.taxon.name, common_name: o.taxon.preferred_common_name || null,
      ids: { inat: [o.taxon.id, ...(o.taxon.ancestor_ids || [])].map(String) },
      observer: o.user?.name || o.user?.login || null, quality: o.quality_grade, remarks: o.description ? String(o.description).slice(0, 600) : null,
    })
  }
  return { records, note: 'Blurred iNaturalist locations are counted when the 0.2° cell they hide in touches the circle.' }
}

// ─── GBIF ───────────────────────────────────────────────────────────────────
// Queried directly elsewhere, so dropped here to avoid counting a record twice.
const GBIF_SKIP_DATASETS = new Set([
  '50c9509d-22c7-4a22-a47d-8c48425ef4a7',  // iNaturalist research-grade observations
])
const GBIF_SKIP_PUBLISHER = /happywhale/i     // Happywhale comes through the whales database

export async function fetchGbif({ lat, lng, radiusKm, from, to }, keys) {
  const records = []
  let latest = null
  await Promise.all(chunk(keys, 150).map(async (group) => {
    for (let offset = 0; offset < 3000; offset += 300) {
      const u = new URL('https://api.gbif.org/v1/occurrence/search')
      u.searchParams.set('geo_distance', `${lat},${lng},${radiusKm}km`)
      u.searchParams.set('eventDate', `${from},${to}`)
      u.searchParams.set('occurrenceStatus', 'PRESENT')
      u.searchParams.set('hasCoordinate', 'true')
      u.searchParams.set('limit', '300')
      u.searchParams.set('offset', String(offset))
      for (const k of group) u.searchParams.append('taxonKey', k)
      const r = await getJson(u)
      for (const o of r.results || []) {
        if (GBIF_SKIP_DATASETS.has(o.datasetKey) || GBIF_SKIP_PUBLISHER.test(o.publisher || '') || GBIF_SKIP_PUBLISHER.test(o.datasetName || '')) continue
        const date = o.eventDate ? String(o.eventDate).slice(0, 10) : null
        if (date && (!latest || date > latest)) latest = date
        records.push({
          source: 'gbif', id: String(o.key), url: `https://www.gbif.org/occurrence/${o.key}`,
          date, lat: o.decimalLatitude, lng: o.decimalLongitude, obscured: false,
          taxon_name: o.scientificName, common_name: o.vernacularName || null,
          ids: { gbif: [o.taxonKey, o.acceptedTaxonKey, o.speciesKey].filter(Boolean).map(String) },
          observer: o.recordedBy || null, quality: null, remarks: null,
          dataset: o.datasetName || o.datasetKey, publisher: o.publisher || null,
        })
      }
      if (r.endOfRecords || !(r.results || []).length) break
    }
  }))
  return { records, latest }
}

// ─── eBird ──────────────────────────────────────────────────────────────────
// One call: the most recent sighting of every species within the radius over the last ≤30 days
// (eBird's limit). Older eBird data reaches the lookup through GBIF's copy, which lags by months.
export async function fetchEbird({ lat, lng, radiusKm, from, to }, codes) {
  const key = process.env.EBIRD_API_KEY
  if (!key) return { records: [], note: 'eBird key not configured' }
  const today = new Date().toISOString().slice(0, 10)
  const back = Math.min(30, Math.ceil((Date.parse(today) - Date.parse(from)) / 86400000) + 1)
  if (to < new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)) return { records: [], note: 'eBird gives only the last 30 days; this window is older' }
  const dist = Math.min(50, Math.max(1, Math.ceil(radiusKm)))
  const path = `/data/obs/geo/recent?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&dist=${dist}&back=${back}&maxResults=10000&includeProvisional=true`
  const obs = await getJson(EBIRD_BASE + path, { 'X-eBirdApiToken': key })
  const records = obs
    .filter(o => codes.has(o.speciesCode) && distanceKm(lat, lng, o.lat, o.lng) <= radiusKm)
    .map(o => ({
      source: 'ebird', id: o.subId, url: `https://ebird.org/checklist/${o.subId}`,
      date: o.obsDt.slice(0, 10), lat: o.lat, lng: o.lng, obscured: false,
      taxon_name: o.sciName, common_name: o.comName, ids: { ebird: [o.speciesCode] },
      observer: null, quality: o.obsReviewed ? (o.obsValid ? 'reviewed' : 'not accepted') : null, remarks: null,
      location_name: o.locName, count: o.howMany ?? null,
    }))
  return { records, note: 'eBird: latest sighting of each species in the last 30 days; the location is the checklist site, not the bird.' }
}

// ─── Whales database (Orca Network/Maplify, Happywhale, OBIS, Salish Sea, Orcasound) ──────────
export async function fetchWhales({ lat, lng, radiusKm, from, to }) {
  // the whales database keeps 10 years at most per query
  const tenYears = new Date(Date.parse(to) - 3650 * 86400000).toISOString().slice(0, 10)
  const sp = new URLSearchParams({ lat, lng, radius_km: radiusKm, from: from < tenYears ? tenYears : from, to, group: 'all', exclude: 'inaturalist', limit: 2000 })
  const parsed = parseWhaleQuery(sp)
  if (!parsed.ok) throw new Error(parsed.error)
  const schema = process.env.VERCEL_ENV !== 'production' && process.env.WHALES_SCHEMA ? process.env.WHALES_SCHEMA : DEFAULT_SCHEMA
  const out = await queryWhales(whalesHttp(), parsed.q, schema)
  const records = out.sightings.filter(s => s.taxon?.id && (s.location_obscured || distanceKm(lat, lng, s.lat, s.lng) <= radiusKm)).map(s => ({
    source: s.source, id: s.id, url: s.url, date: s.observed_date, lat: s.lat, lng: s.lng, obscured: !!s.location_obscured,
    taxon_name: s.taxon.scientific, common_name: s.taxon.common, ids: { inat: [String(s.taxon.id)] },
    observer: s.observer || s.organization?.name || null, quality: s.trusted === false ? 'unverified' : null,
    remarks: s.remarks, via: s.via, kind: s.kind, individual: s.individual?.label || s.individual?.id || null, individual_id: s.individual?.id || null,
  }))
  return { records, labels: Object.fromEntries((out.sources || []).map(s => [s.id, { label: s.label, url: s.url }])), truncated: out.truncated }
}
