/**
 * Resolver v1: attach source entities to EarthAtlas vessels, conservatively.
 * The rules are in src/ships/CLAUDE.md. A wrong merge is worse than an
 * unresolved record.
 *
 * `decide()` is pure (unit-tested offline). `resolveEntity()` gathers the
 * facts from the database, applies the decision, and writes links only.
 * Assertions and raw records are never modified here.
 */

import { normName, normImo } from './normalize.js'
import { REGISTRY_SOURCE_IDS } from './registry.js'
import { companyOverlap, isBigShip } from './mepMatch.js'

// v1.2 (2026-09-25): adds the attach-only rules for community-curated (Wikidata) entities and keeps
// community-curated MMSIs, call signs and names out of every other merge. Unchanged for GFW / NOAA entities.
// v1.3 (2026-09-25): AIS-IMO attachments of Wikidata items record their corroboration as the method
// (IMO_AIS_MMSI / IMO_AIS_CALLSIGN / IMO_AIS_NAME). Decisions themselves unchanged.
// v1.4 (2026-09-25): attach-only rules for official government registries (USCG PSIX, FCC ULS,
// Transport Canada): resolveRegistryEntity / decideRegistry. Unchanged for GFW / NOAA / Wikidata entities.
// v1.5 (2026-09-27): attach-only rule for Wikimedia Commons IMO categories (ship photos): resolveCommonsEntity /
// decideCommons. Commons file entities are never linked directly. Unchanged for every other source.
// v1.6 (2026-09-27): attach-only rule for IMO GISIS MARPOL Annex VI Reg. 4.2 notifications (scrubbers; lib/ships/gisis.js):
// decideGisisImo, the Commons rule keyed on the IMO in the entity key. IMO GISIS port-facility entities are never vessels.
// Unchanged for every other source.
// v1.7 (2026-09-28): only vessel-describing entity kinds (VESSEL_ENTITY_KINDS) are ever resolved. Before, any other entity
// (port, terminal, anchorage, incident, port visit, ...) fell through to the generic rules and became a new vessel whenever
// something (reresolveAll) resolved it. Decisions for vessel entities unchanged.
// v1.8 (2026-09-29): attach-only rule for EU MRV ship-year reports (EMSA THETIS-MRV; lib/ships/euMrv.js): the IMO GISIS rule
// (decideGisisImo) keyed on the IMO in the entity key 'IMO 1234567 · 2024'. Unchanged for every other source.
// v1.9 (2026-09-30): rules for the MEP Alliance scrubber lists (lib/ships/mepAlliance.js): decideMep. Rows with an IMO use the
// IMO GISIS rule (IMO_EXACT). Name-only rows attach only on a unique corroborated name (MEP_NAME_CORROBORATED) or, per Josh
// 2026-09-30, a unique big ship known in the Salish Sea (MEP_NAME_SALISH_SIZE, inferred). Unchanged for every other source.
export const RESOLVER = 'resolver:v1.9'

/**
 * The source-entity kinds that describe a vessel, i.e. that the resolver may link to one. Everything else
 * (ports, terminals, anchorages, incidents, port visits, Commons files, GISIS port facilities, bakes...) is
 * never resolved: deny by default, so a new non-vessel source can never create vessels. A new vessel source
 * adds its kind here (the test in resolve.test.js checks these against the importers' own constants).
 */
export const VESSEL_ENTITY_KINDS = Object.freeze(new Set([
  'gfw_vessel_entry',     // gfw.js GFW_ENTITY_KIND
  'mc_mmsi',              // marinecadastre.js MC_ENTITY_KIND
  'gfw_ais_vessel',       // gfwAis.js GFW_AIS_ENTITY_KIND (GFW hourly positions: identity as broadcast)
  'psix_vessel',          // psix.js PSIX_ENTITY_KIND
  'fcc_ship_license',     // fccUls.js FCC_ENTITY_KIND
  'tc_large_vessel',      // tcRegistry.js TC_ENTITY_KIND
  'wikidata_item',        // wikidata.js WD_ENTITY_KIND (non-watercraft items stay unresolved by resolveCuratedEntity)
  'commons_imo_category', // commons.js IMO_CATEGORY_KIND
  'marpol6_reg42_imo',    // gisis.js KIND.imo
  'eu_mrv_ship_year',     // euMrv.js KIND.shipYear
  'mep_voyage_ship',      // mepAlliance.js KIND.voyageShip
  'mep_fitted_imo',       // mepAlliance.js KIND.fittedImo
  'mep_fitted_name',      // mepAlliance.js KIND.fittedName
]))

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

  const { rows: src } = await c.query(`SELECT source_id, entity_kind, entity_key FROM ${S}.source_entities WHERE id = $1`, [entityId])
  const isVessel = VESSEL_ENTITY_KINDS.has(src[0]?.entity_kind)
  // Official government registries resolve by their own, attach-only rules (docs/VESSEL_REGISTRIES.md).
  if (isVessel && REGISTRY_SOURCE_IDS.has(src[0]?.source_id)) return resolveRegistryEntity(c, S, entityId, acceptedVesselId, src[0].source_id)
  // Wikimedia Commons (ship photos) resolves by its own attach-only rule (docs/COMMONS_PHOTOS.md).
  if (src[0]?.source_id === COMMONS_SOURCE_ID) return resolveCommonsEntity(c, S, entityId, acceptedVesselId, src[0])
  // IMO GISIS (docs/IMO_GISIS.md): Reg. 4.2 notifications attach by registry IMO only; port facilities are not vessels.
  if (src[0]?.source_id === GISIS_REG42_SOURCE_ID) return resolveGisisEntity(c, S, entityId, acceptedVesselId, src[0])
  // EU MRV (docs/SHIP_POLLUTION_SOURCES.md §1): ship-year reports attach by registry IMO only; the file-header record is not a vessel.
  if (src[0]?.source_id === MRV_SOURCE_ID) return resolveMrvEntity(c, S, entityId, acceptedVesselId, src[0])
  // MEP Alliance scrubber lists (lib/ships/mepAlliance.js): IMO rows by registry IMO; name rows by decideMep's name rules.
  if (MEP_SOURCE_IDS.has(src[0]?.source_id)) return resolveMepEntity(c, S, entityId, acceptedVesselId, src[0])
  if (src[0]?.source_id === GISIS_FACILITIES_SOURCE_ID) return { action: 'unresolved', reason: 'not_a_vessel_source', needsReview: false, candidates: [], vesselId: null }
  // Any other non-vessel entity (port, terminal, anchorage, incident, port visit...) → never linked, never a new
  // vessel (v1.7). The generic rules below would otherwise create one. An existing accepted link is left as it is.
  if (!isVessel) {
    return { action: acceptedVesselId ? 'keep' : 'unresolved', reason: 'not_a_vessel_entity', needsReview: false, candidates: [], vesselId: acceptedVesselId }
  }

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

