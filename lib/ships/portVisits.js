/**
 * Port visits ("Ports of call", /ships Phase 3 step 1; Josh, 2026-09-26).
 * GFW facts behind every choice here: docs/GFW_ACTIVITY_API.md, "Port visits for one vessel"
 * (verified live 2026-09-26). Rules: src/ships/CLAUDE.md.
 *
 *   evidence        source_records (source 'gfw-port-visits'): each GFW event exactly as received
 *   claim           port_visits: one row per version of one GFW event
 *   interpretation  read-time only: GFW identity id -> vessel_assertions -> entity_links
 *
 * Pure mapping first (unit-tested with recorded live responses), then persistence (bulk,
 * idempotent: a re-fetch of the same events changes only last_* bookkeeping), then the
 * fetch-if-stale flow used by api/ships.js. Network I/O happens only through the `gfw`
 * client passed in (scripts/ships/gfwClient.js), so tests can replay responses.
 */
import { parseUtc, normName } from './normalize.js'
import { upsertSource, canonicalJson, sha256, startRun, finishRun } from './store.js'
import { withTx } from './db.js'
import { annotateVisits } from './anchorages.js'

export const PORT_VISITS_SOURCE = {
  id: 'gfw-port-visits',
  name: 'Global Fishing Watch Events API (public-global-port-visits-events)',
  publisher: 'Global Fishing Watch, Inc.',
  homepage_url: 'https://globalfishingwatch.org/our-apis/documentation/docs/v3/events',
  license: 'CC BY-NC 4.0',
  license_url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  commercial_use: false,
  attribution_text: 'Powered by Global Fishing Watch.',
  attribution_url: 'https://globalfishingwatch.org',
  notes: 'Non-commercial only. API token server-side only (Terms 2.G). Port visits are "apparent", derived by GFW from AIS '
    + '(entry within 3 km of an anchorage, stop/gap, exit beyond 4 km; confidence 2-4). Anchorage names come from GFW\'s '
    + 'anchorages dataset and are often null. 50k requests/day per user.',
}
export const PORT_VISIT_ENTITY_KIND = 'gfw_port_visit'
export const DEFAULT_YEARS = 2
export const EARLIEST = '2012-01-01' // GFW AIS starts 2012; no span limit was found (docs, #57)
export const PAGE_LIMIT = 1000
export const MAX_PAGES = 20           // guardrail: 20,000 visits per fetch (a busy ferry has ~4,550 in 2 years)
export const SETTLE_DAYS = 14         // visits older than this before a fetch's end are treated as settled
export const FRESH_HOURS = 24         // GFW itself caches events for 24 h (cache-control max-age=86400)
export const FULL_REFRESH_DAYS = 30   // re-fetch the whole window after this, so GFW reprocessing shows up (Josh, 2026-09-26)

// ── Pure mapping ─────────────────────────────────────────────────────────────

const str = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v))
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

function anchorage(prefix, a) {
  return {
    [`${prefix}_anchorage_id`]: str(a?.anchorageId), [`${prefix}_port_label`]: str(a?.id), [`${prefix}_name`]: str(a?.name),
    [`${prefix}_iso3`]: str(a?.flag), [`${prefix}_lat`]: num(a?.lat), [`${prefix}_lon`]: num(a?.lon),
    [`${prefix}_at_dock`]: typeof a?.atDock === 'boolean' ? a.atDock : null,
  }
}

/**
 * One GFW port-visit event → the claim row (not yet persisted).
 * Returns { key, row } or { key, error } for an event that can't be stored as a claim
 * (no id, not a port visit, a timestamp without a zone). Nothing is guessed.
 */
