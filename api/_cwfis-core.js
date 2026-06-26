/**
 * Shared CWFIS (Canadian Wildland Fire Information System) core — used by BOTH
 * the production Edge function (api/cwfis.js) and the vite dev middleware.
 * Mirrors the _nifc-core split.
 *
 * Canada's authoritative active-fire layer is the M3 fire-perimeter product:
 * satellite-mapped perimeters auto-generated from clustered MODIS/VIIRS hotspots
 * (NRCan / Canadian Forest Service). It's the Canadian analog to our US NIFC
 * layer — though M3 polygons are satellite-derived, not named agency incidents.
 *
 *   GET ?  → GeoJSON of current Canada active-fire perimeters.
 *
 * Served from the CWFIS public GeoServer WFS as GeoJSON (WGS84 lng,lat). The
 * service is small (≈ low-hundreds of perimeters nationwide), so we pull the
 * whole thing and edge-cache it — same "pull broad, cache" approach as NIFC.
 */

const CWFIS_WFS = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows'

export function resolveCwfisRequest() {
  const qs = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'public:m3_polygons_current',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326', // GeoServer emits GeoJSON lng,lat
    count: '4000',
  })
  // M3 perimeters refresh a few times daily; a few minutes of edge staleness is
  // invisible and lets every visitor share one upstream pull.
  return { url: `${CWFIS_WFS}?${qs}`, cacheControl: 'public, s-maxage=600, stale-while-revalidate=1800' }
}

// Collapse the WFS record to the canonical popup schema. M3 perimeters carry no
// fire name (they're satellite-clustered, not named incidents): hcount = number
// of contributing hotspots, area in hectares, first/last detection timestamps.
export function normalizeCwfis(geojson) {
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    return { type: 'FeatureCollection', features: [], _count: 0 }
  }
  const feats = []
  for (const f of geojson.features) {
    if (!f || !f.geometry) continue
    const p = f.properties || {}
    const areaHa = Number(p.area)
    feats.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        area_ha: Number.isFinite(areaHa) ? Math.round(areaHa) : null,
        hcount: Number(p.hcount) || null,
        first_ms: Date.parse(p.firstdate) || null,
        last_ms: Date.parse(p.lastdate) || null,
      },
    })
  }
  return { type: 'FeatureCollection', features: feats, _count: feats.length }
}