// ── Official government registries (USCG PSIX, FCC ULS, Transport Canada) ───────

/**
 * Registry identifiers → link (pure; tested offline). docs/VESSEL_REGISTRIES.md §Resolution.
 * A registry record only ATTACHES to one existing vessel; it never creates or merges
 * vessels (our vessels are what AIS / GFW observed; a licence or registration with no
 * observation stays unresolved evidence).
 * 1. IMO (checksum-valid, exactly one): the Wikidata attach rule — one holder whose IMO
 *    is registry-class, or AIS-class and corroborated by MMSI / call sign / name.
 * 2. Otherwise `idMatches` computed from the source's own identifiers:
 *    FCC: licence MMSI in overlapping time + name + call sign (or the registration
 *    number the owner typed into AIS's call-sign field); PSIX: call sign + name;
 *    any: same US official number via another registry + name.
 *    Never by name alone, never by MMSI alone.
 * 3. Two different targets (IMO vs identifiers, or several identifier matches) →
 *    unresolved with candidates. Weak evidence (name + dimensions) is only ever a candidate.
 * @param {object} f
 * @param {string|null} f.acceptedVesselId
 * @param {string[]} f.imos
 * @param {Record<string,{vesselId:string, registry:boolean, corroboratedBy:string[]}[]>} f.holders
 * @param {{vesselId:string, method:string, evidence:object}[]} f.idMatches
 * @param {{vesselId:string, method:string, evidence:object}[]} f.candidates
 */
export function decideRegistry(f) {
  const candidates = []
  const add = (vesselId, method, evidence) => {
    if (vesselId === f.acceptedVesselId) return
    if (!candidates.some((c) => c.vesselId === vesselId && c.method === method)) candidates.push({ vesselId, method, evidence })
  }
  for (const imo of f.imos) {
    for (const h of f.holders[imo] || []) {
      add(h.vesselId, 'IMO_EXACT', { imo, basis: 'registry', holder_imo_basis: h.registry ? 'registry' : 'ais', corroborated_by: h.corroboratedBy })
    }
  }
  for (const m of f.idMatches || []) add(m.vesselId, m.method, m.evidence)
  for (const c of f.candidates || []) add(c.vesselId, c.method, c.evidence)
  if (f.acceptedVesselId) return { action: 'keep', vesselId: f.acceptedVesselId, needsReview: candidates.length > 0, candidates }
  const unresolved = (reason) => ({ action: 'unresolved', reason, needsReview: candidates.length > 0, candidates })

  let imoTarget = null
  if (f.imos.length > 1) return unresolved('conflicting_imos')
  if (f.imos.length === 1) {
    const hs = f.holders[f.imos[0]] || []
    if (hs.length > 1) return unresolved('imo_on_several_vessels')
    if (hs.length === 1 && (hs[0].registry || hs[0].corroboratedBy.length)) {
      imoTarget = { vesselId: hs[0].vesselId, method: curatedMethod(hs[0]),
        via: hs[0].registry ? 'registry_imo' : `ais_imo+${hs[0].corroboratedBy.join('+')}` }
    }
  }
  const idTargets = [...new Set((f.idMatches || []).map((m) => m.vesselId))]
  if (idTargets.length > 1) return unresolved('identifiers_match_several_vessels')
  if (imoTarget && idTargets.length === 1 && idTargets[0] !== imoTarget.vesselId) return unresolved('imo_and_identifiers_disagree')
  const idm = idTargets.length === 1 ? f.idMatches.find((m) => m.vesselId === idTargets[0]) : null
  const target = imoTarget ?? (idm ? { vesselId: idm.vesselId, method: idm.method, via: idm.method } : null)
  if (!target) return unresolved(f.imos.length || (f.idMatches || []).length ? 'no_accepted_match' : 'no_match')
  const rest = candidates.filter((c) => c.vesselId !== target.vesselId)
  return { action: 'accept', vesselId: target.vesselId, method: target.method, via: target.via, needsReview: rest.length > 0, candidates: rest }
}

