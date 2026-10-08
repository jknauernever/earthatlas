/**
 * Climate TRACE port stays → our terminals (/ships; Josh 2026-09-29, task 4). Facts: docs/CLIMATETRACE_FACTS.md, "Shipping
 * voyages — answers from Climate TRACE": port stays are placed by Climate TRACE's algorithm where a vessel stops for longer
 * than a set time, often at terminals or other locations rather than at the port itself.
 *
 *   evidence        Climate TRACE shipping_voyages rows (BigQuery pull, gitignored CSV) → scripts/ships/bake-ct-voyages
 *                   (ct-stays-<v>.ndjson: every row with other8 = false, i.e. Climate TRACE's own "port stay" flag, with its
 *                   position(s), port name / id and gases). The CSV is the evidence; nothing is recomputed.
 *   derived         terminal_ct_stays (migration 018): one row per stay that the rule below places at ONE terminal, with the
 *                   berth, the distance, Climate TRACE's ship id / type and its figures. Evidence class 'inferred'.
 *   bake record     one source_records row (source 'climate-trace-voyages', kind 'ct_stay_bake') per version: the rule, the
 *                   berths it used, and the counts of matched / ambiguous / unmatched stays (every ambiguous position listed).
 *   interpretation  read time only: whether Climate TRACE's ship type fits the terminal (terminalCard.js shipFit, decision 1).
 *
 * Rule (conservative; CT_STAY_RULE): every position of the stay (a POINT, or both ends of a short LINESTRING) is compared with
 * every active berth of every listed terminal (official, OpenStreetMap or AIS-estimated points). The stay matches a terminal
 * only when its nearest berth is within CT_STAY_MATCH_KM for EVERY position, all positions pick the same terminal, and no other
 * terminal's berth lies within AMBIGUITY_RATIO × that distance (the house "one of A / B" rule, terminals.js). Otherwise it is
 * not matched: 'ambiguous' (two terminals about equally near), 'disagree' (positions point at different terminals), 'none'.
 * 0.75 km (not the 1 km used for GFW anchorages): Climate TRACE's OceanMind stays sit on the ship's own position, which at
 * the Salish terminals lies 0.01–0.7 km from the cited berth point (Westshore's 350 m berth: 0.30–0.66 km); Global Fishing
 * Watch stays sit on shared anchorage points, where a looser radius would sweep in whole harbours.
 */
import { AMBIGUITY_RATIO, nearestTerminals } from './terminals.js'
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'

export const CT_STAYS_VERSION = 'ct-stays-v3'
export const CT_STAY_MATCH_KM = 0.75
export const CT_STAY_RULE = {
  stayFlag: 'Climate TRACE other8 = false (its port-stay flag)',
  matchKm: CT_STAY_MATCH_KM, ambiguityRatio: AMBIGUITY_RATIO,
  positions: 'every position of the stay must pick the same terminal within matchKm',
  berths: 'every active berth of every listed terminal (official, OpenStreetMap or AIS-estimated points)',
}

/**
 * The area our Climate TRACE pull covers (bake.mjs header: the BigQuery polygon, [W, S, E, N]). A terminal with no berth inside
 * it is "not covered": its stays are not in our copy (not zero). North edge 49.75° N since the v3 pull (was 49.0° N,
 * which left Vancouver, Roberts Bank, Howe Sound and Nanaimo out).
 */
export const CT_PULL_BOX = [-124.85, 47.0, -122.05, 49.75]
export const inPullBox = (lat, lon, box = CT_PULL_BOX) => lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3]
/** Terminal keys with no berth inside the pull box (pure). berths: [{ terminal, lat, lon }]. */
export function notCoveredTerminals(berths, box = CT_PULL_BOX) {
  const all = new Set(berths.map((b) => b.terminal)), inside = new Set(berths.filter((b) => inPullBox(b.lat, b.lon, box)).map((b) => b.terminal))
  return [...all].filter((t) => !inside.has(t)).sort()
}

export const CT_VOYAGES_SOURCE = {
  id: 'climate-trace-voyages',
  name: 'Climate TRACE shipping voyages (per-ship trips and port stays)',
  publisher: 'Climate TRACE coalition (ship tracking: OceanMind and Global Fishing Watch)',
  homepage_url: 'https://climatetrace.org',
  license: 'CC BY 4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  commercial_use: true,
  attribution_text: 'Climate TRACE Emissions Inventory (climatetrace.org), shipping voyages, CC BY 4.0',
  attribution_url: 'https://climatetrace.org',
  notes: 'Modelled estimates per trip and per port stay, from Climate TRACE\'s BigQuery table shipping_voyages (Salish Sea pull). '
    + 'Ships tracked by OceanMind (om-imo-N: large, high-information vessels) or Global Fishing Watch (gfw-imo-N / gfw-mmsi-N: '
    + 'smaller, low-information or non-broadcasting vessels). Port stays are placed by Climate TRACE\'s algorithm where a vessel '
    + 'stops. The licence of the "on request" ship-level table is taken to be the inventory\'s CC BY 4.0 (docs/SHIP_POLLUTION_SOURCES.md §2).',
}

