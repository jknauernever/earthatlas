/**
 * Read queries behind api/ships.js. Each takes `q(text, params) → rows` so the
 * same code runs over Neon HTTP (API) and a pooled client (tests).
 * All results are bounded.
 */
import { normName, normImo, normMmsi } from './normalize.js'
import { classifyClaims } from './taxonomy.js'
import { parseTypeQuery, vesselsOfType, OWNER_ATTRS, RELATED } from './typeSearch.js'
import { WITHHELD } from './registry.js'
import { publicLicenseRecord } from './fccUls.js'
import { publicIncidentPayload, INCIDENT_DETAIL_KEYS } from './incidentsPublic.js'

const SUMMARY_ATTRS = ['name', 'imo', 'mmsi', 'callsign', 'flag', 'vessel_type']

/** Kinds of ship, as GFW classifies them (evidence class 'inferred'), with vessel counts. */
export async function vesselKinds(q, S) {
  return q(
    `SELECT value_norm AS kind, count(DISTINCT vessel_id)::int AS n FROM ${S}.vessel_assertions
      WHERE attribute = 'vessel_type' AND evidence_class = 'inferred' AND value_norm <> 'NA'
      GROUP BY 1 ORDER BY 2 DESC`, [])
}

const KIND_RE = /^[A-Z_]{2,30}$/

/**
 * Search by IMO (7 digits), MMSI (9 digits), callsign, name, owner / operator, or kind of ship
 * ("oil tanker", "ferries", "Washington ferry": lib/ships/typeSearch.js), optionally narrowed to kinds
 * of ship (GFW classification). With kinds and no text it browses those kinds alphabetically.
 * At most 25 vessels (50 for a kind-of-ship search). Each result says why it matched (`match`).
 * `searchVesselsFull` also returns the kind-of-ship reading and its total.
 */