export function mapPortVisit(ev) {
  const key = str(ev?.id)
  if (!key) return { key: null, error: 'event without id' }
  if (ev.type !== 'port_visit' || !ev.port_visit) return { key, error: `not a port visit (type ${ev.type})` }
  let start, end
  try { start = parseUtc(ev.start); end = parseUtc(ev.end) } catch (e) { return { key, error: e.message } }
  if (!start) return { key, error: 'event without start' }
  if (end && end < start) return { key, error: `end ${end} before start ${start}` }
  const pv = ev.port_visit
  const gfwVesselId = str(ev.vessel?.id)
  if (!gfwVesselId) return { key, error: 'event without vessel.id' }
  const confRaw = str(pv.confidence)
  const conf = ['2', '3', '4'].includes(confRaw) ? Number(confRaw) : null
  const anch = (a) => (a ? { top_destination: str(a.topDestination), distance_from_shore_km: str(a.distanceFromShoreKm) } : null)
  const row = {
    event_id: key, visit_id: str(pv.visitId), gfw_vessel_id: gfwVesselId,
    ssvid: str(ev.vessel?.ssvid), vessel_name_raw: str(ev.vessel?.name),
    start_at: start, end_at: end, duration_hrs: num(pv.durationHrs), confidence: conf, confidence_raw: confRaw,
    lat: num(ev.position?.lat), lon: num(ev.position?.lon),
    ...anchorage('start', pv.startAnchorage), ...anchorage('int', pv.intermediateAnchorage), ...anchorage('end', pv.endAnchorage),
    detail: {
      start: anch(pv.startAnchorage), intermediate: anch(pv.intermediateAnchorage), end: anch(pv.endAnchorage),
      vessel_flag: str(ev.vessel?.flag), vessel_type: str(ev.vessel?.type),
      eez: ev.regions?.eez ?? [], mpa: ev.regions?.mpa ?? [],
      ...(conf === null ? { confidence_note: `unexpected confidence ${JSON.stringify(pv.confidence)}` } : {}),
    },
  }
  return { key, row, contentSha256: sha256(canonicalJson(row)) }
}

/**
 * Which of a vessel's GFW identities are the ship itself (pure).
 * GFW groups a ship's tenders / lifeboats into its entry with their own MMSIs (EURODAM:
 * 14 identities on 245206011-016, docs "Port visits for one vessel"); their "visits" last
 * thousands of hours and must not be shown as the ship's. GFW's registry records list those
 * MMSIs too, so the rule uses AIS names and message volume instead:
 *   keep the identity with the most AIS messages, plus every identity whose broadcast name
 *   equals a name a registry gives for this ship. With no message counts at all, keep all.
 * identities: [{ gfwId, mmsi, name, messages }]; registryNames: normalized names.
 */
export function ownIdentities(identities, registryNames = []) {
  const reg = new Set(registryNames.map(normName).filter(Boolean))
  const list = [...new Map((identities || []).filter((i) => i.gfwId).map((i) => [i.gfwId, i])).values()]
  if (!list.length) return { use: [], skipped: [] }
  const counted = list.filter((i) => Number.isFinite(Number(i.messages)) && i.messages !== null)
  if (!counted.length) return { use: list.map((i) => i.gfwId).sort(), skipped: [], rule: 'no AIS message counts: all identities' }
  const top = [...counted].sort((a, b) => Number(b.messages) - Number(a.messages) || String(a.gfwId).localeCompare(String(b.gfwId)))[0]
  const use = [], skipped = []
  for (const i of list) {
    const n = normName(i.name)
    if (i.gfwId === top.gfwId) use.push(i.gfwId)
    else if (n && reg.has(n)) use.push(i.gfwId)
    else skipped.push({ gfwId: i.gfwId, mmsi: i.mmsi ?? null, name: i.name ?? null, messages: i.messages ?? null,
      reason: n ? 'broadcast name is not a registry name for this ship, and it is not the main identity' : 'no broadcast name, and it is not the main identity' })
  }
  return { use: use.sort(), skipped, rule: 'most AIS messages + registry-name matches' }
}