/**
 * Climate TRACE's ship type → EarthAtlas taxonomy { group, class } (pure). Climate TRACE says its "passenger" type comes from
 * its input sources and in the Salish Sea also covers small recreational and some fishing boats, so a GFW-tracked
 * "passenger" is NOT a stated kind (unknown), and an OceanMind "passenger" is only "passenger, type not known".
 */
const T = (group, cls = null) => ({ group, class: cls ?? `${group}_unspecified` })
export const CT_TYPES = {
  // OceanMind types
  bulk_carrier: T('cargo', 'bulk_carrier'), container: T('cargo', 'container_ship'), general_cargo: T('cargo', 'general_cargo'),
  refrigerated_cargo: T('cargo', 'reefer'), ro_ro: T('cargo', 'roro_cargo'), vehicle_carrier: T('cargo', 'vehicle_carrier'),
  oil_tanker: T('tanker', 'oil_tanker'), chemical_tanker: T('tanker', 'chemical_tanker'), LPG_carrier: T('tanker', 'lpg_carrier'),
  LNG_carrier: T('tanker', 'lng_carrier'), ro_pax: T('passenger', 'ferry'), cruise: T('passenger', 'cruise_ship'),
  // Global Fishing Watch types
  'cargo.bulk_carrier': T('cargo', 'bulk_carrier'), 'cargo.container': T('cargo', 'container_ship'), 'cargo.general': T('cargo', 'general_cargo'),
  'cargo.refrigerated': T('cargo', 'reefer'), 'cargo.ro_ro': T('cargo', 'roro_cargo'), 'tanker.oil': T('tanker', 'oil_tanker'),
  'tanker.chemical': T('tanker', 'chemical_tanker'), 'tanker.liquefied_gas': T('tanker', 'gas_carrier'), bunker: T('tanker', 'bunker_tanker'),
  tug: T('tug_tow', 'tug'), patrol_vessel: T('government', 'patrol'), research: T('research', 'research_vessel'),
  seismic_vessel: T('research', 'seismic_survey'), supply_vessel: T('offshore', 'offshore_support'), dredge_non_fishing: T('port_service', 'dredger'),
  trawlers: T('fishing', 'trawler'), trollers: T('fishing'), set_longlines: T('fishing'), drifting_longlines: T('fishing'),
  set_gillnets: T('fishing'), pots_and_traps: T('fishing'),
}
// Josh 2026-09-29: a Climate TRACE "chemical_tanker" counts at refinery docks and crude / fuel-product terminals. That is now
// part of the one kind-fit rule shared with the AIS visit counts (terminalCard.js SHIP_FIT, B3), not a stays-only widening.

export function fromCtType(type, assetId = '') {
  if (type === 'passenger') return String(assetId).startsWith('om-') ? T('passenger') : { group: 'unknown', class: null }
  return CT_TYPES[type] ?? { group: 'unknown', class: null }
}

const round3 = (x) => Math.round(x * 1000) / 1000

/**
 * One stay ({ at: [[lon, lat], …] }) → { status: 'match', terminal, berth, km } | { status: 'ambiguous', oneOf, km }
 * | { status: 'disagree', terminals } | { status: 'none', nearest } (pure). berths: [{ terminal, key, lat, lon }].
 * km = the farthest of the stay's positions from the matched terminal's nearest berth.
 */
export function matchCtStay(stay, berths, { matchKm = CT_STAY_MATCH_KM, ratio = AMBIGUITY_RATIO } = {}) {
  const at = (stay?.at || []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]))
  if (!at.length) return { status: 'none', reason: 'no position' }
  let pick = null, km = 0, berth = null
  for (const [lon, lat] of at) {
    const near = nearestTerminals(lat, lon, berths)
    const first = near[0]
    if (!first || first.km > matchKm) return { status: 'none', nearest: first ? { terminal: first.key, km: round3(first.km) } : null }
    const close = near.filter((n) => n.km <= first.km * ratio)
    if (close.length > 1) return { status: 'ambiguous', oneOf: close.map((n) => ({ terminal: n.key, km: round3(n.km), berth: n.berth })), km: round3(first.km) }
    if (pick && pick !== first.key) return { status: 'disagree', terminals: [pick, first.key] }
    pick = first.key
    if (first.km >= km) { km = first.km; berth = first.berth }
  }
  return { status: 'match', terminal: pick, berth, km: round3(km) }
}