/** Names agree? (normalized sets). */
const meets = (a, b) => [...a].some((x) => b.has(x))
/** Length agreement for name + dimension candidates: within 1 m or 10 %. */
export const lengthsAgree = (a, b) => Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && Math.abs(a - b) <= Math.max(1, 0.1 * Math.max(a, b))

// MMSI MIDs a registry's own vessels use (for name + dimension candidates only).
const REGISTRY_MIDS = { 'tc-vessel-registry': ['316'], 'uscg-psix': ['338', '366', '367', '368', '369'] }

/**
 * Match one registry entity's identifiers against existing vessels (DB facts) and
 * return { idMatches, candidates } for decideRegistry. Every query ignores this
 * entity's own claims and community-curated claims.
 */
async function registryIdMatches(c, S, entityId, sourceId, own) {
  const idMatches = []
  const candidates = []
  const names = own.names
  // (a) FCC: licence MMSI in overlapping time; name + (call sign | registration-number alias) must agree.
  if (own.mmsi.size) {
    const { rows } = await c.query(
      `SELECT va.vessel_id::text AS "vesselId", va.value_norm AS mmsi,
              array(SELECT DISTINCT x.value_norm FROM ${S}.vessel_assertions x
                     WHERE x.vessel_id = va.vessel_id AND x.attribute = 'callsign' AND x.value_norm <> ''
                       AND x.evidence_class <> 'community_curated' AND x.source_entity_id <> $1) AS callsigns,
              array(SELECT DISTINCT x.value_norm FROM ${S}.vessel_assertions x
                     WHERE x.vessel_id = va.vessel_id AND x.attribute = 'name' AND x.value_norm <> ''
                       AND x.evidence_class <> 'community_curated' AND x.source_entity_id <> $1) AS names
         FROM ${S}.assertions a
         JOIN ${S}.vessel_assertions va
           ON va.attribute = 'mmsi' AND va.value_norm = a.value_norm AND va.period && a.period
          AND va.period_kind <> 'unknown' AND va.source_entity_id <> a.source_entity_id
          AND va.evidence_class <> 'community_curated'
        WHERE a.source_entity_id = $1 AND a.attribute = 'mmsi' AND a.status = 'active' AND a.period_kind <> 'unknown'
        GROUP BY va.vessel_id, va.value_norm`, [entityId])
    for (const r of rows) {
      const cs = new Set(r.callsigns), nm = new Set(r.names)
      const nameOk = meets(names, nm), csOk = meets(own.callsign, cs), aliasOk = meets(own.aliases, cs)
      const ev = { mmsi: r.mmsi, name_agrees: nameOk, callsign_agrees: csOk, registration_number_in_ais_callsign: aliasOk,
        basis: 'licence MMSI term overlaps the vessel\'s MMSI window' }
      if (nameOk && csOk) idMatches.push({ vesselId: r.vesselId, method: 'REG_MMSI_CALLSIGN_NAME', evidence: ev })
      else if (nameOk && aliasOk) idMatches.push({ vesselId: r.vesselId, method: 'REG_MMSI_REGNO_NAME', evidence: ev })
      else candidates.push({ vesselId: r.vesselId, method: 'MMSI_TEMPORAL', evidence: { ...ev,
        reason: !nameOk ? 'name differs' : cs.size ? 'call sign differs' : 'vessel has no call sign' } })
    }
  } else if (own.callsign.size) {
    // (b) PSIX: call sign + name (the source has no MMSI and gives no dates for identity).
    const { rows } = await c.query(
      `SELECT va.vessel_id::text AS "vesselId", min(lower(va.period)) AS first_seen,
              array(SELECT DISTINCT x.value_norm FROM ${S}.vessel_assertions x
                     WHERE x.vessel_id = va.vessel_id AND x.attribute = 'name' AND x.value_norm <> ''
                       AND x.evidence_class <> 'community_curated' AND x.source_entity_id <> $1) AS names
         FROM ${S}.vessel_assertions va
        WHERE va.attribute = 'callsign' AND va.value_norm = ANY($2) AND va.source_entity_id <> $1
          AND va.evidence_class <> 'community_curated'
        GROUP BY va.vessel_id`, [entityId, [...own.callsign]])
    for (const r of rows) {
      const nameOk = meets(names, new Set(r.names))
      const retired = own.outOfService && r.first_seen && new Date(own.outOfService) < new Date(r.first_seen)
      const ev = { callsign: [...own.callsign], name_agrees: nameOk, basis: 'registry call sign + name (source gives no dates for identity)' }
      if (nameOk && !retired) idMatches.push({ vesselId: r.vesselId, method: 'REG_CALLSIGN_NAME', evidence: ev })
      else candidates.push({ vesselId: r.vesselId, method: 'CALLSIGN_MATCH',
        evidence: { ...ev, reason: retired ? 'registry lists the vessel out of service before we observed it' : 'name differs' } })
    }
  }
  // (c) the same US official number already on a vessel through another registry, + name.
  if (own.usOfficial.size) {
    const { rows } = await c.query(
      `SELECT va.vessel_id::text AS "vesselId", array_agg(DISTINCT va.source_id) AS via,
              array(SELECT DISTINCT x.value_norm FROM ${S}.vessel_assertions x
                     WHERE x.vessel_id = va.vessel_id AND x.attribute = 'name' AND x.value_norm <> ''
                       AND x.evidence_class <> 'community_curated' AND x.source_entity_id <> $1) AS names
         FROM ${S}.vessel_assertions va
        WHERE va.attribute = 'official_number' AND va.value_norm = ANY($2) AND va.evidence_class = 'registry'
          AND va.detail->>'scheme' = 'us_official_number' AND va.source_entity_id <> $1
        GROUP BY va.vessel_id`, [entityId, [...own.usOfficial]])
    for (const r of rows) {
      const ev = { official_number: [...own.usOfficial], via_sources: r.via, name_agrees: meets(names, new Set(r.names)) }
      if (ev.name_agrees) idMatches.push({ vesselId: r.vesselId, method: 'OFFICIAL_NUMBER_NAME', evidence: ev })
      else candidates.push({ vesselId: r.vesselId, method: 'REGISTRY_LINK', evidence: { ...ev, reason: 'name differs' } })
    }
  }
  // (d) nothing identifying matched: name + length, only as candidates, only among vessels
  //     transmitting from the registry's own country (MMSI MID), and only when few.
  const mids = REGISTRY_MIDS[sourceId]
  if (!idMatches.length && !candidates.length && mids && names.size && own.lengths.length) {
    const { rows } = await c.query(
      `SELECT n.vessel_id::text AS "vesselId",
              array(SELECT DISTINCT x.value_norm::float FROM ${S}.vessel_assertions x
                     WHERE x.vessel_id = n.vessel_id AND x.attribute = 'length_m' AND x.value_norm ~ '^[0-9.]+$'
                       AND x.evidence_class <> 'community_curated' AND x.source_entity_id <> $1) AS lengths
         FROM ${S}.vessel_assertions n
        WHERE n.attribute = 'name' AND n.value_norm = ANY($2) AND n.evidence_class <> 'community_curated'
          AND n.source_entity_id <> $1
          AND EXISTS (SELECT 1 FROM ${S}.vessel_assertions m WHERE m.vessel_id = n.vessel_id AND m.attribute = 'mmsi'
                       AND left(m.value_norm, 3) = ANY($3))
        GROUP BY n.vessel_id`, [entityId, [...names], mids])
    const near = rows.filter((r) => r.lengths.some((b) => own.lengths.some((a) => lengthsAgree(a, b))))
    if (near.length && near.length <= 3) {
      for (const r of near) candidates.push({ vesselId: r.vesselId, method: 'NAME_DIMENSION_MATCH',
        evidence: { names: [...names], registry_lengths: own.lengths, vessel_lengths: r.lengths, mids,
          reason: 'same name and length within 1 m / 10 %, vessel transmits from the registry\'s country; never accepted automatically' } })
    }
  }
  return { idMatches, candidates }
}