const isoDay = (d) => d.toISOString().slice(0, 10)
/** Default window: the last DEFAULT_YEARS years up to and including today (end-date exclusive = tomorrow, UTC). */
export function defaultWindow(now = new Date()) {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const from = new Date(Date.UTC(now.getUTCFullYear() - DEFAULT_YEARS, now.getUTCMonth(), now.getUTCDate()))
  return { from: isoDay(from), to: isoDay(to) }
}

/** Validate a requested window (YYYY-MM-DD, end exclusive). Returns { from, to } or { error }. */
export function parseWindow(fromRaw, toRaw, now = new Date()) {
  const d = defaultWindow(now)
  const day = /^\d{4}-\d{2}-\d{2}$/
  const from = fromRaw || d.from, to = toRaw || d.to
  if (!day.test(from) || !day.test(to) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    return { error: 'from/to must be YYYY-MM-DD' }
  }
  if (from < EARLIEST) return { error: `from must be ${EARLIEST} or later (GFW AIS starts 2012)` }
  if (to <= from) return { error: 'to must be after from' }
  return { from, to: to > d.to ? d.to : to }
}

// ── Persistence ──────────────────────────────────────────────────────────────

const COLS = ['visit_id', 'gfw_vessel_id', 'ssvid', 'vessel_name_raw', 'start_at', 'end_at', 'duration_hrs', 'confidence', 'confidence_raw',
  'lat', 'lon',
  ...['start', 'int', 'end'].flatMap((p) => ['anchorage_id', 'port_label', 'name', 'iso3', 'lat', 'lon', 'at_dock'].map((c) => `${p}_${c}`)),
  'detail']
const TYPES = {
  start_at: 'timestamptz', end_at: 'timestamptz', duration_hrs: 'double precision', confidence: 'smallint', lat: 'double precision',
  lon: 'double precision', detail: 'jsonb',
  ...Object.fromEntries(['start', 'int', 'end'].flatMap((p) => [[`${p}_lat`, 'double precision'], [`${p}_lon`, 'double precision'], [`${p}_at_dock`, 'boolean']])),
}
const typ = (c) => TYPES[c] || 'text'

export async function ensurePortVisitSource(pool, S) {
  await withTx(pool, (c) => upsertSource(c, S, PORT_VISITS_SOURCE))
}

/**
 * Store a batch of raw GFW events (one transaction). Idempotent:
 * - the raw event → source_records under one source entity per GFW event id (new payload = new row);
 * - the mapped claim → port_visits; the same content only touches last_*; changed content inserts a
 *   new version and marks the old one 'superseded'; a withdrawn event that comes back is re-activated.
 * An event with an id that can't be mapped (bad timestamp, not a port visit) is still kept as raw
 * evidence, just without a claim row; one without an id can't be keyed and is only counted. Both
 * are reported in `unmapped`.
 */