/**
 * Climate TRACE sometimes has two or more stay rows for the same ship with the same start and different ends (188 extra rows on 125
 * ship-starts among 225,703 stay rows in the 2026-09-29 pull; e.g. WEST VIRGINIA at Anacortes from 2024-01-05 03:41:06, ending 2024-01-07 23:57 and 2024-01-08 11:19):
 * the same stay cut at different points, so adding both would count it twice. Keep the one that ends last (it covers the
 * other); the rest are returned as `dropped` (and counted in the bake record). Pure.
 */
export function dedupeCtStays(stays) {
  const best = new Map(), dropped = []
  for (const s of stays) {
    const k = `${s.id}|${s.start}`
    const cur = best.get(k)
    if (!cur) { best.set(k, s); continue }
    if (String(s.end) > String(cur.end)) { dropped.push(cur); best.set(k, s) } else dropped.push(s)
  }
  return { kept: [...best.values()], dropped }
}

/**
 * All stays → { matched: [{ ...stay, terminal, berth, km }], summary } (pure). summary counts every outcome; ambiguous and
 * disagreeing positions are listed (position, Climate TRACE port, the terminals involved, how many stays, tonnes CO₂e) so
 * they can be reported and reviewed; they are never assigned.
 */
export function planCtStays(stays, berths, opts = {}) {
  const matched = []
  const { kept, dropped } = dedupeCtStays(stays)
  const summary = { rows: stays.length, overlapping: dropped.length, stays: 0, matched: 0, ambiguous: 0, disagree: 0, none: 0, byTerminal: {}, review: [] }
  const review = new Map()
  for (const s of kept) {
    summary.stays++
    const m = matchCtStay(s, berths, opts)
    if (m.status === 'match') {
      summary.matched++
      const b = summary.byTerminal[m.terminal] || (summary.byTerminal[m.terminal] = { stays: 0, co2e: 0 })
      b.stays++; b.co2e += s.co2e ?? 0
      matched.push({ ...s, terminal: m.terminal, berth: m.berth, km: m.km })
      continue
    }
    summary[m.status]++
    if (m.status === 'ambiguous' || m.status === 'disagree') {
      const k = `${m.status}|${s.at.map((p) => p.join(',')).join(';')}`
      const r = review.get(k) || { status: m.status, at: s.at, port: s.port, terminals: m.oneOf?.map((o) => `${o.terminal} ${o.km} km`) || m.terminals, stays: 0, co2e: 0 }
      r.stays++; r.co2e += s.co2e ?? 0
      review.set(k, r)
    }
  }
  for (const b of Object.values(summary.byTerminal)) b.co2e = Math.round(b.co2e * 10) / 10
  summary.review = [...review.values()].map((r) => ({ ...r, co2e: Math.round(r.co2e * 10) / 10 })).sort((a, b) => b.co2e - a.co2e)
  return { matched, summary }
}

/**
 * Store one version's matched stays (DEV unless Josh says otherwise): the bake record, then this version's rows replaced in one
 * go (the evidence is the pulled CSV). `only` (terminal keys) limits which terminals' rows are written (a small proving import);
 * the bake record still carries the full summary and says which terminals were written.
 */
