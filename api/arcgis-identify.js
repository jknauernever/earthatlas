/**
 * ArcGIS ImageServer point-identify proxy (for the /fire FireApp popup).
 *
 * GET /api/arcgis-identify?base=<ImageServer URL>&lat=<lat>&lng=<lng>
 *
 * The FireApp's click popup needs the pixel value of each raster layer at the
 * clicked point. ArcGIS ImageServers expose /identify for exactly this, but
 * several of the services we use (e.g. USGS NAIP, USDA FS) don't send CORS
 * headers on the identify JSON, so a browser fetch fails even though their
 * imagery loads fine. Proxying server-side eliminates the CORS layer.
 *
 * `base` is host-allowlisted (NOT an open relay): only the ArcGIS ImageServers
 * the FireApp actually ships are permitted. Mirrors api/inat-proxy.js.
 *
 * Edge runtime to stay under the Hobby plan's serverless-function ceiling.
 */

export const config = { runtime: 'edge' }

// Only these hosts may be proxied — keeps this from becoming an open relay.
const ALLOWED_HOSTS = new Set([
  'apps.fs.usda.gov',          // Wildfire Hazard Potential
  'imagery.geoplatform.gov',   // Probabilistic Wildfire Risk — Burn Probability
  'imagery.nationalmap.gov',   // USGS NAIP
  'ic.imagery1.arcgis.com',    // Sentinel-2 Land Cover
])

const IDENTIFY_TIMEOUT_MS = 8000

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  }
}

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...(init.headers || {}),
    },
  })
}

// Lng/lat (WGS84) → Web Mercator (EPSG:3857) meters. ImageServers accept this
// with sr=102100 on the identify geometry.
function toMercator(lng, lat) {
  const x = (lng * 20037508.34) / 180
  const y = (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 20037508.34) / Math.PI
  return [x, y]
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, { status: 405 })

  const { searchParams } = new URL(req.url)
  const base = searchParams.get('base')
  const lat = parseFloat(searchParams.get('lat'))
  const lng = parseFloat(searchParams.get('lng'))

  if (!base || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ error: 'base, lat and lng are required' }, { status: 400 })
  }

  let baseUrl
  try {
    baseUrl = new URL(base)
  } catch {
    return json({ error: 'invalid base url' }, { status: 400 })
  }
  if (baseUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(baseUrl.hostname)) {
    return json({ error: 'host not allowed' }, { status: 403 })
  }
  // Sanity: must be an ImageServer identify target.
  if (!/\/ImageServer\/?$/.test(baseUrl.pathname)) {
    return json({ error: 'base must be an ImageServer' }, { status: 400 })
  }

  const [x, y] = toMercator(lng, lat)
  const idUrl = `${base.replace(/\/$/, '')}/identify?` + new URLSearchParams({
    geometry: JSON.stringify({ x, y }),
    geometryType: 'esriGeometryPoint',
    sr: '102100',
    returnGeometry: 'false',
    returnCatalogItems: 'false',
    f: 'json',
  })

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), IDENTIFY_TIMEOUT_MS)
  try {
    const r = await fetch(idUrl, { headers: { accept: 'application/json' }, signal: ctrl.signal })
    if (!r.ok) {
      return json({ value: null, _upstream_status: r.status }, { status: 200, headers: { 'cache-control': 'no-store' } })
    }
    const j = await r.json().catch(() => null)
    // Identify returns { value, properties, ... }. 'NoData' means off-coverage.
    const value = j && j.value != null && j.value !== 'NoData' ? j.value : null
    return json(
      { value, properties: (j && j.properties) || null },
      {
        status: 200,
        // Static raster layers don't change; cache hard at the edge.
        headers: { 'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
      },
    )
  } catch (err) {
    return json(
      { value: null, _error: String(err) },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  } finally {
    clearTimeout(t)
  }
}