async function resolveRegistryEntity(c, S, entityId, acceptedVesselId, sourceId) {
  const { rows: own } = await c.query(
    `SELECT attribute, value_norm, detail FROM ${S}.assertions
      WHERE source_entity_id = $1 AND status = 'active'
        AND attribute IN ('imo', 'mmsi', 'callsign', 'name', 'official_number', 'length_m', 'registration_status')`, [entityId])
  const of = (a) => own.filter((r) => r.attribute === a && r.value_norm)
  const imos = [...new Set(of('imo').filter((r) => r.detail?.checksum_ok).map((r) => r.value_norm))].sort()
  const facts = {
    mmsi: new Set(of('mmsi').map((r) => r.value_norm)),
    callsign: new Set(of('callsign').map((r) => r.value_norm)),
    names: new Set(of('name').filter((r) => !r.detail?.former).map((r) => r.value_norm)),
    aliases: new Set(of('official_number').map((r) => r.detail?.ais_callsign_alias).filter(Boolean)),
    usOfficial: new Set(of('official_number').filter((r) => r.detail?.scheme === 'us_official_number').map((r) => r.value_norm)),
    lengths: of('length_m').map((r) => Number(r.value_norm)).filter((n) => n > 0),
    outOfService: of('registration_status').map((r) => r.detail?.out_of_service_date).find(Boolean) ?? null,
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
    const mine = { mmsi: facts.mmsi, callsign: facts.callsign, name: facts.names }
    for (const r of rows) {
      const theirs = new Set(r.ids)
      const corroboratedBy = ['mmsi', 'callsign', 'name'].filter((k) => [...mine[k]].some((v) => theirs.has(`${k}:${v}`)))
      ;(holders[r.imo] ||= []).push({ vesselId: r.vesselId, registry: r.registry, corroboratedBy })
    }
  }
  const { idMatches, candidates } = acceptedVesselId ? { idMatches: [], candidates: [] }
    : await registryIdMatches(c, S, entityId, sourceId, facts)
  const d = decideRegistry({ acceptedVesselId, imos, holders, idMatches, candidates })
  if (d.action === 'accept') {
    const m = idMatches.find((x) => x.vesselId === d.vesselId && x.method === d.method)
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'accepted',$3,$4,$5)`,
      [entityId, d.vesselId, d.method, { registryImos: imos, via: d.via, match: m?.evidence ?? null,
        rule: 'official registry record attached to one existing vessel (docs/VESSEL_REGISTRIES.md §Resolution)' }, RESOLVER])
  }
  if (d.vesselId && d.needsReview) await c.query(`UPDATE ${S}.vessels SET needs_review = true WHERE id = $1`, [d.vesselId])
  for (const cand of d.candidates) {
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'candidate',$3,$4,$5) ON CONFLICT DO NOTHING`,
      [entityId, cand.vesselId, cand.method, cand.evidence, RESOLVER])
  }
  return { ...d, vesselId: d.vesselId ?? null }
}

