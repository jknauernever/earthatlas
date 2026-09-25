/**
 * Resolver v1: attach source entities to EarthAtlas vessels, conservatively.
 * The rules are in src/ships/CLAUDE.md. A wrong merge is worse than an
 * unresolved record.
 *
 * `decide()` is pure (unit-tested offline). `resolveEntity()` gathers the
 * facts from the database, applies the decision, and writes links only.
 * Assertions and raw records are never modified here.
 */

import { normName } from './normalize.js'

// v1.2 (2026-09-25): adds the attach-only rules for community-curated (Wikidata) entities and keeps
// community-curated MMSIs, call signs and names out of every other merge. Unchanged for GFW / NOAA entities.
// v1.3 (2026-09-25): AIS-IMO attachments of Wikidata items record their corroboration as the method
// (IMO_AIS_MMSI / IMO_AIS_CALLSIGN / IMO_AIS_NAME). Decisions themselves unchanged.
export const RESOLVER = 'resolver:v1.3'

const RULE_TEXT = {
  IMO_EXACT: 'single registry IMO held by exactly one vessel',
  CALLSIGN_MATCH: 'same MMSI in overlapping time and the same call sign',
  MMSI_TEMPORAL: 'same MMSI in overlapping time and the same name (no call sign on one side)',
  NEW_FROM_SOURCE_ENTITY: 'no existing vessel matched',
}

/**
 * Of the vessels sharing an overlapping MMSI, which does a second identifier tie
 * us to? Call signs decide when both sides have them: agree → match, differ →
 * conflict, never a match. Otherwise the normalized name must agree. Pure; tested.
 */
export function matchByMmsiIdentity(mine, overlaps) {
  const out = []
  for (const o of overlaps) {
    // Two different registry IMOs = two different ships, whatever the MMSI says.
    const theirImo = new Set(o.registry_imos || []), myImo = mine.registryImo || new Set()
    if (myImo.size && theirImo.size && ![...myImo].some((i) => theirImo.has(i))) continue
    const theirCs = new Set(o.callsigns || []), theirNm = new Set(o.names || [])
    const myCs = mine.callsign || new Set(), myNm = mine.name || new Set()
    if (myCs.size && theirCs.size) {
      if ([...myCs].some((c) => theirCs.has(c))) out.push({ vesselId: o.vesselId, mmsi: o.mmsi, via: 'callsign' })
    } else if ([...myNm].some((n) => theirNm.has(n))) {
      out.push({ vesselId: o.vesselId, mmsi: o.mmsi, via: 'name' })
    }
  }
  return out
}

/**
 * @param {object} f
 * @param {string|null} f.acceptedVesselId  vessel this entity is already linked to
 * @param {string[]} f.registryImos         distinct checksum-valid registry-class IMOs of this entity
 * @param {Record<string,string[]>} f.imoVessels  IMO → other vessels already holding it (registry class)
 * @param {Record<string,string[]>} f.aisImoVessels  AIS-reported IMO → vessels holding it as registry IMO
 * @param {{vesselId:string, mmsi:string}[]} f.mmsiOverlaps  other vessels with overlapping MMSI windows
 * @param {{vesselId:string, mmsi:string, via:'callsign'|'name'}[]} [f.mmsiIdMatches]  overlapping-MMSI
 *        vessels whose call sign agrees (or, when either side has no call sign, whose name agrees),
 *        with no conflicting call sign
 * @returns {{action:'keep'|'accept'|'new'|'unresolved', vesselId?:string, method?:string,
 *            needsReview:boolean, candidates:{vesselId:string, method:string, evidence:object}[]}}
 */
