/**
 * Resolver v1: attach source entities to EarthAtlas vessels, conservatively.
 * The rules are in src/ships/CLAUDE.md. A wrong merge is worse than an
 * unresolved record.
 *
 * `decide()` is pure (unit-tested offline). `resolveEntity()` gathers the
 * facts from the database, applies the decision, and writes links only.
 * Assertions and raw records are never modified here.
 */

export const RESOLVER = 'resolver:v1'

/**
 * @param {object} f
 * @param {string|null} f.acceptedVesselId  vessel this entity is already linked to
 * @param {string[]} f.registryImos         distinct checksum-valid registry-class IMOs of this entity
 * @param {Record<string,string[]>} f.imoVessels  IMO → other vessels already holding it (registry class)
 * @param {Record<string,string[]>} f.aisImoVessels  AIS-reported IMO → vessels holding it as registry IMO
 * @param {{vesselId:string, mmsi:string}[]} f.mmsiOverlaps  other vessels with overlapping MMSI windows
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
    `SELECT DISTINCT va.vessel_id::text AS "vesselId", va.value_norm AS mmsi
       FROM ${S}.assertions a
       JOIN ${S}.vessel_assertions va
         ON va.attribute = 'mmsi' AND va.value_norm = a.value_norm AND va.period && a.period
        AND va.period_kind <> 'unknown' AND va.source_entity_id <> a.source_entity_id
      WHERE a.source_entity_id = $1 AND a.attribute = 'mmsi' AND a.status = 'active'
        AND a.period_kind <> 'unknown'`, [entityId])

  const d = decide({ acceptedVesselId, registryImos, imoVessels, aisImoVessels,
    mmsiOverlaps: overlaps.filter((o) => o.vesselId !== acceptedVesselId) })

  let vesselId = d.vesselId ?? null
  if (d.action === 'new') {
    const { rows } = await c.query(`INSERT INTO ${S}.vessels (needs_review) VALUES ($1) RETURNING id`, [d.needsReview])
    vesselId = rows[0].id
  }
  if (d.action === 'new' || d.action === 'accept') {
    await c.query(
      `INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by)
       VALUES ($1,$2,'accepted',$3,$4,$5)`,
      [entityId, vesselId, d.method, { registryImos, rule: d.method === 'IMO_EXACT' ? 'single registry IMO held by exactly one vessel' : 'no existing vessel matched' }, RESOLVER])
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