// ── Wikimedia Commons IMO categories (ship photos; docs/COMMONS_PHOTOS.md) ──────

const COMMONS_SOURCE_ID = 'wikimedia-commons'

/**
 * Commons "Category:IMO <n>" → link (pure; tested offline). Attach-only, strictest of all:
 * the IMO (from the category title) must be checksum-valid and held as a REGISTRY-class
 * IMO by exactly one vessel. An AIS-only IMO, several holders or none → unresolved, with
 * no candidate links (a photo is not identity evidence; the IMO ambiguity itself is
 * already recorded between those vessels). Never by name. A `commons_file` entity is
 * never linked directly: its photo reaches a vessel only through a category's claim.
 * @param {object} f
 * @param {string|null} f.acceptedVesselId
 * @param {string} f.kind   entity kind
 * @param {{imo:string, valid:boolean}|null} f.imo  parsed from the entity key
 * @param {string[]} f.registryHolders  vessels holding that IMO as a registry-class claim
 * @param {number} f.aisHolders  vessels holding it only from AIS
 */
export function decideCommons(f) {
  if (f.acceptedVesselId) return { action: 'keep', vesselId: f.acceptedVesselId, needsReview: false, candidates: [] }
  const unresolved = (reason) => ({ action: 'unresolved', reason, needsReview: false, candidates: [] })
  if (f.kind !== 'commons_imo_category') return unresolved('file_entity_not_linked_directly')
  if (!f.imo) return unresolved('not_an_imo_category')
  if (!f.imo.valid) return unresolved('imo_checksum_invalid')
  if (f.registryHolders.length > 1) return unresolved('imo_on_several_vessels')
  if (!f.registryHolders.length) return unresolved(f.aisHolders ? 'imo_only_ais_reported' : 'no_vessel_with_imo')
  return { action: 'accept', vesselId: f.registryHolders[0], method: 'IMO_EXACT', via: 'registry_imo', needsReview: false, candidates: [] }
}

async function resolveCommonsEntity(c, S, entityId, acceptedVesselId, ent) {
  const m = /^Category:IMO (\d{7})$/.exec(ent.entity_key || '')
  const imo = m ? normImo(m[1]) : null
  const parsed = imo ? { imo: imo.value, valid: imo.valid } : null
  let registryHolders = [], aisHolders = 0
  if (parsed?.valid && ent.entity_kind === 'commons_imo_category') {
    const { rows } = await c.query(
      `SELECT h.vessel_id::text AS "vesselId", bool_or(h.evidence_class = 'registry') AS registry
         FROM ${S}.vessel_assertions h
        WHERE h.attribute = 'imo' AND h.value_norm = $1 AND (h.detail->>'checksum_ok')::boolean
          AND h.evidence_class <> 'community_curated' AND h.source_entity_id <> $2
        GROUP BY h.vessel_id`, [parsed.imo, entityId])
    registryHolders = rows.filter((r) => r.registry).map((r) => r.vesselId)
    aisHolders = rows.filter((r) => !r.registry).length
  }
  const d = decideCommons({ acceptedVesselId, kind: ent.entity_kind, imo: parsed, registryHolders, aisHolders })
  if (d.action === 'accept') {
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'accepted',$3,$4,$5)`,
      [entityId, d.vesselId, d.method, { imo: parsed.imo, category: ent.entity_key, via: d.via,
        rule: 'Commons IMO category attached to the one vessel holding that IMO as a registry-class claim' }, RESOLVER])
  }
  return { ...d, vesselId: d.vesselId ?? null }
}

// ── IMO GISIS MARPOL Annex VI Reg. 4.2 notifications (scrubbers; docs/IMO_GISIS.md) ─────

const GISIS_REG42_SOURCE_ID = 'imo-gisis-scrubbers'
const GISIS_FACILITIES_SOURCE_ID = 'imo-gisis-port-facilities'

/**
 * A Reg. 4.2 entity ('IMO 1234567': every notification row for that IMO) → link (pure; tested offline). Attach-only, the
 * Commons rule: the IMO must be checksum-valid and held as a REGISTRY-class IMO by exactly one vessel. An AIS-only IMO,
 * several holders or none → unresolved, no candidates (a notification carries no other identifier). Never by name; a row
 * without an IMO (kind marpol6_reg42_row) is never linked.
 * @param {object} f
 * @param {string|null} f.acceptedVesselId
 * @param {string} f.kind
 * @param {{imo:string, valid:boolean}|null} f.imo  parsed from the entity key
 * @param {string[]} f.registryHolders
 * @param {number} f.aisHolders
 */
export function decideGisisImo(f) {
  if (f.acceptedVesselId) return { action: 'keep', vesselId: f.acceptedVesselId, needsReview: false, candidates: [] }
  const unresolved = (reason) => ({ action: 'unresolved', reason, needsReview: false, candidates: [] })
  if (f.kind !== 'marpol6_reg42_imo' || !f.imo) return unresolved('no_imo_in_row')
  if (!f.imo.valid) return unresolved('imo_checksum_invalid')
  if (f.registryHolders.length > 1) return unresolved('imo_on_several_vessels')
  if (!f.registryHolders.length) return unresolved(f.aisHolders ? 'imo_only_ais_reported' : 'no_vessel_with_imo')
  return { action: 'accept', vesselId: f.registryHolders[0], method: 'IMO_EXACT', via: 'registry_imo', needsReview: false, candidates: [] }
}

/** Vessels holding a checksum-valid IMO: registry-class holders, and how many hold it only from AIS (Commons excluded). */
async function imoHolders(c, S, imo, entityId) {
  const { rows } = await c.query(
    `SELECT h.vessel_id::text AS "vesselId", bool_or(h.evidence_class = 'registry') AS registry
       FROM ${S}.vessel_assertions h
      WHERE h.attribute = 'imo' AND h.value_norm = $1 AND (h.detail->>'checksum_ok')::boolean
        AND h.evidence_class <> 'community_curated' AND h.source_entity_id <> $2
      GROUP BY h.vessel_id`, [imo, entityId])
  return { registryHolders: rows.filter((r) => r.registry).map((r) => r.vesselId), aisHolders: rows.filter((r) => !r.registry).length }
}

async function resolveGisisEntity(c, S, entityId, acceptedVesselId, ent) {
  const m = /^IMO (\d{7})$/.exec(ent.entity_key || '')
  const n = m ? normImo(m[1]) : null
  const parsed = n ? { imo: n.value, valid: n.valid } : null
  let registryHolders = [], aisHolders = 0
  if (parsed?.valid && !acceptedVesselId) ({ registryHolders, aisHolders } = await imoHolders(c, S, parsed.imo, entityId))
  const d = decideGisisImo({ acceptedVesselId, kind: ent.entity_kind, imo: parsed, registryHolders, aisHolders })
  if (d.action === 'accept') {
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'accepted',$3,$4,$5)`,
      [entityId, d.vesselId, d.method, { imo: parsed.imo, via: d.via,
        rule: 'IMO GISIS Reg. 4.2 notification attached to the one vessel holding that IMO as a registry-class claim' }, RESOLVER])
  }
  return { ...d, vesselId: d.vesselId ?? null }
}