export async function searchVessels(q, S, text, kinds = []) {
  return (await searchVesselsFull(q, S, text, kinds)).results
}
export async function searchVesselsFull(q, S, text, kinds = []) {
  const typed = await searchByType(q, S, text, kinds)
  if (typed) return typed
  return { results: await searchText(q, S, text, kinds), type: null, total: null }
}
async function searchByType(q, S, text, kinds) {
  const raw = String(text || '').trim()
  if (raw.length < 3 || /^\s*(IMO\s*)?\d+\s*$/i.test(raw)) return null
  const t = parseTypeQuery(raw)
  if (!t) return null
  // A ship NAMED like the words ("Ferry Queen") still comes first, then the ships of that kind.
  const named = t.rest ? [] : (await searchText(q, S, raw, kinds)).filter((r) => r.score >= 0.9)
  const r = await vesselsOfType(q, S, t, { restNorm: normName(t.rest) })
  if (!r.ids.length && !named.length) return t.rest ? null : { results: [], type: t, total: 0 }
  const summaries = await summarize(q, S, r.ids)
  const kindMatch = { kind: 'type', label: t.label }
  const seen = new Set(named.map((n) => n.id))
  const results = [...named, ...r.ids.filter((id) => !seen.has(id)).map((id) => ({ ...summaries[id], score: 0.8, match: kindMatch }))].filter((s) => s.id)
  return { results, type: { group: t.group, class: t.class, classes: t.class ? [t.class, ...(RELATED[t.class] || [])] : [], label: t.label, rest: t.rest || null },
    total: r.total, capped: !!r.capped }
}
async function searchText(q, S, text, kinds = []) {
  const raw = String(text || '').trim()
  const ks = (kinds || []).map((k) => String(k).toUpperCase()).filter((k) => KIND_RE.test(k)).slice(0, 12)
  if (raw.length < 2 && !ks.length) return []
  const digits = raw.replace(/\D/g, '')
  let hits
  if (raw.length < 2) {
    hits = await q(
      `SELECT va.vessel_id, 0.5::float AS score, min(n.value_norm) AS sortname
         FROM ${S}.vessel_assertions va
         LEFT JOIN ${S}.vessel_assertions n ON n.vessel_id = va.vessel_id AND n.attribute = 'name'
        WHERE va.attribute = 'vessel_type' AND va.evidence_class = 'inferred' AND va.value_norm = ANY($1)
        GROUP BY va.vessel_id ORDER BY min(n.value_norm) NULLS LAST LIMIT 25`, [ks])
  } else if (/^(IMO\s*)?\d{7}$/i.test(raw)) {
    hits = await q(`SELECT DISTINCT vessel_id, 1.0::float AS score FROM ${S}.vessel_assertions
                     WHERE attribute = 'imo' AND value_norm = $1 LIMIT 25`, [normImo(raw).value])
  } else if (/^\d{9}$/.test(digits) && digits === raw.replace(/\s/g, '')) {
    hits = await q(`SELECT DISTINCT vessel_id, 1.0::float AS score FROM ${S}.vessel_assertions
                     WHERE attribute = 'mmsi' AND value_norm = $1 LIMIT 25`, [normMmsi(raw).value])
  } else {
    const n = normName(raw)
    if (n.length < 2) return []
    // Names and call signs, then owners / operators (Josh 2026-09-27), whose text may appear anywhere
    // ("washington state" finds WASHINGTON STATE TRANSPORT). Withheld owner values are never searched.
    hits = await q(
      `SELECT DISTINCT ON (vessel_id) vessel_id, score, attribute, value_raw FROM (
         SELECT vessel_id, attribute, value_raw, CASE WHEN value_norm = $1 THEN 1.0 WHEN value_norm LIKE $1 || '%' THEN 0.9
                                ELSE similarity(value_norm, $1) END AS score
           FROM ${S}.vessel_assertions
          WHERE (attribute = 'name' AND (value_norm LIKE $1 || '%' OR value_norm % $1))
             OR (attribute = 'callsign' AND value_norm = $1)
         UNION ALL
         SELECT vessel_id, attribute, value_raw, 0.75 AS score
           FROM ${S}.vessel_assertions
          WHERE attribute = ANY($2) AND length($1) >= 4 AND value_norm LIKE '%' || $1 || '%'
            AND (detail->>'display') IS DISTINCT FROM 'false'
       ) s ORDER BY vessel_id, score DESC`, [n, OWNER_ATTRS])
    hits = hits.sort((a, b) => b.score - a.score).slice(0, 25)
  }
  if (ks.length && raw.length >= 2 && hits.length) {
    const keep = new Set((await q(
      `SELECT DISTINCT vessel_id FROM ${S}.vessel_assertions
        WHERE vessel_id = ANY($1) AND attribute = 'vessel_type' AND evidence_class = 'inferred' AND value_norm = ANY($2)`,
      [hits.map((h) => h.vessel_id), ks])).map((r) => r.vessel_id))
    hits = hits.filter((h) => keep.has(h.vessel_id))
  }
  if (!hits.length) return []
  const ids = hits.map((h) => h.vessel_id)
  const summaries = await summarize(q, S, ids)
  return hits.map((h) => ({ ...summaries[h.vessel_id], score: Number(h.score),
    ...(OWNER_ATTRS.includes(h.attribute) ? { match: { kind: 'owner', attribute: h.attribute, value: h.value_raw } } : {}) })).filter((s) => s.id)
}

/**
 * Headline value per attribute, for result lists: the latest REGISTRY value
 * when a registry names the ship, otherwise the latest value from any source.
 * A registry outranks broadcasts: GFW can attach a disputed AIS identity to a
 * vessel (e.g. CRESTY's AIS identity inside GOLDENEYE's entry), and the
 * headline must not follow it. Each value keeps its
 * evidence class and source, so the list can show provenance inline too.
 */
