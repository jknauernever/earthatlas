/**
 * Vessel incidents: storage + conservative vessel matching (docs/SHIP_INCIDENT_SOURCES.md §13).
 *
 *   evidence        source_records: the raw payload exactly as received
 *   claim           incident_events + incident_vessel_refs: what the source says happened and
 *                   how it names each vessel (its own identifiers, verbatim)
 *   interpretation  incident_links: which EarthAtlas vessel a ref is (accepted | candidate)
 *
 * Source mappers (incidentsCgmix.js, incidentsEcology.js, incidentsNames.js) are pure and
 * return { source, entityKind, key, payload, datasetVersion, event, refs }. This module
 * persists them idempotently and matches the refs. Incident data never becomes a vessel
 * attribute, and nothing here edits assertions or entity_links.
 */
import { normName, normImo, normMmsi, normCallsign, rangeLiteral } from './normalize.js'
import { findOrCreateEntity, upsertRecord, upsertSource, canonicalJson, sha256 } from './store.js'
import { withTx } from './db.js'

export const MATCHER = 'incidents:v1'

// ── Shared vocabulary (pure) ─────────────────────────────────────────────────

/** Normalized event types from the source's own wording (titles, subtypes, categories). */
const TYPE_RULES = [
  [/aground|grounding/i, 'grounding'], [/allision/i, 'allision'], [/collision/i, 'collision'],
  [/\bfire\b|burn/i, 'fire'], [/explosion/i, 'explosion'], [/flood/i, 'flooding'], [/sink|sank|sunk/i, 'sinking'],
  [/capsiz/i, 'capsize'], [/\bLOP\b|loss of propulsion|propulsion/i, 'loss_of_propulsion'],
  [/loss of steering|steering/i, 'loss_of_steering'], [/loss of (electrical )?power|blackout/i, 'loss_of_power'],
  [/equipment failure|machinery|mechanical/i, 'equipment_failure'], [/pollution|discharge|spill|sheen|oil/i, 'spill'],
  [/injur|loss of life|fatal|death|died/i, 'injury_or_death'], [/man overboard|person in the water|\bPIW\b/i, 'person_overboard'],
  [/disabled|adrift/i, 'disabled'], [/wake/i, 'wake_damage'], [/structural|hull failure/i, 'structural_failure'],
]
export function typesFromText(...texts) {
  const s = texts.filter(Boolean).join(' | ')
  const out = []
  for (const [re, t] of TYPE_RULES) if (re.test(s) && !out.includes(t)) out.push(t)
  return out
}

/** Roles, from the source's wording. */
export function roleFromText(raw) {
  const s = String(raw ?? '')
  if (/vicinity/i.test(s)) return 'other'
  if (/pollution source|responsible|subject of investigation|violation|suspected/i.test(s)) return 'responsible'
  if (/involved in a marine casualty|subject of search|distress|primary subject/i.test(s)) return 'subject'
  if (/assist|response|rescue vessel/i.test(s)) return 'assisting'
  return 'involved'
}

/**
 * CGMIX (IIR / PSIX) timestamps carry a -04:00 / -05:00 offset, but the wall-clock
 * value is UTC (verified on 4 IIR cases against the narratives' local times:
 * docs/SHIP_INCIDENT_SOURCES.md §1). Returns the UTC instant from the wall clock,
 * or null when the value is not a CGMIX-shaped timestamp.
 */
export function cgmixUtc(raw) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2}:\d{2}|Z)?$/.exec(String(raw ?? '').trim())
  if (!m) return null
  const t = new Date(`${m[1]}Z`)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

// ── Matching (pure; unit-tested) ─────────────────────────────────────────────

/** Methods strong enough to accept a link automatically. Everything else is a candidate. */
export const ACCEPT_METHODS = new Set(['USCG_VESSEL_ID', 'IMO_EXACT', 'IMO_AIS_NAME', 'OFFICIAL_NUMBER_NAME', 'MMSI_NAME'])

/**
 * Decide one vessel ref's link.
 * @param {object} f
 * @param {string|null} f.acceptedVesselId  already accepted (never moved)
 * @param {boolean} f.nameOnly              the source gives no identifier (NRC, IncidentNews, Ecology)
 * @param {{vesselId:string, method:string, evidence:object}[]} f.strong  identifier matches (ACCEPT_METHODS)
 * @param {{vesselId:string, method:string, evidence:object}[]} f.candidates
 * Rules: a name-only source NEVER accepts. Strong matches accept only when they all point
 * at exactly one vessel; two different vessels → unresolved with every match as a candidate.
 */