// ── EU MRV ship-year reports (EMSA THETIS-MRV; docs/SHIP_POLLUTION_SOURCES.md §1) ─────

const MRV_SOURCE_ID = 'emsa-thetis-mrv'

/**
 * An EU MRV ship-year entity ('IMO 9378448 · 2024') → link (pure; tested offline). The IMO GISIS rule: the IMO must be
 * checksum-valid and held as a REGISTRY-class IMO by exactly one vessel. AIS-only, several holders or none → unresolved, no
 * candidates (a report carries no MMSI or call sign). Never by name. The file-header entity ('eu_mrv_file') is never linked.
 * Same inputs as decideGisisImo.
 */
export function decideMrvImo(f) {
  if (f.acceptedVesselId) return { action: 'keep', vesselId: f.acceptedVesselId, needsReview: false, candidates: [] }
  const unresolved = (reason) => ({ action: 'unresolved', reason, needsReview: false, candidates: [] })
  if (f.kind !== 'eu_mrv_ship_year') return unresolved('not_a_vessel_source')
  if (!f.imo) return unresolved('no_imo_in_key')
  if (!f.imo.valid) return unresolved('imo_checksum_invalid')
  if (f.registryHolders.length > 1) return unresolved('imo_on_several_vessels')
  if (!f.registryHolders.length) return unresolved(f.aisHolders ? 'imo_only_ais_reported' : 'no_vessel_with_imo')
  return { action: 'accept', vesselId: f.registryHolders[0], method: 'IMO_EXACT', via: 'registry_imo', needsReview: false, candidates: [] }
}

