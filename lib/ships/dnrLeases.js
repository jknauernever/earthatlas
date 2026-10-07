/**
 * Washington DNR state-owned aquatic land use authorizations (leases, harbor-area leases, port management agreements) at a
 * terminal's dock. DEV 2026-10-07; sources and field catalogue docs/DNR_LEASES.md. Rules: src/ships/CLAUDE.md.
 *
 *   evidence        one DNR map-service feature per source record, as the public service returns it (staff-name fields dropped):
 *                   source 'wa-dnr-aquatic-uses', kind dnr_use_authorization (a point; key = layer:OBJECTID) or dnr_port_management
 *                   (a port management agreement area polygon; key = PMA:OBJECTID; geometry kept)
 *   claim           the feature's own fields (lease number, lessee, type, status, start date, acres), unchanged in the payload
 *   interpretation  terminal_land_records kind dnr_use_authorization / dnr_port_management: which authorization is this dock's, with
 *                   the hand-checked reason from lib/ships/data/wa-leases-sites.json
 *
 * The public service (AQ_ENC_Public_Prod, layers 1-4 and 25) publishes the lease number, lessee, type, status, start date and
 * mapped acres, but NOT the end date (CONTRACT_END_DT is empty in all 6,168 active records, read 2026-10-07). EarthAtlas shows
 * only what the public service publishes; it never fills in an end date from elsewhere.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'wa-leases-sites.json')
export const loadLeaseSites = async () => JSON.parse(await readFile(DATA, 'utf8'))

export const DNR_SERVICE = 'https://gis.dnr.wa.gov/site3/rest/services/Aquatics/AQ_ENC_Public_Prod/MapServer'
/** The use-authorization point layers read, in the order a lease is looked up (active first). */
export const DNR_LAYERS = {
  1: 'Active Uses Points',
  3: 'Extended/ Holdover',
  2: 'Application Phase',
  4: 'Historic/ Not Active Use Authorizations',
}
export const DNR_PMA_LAYER = 25   // Port Management Agreement (PMA) Areas (polygons; layer 104 holds the same 122 features)
export const DNR_AQUATIC_LEASING = 'https://dnr.wa.gov/aquatics/aquatic-leasing-and-transactions'

export const DNR_SOURCE = {
  id: 'wa-dnr-aquatic-uses',
  name: 'Washington DNR aquatic lands use authorizations (AQ_ENC_Public_Prod map service)',
  publisher: 'Washington State Department of Natural Resources, Aquatic Resources Division',
  homepage_url: `${DNR_SERVICE}`,
  license: 'Public agency record (WA DNR): cleared for EarthAtlas use by Josh 2026-10-06 (public agency records are treated as cleared; terms page not read). Credit and link.',
  license_url: null,
  commercial_use: false,
  attribution_text: 'WA DNR aquatic lands',
  attribution_url: `${DNR_SERVICE}`,
  notes: 'Points for active, extended/holdover, application-phase and historic use authorizations and polygons for port management '
    + 'agreement areas, read with paged ArcGIS REST queries (2,000 a page) and cached. The service carries no lease end date. Staff '
    + 'name fields (EDIT_NM, PERSON_RESPONSIBLE) are dropped before storage.',
}

/** DNR's contract type codes (the layer's own coded-value domain). */
export const CONTRACT_TYPE = {
  20: 'Aquatic land lease', 21: 'Unauthorized use and occupancy', 22: 'Harbor area lease', 23: 'Right of entry / mooring buoy',
  31: 'Aquatic material sale', 50: 'Right of way (granted land)', 51: 'Right of way (aquatic land)', 92: 'Management agreement',
}
/** DNR's CONTRACT_ACTIVE_CD codes, in plain words. */
export const CONTRACT_STATUS = { Y: 'active', EX: 'extended or in holdover', AP: 'application in process', N: 'no longer active', UK: 'status unknown' }

const DROP = ['EDIT_NM', 'PERSON_RESPONSIBLE']   // DNR staff usernames: not evidence about the lease, not shown publicly

/** A query URL for one lease number in one layer, as a readable HTML page (the inline source link). */
export const leaseQueryUrl = (jacket, layer = 1) =>
  `${DNR_SERVICE}/${layer}/query?where=${encodeURIComponent(`LEASE_JKT_NO='${jacket}'`)}&outFields=*&returnGeometry=false&f=html`
