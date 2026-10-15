/**
 * SkyTruth Cerulean reads (server side): one slick with its ranked sources, and every slick linked to some MMSIs.
 * Used by api/cerulean.js (the map's proxy) and api/ships.js (op=slickShips / op=save: a slick's own source list is the
 * proof that an MMSI is worth looking up). Facts and limits: lib/ships/cerulean.js.
 */
import { CERULEAN_API } from './cerulean.js'
import { nearestFacility } from './offshoreFacilities.js'

export const C = `${CERULEAN_API}/collections`
export const UA = { 'User-Agent': 'EarthAtlas/1.0 (+https://earthatlas.org/ships)' }

export async function getJson(url) {
  // Ask for GeoJSON by name: with Accept: application/json the API answers with bare rows instead.
  const r = await fetch(url, { headers: { ...UA, Accept: 'application/geo+json' } })
  if (!r.ok) throw Object.assign(new Error(`Cerulean ${r.status}`), { status: r.status })
  return r.json()
}

const SLICK_PROPS = ['id', 'slick_timestamp', 'machine_confidence', 'slick_confidence', 'length', 'area', 'hitl_cls', 'hitl_cls_name',
  'max_source_collated_score', 's1_scene_id', 'aoi_type_1_ids', 'aoi_type_3_ids']
const SOURCE_PROPS = ['slick_id', 'mmsi_or_structure_id', 'source_type', 'source_collated_score', 'source_rank', 'git_tag']

export async function ceruleanSlick(id) {
  const [s, src] = await Promise.all([
    getJson(`${C}/public.slick_plus/items?ids=${id}&geom-column=centroid&properties=${SLICK_PROPS.join(',')}`),
    getJson(`${C}/public.source_plus/items?slick_id=${id}&limit=50&sortby=source_rank&bbox-only=true&properties=${SOURCE_PROPS.join(',')}`),
  ])
  const f = s.features?.[0]
  if (!f) return null
  return {
    slick: { ...f.properties, centroid: f.geometry?.coordinates || null },
    sources: (src.features || []).map((x) => x.properties),
  }
}

export async function ceruleanVessel(mmsis) {
  const per = await Promise.all(mmsis.map((m) => getJson(
    `${C}/public.source_plus/items?mmsi_or_structure_id=${m}&source_type=VESSEL&limit=500&bbox-only=true&properties=${SOURCE_PROPS.join(',')}`)))
  const rows = per.flatMap((d) => (d.features || []).map((x) => x.properties))
  const ids = [...new Set(rows.map((r) => r.slick_id))]
  const slicks = new Map()
  for (let i = 0; i < ids.length; i += 100) { // the ids filter goes in the URL; 100 per ask keeps it short
    const d = await getJson(`${C}/public.slick_plus/items?ids=${ids.slice(i, i + 100).join(',')}&limit=100&geom-column=centroid`
      + '&properties=id,slick_timestamp,area,hitl_cls_name,max_source_collated_score')
    for (const f of d.features || []) slicks.set(f.properties.id, { ...f.properties, centroid: f.geometry?.coordinates || null })
  }
  return {
    rows: rows.map((r) => {
      const s = slicks.get(r.slick_id) || {}
      return { mmsi: String(r.mmsi_or_structure_id), slick_id: r.slick_id, score: r.source_collated_score, rank: r.source_rank,
        git_tag: r.git_tag, slick_timestamp: s.slick_timestamp || null, area: s.area ?? null, hitl_cls_name: s.hitl_cls_name || null,
        slick_score: s.max_source_collated_score ?? null, centroid: s.centroid || null }
    }).filter((r) => r.slick_timestamp),
  }
}

// ─── Ships near a slick, from Cerulean's web-app API (undocumented; SkyTruth cleared its use 2026-10-14) ───
// /api/slicks/{id}: the slick (outline, time, candidate sourceIds). /api/sources/{sourceId}: one candidate source of that
// slick, with its identity (GFW's) and, for ships, the AIS positions Cerulean used: about one a minute for the 8 h before
// the image, each with its time and an `extrapolated` flag (an estimated position, not an AIS report).
export const CERULEAN_WEB = 'https://cerulean.skytruth.org/api'
const webJson = async (path) => {
  const r = await fetch(`${CERULEAN_WEB}${path}`, { headers: { ...UA, Accept: 'application/json' } })
  if (!r.ok) throw Object.assign(new Error(`Cerulean web ${r.status}`), { status: r.status })
  return r.json()
}