export function decide(f) {
  const candidates = []
  const add = (vesselId, method, evidence) => {
    if (vesselId === f.acceptedVesselId) return
    if (!candidates.some((c) => c.vesselId === vesselId && c.method === method)) candidates.push({ vesselId, method, evidence })
  }
  for (const imo of f.registryImos) for (const v of f.imoVessels[imo] || []) add(v, 'IMO_EXACT', { imo, basis: 'registry' })
  for (const [imo, vs] of Object.entries(f.aisImoVessels || {})) for (const v of vs) add(v, 'IMO_EXACT', { imo, basis: 'ais_self_reported' })
  for (const o of f.mmsiOverlaps || []) add(o.vesselId, 'MMSI_TEMPORAL', { mmsi: o.mmsi, basis: 'overlapping observed windows' })

  // 1. Never silently move an accepted entity; new conflicts only become candidates.
  if (f.acceptedVesselId) {
    return { action: 'keep', vesselId: f.acceptedVesselId, needsReview: candidates.length > 0, candidates }
  }
  // 2. IMO_EXACT: one registry IMO, held by exactly one existing vessel.
  if (f.registryImos.length === 1) {
    const holders = f.imoVessels[f.registryImos[0]] || []
    if (holders.length === 1) {
      const rest = candidates.filter((c) => !(c.vesselId === holders[0] && c.method === 'IMO_EXACT'))
      return { action: 'accept', vesselId: holders[0], method: 'IMO_EXACT', needsReview: rest.length > 0, candidates: rest }
    }
    // 3. Several vessels already claim this IMO: ambiguous, so don't pick one.
    if (holders.length > 1) return { action: 'unresolved', needsReview: true, candidates }
  }
  // 3b. Conflicting registry IMOs inside one entity: a new vessel, flagged, with candidates.
  if (f.registryImos.length > 1) return { action: 'new', method: 'NEW_FROM_SOURCE_ENTITY', needsReview: true, candidates }
  // 4b (v1.1). Same MMSI in overlapping time AND a second identifier agrees
  // (call sign, or the name when either side has no call sign) → the same ship.
  // Never across different registry IMOs (the matcher drops those) and never
  // with a conflicting call sign. MMSI alone still never merges (rule 4).
  if (f.mmsiIdMatches?.length) {
    const vs = [...new Set(f.mmsiIdMatches.map((m) => m.vesselId))].filter((v) => v !== f.acceptedVesselId)
    if (vs.length === 1) {
      const via = f.mmsiIdMatches.find((m) => m.vesselId === vs[0]).via
      const rest = candidates.filter((c) => c.vesselId !== vs[0])
      return { action: 'accept', vesselId: vs[0], method: via === 'callsign' ? 'CALLSIGN_MATCH' : 'MMSI_TEMPORAL',
        needsReview: rest.length > 0, candidates: rest, via }
    }
    if (vs.length > 1) return { action: 'unresolved', needsReview: true, candidates }
  }
  // 5. Nothing matches: a new vessel from the source's own grouping (candidates kept for review).
  return { action: 'new', method: 'NEW_FROM_SOURCE_ENTITY', needsReview: candidates.length > 0, candidates }
}

