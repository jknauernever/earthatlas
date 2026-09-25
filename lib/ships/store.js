/**
 * Persisting source evidence: sources, import runs, source entities, raw
 * records and assertions. Every write is idempotent, so re-importing the same
 * payload changes only the last_* bookkeeping columns.
 */
import { createHash } from 'node:crypto'
import { rangeLiteral } from './normalize.js'

/** JSON with sorted keys, so one payload always hashes the same. */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}
export const sha256 = (s) => createHash('sha256').update(s).digest('hex')

export async function upsertSource(c, S, src) {
  await c.query(
    `INSERT INTO ${S}.sources (id, name, publisher, homepage_url, license, license_url,
       commercial_use, attribution_text, attribution_url, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, publisher = EXCLUDED.publisher,
       homepage_url = EXCLUDED.homepage_url, license = EXCLUDED.license, license_url = EXCLUDED.license_url,
       commercial_use = EXCLUDED.commercial_use, attribution_text = EXCLUDED.attribution_text,
       attribution_url = EXCLUDED.attribution_url, notes = EXCLUDED.notes`,
    [src.id, src.name, src.publisher, src.homepage_url, src.license, src.license_url,
      src.commercial_use, src.attribution_text, src.attribution_url, src.notes])
}

export async function startRun(c, S, sourceId, params) {
  const { rows } = await c.query(
    `INSERT INTO ${S}.import_runs (source_id, params) VALUES ($1, $2) RETURNING id`, [sourceId, params])
  return rows[0].id
}

export async function finishRun(c, S, runId, { status, stats, datasetVersion, error }) {
  await c.query(
    `UPDATE ${S}.import_runs SET finished_at = now(), status = $2, stats = $3,
       dataset_version = coalesce($4, dataset_version), error = $5 WHERE id = $1`,
    [runId, status, stats, datasetVersion ?? null, error ?? null])
}

/**
 * Find or create the source entity for a payload.
 * `refs` are sub-record ids that identify it, and `refClass` is the evidence
 * class those refs appear under (GFW: registry refs, or AIS ids for AIS-only
 * entries). Matching only within that class keeps AIS-only and registry-backed
 * entries from swallowing each other. A payload sharing refs with exactly one
 * existing entity attaches to it, even if its anchor key has changed. One
 * sharing refs with several entities means the source regrouped them: it gets
 * its own entity, flagged `regrouped`, and the resolver leaves the conflict
 * for review.
 */
export async function findOrCreateEntity(c, S, { sourceId, kind, anchor, refs = [], refClass = null }) {
  const { rows: hits } = await c.query(
    `SELECT DISTINCT se.id FROM ${S}.source_entities se
      WHERE se.source_id = $1 AND se.entity_kind = $2
        AND (se.entity_key = $3 OR EXISTS (
              SELECT 1 FROM ${S}.assertions a
               WHERE a.source_entity_id = se.id AND a.evidence_class = $5 AND a.sub_record_ref = ANY($4)))`,
    [sourceId, kind, anchor, refs, refClass])
  const memberRefs = refs
  if (hits.length === 1) {
    await c.query(`UPDATE ${S}.source_entities SET last_seen_at = now() WHERE id = $1`, [hits[0].id])
    return { id: hits[0].id, created: false, regrouped: false }
  }
  const key = hits.length > 1 ? `regroup:${sha256([...memberRefs].sort().join('|')).slice(0, 24)}` : anchor
  const { rows } = await c.query(
    `INSERT INTO ${S}.source_entities (source_id, entity_kind, entity_key) VALUES ($1,$2,$3)
     ON CONFLICT (source_id, entity_kind, entity_key) DO UPDATE SET last_seen_at = now()
     RETURNING id, (xmax = 0) AS created`, [sourceId, kind, key])
  return { id: rows[0].id, created: rows[0].created, regrouped: hits.length > 1, overlapsWith: hits.map((h) => h.id) }
}

export async function upsertRecord(c, S, { sourceId, entityId, payload, datasetVersion, retrievalUrl, runId }) {
  const hash = sha256(canonicalJson(payload))
  const { rows } = await c.query(
    `INSERT INTO ${S}.source_records (source_id, source_entity_id, payload, payload_sha256, dataset_version,
       retrieval_url, first_import_run_id, last_import_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT (source_entity_id, payload_sha256) DO UPDATE
       SET last_import_run_id = EXCLUDED.last_import_run_id, last_retrieved_at = now()
     RETURNING id, (xmax = 0) AS created`,
    [sourceId, entityId, payload, hash, datasetVersion ?? null, retrievalUrl ?? null, runId ?? null])
  return rows[0]
}

/**
 * Upsert all assertions of one record in a single statement.
 * - A claim seen again: last_* updated. A 'superseded' claim the source restates
 *   is re-activated. 'disputed' and 'rejected' are manual decisions and are
 *   left alone.
 * - A claim this entity's newest record no longer contains: 'superseded'
 *   (the source restated itself). It is never deleted.
 */
export async function upsertAssertions(c, S, { entityId, recordId, assertions }) {
  const rows = assertions.map((a) => ({
    attribute: a.attribute, value_raw: a.value_raw, value_norm: a.value_norm,
    period: rangeLiteral(a.period_from, a.period_to, a.period_kind), period_kind: a.period_kind,
    evidence_class: a.evidence_class, sub_record_ref: a.sub_record_ref ?? '', detail: a.detail ?? {},
  }))
  const { rows: res } = await c.query(
    `INSERT INTO ${S}.assertions AS t (source_entity_id, attribute, value_raw, value_norm, period, period_kind,
       evidence_class, sub_record_ref, detail, first_source_record_id, last_source_record_id)
     SELECT $1, r.attribute, r.value_raw, r.value_norm, r.period::tstzrange, r.period_kind,
            r.evidence_class, r.sub_record_ref, r.detail, $2, $2
       FROM jsonb_to_recordset($3::jsonb) AS r(attribute text, value_raw text, value_norm text, period text,
            period_kind text, evidence_class text, sub_record_ref text, detail jsonb)
     ON CONFLICT ON CONSTRAINT assertions_claim_uniq DO UPDATE
       SET last_source_record_id = EXCLUDED.last_source_record_id, last_seen_at = now(),
           detail = EXCLUDED.detail,
           status = CASE WHEN t.status = 'superseded' THEN 'active' ELSE t.status END
     RETURNING (xmax = 0) AS created`,
    [entityId, recordId, JSON.stringify(dedupeClaims(rows))])
  const { rowCount: superseded } = await c.query(
    `UPDATE ${S}.assertions SET status = 'superseded'
      WHERE source_entity_id = $1 AND status = 'active' AND last_source_record_id <> $2`,
    [entityId, recordId])
  return { created: res.filter((r) => r.created).length, seen: res.filter((r) => !r.created).length, superseded }
}

/** One statement can't touch the same conflict key twice; the source may repeat a claim. */
function dedupeClaims(rows) {
  const seen = new Map()
  for (const r of rows) {
    const k = [r.attribute, r.value_raw, r.period, r.period_kind, r.evidence_class, r.sub_record_ref].join('\u0001')
    if (!seen.has(k)) seen.set(k, r)
  }
  return [...seen.values()]
}