/** The paged query EarthAtlas reads a whole layer with. */
export const layerPageUrl = (layer, offset) =>
  `${DNR_SERVICE}/${layer}/query?where=1%3D1&outFields=*&outSR=4326&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=2000&f=json`
export const countUrl = (layer) => `${DNR_SERVICE}/${layer}/query?where=1%3D1&returnCountOnly=true&f=json`

/** epoch ms (UTC midnight) → 'YYYY-MM-DD'. */
export const dnrDate = (ms) => (ms == null || !Number.isFinite(Number(ms)) ? null : new Date(Number(ms)).toISOString().slice(0, 10))

/** One feature → the evidence payload (attributes minus staff names, plus geometry and layer). */
export function usePayload(feature, layer) {
  const a = { ...(feature.attributes || {}) }
  for (const k of DROP) delete a[k]
  return { layer: Number(layer), layer_name: DNR_LAYERS[layer] ?? (Number(layer) === DNR_PMA_LAYER ? 'Port Management Agreement (PMA) Areas' : null),
    attributes: a, geometry: feature.geometry ?? null, dropped_fields: DROP }
}

/** The fields EarthAtlas shows, read from one payload. */
export function useFields(p) {
  const a = p.attributes || {}
  const type = a.CONTRACT_TYPE_NM == null ? null : String(a.CONTRACT_TYPE_NM)
  return {
    layer: p.layer, objectid: a.OBJECTID, contract: a.CONTRACT_NO ?? null, lease: a.LEASE_JKT_NO ?? null, site: a.SITE_ID ?? null,
    type, typeName: CONTRACT_TYPE[type] ?? null, status: a.CONTRACT_ACTIVE_CD ?? null, statusWords: CONTRACT_STATUS[a.CONTRACT_ACTIVE_CD] ?? null,
    effective: dnrDate(a.CONTRACT_EFFECTIVE_DT), ends: dnrDate(a.CONTRACT_END_DT), acres: a.GIS_ACRES == null ? null : Number(a.GIS_ACRES),
    lessee: a.BUSINESS_PARTNER_NM ?? null, countyCode: a.COUNTY_CD ?? null, locationBasis: a.LOCATION_BASIS ?? null,
    lat: p.geometry?.y ?? a.YLATITUDE ?? null, lon: p.geometry?.x ?? a.XLONGITUDE ?? null,
  }
}

// ── geometry (small, planar near the point: fine at the hundreds-of-metres scale used here) ──
const RAD = Math.PI / 180
export const km = (lat1, lon1, lat2, lon2) =>
  6371 * Math.hypot((lon2 - lon1) * RAD * Math.cos(((lat1 + lat2) / 2) * RAD), (lat2 - lat1) * RAD)
function inRing(x, y, ring) {
  let ins = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins
  }
  return ins
}
/** Is (lon, lat) inside an Esri polygon (rings; holes by even-odd)? */
export const inPolygon = (lon, lat, rings) => (rings || []).filter((r) => inRing(lon, lat, r)).length % 2 === 1
/** Metres from (lon, lat) to the polygon: 0 inside, else the distance to its nearest edge. */
export function metresToPolygon(lon, lat, rings) {
  if (inPolygon(lon, lat, rings)) return 0
  const xy = ([x, y]) => [x * RAD * Math.cos(lat * RAD) * 6371000, y * RAD * 6371000]
  const p = xy([lon, lat])
  let best = Infinity
  for (const r of rings || []) for (let i = 1; i < r.length; i++) {
    const a = xy(r[i - 1]), b = xy(r[i]), dx = b[0] - a[0], dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
  }
  return best
}

/** Distance (km) from the nearest berth of a terminal to a point. */
export const berthKm = (terminal, lat, lon) => Math.min(...(terminal.berths || []).map((b) => km(b.lat, b.lon, lat, lon)))

/** Words that must all appear in the lessee name (case-insensitive, punctuation ignored). */
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
export const lesseeHas = (lessee, words) => (words || []).every((w) => ` ${norm(lessee)} `.includes(` ${norm(w)} `))

/**
 * index = { uses: Map(layer → [payload]), pma: [payload] } built from the cached layer pages.
 * Candidates for a terminal (for hand review; nothing is accepted automatically): leases / harbor areas / management agreements
 * (types 20, 21, 22, 92) within maxKm of a berth in the active, extended and application layers, nearest first.
 */
