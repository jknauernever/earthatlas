/**
 * Client helper for /api/species-of-concern: listed species (state, federal, WA plant, SGCN, PHS lists)
 * recorded within a radius of a point. Every site and /permits fetch the lookup through this.
 *
 * The point is rounded to 3 decimals (~100 m) and the radius to 0.01 km, matching the server, so
 * nearby clicks share edge-cache entries.
 */
export const KM_PER_MILE = 1.609344

/**
 * @param {object} o
 * @param {number} o.lat
 * @param {number} o.lng
 * @param {number} [o.radius]       default 5
 * @param {'km'|'mi'} [o.unit]      default 'km'
 * @param {'30d'|'1y'|'10y'|'all'} [o.window]  default '1y'
 * @returns {Promise<{query,groups,species,sources,lists,notes}>}
 */
export async function fetchSpeciesOfConcern({ lat, lng, radius = 5, unit = 'km', window = '1y', signal } = {}) {
  const km = unit === 'mi' ? radius * KM_PER_MILE : radius
  const sp = new URLSearchParams({
    lat: (Math.round(lat * 1000) / 1000).toFixed(3),
    lng: (Math.round(lng * 1000) / 1000).toFixed(3),
    radius_km: String(Math.round(km * 100) / 100),
    window,
  })
  const r = await fetch(`/api/species-of-concern?${sp}`, { signal })
  if (!r.ok) throw new Error(`species-of-concern: HTTP ${r.status}`)
  return r.json()
}
