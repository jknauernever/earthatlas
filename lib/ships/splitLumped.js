/**
 * B2, split vessel records that lump different boats together (Josh 2026-10-20, option A). A record is "lumped" when it holds
 * two or more USCG / Canadian official numbers (lib/ships/matchRules.js DOC_SCHEMES) or registry IMOs. Most such records are
 * ONE boat whose owner typed the number differently on a later radio licence (MOLAMOLA, SOMERLED), so a different number alone
 * never splits. A record splits only when its numbers fall into groups that each broadcast on their OWN MMSI:
 *
 *   1. Registry entries (FCC licences, PSIX, TC) that share an official number form one id group.
 *   2. A group's MMSIs = those of its single-MMSI members (a licence names one MMSI; an entry with several MMSIs is mixed).
 *      Groups whose MMSIs overlap are one boat and join. A group with no MMSI can't be told apart: it stays with the kept one.
 *   3. Fewer than two groups with MMSIs → no split (the record goes on the manual list with the reason).
 *   4. Every other entry joins the one group holding all its MMSIs (or, with no MMSI, its call signs); one that fits no group
 *      or several (e.g. a GFW entry that itself mixes hulls) is mixed and stays with the kept record.
 *   5. The group with the most claims (then the oldest entry) keeps the vessel id. Each other group moves to the one other
 *      active record already holding its number, or else to a new record; two or more holders → that group stays put.
 *
 * Interpretation only (src/ships/CLAUDE.md): no claim or raw record is touched. Moved entries' accepted links are superseded
 * and re-made on the target (a manual decision keeps its own method and decider), exactly like lib/ships/mergeSplits.js, so
 * the superseded links (evidence.split_from) say what moved and the split is reversible. Nothing is deleted.
 */
import { DOC_SCHEMES, isBlankMmsi } from './matchRules.js'
import { refreshReview } from './mergeSplits.js'
import { realCallsignSql } from './normalize.js'
import { RESOLVER } from './resolve.js'

export const SPLIT_RULE = 'B2: the record held two registry ids (official number or IMO) whose licences broadcast on different MMSIs; each is its own boat'

const IDS_SQL = (S, v) => `
  SELECT ${v}.vessel_id::text AS v,
         array_agg(DISTINCT (${v}.detail->>'scheme') || ':' || ${v}.value_norm) FILTER (WHERE ${v}.attribute = 'official_number') AS docs,
         array_agg(DISTINCT ${v}.value_norm) FILTER (WHERE ${v}.attribute = 'imo') AS imos
    FROM ${S}.vessel_assertions ${v}
   WHERE ${v}.evidence_class = 'registry'
     AND ((${v}.attribute = 'official_number' AND ${v}.detail->>'scheme' = ANY($1))
       OR (${v}.attribute = 'imo' AND (${v}.detail->>'checksum_ok')::boolean))`

/** Active records holding 2+ official numbers of one scheme or 2+ registry IMOs: [{ id, docs, imos }], oldest first. */
export async function findLumped(q, S, { vesselIds = null } = {}) {
  const rows = await q(`
    WITH ids AS (${IDS_SQL(S, 'va')} ${vesselIds ? 'AND va.vessel_id = ANY($2::uuid[])' : ''} GROUP BY va.vessel_id)
    SELECT ids.v AS id, coalesce(ids.docs, '{}') AS docs, coalesce(ids.imos, '{}') AS imos
      FROM ids JOIN ${S}.vessels v ON v.id = ids.v::uuid AND v.status = 'active'
     ORDER BY v.created_at, ids.v`, vesselIds ? [DOC_SCHEMES, vesselIds] : [DOC_SCHEMES])
  const perScheme = (docs) => Math.max(0, ...DOC_SCHEMES.map((s) => docs.filter((d) => d.startsWith(`${s}:`)).length))
  return rows.filter((r) => perScheme(r.docs) > 1 || r.imos.length > 1)
}

