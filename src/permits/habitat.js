/**
 * Waters and habitat near a permit's map point (/permits): the things a permit decision should weigh (Josh 2026-10-15:
 * receiving waters and habitat are thought about the same way). Shared by the bake (scripts/permits/bake-permits.mjs
 * stores the result on each record as `near`) and the client (layer list, legend, popup and dashboard wording).
 *
 * Habitat: public/permits-data/friends-habitat.geojson, made from Salish Sea Explorer's copies of Friends' layers by
 * scripts/permits/import-friends-habitat.mjs (features carry `h`, one of HABITATS' ids). Waters: the bake's own
 * Ecology 303(d) and DOH shellfish layers (wq303d.geojson, shellfish.geojson), tagged by waterFeatures(). Distances are
 * from the record's map point, not the project's footprint (we have no footprints).
 */

export const FRIENDS_PAGE = 'https://sanjuans.org/our-work/shoreline-science-and-mapping/'
export const FRIENDS_LOGO = '/hpa/friends-logo.png'

// Popup lists everything within LIST_M; the panel's "near habitat" filter uses NEAR_M.
export const LIST_M = 300
export const NEAR_M = 100

// Ids are the URL keys (off=…). Colors are Salish Sea Explorer's for the same layers (cross-site consistency).
export const HABITATS = [
  { id: 'hfd', label: 'Forage fish spawning beach, documented', short: 'Documented forage fish spawning beach', color: '#E11D74', kind: 'line',
    credit: 'Friends of the San Juans forage fish egg surveys, with Washington Department of Fish and Wildlife records' },
  { id: 'hfp', label: 'Forage fish spawning beach, potential', short: 'Potential forage fish spawning beach (suitable beach sediment)', color: '#F9A8D4', kind: 'line',
    credit: 'Friends of the San Juans' },
  { id: 'hhe', label: 'Herring spawning area', short: 'Herring spawning area (present or historic)', color: '#8B5CF6', kind: 'fill',
    credit: 'Washington Department of Fish and Wildlife; compiled by Friends of the San Juans' },
  { id: 'hee', label: 'Eelgrass meadow, deep edge', short: 'Eelgrass meadow (its mapped deep edge)', color: '#20B2AA', kind: 'line',
    credit: 'Friends of the San Juans, Washington DNR and Friday Harbor Labs (countywide eelgrass study)' },
  { id: 'hkb', label: 'Bull kelp bed', short: 'Bull kelp bed', color: '#B89A3A', kind: 'fill',
    credit: 'Washington Department of Natural Resources and Friends of the San Juans' },
]
export const HABITAT_BY_ID = Object.fromEntries(HABITATS.map((h) => [h.id, h]))

// Receiving waters, as on the map's water layers. `friends: false`: their source is the agency record (`src` doc key).
export const WATERS = [
  { id: 'wq', label: 'Impaired water (303(d) list)', short: 'Impaired water on Washington State Department of Ecology’s 303(d) list', color: '#f97316', kind: 'fill', friends: false,
    credit: 'Washington State Department of Ecology, 303(d) Category 5' },
  { id: 'shell', label: 'Shellfish growing area', short: 'Shellfish growing area', color: '#4ade80', kind: 'fill', friends: false,
    credit: 'Washington State Department of Health classification' },
]
export const FACTORS = [...WATERS, ...HABITATS.map((h) => ({ ...h, friends: true }))]
export const FACTOR_BY_ID = Object.fromEntries(FACTORS.map((f) => [f.id, f]))

// A discharge permit's map point is its plant on land, not its outfall, so its receiving waters are matched by NAME:
// an impaired water or shellfish growing area whose name's words all appear in one of the permit's receiving waters.
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter((w) => w && !['and', 'the', 'of', 's'].includes(w))
export function receivingMatches(receiving, features) {
  const parts = String(receiving || '').split(/[;,&]|\band\b/i).map((p) => new Set(words(p))).filter((p) => p.size)
  const all = new Set(parts.flatMap((p) => [...p]))
  const out = new Map()
  for (const f of features) {
    const w = words(f.properties.h === 'wq' ? f.properties.name.split(':')[0] : f.properties.name.split(',')[0])
    if (w.length && w.every((x) => all.has(x))) out.set(`${f.properties.h}|${f.properties.name}`, { h: f.properties.h, name: f.properties.name, src: f.properties.doc })
  }
  return [...out.values()]
}