export function decideRef(f) {
  const cands = []
  const add = (c) => {
    if (c.vesselId === f.acceptedVesselId) return
    if (!cands.some((x) => x.vesselId === c.vesselId && x.method === c.method)) cands.push(c)
  }
  const strong = f.nameOnly ? [] : (f.strong || []).filter((m) => ACCEPT_METHODS.has(m.method))
  // A name-only source's "strong" match is demoted (defence in depth; mappers never produce one).
  if (f.nameOnly) for (const m of f.strong || []) add({ ...m, method: 'NAME_DATE_PLACE', evidence: { ...m.evidence, demoted_from: m.method } })
  for (const c of f.candidates || []) add(c)
  if (f.acceptedVesselId) return { action: 'keep', vesselId: f.acceptedVesselId, candidates: cands }
  const targets = [...new Set(strong.map((m) => m.vesselId))]
  if (targets.length === 1) {
    const best = strong.find((m) => m.vesselId === targets[0])
    return { action: 'accept', vesselId: targets[0], method: best.method, evidence: { matches: strong.map((m) => ({ method: m.method, ...m.evidence })) },
      candidates: cands.filter((c) => c.vesselId !== targets[0]) }
  }
  for (const m of strong) add({ ...m, evidence: { ...m.evidence, conflict: 'identifiers point at different vessels' } })
  return { action: 'unresolved', reason: targets.length > 1 ? 'identifiers_disagree' : cands.length ? 'candidates_only' : 'no_match', candidates: cands }
}

/** Ref identifiers, normalized. */
export function refIdentifiers(ref) {
  const imo = ref.imo_raw ? normImo(ref.imo_raw) : null
  const mmsi = ref.mmsi_raw ? normMmsi(ref.mmsi_raw) : null
  const on = String(ref.official_number_raw ?? '').trim()
  const onNorm = ref.official_number_scheme === 'us_official_number' ? on.replace(/\D/g, '').replace(/^0+/, '')
    : ref.official_number_scheme === 'ca_official_number' ? on.replace(/\.0+$/, '') : normName(on)
  return {
    name: normName(ref.name_raw),
    imo: imo?.valid ? imo.value : null,
    mmsi: mmsi?.valid && mmsi.ship ? mmsi.value : null,
    callsign: ref.callsign_raw ? normCallsign(ref.callsign_raw) : null,
    official: on ? { scheme: ref.official_number_scheme, value: onNorm } : null,
    uscgId: ref.uscg_vessel_id ? String(ref.uscg_vessel_id).trim() : null,
  }
}

// ── Matching (DB facts) ──────────────────────────────────────────────────────

const NAME_CANDIDATE_MAX = 3

async function namesOf(c, S, vesselIds) {
  if (!vesselIds.length) return {}
  const { rows } = await c.query(
    `SELECT vessel_id::text AS v, array_agg(DISTINCT value_norm) AS names FROM ${S}.vessel_assertions
      WHERE vessel_id = ANY($1) AND attribute = 'name' AND value_norm <> '' AND evidence_class <> 'community_curated'
      GROUP BY vessel_id`, [vesselIds])
  return Object.fromEntries(rows.map((r) => [r.v, new Set(r.names)]))
}

/**
 * Gather { strong, candidates } for one ref from the database.
 * - USCG vessel id → the vessel our PSIX import linked that MISLE id to (accepted link).
 * - IMO (valid checksum) → exactly one holder; a registry-held IMO accepts (IMO_EXACT), an
 *   AIS-only IMO needs the name too (IMO_AIS_NAME). A number whose type the source does not
 *   state (IIR "primary identification number") also needs the name.
 * - Official number (same scheme) + name → OFFICIAL_NUMBER_NAME; number without the name → candidate.
 * - MMSI held at the event time (observed windows) + name, and it is the only vessel then → MMSI_NAME;
 *   otherwise MMSI_TEMPORAL candidates (incl. the same MMSI + name outside our observed window).
 * - Call sign + name → CALLSIGN_NAME candidate only.
 * - Name only → NAME_DATE_PLACE candidates (≤ 3 vessels), never accepted.
 */