async function resolveMrvEntity(c, S, entityId, acceptedVesselId, ent) {
  const m = /^IMO (\d{7}) · \d{4}$/.exec(ent.entity_key || '')
  const n = m ? normImo(m[1]) : null
  const parsed = n ? { imo: n.value, valid: n.valid } : null
  let registryHolders = [], aisHolders = 0
  if (parsed?.valid && !acceptedVesselId && ent.entity_kind === 'eu_mrv_ship_year') ({ registryHolders, aisHolders } = await imoHolders(c, S, parsed.imo, entityId))
  const d = decideMrvImo({ acceptedVesselId, kind: ent.entity_kind, imo: parsed, registryHolders, aisHolders })
  if (d.action === 'accept') {
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'accepted',$3,$4,$5)`,
      [entityId, d.vesselId, d.method, { imo: parsed.imo, via: d.via,
        rule: 'EU MRV ship-year report attached to the one vessel holding that IMO as a registry-class claim' }, RESOLVER])
  }
  return { ...d, vesselId: d.vesselId ?? null }
}

// ── MEP Alliance scrubber lists (lib/ships/mepAlliance.js; migration 021) ─────

const MEP_SOURCE_IDS = new Set(['mep-alliance-voyages', 'mep-alliance-fitted-ships'])
const MEP_FITTED_SOURCE_ID = 'mep-alliance-fitted-ships'
const MEP_ROLE_ATTRS = ['registry_owner', 'registered_owner', 'beneficial_owner', 'owner', 'operator', 'ship_manager', 'technical_manager',
  'commercial_manager', 'ism_manager', 'bareboat_charterer']
export const MEP_MAX_CANDIDATES = 10

/**
 * A MEP Alliance list entity → link (pure; tested offline).
 * IMO rows ('mep_fitted_imo'): the IMO GISIS rule, IMO_EXACT to the one vessel holding the IMO as a registry-class claim; never by
 * name, even when no vessel holds it.
 * Name rows ('mep_voyage_ship', 'mep_fitted_name'), f.nameMatches = the vessels one of whose names (any source but community-
 * curated) equals the row's normalized name, each { vesselId, salish, big, companyShared: [], yearMatch, imoListMatch,
 * imoListConflict }:
 *   imoListConflict  the vessel-type list gives this name with an IMO the vessel does NOT hold (while it holds a registry IMO):
 *                    the list's ship of that name is another ship, so this vessel is never accepted
 *   1. MEP_NAME_CORROBORATED: exactly one vessel has the name and a second fact agrees (a shared company word, the build year, or
 *      the vessel-type list's IMO for that name is this vessel's); or the one big Salish ship among several has one
 *   2. MEP_NAME_SALISH_SIZE (Josh 2026-09-30, inferred): exactly one of the name's vessels is big and known in the Salish Sea
 *   3. otherwise candidates (MEP_NAME_ONLY; none when more than MEP_MAX_CANDIDATES vessels share the name), unresolved
 * @returns {{action, vesselId?, method?, inferred?, reason?, needsReview:boolean, candidates:[], evidence?}}
 */
export function decideMep(f) {
  if (f.acceptedVesselId) return { action: 'keep', vesselId: f.acceptedVesselId, needsReview: false, candidates: [] }
  const unresolved = (reason, candidates = []) => ({ action: 'unresolved', reason, needsReview: false, candidates })
  if (f.kind === 'mep_fitted_imo') {
    if (!f.imo) return unresolved('no_imo_in_key')
    if (!f.imo.valid) return unresolved('imo_checksum_invalid')
    if (f.registryHolders.length > 1) return unresolved('imo_on_several_vessels')
    if (!f.registryHolders.length) return unresolved(f.aisHolders ? 'imo_only_ais_reported' : 'no_vessel_with_imo')
    return { action: 'accept', vesselId: f.registryHolders[0], method: 'IMO_EXACT', via: 'registry_imo', inferred: false, needsReview: false, candidates: [] }
  }
  if (!['mep_voyage_ship', 'mep_fitted_name'].includes(f.kind)) return unresolved('not_a_vessel_source')
  const ms = f.nameMatches || []
  if (!ms.length) return unresolved('no_name_match')
  const facts = (m) => [...(m.companyShared?.length ? ['company'] : []), ...(m.yearMatch ? ['year_built'] : []), ...(m.imoListMatch ? ['imo_list'] : [])]
  const usable = ms.filter((m) => !m.imoListConflict)
  const salishBig = usable.filter((m) => m.salish && m.big)
  const ev = (m, rule) => ({ name: f.nameNorm ?? null, rule, corroborated_by: facts(m), company_words: m.companyShared || [],
    salish: !!m.salish, big: !!m.big, vessels_with_name: ms.length })
  const accept = (m, method, rule) => ({ action: 'accept', vesselId: m.vesselId, method, inferred: method === 'MEP_NAME_SALISH_SIZE',
    needsReview: false, candidates: [], evidence: ev(m, rule) })
  if (ms.length === 1 && usable.length === 1 && facts(usable[0]).length) {
    return accept(usable[0], 'MEP_NAME_CORROBORATED', 'the only vessel with this name, and a second fact agrees')
  }
  if (salishBig.length === 1 && facts(salishBig[0]).length) {
    return accept(salishBig[0], 'MEP_NAME_CORROBORATED', 'the only big Salish Sea ship with this name, and a second fact agrees')
  }
  if (salishBig.length === 1) {
    return accept(salishBig[0], 'MEP_NAME_SALISH_SIZE', 'the only big ship (>= 100 m or a big-ship type) with this name known in the Salish Sea (inferred)')
  }
  const reason = salishBig.length > 1 ? 'name_on_several_big_salish_ships'
    : ms.some((m) => m.imoListConflict) && !usable.length ? 'vessel_type_list_names_another_ship'
    : usable.some((m) => m.salish) ? 'name_only_on_small_salish_craft' : 'name_not_corroborated'
  if (ms.length > MEP_MAX_CANDIDATES) return unresolved('name_too_common')
  return unresolved(reason, ms.map((m) => ({ vesselId: m.vesselId, method: 'MEP_NAME_ONLY', evidence: { ...ev(m, 'name match only'), imo_list_conflict: !!m.imoListConflict } })))
}

/** The facts decideMep needs about each vessel carrying `nameNorm`, plus what the list row says. */
async function mepNameMatches(c, S, entityId, ent, nameNorm) {
  const { rows: vs } = await c.query(
    `SELECT DISTINCT vessel_id::text AS id FROM ${S}.vessel_assertions
      WHERE attribute = 'name' AND value_norm = $1 AND evidence_class <> 'community_curated'`, [nameNorm])
  if (!vs.length || vs.length > MEP_MAX_CANDIDATES) return vs.map((v) => ({ vesselId: v.id }))
  const ids = vs.map((v) => v.id)
  const { rows: facts } = await c.query(
    `SELECT vessel_id::text AS id, attribute, value_raw, value_norm, evidence_class, detail->>'display' AS display, (detail->>'checksum_ok')::boolean AS ok
       FROM ${S}.vessel_assertions
      WHERE vessel_id = ANY($1::uuid[]) AND attribute = ANY($2)`,
    [ids, ['length_m', 'vessel_type', 'year_built', 'imo', 'mmsi', ...MEP_ROLE_ATTRS]])
  const { rows: sal } = await c.query(
    `SELECT DISTINCT l.vessel_id::text AS id FROM ${S}.entity_links l JOIN ${S}.source_entities se ON se.id = l.source_entity_id
      WHERE l.status = 'accepted' AND l.vessel_id = ANY($1::uuid[]) AND se.source_id = 'marinecadastre-ais'`, [ids])
  const salish = new Set(sal.map((r) => r.id))
  // Terminal calls and anchorage stays are counted from the same Salish AIS, by MMSI.
  const mmsis = [...new Set(facts.filter((f) => f.attribute === 'mmsi').map((f) => f.value_norm))]
  if (mmsis.length) {
    const { rows: st } = await c.query(
      `SELECT mmsi FROM ${S}.terminal_calls WHERE mmsi = ANY($1) UNION SELECT mmsi FROM ${S}.anchorage_stays WHERE mmsi = ANY($1)`,
      [mmsis]).catch(() => ({ rows: [] }))
    const hit = new Set(st.map((r) => String(r.mmsi)))
    for (const f of facts) if (f.attribute === 'mmsi' && hit.has(f.value_norm)) salish.add(f.id)
  }
  // What the list says: companies and build years from this entity's active claims.
  const { rows: mine } = await c.query(
    `SELECT detail->>'owner' AS owner, detail->>'charterer' AS charterer, detail->>'controller' AS controller, detail->>'year_built' AS year
       FROM ${S}.assertions WHERE source_entity_id = $1 AND status = 'active'`, [entityId])
  const listCompanies = mine.flatMap((m) => [m.owner, m.charterer, m.controller]).filter(Boolean)
  const listYears = new Set(mine.map((m) => m.year).filter(Boolean).map(String))
  // The vessel-type list's IMOs for this name (voyage rows have none of their own).
  let listImos = []
  if (ent.source_id !== MEP_FITTED_SOURCE_ID || ent.entity_kind === 'mep_fitted_name') {
    const { rows } = await c.query(
      `SELECT DISTINCT substr(se.entity_key, 5) AS imo FROM ${S}.source_entities se JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
        WHERE se.source_id = $1 AND se.entity_kind = 'mep_fitted_imo' AND sr.payload->>'name_norm' = $2`, [MEP_FITTED_SOURCE_ID, nameNorm])
    listImos = rows.map((r) => r.imo)
  }
  return ids.map((id) => {
    const mineF = facts.filter((f) => f.id === id)
    const lengths = mineF.filter((f) => f.attribute === 'length_m').map((f) => parseFloat(f.value_raw))
    const types = mineF.filter((f) => f.attribute === 'vessel_type').map((f) => f.value_raw)
    const companies = mineF.filter((f) => MEP_ROLE_ATTRS.includes(f.attribute) && f.display !== 'false').map((f) => f.value_raw)
    const years = new Set(mineF.filter((f) => f.attribute === 'year_built').map((f) => String(parseInt(f.value_raw, 10))))
    const regImos = new Set(mineF.filter((f) => f.attribute === 'imo' && f.evidence_class === 'registry' && f.ok).map((f) => f.value_norm))
    return {
      vesselId: id, salish: salish.has(id), big: isBigShip({ lengths, types }),
      companyShared: companyOverlap(listCompanies, companies),
      yearMatch: [...listYears].some((y) => years.has(y)),
      imoListMatch: listImos.some((i) => regImos.has(i)),
      imoListConflict: listImos.length > 0 && regImos.size > 0 && !listImos.some((i) => regImos.has(i)),
    }
  })
}

async function resolveMepEntity(c, S, entityId, acceptedVesselId, ent) {
  let f = { acceptedVesselId, kind: ent.entity_kind }
  if (!acceptedVesselId) {
    if (ent.entity_kind === 'mep_fitted_imo') {
      const m = /^IMO (\d{7})$/.exec(ent.entity_key || '')
      const n = m ? normImo(m[1]) : null
      f.imo = n ? { imo: n.value, valid: n.valid } : null
      Object.assign(f, f.imo?.valid ? await imoHolders(c, S, f.imo.imo, entityId) : { registryHolders: [], aisHolders: 0 })
    } else {
      const m = /^NAME ([A-Z0-9?]+)/.exec(ent.entity_key || '')
      f.nameNorm = m ? m[1] : ''
      f.nameMatches = f.nameNorm && f.nameNorm !== '?' ? await mepNameMatches(c, S, entityId, ent, f.nameNorm) : []
    }
  }
  const d = decideMep(f)
  if (d.action === 'accept') {
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'accepted',$3,$4,$5)`,
      [entityId, d.vesselId, d.method, { ...(d.evidence || { imo: f.imo?.imo, via: d.via }), inferred: !!d.inferred,
        rule: d.method === 'IMO_EXACT' ? 'MEP Alliance list row attached to the one vessel holding that IMO as a registry-class claim' : d.evidence?.rule }, RESOLVER])
  }
  for (const cand of d.candidates) {
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'candidate',$3,$4,$5) ON CONFLICT DO NOTHING`,
      [entityId, cand.vesselId, cand.method, cand.evidence, RESOLVER])
  }
  return { ...d, vesselId: d.vesselId ?? null }
}