/** Gather facts for `decide` from the DB, then write links. Returns the decision. */
export async function resolveEntity(c, S, entityId) {
  const { rows: acc } = await c.query(
    `SELECT vessel_id FROM ${S}.entity_links WHERE source_entity_id = $1 AND status = 'accepted'`, [entityId])
  const acceptedVesselId = acc[0]?.vessel_id ?? null

  // Community-curated sources (Wikidata) resolve by their own, attach-only rules.
  const { rows: cls } = await c.query(
    `SELECT DISTINCT evidence_class FROM ${S}.assertions WHERE source_entity_id = $1 AND status = 'active'`, [entityId])
  if (cls.length && cls.every((r) => r.evidence_class === 'community_curated')) {
    return resolveCuratedEntity(c, S, entityId, acceptedVesselId)
  }

  const { rows: imos } = await c.query(
    `SELECT DISTINCT value_norm, evidence_class FROM ${S}.assertions
      WHERE source_entity_id = $1 AND attribute = 'imo' AND status = 'active'
        AND (detail->>'checksum_ok')::boolean`, [entityId])
  const registryImos = imos.filter((r) => r.evidence_class === 'registry').map((r) => r.value_norm).sort()
  const aisImos = imos.filter((r) => r.evidence_class === 'ais_self_reported').map((r) => r.value_norm)

  const holders = async (list) => {
    if (!list.length) return {}
    const { rows } = await c.query(
      `SELECT value_norm, array_agg(DISTINCT vessel_id::text) AS vs FROM ${S}.vessel_assertions
        WHERE attribute = 'imo' AND evidence_class = 'registry' AND value_norm = ANY($1)
          AND source_entity_id <> $2
        GROUP BY value_norm`, [list, entityId])
    return Object.fromEntries(rows.map((r) => [r.value_norm, r.vs.filter((v) => v !== acceptedVesselId)]))
  }
  const imoVessels = await holders(registryImos)
  const aisImoVessels = await holders(aisImos.filter((i) => !registryImos.includes(i)))

  const { rows: overlaps } = await c.query(
    `SELECT DISTINCT va.vessel_id::text AS "vesselId", va.value_norm AS mmsi,
            array(SELECT DISTINCT x.value_norm FROM ${S}.vessel_assertions x
                   WHERE x.vessel_id = va.vessel_id AND x.attribute = 'callsign' AND x.value_norm <> ''
                     AND x.evidence_class <> 'community_curated') AS callsigns,
            array(SELECT DISTINCT x.value_norm FROM ${S}.vessel_assertions x
                   WHERE x.vessel_id = va.vessel_id AND x.attribute = 'name' AND x.value_norm <> ''
                     AND x.evidence_class <> 'community_curated') AS names,
            array(SELECT DISTINCT x.value_norm FROM ${S}.vessel_assertions x
                   WHERE x.vessel_id = va.vessel_id AND x.attribute = 'imo' AND x.evidence_class = 'registry'
                     AND (x.detail->>'checksum_ok')::boolean) AS registry_imos
       FROM ${S}.assertions a
       JOIN ${S}.vessel_assertions va
         ON va.attribute = 'mmsi' AND va.value_norm = a.value_norm AND va.period && a.period
        AND va.period_kind <> 'unknown' AND va.source_entity_id <> a.source_entity_id
        AND va.evidence_class <> 'community_curated'
      WHERE a.source_entity_id = $1 AND a.attribute = 'mmsi' AND a.status = 'active'
        AND a.period_kind <> 'unknown'`, [entityId])
  const { rows: own } = await c.query(
    `SELECT attribute, array_agg(DISTINCT value_norm) AS vals FROM ${S}.assertions
      WHERE source_entity_id = $1 AND status = 'active' AND attribute IN ('callsign', 'name') AND value_norm <> ''
        AND evidence_class <> 'community_curated'
      GROUP BY attribute`, [entityId])
  const mine = Object.fromEntries(own.map((r) => [r.attribute, new Set(r.vals)]))
  mine.registryImo = new Set(registryImos)
  const mmsiIdMatches = matchByMmsiIdentity(mine, overlaps)

  const d = decide({ acceptedVesselId, registryImos, imoVessels, aisImoVessels,
    mmsiOverlaps: overlaps.filter((o) => o.vesselId !== acceptedVesselId).map(({ vesselId, mmsi }) => ({ vesselId, mmsi })),
    mmsiIdMatches: mmsiIdMatches.filter((m) => m.vesselId !== acceptedVesselId) })

  let vesselId = d.vesselId ?? null
  if (d.action === 'new') {
    const { rows } = await c.query(`INSERT INTO ${S}.vessels (needs_review) VALUES ($1) RETURNING id`, [d.needsReview])
    vesselId = rows[0].id
  }
  if (d.action === 'new' || d.action === 'accept') {
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'accepted',$3,$4,$5)`,
      [entityId, vesselId, d.method, { registryImos, via: d.via ?? null, rule: RULE_TEXT[d.method] }, RESOLVER])
  }
  if (vesselId && d.needsReview) await c.query(`UPDATE ${S}.vessels SET needs_review = true WHERE id = $1`, [vesselId])
  for (const cand of d.candidates) {
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'candidate',$3,$4,$5) ON CONFLICT DO NOTHING`,
      [entityId, cand.vesselId, cand.method, cand.evidence, RESOLVER])
  }
  return { ...d, vesselId }
}