// Metres from point p to the slick (0 inside), all in a local equirectangular frame around the slick.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy
  const u = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy))
}
export function distanceToPolygonsM(polys, toM, lngLat) {
  const [px, py] = toM(lngLat)
  let best = Infinity
  for (const poly of polys) {
    let inside = false
    for (const ring of poly) {
      const r = ring.map(toM)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j]
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
        best = Math.min(best, segDist(px, py, xj, yj, xi, yi))
      }
    }
    if (inside) return 0 // holes are slivers of clear water inside a slick; treated as part of it
  }
  return best
}

/**
 * Every candidate ship of one slick with its closest approach to the slick in the `hours` before the image.
 * → { slick: { id, at, lnglat }, hours, ships: [...nearest first], others: [infrastructure / dark / natural candidates] }
 * Each ship: identity (as Cerulean has it, from GFW), Cerulean's rank and scores, dist (m), closest (ISO), estimated
 * (the closest position was extrapolated, not reported), and track: [[lng, lat, unixSec, estimated 0/1], …] in the window.
 */
export async function shipsNearSlick(slickId, hours = 6) {
  const s = await webJson(`/slicks/${slickId}`)
  const p = s.properties || {}
  const T = Date.parse(`${String(p.slick_timestamp).replace(/Z$/, '')}Z`)
  if (!Number.isFinite(T)) return null
  const geom = s.geometry
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : []
  const [lng0, lat0] = p.lnglat || polys[0]?.[0]?.[0] || [0, 0]
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320
  const toM = ([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky]
  const t0 = T - hours * 36e5
  const sources = await Promise.all((p.sourceIds || []).slice(0, 30).map((id) => webJson(`/sources/${id}?locale=en`).catch(() => null)))
  const ships = [], others = []
  for (const src of sources.filter(Boolean)) {
    const base = { sourceId: src.sourceId, extId: String(src.extId ?? ''), kind: src.sourceTypeName, rank: src.rank ?? null,
      score: src.collatedScore ?? null, coincidence: src.coincidenceScore ?? null }
    if (src.sourceTypeName !== 'VESSEL') {
      // Infrastructure: where it is (Cerulean's point) and what Cerulean knows of it.
      const c = src.geometry?.features?.[0]?.geometry?.coordinates
      const o = { ...base, lnglat: Array.isArray(c) ? c : null, name: src.name || null, operator: src.operator || null, status: src.status || null, year: src.year || null }
      // The nearest facility on an official register (EMODnet, BOEM, USWTDB) within 5 km, so the card can tell a real platform from a radar artifact.
      if (src.sourceTypeName === 'INFRA' && o.lnglat) o.registered = await nearestFacility(o.lnglat[0], o.lnglat[1], 5).catch(() => null)
      others.push(o)
      continue
    }
    const pts = (src.geometry?.features || []).map((f) => ({ c: f.geometry?.coordinates, t: Date.parse(`${String(f.properties?.timestamp).replace(/Z$/, '')}Z`), e: !!f.properties?.extrapolated }))
      .filter((x) => Array.isArray(x.c) && Number.isFinite(x.t) && x.t >= t0 && x.t <= T + 60e3).sort((a, b) => a.t - b.t)
    let best = { d: Infinity }
    for (const x of pts) { const d = distanceToPolygonsM(polys, toM, x.c); if (d < best.d) best = { d, t: x.t, e: x.e } }
    ships.push({ ...base, mmsi: base.extId, name: src.vesselName || null, type: src.shipType || null, flag: src.flag || null, imo: src.imo || null,
      dist: Number.isFinite(best.d) ? Math.round(best.d) : null, closest: best.t ? new Date(best.t).toISOString() : null, estimated: !!best.e,
      // ~1 point a minute is more than a map line needs: keep one per 2 minutes, every change of estimated/reported, and the closest.
      track: pts.filter((x, i) => i === 0 || i === pts.length - 1 || x.t === best.t || x.e !== pts[i - 1].e || Math.floor(x.t / 12e4) !== Math.floor(pts[i - 1].t / 12e4))
        .map((x) => [+x.c[0].toFixed(5), +x.c[1].toFixed(5), Math.round(x.t / 1000), x.e ? 1 : 0]) })
  }
  ships.sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity))
  // Outline bbox (for the map's fit and the "within" ring), the radar image's tile URL (Cerulean's own TiTiler, only
  // ever a template from SkyTruth's API), the waters it touches (EEZ, sea area, protected area), size.
  const flat = polys.flat(2)
  const bbox = flat.length ? [Math.min(...flat.map((c) => c[0])), Math.min(...flat.map((c) => c[1])), Math.max(...flat.map((c) => c[0])), Math.max(...flat.map((c) => c[1]))] : null
  const radar = /^https:\/\/[^\s"'<>]+\{z\}\/\{x\}\/\{y\}[^\s"'<>]*$/.test(String(p.s1_tile_url || '')) ? p.s1_tile_url : null
  return { slick: { id: Number(slickId), at: new Date(T).toISOString(), lnglat: [lng0, lat0], bbox, radar, scene: p.s1_scene_id || null,
    area: p.area ?? null, length: p.length ?? null, waters: (p.aois || []).map((a) => ({ type: a.type, name: a.name })), outline: geom }, hours, ships, others }
}