export async function gatherRefMatches(c, S, ref, { at = null, nameOnly = false, place = null } = {}) {
  const id = refIdentifiers(ref)
  const strong = [], candidates = []
  const typeUnstated = ref.detail?.primary_id_type === 'unstated'
  if (!nameOnly) {
    if (id.uscgId) {
      const { rows } = await c.query(
        `SELECT l.vessel_id::text AS v FROM ${S}.source_entities se
           JOIN ${S}.entity_links l ON l.source_entity_id = se.id AND l.status = 'accepted'
          WHERE se.source_id = 'uscg-psix' AND se.entity_kind = 'psix_vessel' AND se.entity_key = $1`, [id.uscgId])
      for (const r of rows) strong.push({ vesselId: r.v, method: 'USCG_VESSEL_ID', evidence: { uscg_vessel_id: id.uscgId, via: 'uscg-psix entity accepted link' } })
    }
    if (id.imo) {
      const { rows } = await c.query(
        `SELECT vessel_id::text AS v, bool_or(evidence_class = 'registry') AS registry FROM ${S}.vessel_assertions
          WHERE attribute = 'imo' AND value_norm = $1 AND (detail->>'checksum_ok')::boolean
            AND evidence_class <> 'community_curated' GROUP BY vessel_id`, [id.imo])
      const names = await namesOf(c, S, rows.map((r) => r.v))
      for (const r of rows) {
        const nameOk = !!id.name && !!names[r.v]?.has(id.name)
        const ev = { imo: id.imo, holder_basis: r.registry ? 'registry' : 'ais', name_agrees: nameOk, holders: rows.length,
          ...(typeUnstated ? { number_type: 'unstated by source (IMO or official number); name required' } : {}) }
        if (rows.length === 1 && r.registry && (!typeUnstated || nameOk)) strong.push({ vesselId: r.v, method: 'IMO_EXACT', evidence: ev })
        else if (rows.length === 1 && nameOk) strong.push({ vesselId: r.v, method: 'IMO_AIS_NAME', evidence: ev })
        else candidates.push({ vesselId: r.v, method: 'IMO_AMBIGUOUS', evidence: { ...ev, reason: rows.length > 1 ? 'IMO on several vessels' : 'AIS-only IMO and the name differs' } })
      }
    }
    if (id.official?.value && id.official.scheme) {
      const { rows } = await c.query(
        `SELECT DISTINCT vessel_id::text AS v FROM ${S}.vessel_assertions
          WHERE attribute = 'official_number' AND value_norm = $1 AND detail->>'scheme' = $2 AND evidence_class = 'registry'`,
        [id.official.value, id.official.scheme])
      const names = await namesOf(c, S, rows.map((r) => r.v))
      for (const r of rows) {
        const nameOk = !!id.name && !!names[r.v]?.has(id.name)
        const ev = { official_number: id.official.value, scheme: id.official.scheme, name_agrees: nameOk, holders: rows.length }
        if (nameOk && rows.length === 1) strong.push({ vesselId: r.v, method: 'OFFICIAL_NUMBER_NAME', evidence: ev })
        else candidates.push({ vesselId: r.v, method: 'OFFICIAL_NUMBER', evidence: { ...ev, reason: nameOk ? 'number on several vessels' : 'name differs' } })
      }
    }
    if (id.mmsi) {
      const atTime = at ? (await c.query(`SELECT DISTINCT vessel_id::text AS v FROM ${S}.vessels_for_mmsi_at($1, $2)`, [id.mmsi, at])).rows.map((r) => r.v) : []
      const anyTime = (await c.query(
        `SELECT DISTINCT vessel_id::text AS v FROM ${S}.vessel_assertions WHERE attribute = 'mmsi' AND value_norm = $1`, [id.mmsi])).rows.map((r) => r.v)
      const names = await namesOf(c, S, anyTime)
      for (const v of anyTime) {
        const nameOk = !!id.name && !!names[v]?.has(id.name)
        const covered = atTime.includes(v)
        const ev = { mmsi: id.mmsi, at, window_covers_event: covered, name_agrees: nameOk, vessels_with_mmsi_at_event: atTime.length }
        if (covered && nameOk && atTime.length === 1) strong.push({ vesselId: v, method: 'MMSI_NAME', evidence: ev })
        else if (covered || nameOk) candidates.push({ vesselId: v, method: 'MMSI_TEMPORAL', evidence: { ...ev,
          reason: !covered ? 'our observed MMSI window does not cover the event time' : !nameOk ? 'name differs' : 'several vessels held this MMSI then' } })
      }
    }
    if (id.callsign && id.name) {
      const { rows } = await c.query(
        `SELECT DISTINCT cs.vessel_id::text AS v FROM ${S}.vessel_assertions cs
           JOIN ${S}.vessel_assertions n ON n.vessel_id = cs.vessel_id AND n.attribute = 'name' AND n.value_norm = $2
                AND n.evidence_class <> 'community_curated'
          WHERE cs.attribute = 'callsign' AND cs.value_norm = $1 AND cs.evidence_class <> 'community_curated'`, [id.callsign, id.name])
      for (const r of rows) candidates.push({ vesselId: r.v, method: 'CALLSIGN_NAME', evidence: { callsign: id.callsign, name: id.name, reason: 'call sign + name only; never accepted automatically' } })
    }
  }
  // Name only: when nothing identifying matched (or the source has nothing else).
  if (!strong.length && !candidates.length && id.name.length >= 4) {
    const { rows } = await c.query(
      `SELECT DISTINCT vessel_id::text AS v FROM ${S}.vessel_assertions
        WHERE attribute = 'name' AND value_norm = $1 AND evidence_class <> 'community_curated' LIMIT ${NAME_CANDIDATE_MAX + 1}`, [id.name])
    if (rows.length && rows.length <= NAME_CANDIDATE_MAX) {
      for (const r of rows) candidates.push({ vesselId: r.v, method: 'NAME_DATE_PLACE', evidence: { name: id.name, event_at: at, place,
        vessels_with_name: rows.length, reason: 'same name only; a different boat can share it. Never accepted automatically.' } })
    }
  }
  return { strong, candidates }
}