/** One record's accepted entries with the identity facts the split needs. `c` = a client or { query } (pool). */
export async function loadEntries(c, S, vesselId, { lock = false } = {}) {
  const fact = (where) => `array(SELECT DISTINCT a.value_norm FROM ${S}.assertions a WHERE a.source_entity_id = l.source_entity_id AND a.status = 'active' AND ${where})`
  const { rows } = await c.query(`
    SELECT l.id::text AS link_id, l.source_entity_id::text AS entity, se.source_id, l.method, l.evidence, l.confidence, l.decided_by,
           (SELECT count(*) FROM ${S}.assertions a WHERE a.source_entity_id = l.source_entity_id AND a.status = 'active')::int AS claims,
           array(SELECT DISTINCT (a.detail->>'scheme') || ':' || a.value_norm FROM ${S}.assertions a
                  WHERE a.source_entity_id = l.source_entity_id AND a.status = 'active' AND a.attribute = 'official_number'
                    AND a.evidence_class = 'registry' AND a.detail->>'scheme' = ANY($2)) AS docs,
           ${fact(`a.attribute = 'imo' AND a.evidence_class = 'registry' AND (a.detail->>'checksum_ok')::boolean`)} AS imos,
           ${fact(`a.attribute = 'mmsi' AND a.evidence_class <> 'community_curated'`)} AS mmsis,
           ${fact(`a.attribute = 'callsign' AND a.evidence_class <> 'community_curated' AND ${realCallsignSql('a.value_norm')}`)} AS callsigns,
           ${fact(`a.attribute = 'name' AND a.value_norm <> '' AND a.evidence_class <> 'community_curated'`)} AS names
      FROM ${S}.entity_links l JOIN ${S}.source_entities se ON se.id = l.source_entity_id
     WHERE l.vessel_id = $1 AND l.status = 'accepted'
     ORDER BY l.source_entity_id ${lock ? 'FOR UPDATE OF l' : ''}`, [vesselId, DOC_SCHEMES])
  return rows.map((r) => ({ ...r, mmsis: r.mmsis.filter((m) => !isBlankMmsi(m)) }))
}

/**
 * Pure: how one record's entries split. `entries` = loadEntries rows ({ entity, claims, docs, imos, mmsis, callsigns }).
 * Returns { split: false, reason } or { split: true, keep: { entities, docs, mmsis }, moves: [{ entities, docs, imos, mmsis }],
 * mixed: [entity] } (mixed entries stay with the kept group).
 */
export function planSplit(entries) {
  const byId = new Map(entries.map((e) => [e.entity, e]))
  // 1. Id groups: union entries sharing an official number (union-find over entity ids).
  const parent = new Map()
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra) }
  const anchors = entries.filter((e) => e.docs.length)
  for (const e of anchors) parent.set(e.entity, e.entity)
  const holder = new Map()
  for (const e of anchors) for (const d of e.docs) holder.has(d) ? union(holder.get(d), e.entity) : holder.set(d, e.entity)
  // 2. Groups whose single-MMSI members share an MMSI are one boat.
  const groupMmsis = () => {
    const m = new Map()
    for (const e of anchors) { const r = find(e.entity); if (!m.has(r)) m.set(r, new Set()); if (e.mmsis.length === 1) m.get(r).add(e.mmsis[0]) }
    return m
  }
  let gm = groupMmsis()
  const idGroups = gm.size
  const seen = new Map()
  for (const [r, ms] of gm) for (const x of ms) seen.has(x) ? union(seen.get(x), r) : seen.set(x, r)
  gm = groupMmsis()
  const withMmsi = [...gm].filter(([, ms]) => ms.size)
  if (withMmsi.length < 2) {
    return { split: false, reason: idGroups < 2 ? 'one entry carries all its numbers' : gm.size < 2 ? 'every number broadcast on the same MMSI: a typo or a re-licence, not proven two boats'
      : 'only one number has an MMSI: not proven two boats' }
  }
  // Groups: root → { entities, mmsis, callsigns }; id groups with no MMSI become mixed (they stay with the kept group).
  const groups = new Map(withMmsi.map(([r, ms]) => [r, { entities: [], mmsis: ms, callsigns: new Set() }]))
  const mixed = []
  for (const e of anchors) {
    const g = groups.get(find(e.entity))
    if (!g) { mixed.push(e.entity); continue }
    g.entities.push(e.entity); for (const c of e.callsigns) g.callsigns.add(c)
  }
  // 4. Every other entry joins the one group holding all its MMSIs (none: all its call signs); else it is mixed.
  for (const e of entries.filter((x) => !x.docs.length)) {
    const fits = [...groups.values()].filter((g) => (e.mmsis.length ? e.mmsis.every((m) => g.mmsis.has(m))
      : e.callsigns.length && e.callsigns.every((c) => g.callsigns.has(c))))
    if (fits.length === 1) fits[0].entities.push(e.entity)
    else mixed.push(e.entity)
  }
  // 5. Most claims keeps the id (then the oldest entry: lowest entity id).
  const claims = (g) => g.entities.reduce((n, id) => n + byId.get(id).claims, 0)
  const oldest = (g) => Math.min(...g.entities.map(Number))
  const order = [...groups.values()].sort((a, b) => claims(b) - claims(a) || oldest(a) - oldest(b))
  const describe = (g) => ({
    entities: g.entities,
    docs: [...new Set(g.entities.flatMap((id) => byId.get(id).docs))].sort(),
    imos: [...new Set(g.entities.flatMap((id) => byId.get(id).imos))].sort(),
    mmsis: [...g.mmsis].sort(),
    names: [...new Set(g.entities.flatMap((id) => byId.get(id).names || []))].sort(),
  })
  return { split: true, keep: { ...describe(order[0]), entities: [...order[0].entities, ...mixed] }, moves: order.slice(1).map(describe), mixed }
}