export async function ingestPortVisitEvents(c, S, events, { runId = null, retrievalUrl = null, datasetVersion = null } = {}) {
  const src = PORT_VISITS_SOURCE.id
  const mapped = []
  const unmapped = []
  const byKey = new Map()
  for (const ev of events) {
    const m = mapPortVisit(ev)
    if (!m.key) { unmapped.push(m.error); continue }
    byKey.set(m.key, { ev, m }) // the same event twice in one batch (paging overlap): keep the last
  }
  const items = [...byKey.values()]
  if (!items.length) return { events: events.length, recordsCreated: 0, visitsCreated: 0, visitsSeenAgain: 0, superseded: 0, unmapped: unmapped.length }
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('ships.port_visits'))`)
  const { rows: ents } = await c.query(
    `INSERT INTO ${S}.source_entities (source_id, entity_kind, entity_key)
     SELECT $1, $2, k FROM unnest($3::text[]) AS k
     ON CONFLICT (source_id, entity_kind, entity_key) DO UPDATE SET last_seen_at = now()
     RETURNING id, entity_key`, [src, PORT_VISIT_ENTITY_KIND, items.map((i) => i.m.key)])
  const entId = new Map(ents.map((e) => [e.entity_key, e.id]))
  const { rows: recs } = await c.query(
    `INSERT INTO ${S}.source_records (source_id, source_entity_id, payload, payload_sha256, dataset_version,
       retrieval_url, first_import_run_id, last_import_run_id)
     SELECT $1, r.eid, r.payload, r.sha, $2, $3, $4, $4
       FROM jsonb_to_recordset($5::jsonb) AS r(eid bigint, payload jsonb, sha text)
     ON CONFLICT (source_entity_id, payload_sha256) DO UPDATE
       SET last_import_run_id = EXCLUDED.last_import_run_id, last_retrieved_at = now()
     RETURNING id, source_entity_id, (xmax = 0) AS created`,
    [src, datasetVersion, retrievalUrl, runId,
      JSON.stringify(items.map((i) => ({ eid: entId.get(i.m.key), payload: i.ev, sha: sha256(canonicalJson(i.ev)) })))])
  const recId = new Map(recs.map((r) => [String(r.source_entity_id), r.id]))
  const good = items.filter((i) => i.m.row)
  for (const i of items) if (!i.m.row) unmapped.push(`${i.m.key}: ${i.m.error}`)
  let visitsCreated = 0, visitsSeenAgain = 0, superseded = 0
  if (good.length) {
    const payload = JSON.stringify(good.map((i) => ({
      eid: entId.get(i.m.key), rid: recId.get(String(entId.get(i.m.key))), event_id: i.m.key, sha: i.m.contentSha256, ...i.m.row,
    })))
    const recordset = `jsonb_to_recordset($1::jsonb) AS r(eid bigint, rid bigint, event_id text, sha text, ${COLS.map((col) => `${col} ${typ(col)}`).join(', ')})`
    superseded = (await c.query(
      `UPDATE ${S}.port_visits pv SET status = 'superseded'
         FROM ${recordset}
        WHERE pv.source_id = $2 AND pv.event_id = r.event_id AND pv.status = 'active' AND pv.content_sha256 <> r.sha`,
      [payload, src])).rowCount
    const { rows } = await c.query(
      `INSERT INTO ${S}.port_visits AS t (source_id, source_entity_id, event_id, content_sha256, ${COLS.join(', ')},
         dataset_version, first_source_record_id, last_source_record_id)
       SELECT $2, r.eid, r.event_id, r.sha, ${COLS.map((col) => `r.${col}`).join(', ')}, $3, r.rid, r.rid
         FROM ${recordset}
       ON CONFLICT (source_id, event_id, content_sha256) DO UPDATE
         SET last_source_record_id = EXCLUDED.last_source_record_id, last_seen_at = now(),
             status = CASE WHEN t.status IN ('superseded', 'withdrawn') THEN 'active' ELSE t.status END
       RETURNING (xmax = 0) AS created`,
      [payload, src, datasetVersion])
    visitsCreated = rows.filter((r) => r.created).length
    visitsSeenAgain = rows.length - visitsCreated
  }
  return { events: events.length, recordsCreated: recs.filter((r) => r.created).length, visitsCreated, visitsSeenAgain,
    superseded, unmapped: unmapped.length, unmappedReasons: unmapped.slice(0, 10) }
}

/**
 * After a COMPLETE fetch of [from, to) for these identities: active visits lying wholly inside
 * that window that GFW no longer returned are marked 'withdrawn' (kept, never deleted).
 */
export async function withdrawMissing(c, S, { gfwIds, from, to, seenEventIds }) {
  const { rowCount } = await c.query(
    `UPDATE ${S}.port_visits SET status = 'withdrawn'
      WHERE source_id = $1 AND status = 'active' AND gfw_vessel_id = ANY($2)
        AND start_at >= $3::date AND end_at IS NOT NULL AND end_at < $4::date AND NOT (event_id = ANY($5))`,
    [PORT_VISITS_SOURCE.id, gfwIds, from, to, seenEventIds])
  return rowCount
}

// ── Which identities, and is a fetch needed? ─────────────────────────────────

/** A vessel's GFW identities (from our identity evidence) and its registry names. q(text, params) → rows. */
export async function vesselGfwIdentities(q, S, vesselId) {
  const ids = await q(
    `SELECT m.sub_record_ref AS "gfwId", m.value_raw AS mmsi, (m.detail->>'messagesCounter')::bigint AS messages,
            (SELECT n.value_raw FROM ${S}.vessel_assertions n
              WHERE n.vessel_id = m.vessel_id AND n.source_id = m.source_id AND n.evidence_class = 'ais_self_reported'
                AND n.attribute = 'name' AND n.sub_record_ref = m.sub_record_ref LIMIT 1) AS name
       FROM ${S}.vessel_assertions m
      WHERE m.vessel_id = $1 AND m.source_id = 'gfw-vessel-identity' AND m.evidence_class = 'ais_self_reported'
        AND m.attribute = 'mmsi' AND m.sub_record_ref <> ''`, [vesselId])
  const names = await q(
    `SELECT DISTINCT value_norm FROM ${S}.vessel_assertions
      WHERE vessel_id = $1 AND attribute = 'name' AND evidence_class = 'registry' AND value_norm <> ''`, [vesselId])
  return { identities: ids.map((r) => ({ ...r, messages: r.messages == null ? null : Number(r.messages) })), registryNames: names.map((r) => r.value_norm) }
}

/**
 * What still has to come from GFW for [from, to) and these identities (pure over the fetch log).
 * - A fresh (< FRESH_HOURS) succeeded fetch of the same identities that covers the window → nothing.
 * - An older succeeded fetch that covers the start → only its last SETTLE_DAYS onward (recent visits
 *   can still close or change; older ones are treated as settled), unless that full fetch is older
 *   than FULL_REFRESH_DAYS: then the whole window again, so GFW corrections to old visits show up.
 * - Otherwise the whole window.
 */
export function planFetch(fetches, { gfwIds, from, to, now = new Date() }) {
  const key = [...gfwIds].sort().join(',')
  const ok = (fetches || []).filter((f) => f.status === 'succeeded' && [...f.gfw_vessel_ids].sort().join(',') === key)
  const ts = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10))
  const fresh = ok.filter((f) => now - new Date(f.finished_at) < FRESH_HOURS * 3600e3)
  // Fresh fetches that together cover [from, to): any single one is enough for our windows.
  if (fresh.some((f) => ts(f.range_from) <= from && ts(f.range_to) >= to)) return { fetch: false }
  const covering = ok.filter((f) => ts(f.range_from) <= from && ts(f.range_to) > from)
    .sort((a, b) => ts(b.range_to).localeCompare(ts(a.range_to)))[0]
  const stale = covering && now - new Date(covering.finished_at) > FULL_REFRESH_DAYS * 864e5
  if (covering && !stale) {
    const settle = new Date(Date.parse(`${ts(covering.range_to)}T00:00:00Z`) - SETTLE_DAYS * 864e5).toISOString().slice(0, 10)
    const start = settle > from ? settle : from
    if (start < to) return { fetch: true, from: start, to, incremental: start !== from }
  }
  return { fetch: true, from, to, incremental: false }
}

/**
 * Make sure a vessel's port visits for [from, to) are stored: look up its GFW identities, fetch
 * from GFW only what the fetch log says is missing or stale, store it, log the fetch.
 * Returns { status: 'no_gfw_identity' | 'fresh' | 'fetched', ... }. Throws on GFW / DB failure
 * (the fetch row is marked 'failed').
 */
/** Read-only: the vessel's own GFW identities and what (if anything) must be fetched. q(text, params) → rows. */
export async function portVisitPlan(q, S, vesselId, { from, to, now = new Date() }) {
  const { identities, registryNames } = await vesselGfwIdentities(q, S, vesselId)
  const own = ownIdentities(identities, registryNames)
  if (!own.use.length) return { own, plan: { fetch: false } }
  const log = await q(
    `SELECT gfw_vessel_ids, range_from, range_to, status, finished_at FROM ${S}.port_visit_fetches
      WHERE vessel_id = $1 AND status = 'succeeded' ORDER BY finished_at DESC LIMIT 50`, [vesselId])
  return { own, plan: planFetch(log, { gfwIds: own.use, from, to, now }) }
}

export async function ensurePortVisits(pool, S, vesselId, gfw, { from, to, now = new Date() }) {
  const q = async (text, params) => (await pool.query(text, params)).rows
  const { own, plan } = await portVisitPlan(q, S, vesselId, { from, to, now })
  if (!own.use.length) return { status: 'no_gfw_identity' }
  if (!plan.fetch) return { status: 'fresh', gfwIds: own.use, skipped: own.skipped }
  if (!gfw) return { status: 'stale_no_gfw', gfwIds: own.use, skipped: own.skipped }
  await ensurePortVisitSource(pool, S)
  const runId = await withTx(pool, (c) => startRun(c, S, PORT_VISITS_SOURCE.id, { vesselId, gfwIds: own.use, from: plan.from, to: plan.to }))
  const [{ id: fetchId }] = await q(
    `INSERT INTO ${S}.port_visit_fetches (vessel_id, gfw_vessel_ids, skipped, range_from, range_to, import_run_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [vesselId, own.use, JSON.stringify(own.skipped), plan.from, plan.to, runId])
  const stats = { pages: 0, events: 0, recordsCreated: 0, visitsCreated: 0, visitsSeenAgain: 0, superseded: 0, withdrawn: 0, unmapped: 0 }
  let calls = 0
  try {
    const seen = []
    let offset = 0, total = null, datasetVersion = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const { url, body, datasets } = await gfw.portVisits({ vesselIds: own.use, from: plan.from, to: plan.to, limit: PAGE_LIMIT, offset })
      calls++
      datasetVersion = datasets || datasetVersion
      total = body.total ?? total
      const entries = body.entries || []
      const r = await withTx(pool, (c) => ingestPortVisitEvents(c, S, entries, { runId, retrievalUrl: url, datasetVersion }))
      for (const k of ['events', 'recordsCreated', 'visitsCreated', 'visitsSeenAgain', 'superseded', 'unmapped']) stats[k] += r[k]
      stats.pages++
      for (const e of entries) if (e?.id) seen.push(String(e.id))
      if (body.nextOffset == null || !entries.length) { offset = null; break }
      offset = body.nextOffset
    }
    const complete = offset === null
    stats.complete = complete
    stats.total = total
    if (complete) stats.withdrawn = await withTx(pool, (c) => withdrawMissing(c, S, { gfwIds: own.use, from: plan.from, to: plan.to, seenEventIds: seen }))
    const status = complete ? 'succeeded' : 'failed'
    await q(`UPDATE ${S}.port_visit_fetches SET finished_at = now(), status = $2, gfw_calls = $3, events_returned = $4, stats = $5,
               error = $6 WHERE id = $1`, [fetchId, status, calls, stats.events, stats, complete ? null : `stopped after ${MAX_PAGES} pages`])
    await withTx(pool, (c) => finishRun(c, S, runId, { status, stats, datasetVersion, error: complete ? null : `stopped after ${MAX_PAGES} pages` }))
    return { status: 'fetched', plan, gfwIds: own.use, skipped: own.skipped, stats, calls }
  } catch (e) {
    await q(`UPDATE ${S}.port_visit_fetches SET finished_at = now(), status = 'failed', gfw_calls = $2, stats = $3, error = $4 WHERE id = $1`,
      [fetchId, calls, stats, String(e.message).slice(0, 500)]).catch(() => {})
    await withTx(pool, (c) => finishRun(c, S, runId, { status: 'failed', stats, error: String(e.message).slice(0, 500) })).catch(() => {})
    throw e
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * A vessel's stored port visits in [from, to) (overlap, like GFW), newest first, for the card.
 * Only its own GFW identities (ownIdentities). Returns rows + a summary over the whole window.
 */
export async function vesselPortVisits(q, S, vesselId, { from, to, limit = 200, offset = 0 }) {
  const { identities, registryNames } = await vesselGfwIdentities(q, S, vesselId)
  const own = ownIdentities(identities, registryNames)
  if (!own.use.length) return { gfwIds: [], skipped: [], total: 0, visits: [], topPorts: [], since: null, fetchedAt: null }
  const where = `pv.status = 'active' AND pv.gfw_vessel_id = ANY($1) AND pv.start_at < $3::date AND coalesce(pv.end_at, pv.start_at) >= $2::date`
  const lim = Math.max(1, Math.min(1000, Number(limit) || 200)), off = Math.max(0, Number(offset) || 0)
  // Names (step 2, lib/ships/ports.js): our port for the intermediate anchorage's GFW label, named World Port
  // Index first, then GFW; the country is GFW's ISO3 for the anchorage, named by GeoNames. Before migration 008
  // exists (e.g. a database not migrated yet) the plain step-1 read is used.
  const named = `LEFT JOIN ${S}.ports p ON p.id = pv.port_id
         LEFT JOIN ${S}.port_aliases pa ON pa.key_kind = 'gfw_port_label' AND pa.key = pv.int_port_label AND pa.status = 'accepted' AND pa.port_id = pv.port_id
         LEFT JOIN ${S}.countries cn ON cn.iso3 = pv.int_iso3`
  const namedCols = `pv.port_id, p.name AS port_name, p.name_source_id, coalesce(pa.method, p.name_method) AS name_method, p.name_source_record_id, pa.distance_km AS name_distance_km,
              p.harbor_size, p.unlocode, cn.name AS country_name, cn.source_record_id AS country_record_id`
  const plainCols = `NULL::bigint AS port_id, NULL::text AS port_name, NULL::text AS name_source_id, NULL::text AS name_method,
              NULL::bigint AS name_source_record_id, NULL::float AS name_distance_km, NULL::text AS harbor_size, NULL::text AS unlocode,
              NULL::text AS country_name, NULL::bigint AS country_record_id`
  // Kind of stop (Josh 2026-09-27), from GFW's own fields on the event as received:
  //   docked    = GFW marks the start, middle or end anchorage as a dock;
  //   anchor    = not docked and the middle anchorage is ≥ 1 km from shore (GFW gives whole km);
  //   alongside = not docked and < 1 km from shore (a pier GFW doesn't call a dock, or near-shore anchoring).
  // topDestination = the destination ships most often broadcast at that anchorage (a place hint, noisy).
  const raw = `LEFT JOIN ${S}.source_records sr ON sr.id = pv.last_source_record_id`
  const shore = `(sr.payload->'port_visit'->'intermediateAnchorage'->>'distanceFromShoreKm')`
  const kind = `CASE WHEN coalesce(pv.start_at_dock, false) OR coalesce(pv.int_at_dock, false) OR coalesce(pv.end_at_dock, false) THEN 'docked'
              WHEN ${shore} ~ '^[0-9]+(\\.[0-9]+)?$' AND ${shore}::float8 >= 1 THEN 'anchor'
              WHEN ${shore} ~ '^[0-9]+(\\.[0-9]+)?$' THEN 'alongside' ELSE 'unknown' END`
  const hintCols = `${kind} AS stop_kind, ${shore} AS shore_km,
              sr.payload->'port_visit'->'intermediateAnchorage'->>'topDestination' AS top_destination`
  const read = (withNames) => Promise.all([
    q(`SELECT pv.id, pv.event_id, pv.gfw_vessel_id, pv.ssvid, pv.start_at, pv.end_at, pv.duration_hrs, pv.confidence,
              pv.int_port_label AS port_label, pv.int_name AS gfw_name, pv.int_iso3 AS iso3, pv.int_at_dock AS at_dock,
              pv.lat, pv.lon, pv.start_port_label, pv.end_port_label, pv.end_name, pv.last_source_record_id, pv.dataset_version,
              ${withNames ? namedCols : plainCols}, ${hintCols}
         FROM ${S}.port_visits pv ${withNames ? named : ''} ${raw} WHERE ${where}
        ORDER BY pv.start_at DESC, pv.id DESC LIMIT ${lim} OFFSET ${off}`, [own.use, from, to]),
    q(`SELECT count(*)::int AS total, min(pv.start_at) AS since FROM ${S}.port_visits pv WHERE ${where}`, [own.use, from, to]),
    // "Most often": grouped by our port when there is one (two GFW labels can be one WPI port), else by the raw label.
    q(`SELECT coalesce('p' || pv.port_id::text, 'l' || pv.int_port_label) AS key, min(pv.int_port_label) AS port_label,
              max(pv.int_name) AS gfw_name, max(pv.int_iso3) AS iso3, count(*)::int AS n,
              ${withNames ? `max(pv.port_id) AS port_id, max(p.name) AS port_name, max(p.name_source_id) AS name_source_id,
              max(coalesce(pa.method, p.name_method)) AS name_method, max(p.name_source_record_id) AS name_source_record_id, max(cn.name) AS country_name`
                : `NULL::bigint AS port_id, NULL::text AS port_name, NULL::text AS name_source_id, NULL::text AS name_method,
              NULL::bigint AS name_source_record_id, NULL::text AS country_name`},
              mode() WITHIN GROUP (ORDER BY sr.payload->'port_visit'->'intermediateAnchorage'->>'topDestination') AS top_destination,
              max(pa_d.distance_km) AS name_distance_km
         FROM ${S}.port_visits pv ${withNames ? named : ''} ${raw}
         ${withNames ? `LEFT JOIN ${S}.port_aliases pa_d ON pa_d.key_kind = 'gfw_port_label' AND pa_d.key = pv.int_port_label AND pa_d.status = 'accepted'` : 'LEFT JOIN (SELECT NULL::float AS distance_km) pa_d ON true'}
         WHERE ${where}
        GROUP BY 1 ORDER BY n DESC, key LIMIT 5`, [own.use, from, to]),
    q(`SELECT ${kind} AS stop_kind, count(*)::int AS n FROM ${S}.port_visits pv ${raw} WHERE ${where} GROUP BY 1`, [own.use, from, to]),
    q(`SELECT finished_at, range_from, range_to FROM ${S}.port_visit_fetches
        WHERE vessel_id = $1 AND status = 'succeeded' ORDER BY finished_at DESC LIMIT 1`, [vesselId]),
  ])
  let visits, sum, topPorts, kinds, fetch
  try { [visits, [sum], topPorts, kinds, [fetch]] = await read(true) } catch (e) {
    if (e?.code !== '42P01' && !/relation .*(ports|port_aliases|countries).* does not exist/.test(String(e?.message))) throw e
    ;[visits, [sum], topPorts, kinds, [fetch]] = await read(false)
  }
  const stopKinds = Object.fromEntries(kinds.map((k) => [k.stop_kind, k.n]))
  // Official anchorage areas (step 3, lib/ships/anchorages.js): which one each stop's position lies in or is near,
  // decided here at read time (the GFW evidence is never touched). The summary covers every stop in the window,
  // matched once per distinct position. null before migration 009.
  const positions = await q(`SELECT pv.lat, pv.lon, count(*)::int AS n FROM ${S}.port_visits pv
                              WHERE ${where} AND pv.lat IS NOT NULL AND pv.lon IS NOT NULL GROUP BY 1, 2`, [own.use, from, to])
  const anchorages = await annotateVisits(q, S, visits, positions)
  return { gfwIds: own.use, skipped: own.skipped, total: sum.total, since: sum.since, topPorts, visits, stopKinds, anchorages,
    limit: lim, offset: off, fetchedAt: fetch?.finished_at ?? null }
}
