/**
 * Shared NOAA HMS (Hazard Mapping System) fire-detection core — used by BOTH the
 * production Edge function (api/hms.js) and the vite dev middleware. Mirrors the
 * _firms-core / _nifc-core split.
 *
 * HMS is NOAA/NESDIS's analyst-QC'd multi-sensor fire product: it fuses the
 * GEOSTATIONARY GOES-East/West ABI fire detections (sub-hourly — far faster than
 * polar orbiters) with VIIRS + MODIS, and a human analyst removes obvious false
 * positives. That makes it the accessible way to add "GOES" to the map without
 * touching raw netCDF, and a cleaner complement to the raw FIRMS hotspots.
 *
 *   GET ?bbox=w,s,e,n  → GeoJSON of HMS fire detections in view.
 *
 * Served from the public NESDIS/NIFC ArcGIS Feature Service. Viewport-gated like
 * FIRMS; edge-cached (HMS refreshes a few times a day).
 */

import { parseBbox } from './_firms-core.js'

const HMS_URL = 'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/NOAA_Satellite_Fire_Detections_(v1)/FeatureServer/0/query'

export function resolveHmsRequest(searchParams) {
  const bbox = parseBbox(searchParams.get('bbox'))
  if (!bbox) return { error: 'invalid or missing bbox (expect west,south,east,north)', status: 400 }
  const qs = new URLSearchParams({
    where: '1=1',
    geometry: bbox.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'Lon,Lat,Satellite,Method,FRP,YearDay,Time',
    orderByFields: 'YearDay DESC, Time DESC',
    resultRecordCount: '4000',
    f: 'geojson',
  })
  // GOES refreshes sub-hourly; HMS republishes a few times a day. A few minutes
  // of edge staleness is invisible and shares the upstream pull across visitors.
  return { url: `${HMS_URL}?${qs}`, cacheControl: 'public, s-maxage=300, stale-while-revalidate=900' }
}

// GOES-EAST / GOES-WEST → geostationary (the fast ones); everything else (NOAA-20,
// NOAA-21, SUOMI NPP, AQUA, TERRA) → polar.
const isGeo = (sat) => /GOES/i.test(String(sat || ''))

// YearDay (e.g. 2026218 = 2026, day-of-year 218) + Time ("0426" HHMM UTC) → ms.
function hmsMs(yearDay, time) {
  const yd = String(yearDay || '')
  const m = /^(\d{4})(\d{3})$/.exec(yd)
  if (!m) return null
  const year = +m[1], doy = +m[2]
  const t = String(time ?? '0').padStart(4, '0')
  const hh = +t.slice(0, 2), mm = +t.slice(2, 4)
  return Date.UTC(year, 0, 1) + (doy - 1) * 86400000 + hh * 3600000 + mm * 60000
}

// Friendly satellite label.
const SAT_LABEL = {
  'GOES-EAST': 'GOES-East', 'GOES-WEST': 'GOES-West',
  'NOAA-20': 'NOAA-20', 'NOAA-21': 'NOAA-21', 'SUOMI NPP': 'Suomi NPP',
  AQUA: 'Aqua', TERRA: 'Terra',
}

export function normalizeHms(geojson, nowMs) {
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    return { type: 'FeatureCollection', features: [], _count: 0 }
  }
  const feats = []
  for (const f of geojson.features) {
    if (!f || !f.geometry) continue
    const p = f.properties || {}
    const ms = hmsMs(p.YearDay, p.Time)
    const hoursAgo = ms == null ? null : Math.max(0, Math.round(((nowMs - ms) / 3.6e6) * 10) / 10)
    const frp = Number(p.FRP)
    feats.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        sat: SAT_LABEL[p.Satellite] || p.Satellite || '',
        geo: isGeo(p.Satellite), // geostationary (GOES) vs polar
        method: p.Method || '',
        frp: Number.isFinite(frp) ? frp : null,
        acq_ms: ms,
        hours_ago: hoursAgo,
      },
    })
  }
  // Newest first so a cap keeps the freshest.
  feats.sort((a, b) => (b.properties.acq_ms || 0) - (a.properties.acq_ms || 0))
  return { type: 'FeatureCollection', features: feats, _count: feats.length }
}