export async function summarize(q, S, ids) {
  const rows = await q(
    `SELECT DISTINCT ON (va.vessel_id, va.attribute)
            va.vessel_id, va.attribute, va.value_raw, va.evidence_class, va.source_id,
            upper(va.period) AS until, v.needs_review
       FROM ${S}.vessel_assertions va JOIN ${S}.vessels v ON v.id = va.vessel_id
      WHERE va.vessel_id = ANY($1) AND va.attribute = ANY($2)
      ORDER BY va.vessel_id, va.attribute, (va.evidence_class = 'registry') DESC,
               upper(va.period) DESC NULLS LAST, va.id`, [ids, SUMMARY_ATTRS])
  const out = {}
  for (const r of rows) {
    const s = (out[r.vessel_id] ||= { id: r.vessel_id, needsReview: r.needs_review, latest: {} })
    s.latest[r.attribute] = { value: r.value_raw, evidence: r.evidence_class, source: r.source_id, until: r.until }
  }
  return out
}

/** Full identity picture for one vessel: every active claim with its provenance, plus links. */
export async function getVessel(q, S, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null
  const [vessel] = await q(`SELECT id, status, merged_into, needs_review, created_at FROM ${S}.vessels WHERE id = $1`, [id])
  if (!vessel) return null
  const assertions = await q(
    `SELECT va.id, va.attribute, va.value_raw, va.value_norm, lower(va.period) AS "from", upper(va.period) AS "to",
            lower_inc(va.period) AS from_inc, upper_inc(va.period) AS to_inc, va.period_kind, va.evidence_class,
            va.sub_record_ref, va.detail, va.source_id, va.entity_key,
            va.first_source_record_id, va.last_source_record_id, va.first_seen_at, va.last_seen_at,
            -- How this claim's source entity was tied to the vessel (e.g. IMO_AIS_NAME = weaker Wikidata match).
            (SELECT l.method FROM ${S}.entity_links l
              WHERE l.source_entity_id = va.source_entity_id AND l.status = 'accepted') AS link_method
       FROM ${S}.vessel_assertions va
      WHERE va.vessel_id = $1
      ORDER BY va.attribute, lower(va.period) NULLS FIRST, va.id
      LIMIT 5000`, [id])
  // Privacy rule (docs/VESSEL_REGISTRIES.md §Privacy): a claim flagged detail.display = false
  // never leaves the server with its value; the UI gets the placeholder and the reason.
  for (const a of assertions) {
    if (a.detail?.display === false) { a.value_raw = WITHHELD.value_raw; a.value_norm = WITHHELD.value_norm }
  }
  const links = await q(
    `SELECT l.id, l.status, l.method, l.evidence, l.decided_by, l.decided_at, se.source_id, se.entity_key,
            l.source_entity_id,
            (SELECT a.vessel_id FROM ${S}.entity_links a
              WHERE a.source_entity_id = l.source_entity_id AND a.status = 'accepted') AS other_vessel
       FROM ${S}.entity_links l JOIN ${S}.source_entities se ON se.id = l.source_entity_id
      WHERE l.vessel_id = $1 AND l.status IN ('accepted', 'candidate')
      ORDER BY l.status, l.decided_at`, [id])
  // Candidate links that point AWAY from this vessel: entities of ours that may also match elsewhere.
  const outgoing = await q(
    `SELECT l.vessel_id AS other_vessel, l.method, l.evidence FROM ${S}.entity_links l
      WHERE l.status = 'candidate' AND l.source_entity_id IN
            (SELECT source_entity_id FROM ${S}.entity_links WHERE vessel_id = $1 AND status = 'accepted')`, [id])
  const incidents = await vesselIncidents(q, S, id)
  const sourceIds = [...new Set([...assertions.map((a) => a.source_id), ...links.map((l) => l.source_id), ...incidents.map((i) => i.source_id)])]
  const sources = sourceIds.length
    ? await q(`SELECT id, name, publisher, homepage_url, license, license_url, commercial_use,
                      attribution_text, attribution_url FROM ${S}.sources WHERE id = ANY($1)`, [sourceIds])
    : []
  // EarthAtlas type interpretation (docs/SHIP_CLASSIFICATION.md), computed on read from the
  // claims above: group/class with labels, lower-ranked model dissent, and self-declared
  // AIS hazardous-cargo categories ("carries hazardous cargo (self-declared, category X)").
  const now = new Date().toISOString()
  const classification = classifyClaims(assertions, { from: now, to: now, keepObserved: true })
  return { vessel, assertions, links, outgoing, sources, classification, incidents }
}