// ── Persistence ──────────────────────────────────────────────────────────────

const EVENT_COLS = ['event_kinds', 'event_types', 'event_type_raw', 'title', 'period_kind', 'time_raw', 'time_quality',
  'lat', 'lon', 'location_text', 'position_quality', 'severity_raw', 'severity_rank', 'deaths', 'injuries', 'missing',
  'material', 'quantity', 'quantity_unit', 'quantity_to_water', 'narrative', 'report_url', 'report_ref', 'evidence_class', 'detail']
const REF_COLS = ['ref_key', 'role_raw', 'role', 'name_raw', 'imo_raw', 'mmsi_raw', 'callsign_raw', 'official_number_raw',
  'official_number_scheme', 'uscg_vessel_id', 'flag_raw', 'vessel_type_raw', 'detail']

export async function ensureIncidentSources(pool, S, sources) {
  await withTx(pool, async (c) => { for (const s of sources) await upsertSource(c, S, s) })
}

/**
 * Persist one mapped event (idempotent) and match its vessel refs.
 * Same content → only last_* change. Changed content → a new version; the previous
 * active version is 'superseded' (never deleted), its refs and links stay as history.
 */
export async function ingestIncident(pool, S, m, { runId = null, retrievalUrl = null, nameOnly = false } = {}) {
  return withTx(pool, async (c) => {
    const ent = await findOrCreateEntity(c, S, { sourceId: m.source.id, kind: m.entityKind, anchor: m.key })
    const rec = await upsertRecord(c, S, { sourceId: m.source.id, entityId: ent.id, payload: m.payload,
      datasetVersion: m.datasetVersion ?? null, retrievalUrl: retrievalUrl ?? m.retrievalUrl ?? null, runId })
    const e = m.event
    const occurred = rangeLiteral(e.occurred_from ?? null, e.occurred_to ?? null, e.period_kind)
    const content = sha256(canonicalJson({ event: { ...e, occurred }, refs: m.refs }))
    const { rows: same } = await c.query(
      `SELECT id, status FROM ${S}.incident_events WHERE source_id = $1 AND source_event_key = $2 AND content_sha256 = $3`,
      [m.source.id, m.key, content])
    let eventId, created = false, superseded = 0
    if (same.length) {
      eventId = same[0].id
      if (same[0].status === 'superseded') {
        superseded = (await c.query(`UPDATE ${S}.incident_events SET status = 'superseded' WHERE source_id = $1 AND source_event_key = $2 AND status = 'active'`, [m.source.id, m.key])).rowCount
        await c.query(`UPDATE ${S}.incident_events SET status = 'active' WHERE id = $1`, [eventId])
      }
      await c.query(`UPDATE ${S}.incident_events SET last_source_record_id = $2, last_seen_at = now() WHERE id = $1`, [eventId, rec.id])
    } else {
      superseded = (await c.query(`UPDATE ${S}.incident_events SET status = 'superseded' WHERE source_id = $1 AND source_event_key = $2 AND status = 'active'`, [m.source.id, m.key])).rowCount
      const vals = EVENT_COLS.map((k) => (k === 'detail' ? (e.detail ?? {}) : e[k] ?? null))
      const { rows } = await c.query(
        `INSERT INTO ${S}.incident_events (source_id, source_entity_id, source_event_key, content_sha256, occurred,
           ${EVENT_COLS.join(', ')}, first_source_record_id, last_source_record_id)
         VALUES ($1,$2,$3,$4,$5::tstzrange, ${EVENT_COLS.map((_, i) => `$${i + 6}`).join(', ')}, $${EVENT_COLS.length + 6}, $${EVENT_COLS.length + 6})
         RETURNING id`, [m.source.id, ent.id, m.key, content, occurred, ...vals, rec.id])
      eventId = rows[0].id
      created = true
      for (const r of m.refs) {
        await c.query(
          `INSERT INTO ${S}.incident_vessel_refs (incident_event_id, ${REF_COLS.join(', ')})
           VALUES ($1, ${REF_COLS.map((_, i) => `$${i + 2}`).join(', ')}) ON CONFLICT (incident_event_id, ref_key) DO NOTHING`,
          [eventId, ...REF_COLS.map((k) => (k === 'detail' ? (r.detail ?? {}) : k === 'role' ? (r.role ?? 'involved') : r[k] ?? null))])
      }
    }
    const res = await matchEventRefs(c, S, eventId, { at: e.occurred_from ?? null, nameOnly, place: e.location_text ?? null })
    return { key: m.key, eventId, eventCreated: created, superseded, recordCreated: rec.created, ...res }
  })
}

