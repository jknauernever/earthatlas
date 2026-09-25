/**
 * Resolver v1: attach source entities to EarthAtlas vessels, conservatively.
 * The rules are in src/ships/CLAUDE.md. A wrong merge is worse than an
 * unresolved record.
 *
 * `decide()` is pure (unit-tested offline). `resolveEntity()` gathers the
 * facts from the database, applies the decision, and writes links only.
 * Assertions and raw records are never modified here.
 */

export const RESOLVER = 'resolver:v1.1'

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
                   WHERE x.vessel_id = va.vessel_id AND x.attribute = 'callsign' AND x.value_norm <> '') AS callsigns,
            array(SELECT DISTINCT x.value_norm FROM ${S}.vessel_assertions x
                   WHERE x.vessel_id = va.vessel_id AND x.attribute = 'name' AND x.value_norm <> '') AS names,
            array(SELECT DISTINCT x.value_norm FROM ${S}.vessel_assertions x
                   WHERE x.vessel_id = va.vessel_id AND x.attribute = 'imo' AND x.evidence_class = 'registry'
                     AND (x.detail->>'checksum_ok')::boolean) AS registry_imos
       FROM ${S}.assertions a
       JOIN ${S}.vessel_assertions va
         ON va.attribute = 'mmsi' AND va.value_norm = a.value_norm AND va.period && a.period
        AND va.period_kind <> 'unknown' AND va.source_entity_id <> a.source_entity_id
      WHERE a.source_entity_id = $1 AND a.attribute = 'mmsi' AND a.status = 'active'
        AND a.period_kind <> 'unknown'`, [entityId])
  const { rows: own } = await c.query(
    `SELECT attribute, array_agg(DISTINCT value_norm) AS vals FROM ${S}.assertions
      WHERE source_entity_id = $1 AND status = 'active' AND attribute IN ('callsign', 'name') AND value_norm <> ''
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
