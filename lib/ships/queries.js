/**
 * Read queries behind api/ships.js. Each takes `q(text, params) → rows` so the
 * same code runs over Neon HTTP (API) and a pooled client (tests).
 * All results are bounded.
 */
import { normName, normImo, normMmsi } from './normalize.js'
import { classifyClaims } from './taxonomy.js'

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
 * Search by IMO (7 digits), MMSI (9 digits), callsign or name, optionally
 * narrowed to kinds of ship (GFW classification). With kinds and no text it
 * browses those kinds alphabetically. At most 25 vessels.
 */
export async function searchVessels(q, S, text, kinds = []) {
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
    hits = await q(
      `SELECT vessel_id, max(score) AS score FROM (
         SELECT vessel_id, CASE WHEN value_norm = $1 THEN 1.0 WHEN value_norm LIKE $1 || '%' THEN 0.9
                                ELSE similarity(value_norm, $1) END AS score
           FROM ${S}.vessel_assertions
          WHERE (attribute = 'name' AND (value_norm LIKE $1 || '%' OR value_norm % $1))
             OR (attribute = 'callsign' AND value_norm = $1)
       ) s GROUP BY vessel_id ORDER BY score DESC LIMIT 25`, [n])
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
  return hits.map((h) => ({ ...summaries[h.vessel_id], score: Number(h.score) })).filter((s) => s.id)
}

/**
 * Headline value per attribute, for result lists: the latest REGISTRY value
 * when a registry names the ship, otherwise the latest value from any source.
 * A registry outranks broadcasts: GFW can attach a disputed AIS identity to a
 * vessel (e.g. CRESTY's AIS identity inside GOLDENEYE's entry), and the
 * headline must not follow it. Each value keeps its
 * evidence class and source, so the list can show provenance inline too.
 */
async function summarize(q, S, ids) {
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
  const sourceIds = [...new Set([...assertions.map((a) => a.source_id), ...links.map((l) => l.source_id)])]
  const sources = sourceIds.length
    ? await q(`SELECT id, name, publisher, homepage_url, license, license_url, commercial_use,
                      attribution_text, attribution_url FROM ${S}.sources WHERE id = ANY($1)`, [sourceIds])
    : []
  // EarthAtlas type interpretation (docs/SHIP_CLASSIFICATION.md), computed on read from the
  // claims above: group/class with labels, lower-ranked model dissent, and self-declared
  // AIS hazardous-cargo categories ("carries hazardous cargo (self-declared, category X)").
  const now = new Date().toISOString()
  const classification = classifyClaims(assertions, { from: now, to: now, keepObserved: true })
  return { vessel, assertions, links, outgoing, sources, classification }
}

/** One raw source record (traceability: any fact → the exact payload it came from). */
export async function getRecord(q, S, id) {
  if (!/^\d{1,18}$/.test(String(id))) return null
  const [r] = await q(
    `SELECT r.id, r.source_id, r.payload, r.payload_sha256, r.dataset_version, r.first_retrieved_at,
            r.last_retrieved_at, se.entity_kind, se.entity_key
       FROM ${S}.source_records r JOIN ${S}.source_entities se ON se.id = r.source_entity_id
      WHERE r.id = $1`, [id])
  return r ?? null
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
