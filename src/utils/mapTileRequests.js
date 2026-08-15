/**
 * Map-tile request detection, used to keep tile traffic out of Sentry spans.
 *
 * Every map page fans out dozens of parallel tile fetches per pageload, and
 * Sentry's browser tracing turns each one into an `http.client` span. Ten or
 * more similar parallel spans is exactly the shape Sentry's "N+1 API Call"
 * detector looks for, so each map route eventually files a performance issue
 * (SENTRY-EARTHATLAS-3: Earth Engine tiles on /forestmonitor). It's a false
 * positive — parallel tile loading is how a raster map works, not a query
 * pattern anyone can batch away — and the spans crowd out the ones we do care
 * about, since a transaction only keeps so many.
 *
 * So: don't create spans for tile requests. Tile failures still surface where
 * they always did, through `map.on('error')` and captured exceptions.
 */

// Hosts that, for us, serve nothing but map tiles.
const TILE_HOSTS = new Set([
  'earthengine.googleapis.com',      // forest / carbon / commodity rasters
  'tiles.stadiamaps.com',
  'a.basemaps.cartocdn.com',
  'server.arcgisonline.com',
  'tiles.arcgis.com',
  'gibs.earthdata.nasa.gov',
  'tile.thunderforest.com',
  'api.maptiler.com',
  'mt1.google.com',
])

// api.mapbox.com is mixed traffic: Mapbox GL pulls styles, sprites, glyphs and
// vector tiles from it, but we also call its geocoding/search/tilequery
// endpoints directly — those are real app requests and keep their spans.
const MAPBOX_ASSET_PATH = /^\/(styles|fonts|sprites|map-sessions|rasterarrays)\//

// A z/x/y (or z/y/x) tile path, with optional @2x and file extension.
const ZXY_PATH = /\/\d{1,2}\/\d{1,7}\/\d{1,7}(@[\d.]+x)?(\.[a-z0-9]{2,5})?$/i

const isTileHost = (hostname) =>
  TILE_HOSTS.has(hostname) || hostname.endsWith('.tiles.mapbox.com')

/**
 * True when `url` looks like a map tile fetch.
 * @param {string} url — absolute or same-origin-relative
 */
export function isMapTileRequest(url) {
  let parsed
  try {
    parsed = new URL(url, window.location.origin)
  } catch {
    return false
  }
  const { hostname, pathname, searchParams } = parsed

  if (isTileHost(hostname)) return true
  if (hostname === 'api.mapbox.com' && MAPBOX_ASSET_PATH.test(pathname)) return true
  if (ZXY_PATH.test(pathname)) return true

  // Tile coordinates passed as query params instead of path segments — our own
  // /api/parcel-tiles and /api/vessel-tiles, plus Google's ?x=&y=&z= tiles.
  return ['z', 'x', 'y'].every((k) => /^\d+$/.test(searchParams.get(k) ?? ''))
}
