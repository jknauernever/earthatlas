/**
 * Shared NIFC IFPH (InterAgency Fire Perimeter History) core — used by BOTH the
 * production Edge function (api/fire-history.js) and the vite dev middleware.
 * Mirrors the _firms-core / _nifc-core split.
 *
 * IFPH is the conglomerated agency perimeter history (USFS, BLM, BIA, FWS, NPS,
 * CAL FIRE, WFIGS …) — ~98k polygons, all years through the last full season.
 * Too big to ship whole, so this is a VIEWPORT-gated query (like FIRMS): the
 * client only requests it zoomed in, and we pull the current bbox.
 *
 *   GET ?bbox=w,s,e,n  → GeoJSON of historical fire perimeters in view.
 *
 * Cached hard at the edge — historical perimeters don't change. The service caps
 * a query at 2000 features; we order by recency so a dense view keeps the newest
 * fires and flags truncation rather than silently dropping the rest.
 *
 * NIFC load policy: no relative-date queries / CURRENT_TIMESTAMP. We use a static
 * `where=1=1` + a spatial envelope only — both allowed.
 */

import { parseBbox } from './_firms-core.js'

const IFPH_URL = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0/query'

const MAX_RECORDS = 2000

export function resolveFireHistoryRequest(searchParams) {
  const bbox = parseBbox(searchParams.get('bbox'))
  if (!bbox) return { error: 'invalid or missing bbox (expect west,south,east,north)', status: 400 }

  const qs = new URLSearchParams({
    where: '1=1',
    geometry: bbox.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'INCIDENT,FIRE_YEAR_INT,FIRE_YEAR,DATE_CUR,GIS_ACRES,AGENCY,FEATURE_CA',
    // Recent first — if the view hits the 2000 cap we keep the newest fires.
    orderByFields: 'DATE_CUR DESC',
    resultRecordCount: String(MAX_RECORDS),
    f: 'geojson',
  })
  // Historical perimeters are static → cache hard.
  const cacheControl = 'public, s-maxage=86400, stale-while-revalidate=604800'
  return { url: `${IFPH_URL}?${qs}`, cacheControl, max: MAX_RECORDS }
}

// FIRE_YEAR_INT carries sentinels like 9999 (and some records are 0/blank). Fall
// back to the leading 4 digits of DATE_CUR ("20190102000000" → 2019). Returns a
// clean year in [1900, 2100] or null.
function cleanYear(yearInt, dateCur) {
  const y = Number(yearInt)
  if (Number.isFinite(y) && y >= 1900 && y <= 2100) return y
  const m = /^(\d{4})/.exec(String(dateCur || ''))
  if (m) { const dy = Number(m[1]); if (dy >= 1900 && dy <= 2100) return dy }
  return null
}

export function normalizeFireHistory(geojson, max = MAX_RECORDS) {
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    return { type: 'FeatureCollection', features: [], _count: 0 }
  }
  const feats = []
  for (const f of geojson.features) {
    if (!f || !f.geometry) continue
    const p = f.properties || {}
    const acres = Number(p.GIS_ACRES)
    feats.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        name: p.INCIDENT || null,
        year: cleanYear(p.FIRE_YEAR_INT, p.DATE_CUR),
        acres: Number.isFinite(acres) ? Math.round(acres) : null,
        agency: p.AGENCY || null,
        category: p.FEATURE_CA || null,
      },
    })
  }
  return {
    type: 'FeatureCollection',
    features: feats,
    _count: feats.length,
    _truncated: feats.length >= max,
  }
}
