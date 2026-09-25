/**
 * Re-run identity resolution over every source entity with the current
 * resolver. It changes the interpretation, never the evidence (src/ships/CLAUDE.md):
 *   1. links a resolver made (decided_by 'resolver:*') → 'superseded' (kept);
 *      manual decisions stay and still count;
 *   2. every entity without an accepted link is resolved again, oldest first;
 *   3. vessels left with no accepted link → 'retired'.
 * Raw records and assertions are untouched. Resolver-made vessel ids change,
 * so use only where ids aren't public yet.
 */
import { withTx } from './db.js'
import { resolveEntity } from './resolve.js'

export async function reresolveAll(pool, S, { log = () => {} } = {}) {
  const stats = {}
  const sup = await pool.query(
    `UPDATE ${S}.entity_links SET status = 'superseded', superseded_at = now()
      WHERE decided_by LIKE 'resolver:%' AND status IN ('accepted', 'candidate')`)
  stats.linksSuperseded = sup.rowCount
  const { rows: ents } = await pool.query(
    `SELECT se.id FROM ${S}.source_entities se
      WHERE NOT EXISTS (SELECT 1 FROM ${S}.entity_links l WHERE l.source_entity_id = se.id AND l.status = 'accepted')
      ORDER BY se.id`)
  let done = 0
  for (const { id } of ents) {
    const d = await withTx(pool, (c) => resolveEntity(c, S, id))
    const k = `${d.action}${d.method ? `_${d.method}` : ''}`
    stats[k] = (stats[k] || 0) + 1
    if (d.needsReview) stats.needsReview = (stats.needsReview || 0) + 1
    if (++done % 500 === 0) log(`  ${done}/${ents.length}`)
  }
  const ret = await pool.query(
    `UPDATE ${S}.vessels v SET status = 'retired'
      WHERE status = 'active' AND NOT EXISTS (SELECT 1 FROM ${S}.entity_links l WHERE l.vessel_id = v.id AND l.status = 'accepted')`)
  stats.vesselsRetired = ret.rowCount
  return stats
}
