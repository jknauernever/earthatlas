/**
 * Merge vessel records that resolver v1.10 would have kept as one ship (Josh 2026-10-19, "A"): two active records tied by a
 * same-MMSI candidate link that were split ONLY because one side carried a placeholder call sign (GFW's "DATAHUB"…;
 * lib/ships/normalize.js). They merge when, with placeholders ignored, the real call signs agree or one side has none,
 * they share a name, and no two registry IMOs conflict — the same test the resolver now applies to new records.
 *
 * Interpretation only (src/ships/CLAUDE.md): no claim or raw record is touched. The smaller record (fewer claims, then the
 * newer) is marked status 'merged', merged_into the fuller one, so its id keeps working (lib/ships/queries.js getVessel
 * follows it); its accepted links are superseded and re-made on the fuller record (a manual decision keeps its own
 * method and decider). Reversible: the superseded links and merged_into say exactly what moved.
 */
import { realCallsignSql, PLACEHOLDER_CALLSIGNS } from './normalize.js'
import { RESOLVER } from './resolve.js'

export const MERGE_RULE = 'resolver v1.10: same MMSI in overlapping time and the same name; the only call-sign conflict was a placeholder (e.g. GFW "DATAHUB"), which counts as no call sign'

/** The pairs to merge: [{ keep, merge, mmsi, keep_claims, merge_claims }], fuller record first. */
export async function findPlaceholderSplits(q, S, { limit = null, vesselIds = null } = {}) {
  const ph = `(${PLACEHOLDER_CALLSIGNS.map((x) => `'${x}'`).join(', ')})`
  const rows = await q(`
    WITH pairs AS (
      SELECT DISTINCT LEAST(acc.vessel_id::text, cand.vessel_id::text) AS a, GREATEST(acc.vessel_id::text, cand.vessel_id::text) AS b,
             cand.evidence->>'mmsi' AS mmsi
        FROM ${S}.entity_links cand
        JOIN ${S}.entity_links acc ON acc.source_entity_id = cand.source_entity_id AND acc.status = 'accepted'
        JOIN ${S}.vessels va ON va.id = acc.vessel_id AND va.status = 'active'
        JOIN ${S}.vessels vb ON vb.id = cand.vessel_id AND vb.status = 'active'
       WHERE cand.status = 'candidate' AND cand.method = 'MMSI_TEMPORAL' AND acc.vessel_id <> cand.vessel_id),
    cs AS (SELECT vessel_id::text AS v, array_agg(DISTINCT value_norm) FILTER (WHERE ${realCallsignSql('value_norm')}) AS real,
                  bool_or(value_norm IN ${ph} OR value_norm ~ '^0+$') AS ph
             FROM ${S}.vessel_assertions WHERE attribute = 'callsign' AND evidence_class <> 'community_curated' GROUP BY 1),
    nm AS (SELECT vessel_id::text AS v, array_agg(DISTINCT value_norm) AS n FROM ${S}.vessel_assertions
            WHERE attribute = 'name' AND value_norm <> '' AND evidence_class <> 'community_curated' GROUP BY 1),
    imo AS (SELECT vessel_id::text AS v, array_agg(DISTINCT value_norm) AS i FROM ${S}.vessel_assertions
             WHERE attribute = 'imo' AND evidence_class = 'registry' AND (detail->>'checksum_ok')::boolean GROUP BY 1),
    sz AS (SELECT vessel_id::text AS v, count(*)::int AS n FROM ${S}.vessel_assertions GROUP BY 1)
    SELECT p.a, p.b, p.mmsi, sa.n AS a_n, sb.n AS b_n, va.created_at AS a_at, vb.created_at AS b_at
      FROM pairs p
      JOIN ${S}.vessels va ON va.id = p.a::uuid JOIN ${S}.vessels vb ON vb.id = p.b::uuid
      LEFT JOIN cs ca ON ca.v = p.a LEFT JOIN cs cb ON cb.v = p.b
      LEFT JOIN nm na ON na.v = p.a LEFT JOIN nm nb ON nb.v = p.b
      LEFT JOIN imo ia ON ia.v = p.a LEFT JOIN imo ib ON ib.v = p.b
      LEFT JOIN sz sa ON sa.v = p.a LEFT JOIN sz sb ON sb.v = p.b
     WHERE (coalesce(ca.ph, false) OR coalesce(cb.ph, false))
       AND (ca.real IS NULL OR cb.real IS NULL OR ca.real && cb.real)
       AND na.n && nb.n
       AND (ia.i IS NULL OR ib.i IS NULL OR ia.i && ib.i)
       ${vesselIds ? 'AND (p.a = ANY($1) OR p.b = ANY($1))' : ''}
     ORDER BY p.a, p.b`, vesselIds ? [vesselIds] : [])
  const out = []
  const used = new Set()
  for (const r of rows) {
    // Fuller record kept: more claims, then the older record.
    const aFirst = r.a_n > r.b_n || (r.a_n === r.b_n && new Date(r.a_at) <= new Date(r.b_at))
    const keep = aFirst ? r.a : r.b, merge = aFirst ? r.b : r.a
    // One merge per record per run: chains (A~B~C) settle over repeated runs, each step checked again.
    if (used.has(keep) || used.has(merge)) continue
    used.add(keep); used.add(merge)
    out.push({ keep, merge, mmsi: r.mmsi, keep_claims: aFirst ? r.a_n : r.b_n, merge_claims: aFirst ? r.b_n : r.a_n })
    if (limit && out.length >= limit) break
  }
  return out
}