/** The bake's 303(d) and shellfish layers as factor features: `h`, a short `name` from their own attributes, `doc`. */
export function waterFeatures(wq, shell) {
  const tag = (f, h, name) => ({ ...f, properties: { h, name, doc: f.properties.doc } })
  return [
    ...(wq?.features || []).map((f) => tag(f, 'wq', [f.properties.ListingWaterbodyName, f.properties.ParameterName].filter(Boolean).join(': '))),
    ...(shell?.features || []).map((f) => tag(f, 'shell', [f.properties.NAME, f.properties.CLASS && String(f.properties.CLASS).toLowerCase()].filter(Boolean).join(', '))),
  ]
}

// ─── Geometry, in local metres around the San Juans (equirectangular; error well under 1% over a few km) ───
const LAT0 = 48.6
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180)
const KY = 110540
const xy = ([lon, lat]) => [lon * KX, lat * KY]

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const L = dx * dx + dy * dy
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
function lineDist(p, coords) {
  let m = Infinity
  for (let i = 1; i < coords.length; i++) m = Math.min(m, segDist(p, coords[i - 1], coords[i]))
  return coords.length === 1 ? Math.hypot(p[0] - coords[0][0], p[1] - coords[0][1]) : m
}
function inRing(p, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function polyDist(p, rings) {
  if (inRing(p, rings[0]) && !rings.slice(1).some((h) => inRing(p, h))) return 0
  return Math.min(...rings.map((r) => lineDist(p, r)))
}
// Every part of a geometry as [kind, coords] in metres.
function parts(g) {
  const L = (c) => c.map(xy)
  switch (g?.type) {
    case 'LineString': return [['line', L(g.coordinates)]]
    case 'MultiLineString': return g.coordinates.map((c) => ['line', L(c)])
    case 'Polygon': return [['poly', g.coordinates.map(L)]]
    case 'MultiPolygon': return g.coordinates.map((c) => ['poly', c.map(L)])
    default: return []
  }
}

/** Index a habitat FeatureCollection once (bbox per feature, coordinates in metres). */
export function indexHabitat(fc) {
  return fc.features.map((f) => {
    const ps = parts(f.geometry)
    const all = ps.flatMap(([k, c]) => (k === 'line' ? c : c.flat()))
    const xs = all.map((q) => q[0]), ys = all.map((q) => q[1])
    return { props: f.properties, parts: ps, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
  })
}

/** Nearest feature of each habitat type within maxM of [lon, lat]: [{ h, m, name }], nearest first. */
export function habitatNear(index, lon, lat, maxM = LIST_M) {
  const p = xy([lon, lat])
  const best = new Map()
  for (const f of index) {
    const [x0, y0, x1, y1] = f.box
    if (p[0] < x0 - maxM || p[0] > x1 + maxM || p[1] < y0 - maxM || p[1] > y1 + maxM) continue
    const m = Math.min(...f.parts.map(([k, c]) => (k === 'line' ? lineDist(p, c) : polyDist(p, c))))
    if (m > maxM) continue
    const h = f.props.h
    if (!best.has(h) || m < best.get(h).m) best.set(h, { h, m: Math.round(m), name: f.props.name || null, ...(f.props.doc ? { src: f.props.doc } : {}) })
  }
  return [...best.values()].sort((a, b) => a.m - b.m || FACTORS.findIndex((x) => x.id === a.h) - FACTORS.findIndex((x) => x.id === b.h))
}

/** Plain words for a distance: "at this point" / "within 10 m" / "about 140 m away". */
export function distanceWords(m) {
  if (m === 0) return 'at this point'
  if (m <= 10) return 'within 10 m'
  return `about ${m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10} m away`
}
