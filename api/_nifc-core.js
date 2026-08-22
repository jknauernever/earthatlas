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
    // NB: 'DailyAcres' drifted off this service (season 2026) — one bad field
    // 400s the WHOLE query, so keep this list matched to the live schema. Current
    // size field is 'IncidentSize'.
    outFields: [
      'IncidentName', 'IncidentTypeCategory', 'IncidentSize', 'DiscoveryAcres',
      'PercentContained', 'FireCause', 'FireDiscoveryDateTime', 'IrwinID',
    ].join(','),
  },
}

export function resolveNifcRequest(searchParams) {
  const layer = (searchParams.get('layer') || 'perimeters').trim()
  const svc = SERVICES[layer]
  if (!svc) return { error: 'invalid layer (expect perimeters|incidents)', status: 400 }

  // detail=low → simplified perimeter geometry (see simplifyNifc). The full
  // perimeters pull is ~33 MB of vertex precision nobody can see zoomed out;
  // the client asks for `low` below its detail zoom and upgrades on zoom-in.
  // Points (incidents) have nothing to simplify, so detail is forced to full.
  const detailRaw = (searchParams.get('detail') || 'full').trim()
  if (detailRaw !== 'full' && detailRaw !== 'low') return { error: 'invalid detail (expect low)', status: 400 }
  const detail = layer === 'perimeters' ? detailRaw : 'full'

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
  // 5-min refresh upstream; every visitor shares one pull. The long SWR window is
  // deliberate: NIFC's shared ArcGIS quota gets rate-limited (429) during fire
  // season, so we keep serving the last good copy for up to a day while a
  // background revalidation retries, rather than blanking the map.
  const cacheControl = 'public, s-maxage=300, stale-while-revalidate=86400'
  return { layer, detail, url, cacheControl }
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
    const acres = num(p.poly_GISAcres) ?? num(p.attr_IncidentSize) ?? num(p.IncidentSize) ?? num(p.DiscoveryAcres)
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

// ─── Geometry simplification (the detail=low variant) ───────────────────────
// Douglas–Peucker per polygon ring + 5-decimal coordinate rounding (~1 m).
// EVERY feature survives — only vertex counts shrink — so perimeter-only fires
// still get their centroid markers and nothing disappears from the map. The
// default tolerance (0.001° ≈ 110 m) is sub-pixel below zoom ~10 and ≲2 px at
// the client's detail-upgrade zoom, where it swaps in full geometry anyway.
// Shared by the snapshot cron, the Edge fallback, and the dev middleware.

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

// Iterative DP — endpoints always survive.
function dpOpen(points, tol) {
  const n = points.length
  if (n <= 2) return points.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1; keep[n - 1] = 1
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()
    let maxD = -1, maxK = -1
    for (let k = i + 1; k < j; k++) {
      const d = perpDist(points[k], points[i], points[j])
      if (d > maxD) { maxD = d; maxK = k }
    }
    if (maxD > tol) { keep[maxK] = 1; stack.push([i, maxK], [maxK, j]) }
  }
  const out = []
  for (let k = 0; k < n; k++) if (keep[k]) out.push(points[k])
  return out
}

const round5 = (n) => Math.round(n * 1e5) / 1e5

// Closed ring (first == last): split at a mid anchor so DP can't collapse the
// loop toward a line, simplify each half, re-close. Result is always a valid
// ring of ≥ 4 points.
function simplifyRing(ring, tol) {
  const open = ring.slice(0, Math.max(ring.length - 1, 0))
  let pts
  if (open.length <= 4) {
    pts = open.map(([x, y]) => [round5(x), round5(y)])
  } else {
    const mid = Math.floor(open.length / 2)
    const a = dpOpen(open.slice(0, mid + 1), tol)
    const b = dpOpen(open.slice(mid), tol)
    pts = a.concat(b.slice(1)).map(([x, y]) => [round5(x), round5(y)])
  }
  if (pts.length < 3) pts = open.map(([x, y]) => [round5(x), round5(y)]) // degenerate: keep original shape
  pts.push([pts[0][0], pts[0][1]])
  return pts
}

export function simplifyNifc(fc, tol = 0.001) {
  if (!fc || !Array.isArray(fc.features)) return fc
  const features = fc.features.map((f) => {
    const g = f && f.geometry
    if (!g) return f
    if (g.type === 'Polygon') {
      return { ...f, geometry: { type: 'Polygon', coordinates: g.coordinates.map((r) => simplifyRing(r, tol)) } }
    }
    if (g.type === 'MultiPolygon') {
      return { ...f, geometry: { type: 'MultiPolygon', coordinates: g.coordinates.map((poly) => poly.map((r) => simplifyRing(r, tol))) } }
    }
    return f
  })
  return { ...fc, features, _detail: 'low' }
}