/** Merge one record into another inside the caller's transaction `c`. Returns what moved. */
export async function mergeVessel(c, S, { keep, merge, mmsi }) {
  const { rows: vs } = await c.query(`SELECT id::text, status FROM ${S}.vessels WHERE id = ANY($1::uuid[]) FOR UPDATE`, [[keep, merge]])
  if (vs.length !== 2 || vs.some((v) => v.status !== 'active')) return { skipped: 'not both active' }
  // Read the links first: an UPDATE … RETURNING would report them already 'superseded'.
  const { rows: moved } = await c.query(
    `SELECT id, source_entity_id, status, method, evidence, confidence, decided_by FROM ${S}.entity_links
      WHERE vessel_id = $1 AND status IN ('accepted', 'candidate') FOR UPDATE`, [merge])
  await c.query(`UPDATE ${S}.entity_links SET status = 'superseded', superseded_at = now() WHERE id = ANY($1)`, [moved.map((m) => m.id)])
  const evidence = { merged_from: merge, mmsi: mmsi ?? null, rule: MERGE_RULE }
  let links = 0
  for (const l of moved.filter((m) => m.status === 'accepted')) {
    const manual = !String(l.decided_by).startsWith('resolver:')
    await c.query(`INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, confidence, decided_by)
                   VALUES ($1, $2, 'accepted', $3, $4, $5, $6)`,
      [l.source_entity_id, keep, manual ? l.method : 'MMSI_TEMPORAL', manual ? { ...l.evidence, ...evidence } : evidence, manual ? l.confidence : null, manual ? l.decided_by : RESOLVER])
    links++
  }
  // The moved entities' candidate links to the kept record are now answered.
  await c.query(`UPDATE ${S}.entity_links SET status = 'superseded', superseded_at = now()
                  WHERE status = 'candidate' AND vessel_id = $1 AND source_entity_id = ANY($2)`, [keep, moved.map((m) => m.source_entity_id)])
  await c.query(`UPDATE ${S}.vessels SET status = 'merged', merged_into = $2, needs_review = false,
                        note = concat_ws(' · ', note, $3::text) WHERE id = $1`, [merge, keep, `merged into ${keep} (${MERGE_RULE})`])
  // The kept record still needs review only if some other record may still be it.
  const { rows: [left] } = await c.query(
    `SELECT EXISTS (SELECT 1 FROM ${S}.entity_links l JOIN ${S}.entity_links a ON a.source_entity_id = l.source_entity_id AND a.status = 'accepted'
                     JOIN ${S}.vessels o ON o.id = a.vessel_id AND o.status = 'active'
                     WHERE l.vessel_id = $1 AND l.status = 'candidate' AND a.vessel_id <> $1)
         OR EXISTS (SELECT 1 FROM ${S}.entity_links l JOIN ${S}.vessels o ON o.id = l.vessel_id AND o.status = 'active'
                     WHERE l.status = 'candidate' AND l.vessel_id <> $1
                       AND l.source_entity_id IN (SELECT source_entity_id FROM ${S}.entity_links WHERE vessel_id = $1 AND status = 'accepted')) AS open`, [keep])
  await c.query(`UPDATE ${S}.vessels SET needs_review = $2 WHERE id = $1`, [keep, left.open])
  return { keep, merge, links_moved: links, keep_still_needs_review: left.open }
}