// Display-safe incident columns. Never the narrative, never the source's own title or case name
// (they can name people); candidates (name-only, weak identifiers) are never returned for the card.
const INCIDENT_COLS = (e) => `${e}.id, ${e}.source_id, ${e}.source_event_key, ${e}.event_kinds, ${e}.event_types, ${e}.event_type_raw,
  lower(${e}.occurred) AS "from", upper(${e}.occurred) AS "to", ${e}.period_kind, ${e}.time_quality,
  ${e}.lat, ${e}.lon, ${e}.location_text, ${e}.position_quality, ${e}.severity_raw, ${e}.severity_rank,
  ${e}.deaths, ${e}.injuries, ${e}.missing, ${e}.material, ${e}.quantity, ${e}.quantity_unit, ${e}.quantity_to_water,
  ${e}.report_url, ${e}.report_ref, ${e}.evidence_class, ${e}.detail, ${e}.first_source_record_id, ${e}.last_source_record_id`
const safeDetail = (d) => Object.fromEntries(Object.entries(d || {}).filter(([k]) => INCIDENT_DETAIL_KEYS.has(k)))

/**
 * A vessel's incidents: active events with an ACCEPTED link from one of their vessel refs to
 * this vessel, newest first (at most 200). Display-safe fields only; each carries its source
 * link (report_url / report_ref), how the vessel was matched, and the raw record id.
 */
