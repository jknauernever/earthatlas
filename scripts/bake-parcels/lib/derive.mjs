// Derived parcel fields computed at bake time — for values the source data
// doesn't provide cleanly. Config-driven (see a region's `derive` block) so the
// same logic serves every region.
//
//  - acres: computed from the polygon geometry (geodesic). Many NM counties
//    leave the assessor `LandArea` field at 0, so geometry is the reliable
//    source — and it matches exactly what's drawn on the map.
//  - land_use: the NM per-county use codes are undecodable without 33 separate
//    lookup tables, but `StateCodePrimary` (R/N) is statewide-consistent →
//    "Residential" / "Non-residential". Honest and reliable, if coarse.

const EARTH_R = 6378137 // WGS84 semi-major axis, meters
const M2_PER_ACRE = 4046.8564224
const rad = (d) => (d * Math.PI) / 180

// Spherical polygon ring area (m²) for a [lng,lat] ring.
function ringAreaM2(ring) {
  if (!ring || ring.length < 3) return 0
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[(i + 1) % ring.length]
    total += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)))
  }
  return Math.abs((total * EARTH_R * EARTH_R) / 2)
}

// Polygon = [outerRing, ...holes]; subtract holes.
function polygonAreaM2(rings) {
  if (!rings || !rings.length) return 0
  let area = ringAreaM2(rings[0])
  for (let i = 1; i < rings.length; i++) area -= ringAreaM2(rings[i])
  return area
}

export function geometryAcres(geom) {
  if (!geom) return null
  let m2 = 0
  if (geom.type === 'Polygon') m2 = polygonAreaM2(geom.coordinates)
  else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) m2 += polygonAreaM2(poly)
  if (!(m2 > 0)) return null
  const acres = m2 / M2_PER_ACRE
  // 2dp under ~1000 ac, whole numbers for big rural/government parcels.
  return acres >= 1000 ? Math.round(acres) : Math.round(acres * 100) / 100
}

// Mutates `props`: adds derived fields per cfg.derive.
export function deriveExtras(props, rawProps, geom, cfg) {
  const d = cfg.derive || {}
  if (d.acresFromGeometry) {
    const a = geometryAcres(geom)
    if (a != null) props.acres = a
  }
  if (d.landUse) {
    const raw = String(rawProps[d.landUse.field] || '').trim().toUpperCase()
    // Try the full code first, then its leading letter (handles both the clean
    // R/N of StateCodePrimary and the RR/NR prefixes of StateUseCode).
    const label = d.landUse.map[raw] || d.landUse.map[raw[0]]
    if (label) props.land_use = label
  }
}