export function useCandidates(terminal, index, maxKm = 1) {
  const out = new Map()
  for (const layer of [1, 3, 2]) for (const p of index.uses.get(layer) || []) {
    const f = useFields(p)
    if (!['20', '21', '22', '92'].includes(f.type) || f.lat == null) continue
    const d = berthKm(terminal, f.lat, f.lon)
    if (d > maxKm) continue
    const k = `${layer}:${f.lease}`
    if (!out.has(k) || d < out.get(k).km) out.set(k, { ...f, km: d })
  }
  return [...out.values()].sort((a, b) => a.km - b.km)
}

/** The PMA area nearest a terminal's berths: { payload, metres, berth } (metres 0 = a berth is inside). */
export function nearestPma(terminal, index) {
  let best = null
  for (const b of terminal.berths || []) for (const p of index.pma || []) {
    const m = metresToPolygon(b.lon, b.lat, p.geometry?.rings)
    if (!best || m < best.metres) best = { payload: p, metres: m, berth: b.key }
  }
  return best
}

/** One terminal entry of wa-leases-sites.json: what it must carry. Returns error strings. */
export function validateLeaseEntry(key, e) {
  const errs = []
  const d = e?.dnr
  if (!d) return [`${key}: dnr missing`]
  if (!(d.uses || []).length && !d.pma && !d.none) errs.push(`${key}: dnr.uses, dnr.pma or dnr.none`)
  for (const u of d.uses || []) {
    if (!/^\d{2}-[A-Z0-9]{6}$/.test(u.lease || '')) errs.push(`${key}: lease number ${u.lease}`)
    if (!u.why || !(u.lessee_words || []).length) errs.push(`${key}: ${u.lease} needs why + lessee_words`)
  }
  if (d.pma) {
    if (!/^\d{2}-0800\d{2}$/.test(d.pma.lease || '') || !Number.isInteger(d.pma.area_objectid) || !d.pma.why || !Number.isFinite(d.pma.max_metres)) {
      errs.push(`${key}: pma needs lease, area_objectid, max_metres, why`)
    }
  }
  if (d.none && (d.uses || []).length) errs.push(`${key}: dnr.none with uses`)
  return errs
}

/** The whole data file against the terminal list: every WA terminal has an entry and no entry names an unknown terminal. */
export function validateLeaseSites(data, terminals) {
  const wa = terminals.filter((t) => t.country === 'US').map((t) => t.id)
  const keys = Object.keys(data.terminals || {})
  const errs = []
  for (const k of wa) if (!keys.includes(k)) errs.push(`${k}: no entry`)
  for (const k of keys) if (!wa.includes(k)) errs.push(`${k}: not a WA terminal`)
  for (const k of keys) errs.push(...validateLeaseEntry(k, data.terminals[k]))
  return errs
}

/** Build index = { uses: Map(layer → [payload]), pma: [payload] } from layer pages ({ layer, body } with body = the query JSON). */
export function buildIndex(pages) {
  const uses = new Map(), pma = []
  for (const { layer, body } of pages) {
    for (const ft of body.features || []) {
      const p = usePayload(ft, layer)
      if (Number(layer) === DNR_PMA_LAYER) pma.push(p)
      else { if (!uses.has(Number(layer))) uses.set(Number(layer), []); uses.get(Number(layer)).push(p) }
    }
  }
  return { uses, pma }
}

/**
 * Resolve one terminal entry against the index → { uses: [...], pma, problems }. Every feature of an accepted lease number in the
 * active / extended / application layers is kept as evidence; the lessee words must be in the DNR lessee name, and at least one
 * feature must lie within max_km (default 1) of a berth. A PMA area must be the named polygon and lie within max_metres.
 */
