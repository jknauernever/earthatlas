/**
 * Shared NIFC WFIGS core — used by BOTH the production Edge function (api/nifc.js)
 * and the vite dev middleware (nifcProxyPlugin in vite.config.js). Mirrors the
 * api/_firms-core.js / api/_ebird-core.js split so localhost == prod.
 *
 * NIFC's WFIGS (Wildland Fire Interagency Geospatial Services) publishes the
 * authoritative US incident truth as public ArcGIS Feature Services — no key.
 * FIRMS tells you where heat is; WFIGS tells you which NAMED incident it belongs
 * to and its official perimeter.
 *
 *   layer=perimeters → current interagency fire perimeters (polygons, ~tens-to-
 *                      low-hundreds nationwide; the service already applies
 *                      fall-off so it's the "active now" set)
 *   layer=incidents  → current incident locations (points; includes small/new
 *                      fires that don't have a mapped perimeter yet)
 *
 * IMPORTANT (NIFC load policy): never query with relative date ranges or
 * CURRENT_TIMESTAMP — NIFC flags that as abusive. We pull the WHOLE current
 * service (where=1=1) and edge-cache it; it's small, and filtering happens
 * client-side. Attribute filters (e.g. IS NULL) are fine, relative dates are not.
 */

const NIFC_HOST = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services'

// Confirmed live 2026-06-25; if these 404, re-resolve from the NIFC Open Data
// hub "API Resources" panel (the hub slugs are stable, the FeatureServer URLs
// drift between seasons — see project_fire_app memory).
const SERVICES = {
  perimeters: {
    path: 'WFIGS_Interagency_Perimeters_Current/FeatureServer/0',
    // Trim to what the popup needs — full records carry 100+ fields.
    outFields: [
      'poly_IncidentName', 'attr_IncidentName', 'poly_GISAcres', 'attr_IncidentSize',
      'attr_PercentContained', 'attr_FireCause', 'attr_IncidentTypeCategory',
      'attr_FireDiscoveryDateTime', 'attr_FireBehaviorGeneral', 'poly_IRWINID',
    ].join(','),
  },
  incidents: {
    path: 'WFIGS_Incident_Locations_Current/FeatureServer/0',
    outFields: [
      'IncidentName', 'IncidentTypeCategory', 'DailyAcres', 'DiscoveryAcres',
      'PercentContained', 'FireCause', 'FireDiscoveryDateTime', 'IrwinID',
    ].join(','),
  },
}

export function resolveNifcRequest(searchParams) {
  const layer = (searchParams.get('layer') || 'perimeters').trim()
  const svc = SERVICES[layer]
  if (!svc) return { error: 'invalid layer (expect perimeters|incidents)', status: 400 }

  // where=1=1, all features, GeoJSON. resultRecordCount well above the live
  // count so we never silently truncate; the services are small.
  const qs = new URLSearchParams({
    where: '1=1',
    outFields: svc.outFields,
    outSR: '4326',
    resultRecordCount: '4000',
    f: 'geojson',
  })
  const url = `${NIFC_HOST}/${svc.path}/query?${qs}`
  // 5-min refresh upstream; a few minutes of edge staleness is invisible and
  // keeps every visitor sharing one upstream pull.
  const cacheControl = 'public, s-maxage=300, stale-while-revalidate=600'
  return { layer, url, cacheControl }
}

// Normalize the GeoJSON: WFIGS perimeters and incidents use different field
// names for the same concept, so collapse them to one canonical popup schema and
// drop everything else. Keeps geometry untouched. Returns a FeatureCollection.
export function normalizeNifc(geojson, layer) {
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    return { type: 'FeatureCollection', features: [], _count: 0 }
  }
  const feats = []
  for (const f of geojson.features) {
    if (!f || !f.geometry) continue
    const p = f.properties || {}
    const name = p.poly_IncidentName || p.attr_IncidentName || p.IncidentName || null
    const acres = num(p.poly_GISAcres) ?? num(p.attr_IncidentSize) ?? num(p.DailyAcres) ?? num(p.DiscoveryAcres)
    const contained = num(p.attr_PercentContained) ?? num(p.PercentContained)
    const cause = p.attr_FireCause || p.FireCause || null
    const type = p.attr_IncidentTypeCategory || p.IncidentTypeCategory || null
    const discovered = num(p.attr_FireDiscoveryDateTime) ?? num(p.FireDiscoveryDateTime)
    feats.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        name,
        acres: acres != null ? Math.round(acres) : null,
        contained: contained != null ? Math.round(contained) : null,
        cause,
        type, // WF wildfire / RX prescribed / CX complex
        behavior: p.attr_FireBehaviorGeneral || null,
        discovered_ms: discovered ?? null,
        irwin: p.poly_IRWINID || p.IrwinID || null,
      },
    })
  }
  return { type: 'FeatureCollection', features: feats, _count: feats.length, _layer: layer }
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
