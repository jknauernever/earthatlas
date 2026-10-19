/**
 * /ship-intake write step (shared by scripts/ships/intake.mjs and the web intake page). One transaction per intake:
 * the operator's source row, the page and each boat as raw records, the boats' claims (lib/ships/operatorSite.js), and
 * each reviewed match as an accepted MANUAL_REVIEW link. Idempotent: an unchanged intake writes nothing new. A boat whose
 * decision is "none" is kept, unlinked (not on the site); a boat linked earlier and now "none" has its link superseded.
 */
import { upsertSource, findOrCreateEntity, upsertRecord, upsertAssertions } from './store.js'
import { operatorSource, boatKey, boatClaims, boatPayload, pagePayload, PAGE_KIND, BOAT_KIND, INTAKE_DECIDER } from './operatorSite.js'

/** Every matched vessel exists and isn't merged away. Returns problems (empty = fine). */
export async function matchProblems(q, S, intake) {
  const errs = []
  for (const b of intake.boats) if (b.match?.vessel_id) {
    const [v] = await q(`SELECT id, status, merged_into FROM ${S}.vessels WHERE id = $1`, [b.match.vessel_id])
    if (!v) errs.push(`${b.name}: vessel ${b.match.vessel_id} is not in this database`)
    else if (v.status === 'merged') errs.push(`${b.name}: vessel ${b.match.vessel_id} was merged into ${v.merged_into}; use that id`)
  }
  return errs
}

/** Write one intake inside the caller's transaction `c`. Returns { page_record, boats: [{ name, record, claims, link }] }. */
export async function applyIntake(c, S, intake, { decidedBy = INTAKE_DECIDER } = {}) {
  const src = operatorSource(intake)
  await upsertSource(c, S, src)
  const pe = await findOrCreateEntity(c, S, { sourceId: src.id, kind: PAGE_KIND, anchor: intake.page.url })
  const pr = await upsertRecord(c, S, { sourceId: src.id, entityId: pe.id, payload: pagePayload(intake), datasetVersion: intake.page.retrieved_at, retrievalUrl: intake.page.url })
  const out = { source_id: src.id, page_record: { id: pr.id, created: pr.created }, boats: [] }
  for (const b of intake.boats) {
    const ent = await findOrCreateEntity(c, S, { sourceId: src.id, kind: BOAT_KIND, anchor: boatKey(intake, b) })
    const rec = await upsertRecord(c, S, { sourceId: src.id, entityId: ent.id, payload: boatPayload(intake, b), datasetVersion: intake.page.retrieved_at,
      retrievalUrl: b.page_url || intake.page.url })
    const a = await upsertAssertions(c, S, { entityId: ent.id, recordId: rec.id, assertions: boatClaims(intake, b) })
    const [cur] = (await c.query(`SELECT id, vessel_id FROM ${S}.entity_links WHERE source_entity_id = $1 AND status = 'accepted'`, [ent.id])).rows
    let link = 'unlinked'
    if (b.match.vessel_id && cur?.vessel_id !== b.match.vessel_id) {
      if (cur) await c.query(`UPDATE ${S}.entity_links SET status = 'superseded', superseded_at = now() WHERE id = $1`, [cur.id])
      await c.query(`INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, confidence, decided_by)
                     VALUES ($1, $2, 'accepted', 'MANUAL_REVIEW', $3, $4, $5)`,
        [ent.id, b.match.vessel_id, { basis: b.match.basis, reviewed: b.match.decided ?? null, page: b.page_url || intake.page.url }, b.match.confidence || 'high', decidedBy])
      link = cur ? 'moved' : 'linked'
    } else if (b.match.vessel_id) link = 'already linked'
    else if (cur) { await c.query(`UPDATE ${S}.entity_links SET status = 'superseded', superseded_at = now() WHERE id = $1`, [cur.id]); link = 'unlinked (was linked)' }
    out.boats.push({ name: b.name, vessel_id: b.match.vessel_id || null, record: { id: rec.id, created: rec.created }, claims: a, link })
  }
  return out
}

/** Undo one boat of an applied intake: its accepted link is superseded (kept as history). Returns rows changed. */
export async function unlinkBoat(c, S, intake, boatName) {
  const b = intake.boats.find((x) => x.name === boatName)
  if (!b) return 0
  const src = operatorSource(intake)
  const { rowCount } = await c.query(
    `UPDATE ${S}.entity_links l SET status = 'superseded', superseded_at = now()
       FROM ${S}.source_entities se
      WHERE l.source_entity_id = se.id AND l.status = 'accepted'
        AND se.source_id = $1 AND se.entity_kind = $2 AND se.entity_key = $3`, [src.id, BOAT_KIND, boatKey(intake, b)])
  return rowCount
}