export function resolveEntry(terminal, entry, index) {
  const problems = [], uses = []
  for (const u of entry.dnr.uses || []) {
    const feats = [1, 3, 2].flatMap((layer) => (index.uses.get(layer) || []).filter((p) => p.attributes.LEASE_JKT_NO === u.lease))
    if (!feats.length) { problems.push(`${terminal.id}: ${u.lease} not in DNR's active, extended or application layers`); continue }
    const fields = feats.map(useFields)
    const bad = fields.filter((f) => !lesseeHas(f.lessee, u.lessee_words))
    if (bad.length === fields.length) { problems.push(`${terminal.id}: ${u.lease} lessee "${fields[0].lessee}" lacks ${u.lessee_words.join(' ')}`); continue }
    const near = Math.min(...fields.filter((f) => f.lat != null).map((f) => berthKm(terminal, f.lat, f.lon)))
    if (!(near <= (u.max_km ?? 1))) { problems.push(`${terminal.id}: ${u.lease} is ${near.toFixed(2)} km from the berths`); continue }
    // The record shown: the active one if any, else extended, else the application; the nearest feature within it.
    const ranked = feats.map((p, i) => ({ p, f: fields[i], d: fields[i].lat == null ? 99 : berthKm(terminal, fields[i].lat, fields[i].lon) }))
      .filter((x) => lesseeHas(x.f.lessee, u.lessee_words))
      .sort((a, b) => [1, 3, 2].indexOf(a.p.layer) - [1, 3, 2].indexOf(b.p.layer) || a.d - b.d)
    uses.push({ entry: u, main: ranked[0], all: ranked, km: near })
  }
  let pma = null
  if (entry.dnr.pma) {
    const e = entry.dnr.pma
    const p = (index.pma || []).find((x) => x.attributes.OBJECTID === e.area_objectid)
    if (!p || p.attributes.LEASE_JKT_NO !== e.lease) problems.push(`${terminal.id}: PMA area ${e.area_objectid} is not ${e.lease}`)
    else {
      const m = Math.min(...(terminal.berths || []).map((b) => metresToPolygon(b.lon, b.lat, p.geometry?.rings)))
      if (!(m <= e.max_metres)) problems.push(`${terminal.id}: berths are ${Math.round(m)} m from PMA area ${e.area_objectid} (allowed ${e.max_metres})`)
      else {
        // The port's name: DNR's active point records of the same agreement carry it (the polygons do not).
        const pts = (index.uses.get(1) || []).filter((x) => x.attributes.LEASE_JKT_NO === e.lease)
        const port = pts.map((x) => x.attributes.BUSINESS_PARTNER_NM).find(Boolean) ?? null
        if (e.port_words && !lesseeHas(port, e.port_words)) problems.push(`${terminal.id}: PMA ${e.lease} manager "${port}" lacks ${e.port_words.join(' ')}`)
        else pma = { entry: e, area: p, metres: Math.round(m), port, portPoint: pts.find((x) => x.attributes.BUSINESS_PARTNER_NM) ?? null }
      }
    }
  }
  return { uses, pma, problems }
}

async function store(c, S, kind, key, payload, url, runId, version) {
  const ent = await findOrCreateEntity(c, S, { sourceId: DNR_SOURCE.id, kind, anchor: key })
  const r = await upsertRecord(c, S, { sourceId: DNR_SOURCE.id, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: url, runId })
  return { id: Number(r.id), created: r.created }
}

async function upsertLand(c, S, terminalId, kind, key, recId, detail) {
  await c.query(
    `INSERT INTO ${S}.terminal_land_records (terminal_id, kind, record_key, source_record_id, detail) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (terminal_id, kind, record_key) DO UPDATE SET source_record_id = EXCLUDED.source_record_id, detail = EXCLUDED.detail,
       status = 'accepted', last_seen_at = now()`, [terminalId, kind, key, recId, detail])
}

/**
 * data = wa-leases-sites.json; index from buildIndex; terminalList = salish-terminals.json terminals (their berths); retrieved = 'YYYY-MM-DD' the pages were read. Stores the evidence features and
 * the accepted terminal_land_records; on a full run (no `only`) records of the listed terminals that the file no longer names are
 * marked withdrawn. Idempotent.
 */