export async function vesselIncidents(q, S, vesselId) {
  const rows = await q(
    `SELECT DISTINCT ON (e.id) ${INCIDENT_COLS('e')},
            r.role, r.role_raw, l.method AS match_method, l.id AS link_id
       FROM ${S}.incident_links l
       JOIN ${S}.incident_vessel_refs r ON r.id = l.vessel_ref_id
       JOIN ${S}.incident_events e ON e.id = r.incident_event_id
      WHERE l.vessel_id = $1 AND l.status = 'accepted' AND e.status = 'active'
      ORDER BY e.id, (r.role = 'subject') DESC, r.id`, [vesselId]).catch((err) => {
    // Before migration 006 the tables do not exist: no incidents rather than a failed card.
    if (/incident_(links|events|vessel_refs)" does not exist/.test(String(err.message))) return []
    throw err
  })
  for (const r of rows) r.detail = safeDetail(r.detail)
  const t = (x) => (x.from == null ? -Infinity : new Date(x.from).getTime())
  return rows.sort((a, b) => t(b) - t(a) || Number(b.id) - Number(a.id)).slice(0, 200)
}

/**
 * One incident with its raw record (traceability, like getRecord): display-safe event fields,
 * the vessel refs as the source gave them, accepted links only, and the raw payload with
 * narratives / case names withheld server-side.
 */
export async function getIncidentRecord(q, S, id) {
  if (!/^\d{1,18}$/.test(String(id))) return null
  const [e] = await q(`SELECT ${INCIDENT_COLS('e')}, e.status FROM ${S}.incident_events e WHERE e.id = $1`, [id])
  if (!e) return null
  e.detail = safeDetail(e.detail)
  const refs = await q(
    `SELECT r.id, r.ref_key, r.role, r.role_raw, r.name_raw, r.imo_raw, r.mmsi_raw, r.callsign_raw, r.official_number_raw,
            r.official_number_scheme, r.uscg_vessel_id, r.flag_raw, r.vessel_type_raw,
            (SELECT json_build_object('vessel_id', l.vessel_id, 'method', l.method, 'decided_by', l.decided_by, 'decided_at', l.decided_at)
               FROM ${S}.incident_links l WHERE l.vessel_ref_id = r.id AND l.status = 'accepted') AS accepted
       FROM ${S}.incident_vessel_refs r WHERE r.incident_event_id = $1 ORDER BY r.id`, [id])
  // A ref that only has candidate links shows no vessel: the name alone is not a match.
  const record = await getRecord(q, S, e.last_source_record_id)
  const [source] = await q(`SELECT id, name, publisher, homepage_url, license, license_url, commercial_use,
                                   attribution_text, attribution_url FROM ${S}.sources WHERE id = $1`, [e.source_id])
  return { incident: e, refs, record, source: source ?? null }
}

/** One raw source record (traceability: any fact → the exact payload it came from). */
export async function getRecord(q, S, id) {
  if (!/^\d{1,18}$/.test(String(id))) return null
  const [r] = await q(
    `SELECT r.id, r.source_id, r.payload, r.payload_sha256, r.dataset_version, r.first_retrieved_at,
            r.last_retrieved_at, se.entity_kind, se.entity_key
       FROM ${S}.source_records r JOIN ${S}.source_entities se ON se.id = r.source_entity_id
      WHERE r.id = $1`, [id])
  if (r && r.source_id === 'fcc-uls-ship') r.payload = publicLicenseRecord(r.payload)
  if (r) r.payload = publicIncidentPayload(r.source_id, r.entity_kind, r.payload)
  return r ?? null
}

/**
 * A source record as people read it (Josh, 2026-09-27: the raw JSON behind "source" links is "not useful for
 * anyone"). Same privacy rules as the raw view (getRecord). Returns the source (name, publisher, licence,
 * homepage), when we retrieved it, the values it gave each vessel (the claims made from it), where to see it at
 * the source, and the raw payload for anyone who wants it.
 */
export async function getRecordView(q, S, id) {
  const r = await getRecord(q, S, id)
  if (!r) return null
  const [source] = await q(`SELECT id, name, publisher, homepage_url, license, license_url, commercial_use, attribution_text, attribution_url
                              FROM ${S}.sources WHERE id = $1`, [r.source_id])
  const claims = await q(
    `SELECT va.vessel_id, va.attribute, va.value_raw, va.evidence_class, lower(va.period) AS "from", upper(va.period) AS "to",
            va.period_kind, va.detail->>'display' AS display
       FROM ${S}.vessel_assertions va
      WHERE va.first_source_record_id = $1 OR va.last_source_record_id = $1
      ORDER BY va.vessel_id, va.attribute, lower(va.period) NULLS FIRST
      LIMIT 500`, [id])
  for (const c of claims) { if (c.display === 'false') c.value_raw = WITHHELD.value_raw; delete c.display }
  const vids = [...new Set(claims.map((c) => c.vessel_id))]
  const names = vids.length ? await q(
    `SELECT DISTINCT ON (vessel_id) vessel_id, value_raw FROM ${S}.vessel_assertions
      WHERE vessel_id = ANY($1) AND attribute = 'name' ORDER BY vessel_id, (evidence_class = 'registry') DESC, upper(period) DESC NULLS LAST`, [vids]) : []
  const nameOf = Object.fromEntries(names.map((n) => [n.vessel_id, n.value_raw]))
  // Terminals this record is linked to (an IMO GISIS port facility, a USACE dock…): EarthAtlas's interpretation, with how.
  const terminals = await q(
    `SELECT t.key, t.name, l.role, l.detail->'position_agrees' AS position_agrees, l.detail->'km_to_nearest_berth' AS km
       FROM ${S}.terminal_links l JOIN ${S}.terminals t ON t.id = l.terminal_id
      WHERE l.source_record_id = $1 AND l.status = 'active' AND t.list_status = 'listed' ORDER BY t.key`, [id]).catch((err) => {
    if (/terminal_links" does not exist/.test(String(err.message))) return [] // before migration 012
    throw err
  })
  return {
    id: r.id, source, entity_kind: r.entity_kind, entity_key: r.entity_key, dataset_version: r.dataset_version,
    first_retrieved_at: r.first_retrieved_at, last_retrieved_at: r.last_retrieved_at, payload_sha256: r.payload_sha256,
    vessels: vids.map((v) => ({ id: v, name: nameOf[v] || null, claims: claims.filter((c) => c.vessel_id === v) })),
    terminals,
    ...recordLinks(r, source),
    payload: r.payload,
  }
}

/**
 * Where to see a record at its source, and the identifiers to look it up by. Only links whose form is certain:
 * Wikidata items and Commons pages have stable per-record pages; for the rest we link the source's own site and
 * show the id its search takes.
 */
export function recordLinks(r, source) {
  const home = source?.homepage_url || null
  const links = []
  const ids = []
  const k = r.entity_key || ''
  const pl = r.payload || {}
  if (r.source_id === 'wikidata' && /^Q\d+$/.test(k)) links.push({ label: `Wikidata item ${k}`, href: `https://www.wikidata.org/wiki/${k}` })
  else if (r.source_id === 'wikimedia-commons' && /^(File|Category):/.test(k)) links.push({ label: k.replace(/^File:/, ''), href: `https://commons.wikimedia.org/wiki/${encodeURIComponent(k.replace(/ /g, '_')).replace(/%3A/g, ':')}` })
  if (r.source_id === 'gfw-vessel-identity') {
    for (const s of (pl.selfReportedInfo || []).slice(0, 3)) ids.push({ label: 'GFW vessel id', value: s.id })
    const reg = (pl.registryInfo || [])[0]
    if (reg?.imo) ids.push({ label: 'IMO', value: reg.imo })
    const self = (pl.selfReportedInfo || [])[0]
    if (self?.ssvid) ids.push({ label: 'MMSI', value: self.ssvid })
  }
  if (r.source_id === 'marinecadastre-ais') ids.push({ label: 'MMSI', value: k })
  if (r.source_id === 'uscg-psix' && r.entity_kind === 'psix_vessel') ids.push({ label: 'PSIX vessel id', value: k })
  if (r.source_id === 'fcc-uls-ship') { ids.push({ label: 'FCC licence id', value: k }); if (pl.call_sign || pl.callsign) ids.push({ label: 'Call sign', value: pl.call_sign || pl.callsign }) }
  if (r.source_id === 'tc-vessel-registry') ids.push({ label: 'Official number', value: k })
  if (r.source_id === 'nga-wpi') ids.push({ label: 'World Port Index number', value: k })
  if (r.source_id === 'imf-portwatch' && r.entity_kind === 'portwatch_port') ids.push({ label: 'PortWatch port id', value: k })
  // IMO GISIS (docs/IMO_GISIS.md): its pages have no per-record address; its searches take these.
  if (r.source_id === 'imo-gisis-port-facilities') ids.push({ label: 'IMO Port Facility Number', value: k })
  if (r.source_id === 'imo-gisis-scrubbers' && /^IMO \d{7}$/.test(k)) ids.push({ label: 'IMO Number', value: k.slice(4) })
  if (home) links.push({ label: source.name, href: home, home: true })
  return { links, identifiers: ids }
}

/** Values of one attribute that sources place at an instant (history lookup). Every claim is kept, so disagreement shows. */
export async function valuesAt(q, S, vesselId, attribute, at) {
  return q(
    `SELECT DISTINCT value_raw, value_norm, evidence_class, source_id FROM ${S}.vessel_assertions
      WHERE vessel_id = $1 AND attribute = $2 AND period_kind <> 'unknown' AND period @> $3::timestamptz
      ORDER BY value_norm, evidence_class`, [vesselId, attribute, at])
}

/** MMSI + instant → vessels (0 unresolved, 1 resolved, >1 ambiguous). */
export async function vesselsForMmsiAt(q, S, mmsi, at) {
  const rows = await q(`SELECT DISTINCT vessel_id FROM ${S}.vessels_for_mmsi_at($1, $2)`, [normMmsi(mmsi).value, at])
  const ids = rows.map((r) => r.vessel_id)
  return { status: ids.length === 0 ? 'unresolved' : ids.length === 1 ? 'resolved' : 'ambiguous', vesselIds: ids }
}