/**
 * Plan one record (read-only): the split plus each move's target, i.e. the one other active record already holding the
 * group's number (`into`), a new record (`into: null`), or `stays` when several records hold it.
 */
export async function planVessel(c, S, vesselId) {
  const entries = await loadEntries(c, S, vesselId)
  const plan = { vessel: vesselId, names: [...new Set(entries.flatMap((e) => e.names))].sort(), ...planSplit(entries) }
  if (!plan.split) return plan
  for (const m of plan.moves) {
    const { rows } = await c.query(`
      SELECT DISTINCT va.vessel_id::text AS v FROM ${S}.vessel_assertions va JOIN ${S}.vessels v ON v.id = va.vessel_id AND v.status = 'active'
       WHERE va.vessel_id <> $1 AND va.evidence_class = 'registry'
         AND ((va.attribute = 'official_number' AND (va.detail->>'scheme') || ':' || va.value_norm = ANY($2))
           OR (va.attribute = 'imo' AND (va.detail->>'checksum_ok')::boolean AND va.value_norm = ANY($3)))`, [vesselId, m.docs, m.imos])
    if (rows.length > 1) m.stays = `${rows.length} other records hold this number`
    m.into = rows.length === 1 ? rows[0].v : null
  }
  return plan
}

/** Carry out one planned split inside the caller's transaction `c`. Returns what moved. */
export async function applySplit(c, S, plan, { rule = SPLIT_RULE } = {}) {
  const { rows: [v] } = await c.query(`SELECT status FROM ${S}.vessels WHERE id = $1 FOR UPDATE`, [plan.vessel])
  if (v?.status !== 'active') return { skipped: 'not active' }
  // Re-check under lock: the record must still hold exactly the planned entries, or nothing moves.
  const now = await loadEntries(c, S, plan.vessel, { lock: true })
  const planned = [...plan.keep.entities, ...plan.moves.flatMap((m) => m.entities)].sort()
  if (now.map((e) => e.entity).sort().join() !== planned.join()) return { skipped: 'record changed since it was planned' }
  const links = new Map(now.map((e) => [e.entity, e]))
  const out = { vessel: plan.vessel, moves: [] }
  for (const m of plan.moves.filter((x) => !x.stays)) {
    let into = m.into
    if (into) {
      const { rows: [t] } = await c.query(`SELECT status FROM ${S}.vessels WHERE id = $1 FOR UPDATE`, [into])
      if (t?.status !== 'active') return { skipped: `target ${into} is no longer active` }
    } else {
      ({ rows: [{ id: into }] } = await c.query(`INSERT INTO ${S}.vessels (note) VALUES ($1) RETURNING id::text`, [`split from ${plan.vessel} (${rule})`]))
    }
    const moved = m.entities.map((id) => links.get(id))
    await c.query(`UPDATE ${S}.entity_links SET status = 'superseded', superseded_at = now() WHERE id = ANY($1::bigint[])`, [moved.map((l) => l.link_id)])
    const evidence = { split_from: plan.vessel, rule, docs: m.docs, mmsis: m.mmsis }
    for (const l of moved) {
      const manual = !String(l.decided_by).startsWith('resolver:')
      await c.query(`INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, confidence, decided_by)
                     VALUES ($1, $2, 'accepted', $3, $4, $5, $6)`,
        [l.entity, into, l.method, { ...l.evidence, ...evidence }, l.confidence, manual ? l.decided_by : RESOLVER])
    }
    // The moved entries' candidate links to their new record are now answered.
    await c.query(`UPDATE ${S}.entity_links SET status = 'superseded', superseded_at = now()
                    WHERE status = 'candidate' AND vessel_id = $1 AND source_entity_id = ANY($2::bigint[])`, [into, m.entities])
    out.moves.push({ into, created: !m.into, entities: m.entities, docs: m.docs, mmsis: m.mmsis })
  }
  if (!out.moves.length) return { skipped: 'every group stays (number held by several records)' }
  await c.query(`UPDATE ${S}.vessels SET note = concat_ws(' · ', note, $2::text) WHERE id = $1`,
    [plan.vessel, `split: ${out.moves.map((m) => `${m.docs.join('/') || m.mmsis.join('/')} → ${m.into}`).join('; ')} (${rule})`])
  out.keep_needs_review = await refreshReview(c, S, plan.vessel)
  for (const m of out.moves) m.needs_review = await refreshReview(c, S, m.into)
  return out
}