// ── Community-curated entities (Wikidata) ─────────────────────────────────────

// Leading ship prefixes in Wikidata labels ("MS Eurodam"). Used only to
// corroborate a name, never stored as a claim.
const SHIP_PREFIXES = new Set(['MS', 'MV', 'MY', 'MT', 'SS', 'RV', 'FV', 'TS', 'SY', 'RMS', 'HMS', 'HMCS', 'USS', 'USNS',
  'USCGC', 'CCGS', 'NOAAS', 'MSV', 'M/S', 'M/V', 'M/T', 'M/Y', 'S/S', 'R/V', 'F/V'])

/** Comparable names for a Wikidata item: official names plus the label with or without a ship prefix. */
export function curatedNames(officialNames = [], label = null) {
  const out = new Set(officialNames.filter(Boolean))
  if (label) {
    out.add(normName(label))
    const [first, ...rest] = String(label).trim().split(/\s+/)
    if (rest.length && SHIP_PREFIXES.has(first.toUpperCase())) out.add(normName(rest.join(' ')))
  }
  out.delete('')
  return out
}

/**
 * Resolution for a community-curated entity (pure; tested offline).
 * Stricter than `decide`: a Wikidata item never creates a vessel and never
 * merges vessels. It only attaches to ONE existing vessel.
 * - not a kind of watercraft / offshore unit (e.g. a company that carries an IMO
 *   company number in P458) → unresolved;
 * - IMO_EXACT: exactly one checksum-valid IMO, and exactly one existing vessel
 *   carries it (in any non-curated class). If that vessel's IMO comes only from
 *   AIS (self-reported or NOAA-published), a second identifier must agree: MMSI,
 *   call sign or name. A registry IMO needs no second identifier.
 * - MMSI alone never attaches (rule 4). Anything ambiguous → candidates.
 * @param {object} f
 * @param {string|null} f.acceptedVesselId
 * @param {boolean} f.isVessel
 * @param {string[]} f.imos  distinct checksum-valid IMOs of this entity
 * @param {Record<string,{vesselId:string, registry:boolean, corroboratedBy:string[]}[]>} f.holders
 */
export function decideCurated(f) {
  const candidates = []
  const add = (vesselId, method, evidence) => {
    if (vesselId === f.acceptedVesselId) return
    if (!candidates.some((c) => c.vesselId === vesselId && c.method === method)) candidates.push({ vesselId, method, evidence })
  }
  for (const imo of f.imos) {
    for (const h of f.holders[imo] || []) {
      add(h.vesselId, 'IMO_EXACT', { imo, basis: 'community_curated', holder_imo_basis: h.registry ? 'registry' : 'ais',
        corroborated_by: h.corroboratedBy })
    }
  }
  if (f.acceptedVesselId) return { action: 'keep', vesselId: f.acceptedVesselId, needsReview: candidates.length > 0, candidates }
  const unresolved = (reason, cands = candidates) => ({ action: 'unresolved', reason, needsReview: cands.length > 0, candidates: cands })
  if (!f.isVessel) return unresolved('not_a_vessel', [])
  if (!f.imos.length) return unresolved('no_valid_imo', [])
  if (f.imos.length > 1) return unresolved('conflicting_imos')
  const hs = f.holders[f.imos[0]] || []
  if (!hs.length) return unresolved('no_vessel_with_imo')
  if (hs.length > 1) return unresolved('imo_on_several_vessels')
  const h = hs[0]
  if (!h.registry && !h.corroboratedBy.length) return unresolved('ais_imo_not_corroborated')
  const rest = candidates.filter((c) => c.vesselId !== h.vesselId)
  return { action: 'accept', vesselId: h.vesselId, method: curatedMethod(h), needsReview: rest.length > 0, candidates: rest,
    via: h.registry ? 'registry_imo' : `ais_imo+${h.corroboratedBy.join('+')}` }
}