/** (Re)match every ref of one event that has no accepted link yet. Accepted links are never moved. */
export async function matchEventRefs(c, S, eventId, { at, nameOnly, place }) {
  const { rows: refs } = await c.query(
    `SELECT r.*, (SELECT vessel_id::text FROM ${S}.incident_links l WHERE l.vessel_ref_id = r.id AND l.status = 'accepted') AS accepted
       FROM ${S}.incident_vessel_refs r WHERE r.incident_event_id = $1 ORDER BY r.id`, [eventId])
  const out = { refs: refs.length, accepted: 0, candidates: 0, unresolved: 0, methods: {}, reasons: {} }
  for (const ref of refs) {
    if (ref.accepted) { out.accepted++; continue }
    const f = await gatherRefMatches(c, S, ref, { at, nameOnly, place })
    const d = decideRef({ acceptedVesselId: null, nameOnly, ...f })
    if (d.action === 'accept') {
      await c.query(
        `INSERT INTO ${S}.incident_links (vessel_ref_id, vessel_id, status, method, evidence, decided_by)
         VALUES ($1,$2,'accepted',$3,$4,$5)`, [ref.id, d.vesselId, d.method, d.evidence, MATCHER])
      out.accepted++
      out.methods[d.method] = (out.methods[d.method] || 0) + 1
    } else {
      out.unresolved++
      out.reasons[d.reason] = (out.reasons[d.reason] || 0) + 1
    }
    for (const cand of d.candidates) {
      const { rowCount } = await c.query(
        `INSERT INTO ${S}.incident_links (vessel_ref_id, vessel_id, status, method, evidence, decided_by)
         VALUES ($1,$2,'candidate',$3,$4,$5) ON CONFLICT DO NOTHING`, [ref.id, cand.vesselId, cand.method, cand.evidence, MATCHER])
      out.candidates += rowCount
    }
  }
  return out
}

/** Fold per-event results into run stats. */
export function tallyIncident(stats, r) {
  const s = stats
  s.events = (s.events || 0) + 1
  s.eventsCreated = (s.eventsCreated || 0) + (r.eventCreated ? 1 : 0)
  s.eventsSuperseded = (s.eventsSuperseded || 0) + r.superseded
  s.recordsCreated = (s.recordsCreated || 0) + (r.recordCreated ? 1 : 0)
  s.vesselRefs = (s.vesselRefs || 0) + r.refs
  s.refsAccepted = (s.refsAccepted || 0) + r.accepted
  s.refsUnresolved = (s.refsUnresolved || 0) + r.unresolved
  s.candidateLinksAdded = (s.candidateLinksAdded || 0) + r.candidates
  for (const [k, v] of Object.entries(r.methods)) s[`accepted_${k}`] = (s[`accepted_${k}`] || 0) + v
  for (const [k, v] of Object.entries(r.reasons)) s[`unresolved_${k}`] = (s[`unresolved_${k}`] || 0) + v
  return s
}