// ─── The slick's Sentinel-1 radar image (Cerulean's TiTiler; tiles need the public key Cerulean's own app config hands to
// every browser, kept server-side here). The image never changes, so tiles cache for a month.
let tilerKey = null
async function tilerKeyNow() {
  if (tilerKey && tilerKey.until > Date.now()) return tilerKey.key
  const c = await webJson('/config')
  if (!c?.tilerPublicKey) throw new Error('Cerulean config has no tiler key')
  tilerKey = { key: c.tilerPublicKey, until: Date.now() + 36e5 }
  return tilerKey.key
}
const radarUrls = new Map() // slick id → tile template (WebMercatorQuad, as Cerulean's app asks for it)
export async function radarTile(slickId, z, x, y) {
  let tpl = radarUrls.get(slickId)
  if (!tpl) {
    const u = String((await webJson(`/slicks/${slickId}`)).properties?.s1_tile_url || '')
    if (!/^https:\/\/[^\s"'<>]+\/tiles\/[^\s"'<>]*\{z\}\/\{x\}\/\{y\}/.test(u)) return null
    tpl = u.includes('/tiles/WebMercatorQuad/') ? u : u.replace('/tiles/', '/tiles/WebMercatorQuad/')
    if (radarUrls.size > 500) radarUrls.clear()
    radarUrls.set(slickId, tpl)
  }
  const r = await fetch(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y), { headers: { ...UA, Authorization: `Bearer ${await tilerKeyNow()}` } })
  if (r.status === 404 || r.status === 204) return { empty: true }
  if (!r.ok) throw Object.assign(new Error(`Cerulean tiler ${r.status}`), { status: r.status })
  return { type: r.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await r.arrayBuffer()) }
}

/** A slick's time and its candidate ships (MMSI, score, rank), from Cerulean's web-app records (the public API can drop slicks). */
export async function slickCandidateShips(slickId) {
  const s = await webJson(`/slicks/${slickId}`)
  const p = s.properties || {}
  const at = Date.parse(`${String(p.slick_timestamp || '').replace(/Z$/, '')}Z`)
  if (!Number.isFinite(at)) return null
  const srcs = await Promise.all((p.sourceIds || []).slice(0, 30).map((id) => webJson(`/sources/${id}?locale=en`).catch(() => null)))
  const vessels = srcs.filter((x) => x?.sourceTypeName === 'VESSEL' && /^\d{9}$/.test(String(x.extId)))
    .map((x) => ({ mmsi: String(x.extId), score: x.collatedScore, rank: x.rank })).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
  return { at: new Date(at).toISOString(), vessels }
}