export async function importDnrLeases(c, S, data, index, terminalList, { runId = null, retrieved = null, only = null } = {}) {
  const stats = { terminals: 0, uses: 0, pma: 0, recordsCreated: 0, withdrawn: 0, problems: [] }
  await upsertSource(c, S, DNR_SOURCE)
  const terms = new Map((await c.query(`SELECT id, key FROM ${S}.terminals WHERE key = ANY($1)`, [Object.keys(data.terminals)])).rows.map((r) => [r.key, r]))
  const byKey = new Map(terminalList.map((x) => [x.id, x]))
  for (const [key, entry] of Object.entries(data.terminals)) {
    if (only && key !== only) continue
    const t = terms.get(key)
    if (!t) { stats.problems.push(`${key}: terminal not in the database`); continue }
    stats.terminals++
    const terminal = byKey.get(key) || { id: key, berths: [] }
    const r = resolveEntry(terminal, entry, index)
    stats.problems.push(...r.problems)
    const keep = []
    for (const u of r.uses) {
      const ids = []
      for (const x of u.all) {
        const rec = await store(c, S, 'dnr_use_authorization', `${x.p.layer}:${x.p.attributes.OBJECTID}`, x.p, layerPageUrl(x.p.layer, 0), runId, retrieved)
        stats.recordsCreated += rec.created ? 1 : 0
        ids.push(rec.id)
      }
      const f = u.main.f
      await upsertLand(c, S, t.id, 'dnr_use_authorization', u.entry.lease, ids[0], {
        lease: f.lease, contract: f.contract, type: f.type, typeName: f.typeName, status: f.status, statusWords: f.statusWords,
        layer: f.layer, layerName: DNR_LAYERS[f.layer], effective: f.effective, ends: f.ends, acres: f.acres, lessee: f.lessee,
        sites: [...new Set(u.all.map((x) => x.f.site).filter(Boolean))], km: Math.round(u.km * 1000) / 1000,
        others: u.all.slice(1).filter((x) => x.p.layer !== f.layer).map((x) => ({ layer: x.p.layer, status: x.f.status, statusWords: x.f.statusWords, effective: x.f.effective })),
        url: leaseQueryUrl(f.lease, f.layer), why: u.entry.why, record_ids: ids,
      })
      keep.push(`dnr_use_authorization:${u.entry.lease}`)
      stats.uses++
    }
    if (r.pma) {
      const a = r.pma.area
      const rec = await store(c, S, 'dnr_port_management', `PMA:${a.attributes.OBJECTID}`, a, layerPageUrl(DNR_PMA_LAYER, 0), runId, retrieved)
      stats.recordsCreated += rec.created ? 1 : 0
      const ids = [rec.id]
      if (r.pma.portPoint) {
        const pr = await store(c, S, 'dnr_use_authorization', `1:${r.pma.portPoint.attributes.OBJECTID}`, r.pma.portPoint, layerPageUrl(1, 0), runId, retrieved)
        stats.recordsCreated += pr.created ? 1 : 0
        ids.push(pr.id)
      }
      const at = a.attributes
      await upsertLand(c, S, t.id, 'dnr_port_management', r.pma.entry.lease, rec.id, {
        lease: at.LEASE_JKT_NO, contract: at.CONTRACT_NO, port: r.pma.port, site: at.SITE_ID ?? null, effective: dnrDate(at.CONTRACT_EFFECTIVE_DT),
        areaAcres: at.GIS_ACRES == null ? null : Number(at.GIS_ACRES), metres: r.pma.metres, url: leaseQueryUrl(at.LEASE_JKT_NO, DNR_PMA_LAYER),
        why: r.pma.entry.why, record_ids: ids,
      })
      keep.push(`dnr_port_management:${r.pma.entry.lease}`)
      stats.pma++
    }
    const { rowCount } = await c.query(
      `UPDATE ${S}.terminal_land_records SET status = 'withdrawn', last_seen_at = now()
        WHERE terminal_id = $1 AND kind IN ('dnr_use_authorization', 'dnr_port_management') AND status = 'accepted' AND NOT ((kind || ':' || record_key) = ANY($2))`,
      [t.id, keep])
    stats.withdrawn += rowCount
  }
  return stats
}

/** The card's rows for one terminal (all kinds), newest evidence first within kind, plus the sources to credit. */
export async function terminalLand(q, S, terminalId) {
  const rows = await q(`SELECT kind, record_key, source_record_id, detail FROM ${S}.terminal_land_records
                         WHERE terminal_id = $1 AND status = 'accepted' ORDER BY kind, record_key`, [terminalId])
  const records = rows.map((r) => ({ kind: r.kind, key: r.record_key, record_id: Number(r.source_record_id), ...r.detail }))
  const ids = [...new Set([...(records.some((r) => r.kind.startsWith('dnr_')) ? [DNR_SOURCE.id] : []), ...records.flatMap((r) => r.source_ids || [])])]
  const sources = ids.length ? await q(`SELECT id, name, publisher, homepage_url, license, license_url, commercial_use, attribution_text, attribution_url
                                          FROM ${S}.sources WHERE id = ANY($1)`, [ids]) : []
  return { records, sources }
}