/**
 * Link method for an attached Wikidata item (Josh, 2026-09-25): a registry IMO is
 * IMO_EXACT; an AIS IMO is named after its strongest corroboration, so a
 * name-only match (IMO_AIS_NAME) stays visibly weaker than MMSI / call sign.
 */
export function curatedMethod(h) {
  if (h.registry) return 'IMO_EXACT'
  if (h.corroboratedBy.includes('mmsi')) return 'IMO_AIS_MMSI'
  if (h.corroboratedBy.includes('callsign')) return 'IMO_AIS_CALLSIGN'
  return 'IMO_AIS_NAME'
}

async function resolveCuratedEntity(c, S, entityId, acceptedVesselId) {
  const { rows: own } = await c.query(
    `SELECT attribute, value_norm, detail FROM ${S}.assertions
      WHERE source_entity_id = $1 AND status = 'active' AND attribute IN ('imo', 'mmsi', 'callsign', 'name', 'vessel_type')`,
    [entityId])
  const imos = [...new Set(own.filter((r) => r.attribute === 'imo' && r.detail?.checksum_ok).map((r) => r.value_norm))].sort()
  const isVessel = own.some((r) => r.attribute === 'vessel_type')
  const label = own.find((r) => r.attribute === 'imo')?.detail?.item_label ?? null
  const mine = {
    mmsi: new Set(own.filter((r) => r.attribute === 'mmsi').map((r) => r.value_norm)),
    callsign: new Set(own.filter((r) => r.attribute === 'callsign' && r.value_norm).map((r) => r.value_norm)),
    name: curatedNames(own.filter((r) => r.attribute === 'name').map((r) => r.value_norm), label),
  }
  const holders = {}
  if (imos.length) {
    const { rows } = await c.query(
      `SELECT h.value_norm AS imo, h.vessel_id::text AS "vesselId",
              bool_or(h.evidence_class = 'registry') AS registry,
              array(SELECT DISTINCT x.attribute || ':' || x.value_norm FROM ${S}.vessel_assertions x
                     WHERE x.vessel_id = h.vessel_id AND x.attribute IN ('mmsi', 'callsign', 'name')
                       AND x.evidence_class <> 'community_curated' AND x.value_norm <> '') AS ids
         FROM ${S}.vessel_assertions h
        WHERE h.attribute = 'imo' AND h.value_norm = ANY($1) AND (h.detail->>'checksum_ok')::boolean
          AND h.evidence_class <> 'community_curated' AND h.source_entity_id <> $2
        GROUP BY h.value_norm, h.vessel_id`, [imos, entityId])
    for (const r of rows) {
      const theirs = new Set(r.ids)
      const corroboratedBy = ['mmsi', 'callsign', 'name'].filter((k) => [...mine[k]].some((v) => theirs.has(`${k}:${v}`)))
      ;(holders[r.imo] ||= []).push({ vesselId: r.vesselId, registry: r.registry, corroboratedBy })
    }
  }
  const d = decideCurated({ acceptedVesselId, isVessel, imos, holders })
  if (d.action === 'accept') {
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'accepted',$3,$4,$5)`,
      [entityId, d.vesselId, d.method, { curatedImos: imos, via: d.via,
        corroborated_by: d.via === 'registry_imo' ? [] : d.via.replace(/^ais_imo\+/, '').split('+'),
        rule: 'single community-curated IMO held by exactly one vessel (registry IMO, or AIS IMO + a second identifier)' }, RESOLVER])
    if (d.needsReview) await c.query(`UPDATE ${S}.vessels SET needs_review = true WHERE id = $1`, [d.vesselId])
  }
  if (d.action === 'keep' && d.needsReview) await c.query(`UPDATE ${S}.vessels SET needs_review = true WHERE id = $1`, [d.vesselId])
  for (const cand of d.candidates) {
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'candidate',$3,$4,$5) ON CONFLICT DO NOTHING`,
      [entityId, cand.vesselId, cand.method, cand.evidence, RESOLVER])
  }
  return { ...d, vesselId: d.vesselId ?? null }
}