export async function storeCtStays(c, S, { matched, summary, bake, runId = null, version = CT_STAYS_VERSION, only = null }) {
  await upsertSource(c, S, CT_VOYAGES_SOURCE)
  const terms = new Map((await c.query(`SELECT key, id FROM ${S}.terminals`)).rows.map((r) => [r.key, r.id]))
  const rows = matched.filter((m) => !only || only.includes(m.terminal))
  const unknown = [...new Set(rows.filter((x) => !terms.has(x.terminal)).map((x) => x.terminal))]
  if (unknown.length) throw new Error(`stays for terminals not in ${S}.terminals: ${unknown.join(', ')}`)
  const ent = await findOrCreateEntity(c, S, { sourceId: CT_VOYAGES_SOURCE.id, kind: 'ct_stay_bake', anchor: version })
  const payload = { method: CT_VOYAGES_SOURCE.notes, bake_version: version, rule: CT_STAY_RULE, ...bake, summary, written: only || 'all', rows: rows.length }
  const rec = await upsertRecord(c, S, { sourceId: CT_VOYAGES_SOURCE.id, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: null, runId })
  await c.query(`DELETE FROM ${S}.terminal_ct_stays WHERE bake_version = $1`, [version])
  const f = (x) => (x == null ? null : Number(x))
  for (let i = 0; i < rows.length; i += 1000) {
    const b = rows.slice(i, i + 1000)
    await c.query(
      `INSERT INTO ${S}.terminal_ct_stays (bake_version, terminal_id, terminal_key, berth_key, km, asset_identifier, ship_name, ct_type, t0, t1,
              ct_port_name, ct_port_id, sector, lon, lat, co2e_100yr, co2e_20yr, co2, ch4, n2o, sox, nox, pm2_5, co, bake_record_id)
       SELECT $1, x.tid, x.tkey, x.berth, x.km, x.aid, x.name, x.type, x.t0, x.t1, x.port, x.pid, x.sector, x.lon, x.lat,
              x.e100, x.e20, x.co2, x.ch4, x.n2o, x.sox, x.nox, x.pm, x.co, $2
         FROM unnest($3::bigint[], $4::text[], $5::text[], $6::real[], $7::text[], $8::text[], $9::text[], $10::timestamptz[], $11::timestamptz[],
                     $12::text[], $13::text[], $14::text[], $15::float8[], $16::float8[], $17::float8[], $18::float8[], $19::float8[], $20::float8[],
                     $21::float8[], $22::float8[], $23::float8[], $24::float8[], $25::float8[])
              AS x(tid, tkey, berth, km, aid, name, type, t0, t1, port, pid, sector, lon, lat, e100, e20, co2, ch4, n2o, sox, nox, pm, co)`,
      [version, rec.id, b.map((x) => terms.get(x.terminal)), b.map((x) => x.terminal), b.map((x) => x.berth), b.map((x) => x.km),
        b.map((x) => x.id), b.map((x) => x.name ?? null), b.map((x) => x.type ?? null), b.map((x) => ctTime(x.start)), b.map((x) => ctTime(x.end)),
        b.map((x) => x.port ?? null), b.map((x) => x.portId ?? null), b.map((x) => x.sector ?? null), b.map((x) => x.at[0][0]), b.map((x) => x.at[0][1]),
        b.map((x) => f(x.co2e)), b.map((x) => f(x.co2e20)), b.map((x) => f(x.co2)), b.map((x) => f(x.ch4)), b.map((x) => f(x.n2o)),
        b.map((x) => f(x.sox)), b.map((x) => f(x.nox)), b.map((x) => f(x.pm25)), b.map((x) => f(x.co))])
  }
  return { recordId: rec.id, recordCreated: rec.created, rows: rows.length }
}

/**
 * The stay bake the site shows: the newest COMPLETE one (written 'all'; a --terminals proving import counts only where no
 * complete bake exists, e.g. the dev DB, and then shows just its terminals), newest by
 * bakedAt (automated bakes, ct-voyages-bake.yml) or else its pull date. An import stores its record and rows in one transaction,
 * so a new version goes live the moment it commits; no code change or deploy. q(text, params) → rows.
 */
export async function currentCtStaysBake(q, S) {
  const [b] = await q(
    `SELECT se.entity_key AS version, sr.id, sr.payload->>'release' AS release, sr.payload->'startDates' AS dates, sr.payload->'notCovered' AS not_covered,
            sr.payload->'written' AS written, sr.payload->'pullBox' AS box, sr.payload->>'pulled' AS pulled
       FROM ${S}.source_entities se JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
      WHERE se.source_id = $1 AND se.entity_kind = 'ct_stay_bake'
      ORDER BY (sr.payload->>'written' = 'all') DESC, coalesce(sr.payload->>'bakedAt', sr.payload->>'pulled') DESC NULLS LAST, sr.id DESC LIMIT 1`, [CT_VOYAGES_SOURCE.id])
  return b || null
}

/**
 * Keep the rows of the newest `keep` complete bakes and delete every other version's rows (the bake records stay, as
 * provenance). Run after a new version is stored, so monthly bakes don't pile up copies of the same stays.
 */
export async function pruneCtStays(c, S, keep = 2) {
  const { rows } = await c.query(
    `SELECT se.entity_key AS version FROM ${S}.source_entities se JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
      WHERE se.source_id = $1 AND se.entity_kind = 'ct_stay_bake' AND sr.payload->>'written' = 'all'
      ORDER BY coalesce(sr.payload->>'bakedAt', sr.payload->>'pulled') DESC NULLS LAST, sr.id DESC LIMIT $2`, [CT_VOYAGES_SOURCE.id, keep])
  if (!rows.length) return 0
  const r = await c.query(`DELETE FROM ${S}.terminal_ct_stays WHERE NOT (bake_version = ANY($1))`, [rows.map((x) => x.version)])
  return r.rowCount
}

/**
 * Climate TRACE's timestamps come as 'YYYY-MM-DD HH:MM:SS' from a BigQuery TIMESTAMP column, which is UTC by definition (the
 * CLI's CSV drops the zone). Anything else is rejected, never guessed.
 */
export function ctTime(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?: UTC|Z)?$/.exec(String(s ?? ''))
  if (!m) throw new Error(`not a Climate TRACE timestamp: ${s}`)
  return `${m[1]}T${m[2]}Z`
}
