/**
 * Ports on the map + the port card (/ships Phase 3 step 3; Josh, 2026-09-27).
 * Facts behind every choice: docs/GFW_ACTIVITY_API.md ("Port visits by port", verified live 2026-09-27) and
 * docs/PORTS_SOURCES.md ("Step 3"). Rules: src/ships/CLAUDE.md.
 *
 *   evidence        source_records: GFW port-visit events (the same entities / port_visits claims a ship card stores),
 *                   GFW /events/stats responses, IMF PortWatch port features and daily-series responses, all as received
 *   claim           port_visits (007)
 *   interpretation  port_aliases (008): which GFW labels are this port; the PortWatch join (read time only)
 *
 * GFW is asked only for ports in ships.ports, only when the fetch log (port_card_fetches, 010) says the stored answer
 * is missing or stale, and never beyond DAILY_GFW_CALLS a day. Network I/O only through the `gfw` client and the
 * `fetchJson` function passed in, so tests replay recorded responses.
 */
import { upsertSource, startRun, finishRun, canonicalJson, sha256 } from './store.js'
import { withTx } from './db.js'
import { PORT_VISITS_SOURCE, ingestPortVisitEvents } from './portVisits.js'
import { storeRawRecords, matchPortLabels, haversineKm, MATCH_KM } from './ports.js'
import { circlePolygon } from './anchorages.js'
import { ingestGfwEntry, ensureGfwSource } from './ingestGfw.js'

// ── Source (licence facts: docs/PORTS_SOURCES.md §3 and "Step 3") ─────────────

export const PORTWATCH_SOURCE = {
  id: 'imf-portwatch',
  name: 'IMF PortWatch: ports database and daily port calls / trade estimates (Daily_Ports_Data)',
  publisher: 'International Monetary Fund (IMF), with the University of Oxford; AIS from Kpler via the UN Global Platform',
  homepage_url: 'https://portwatch.imf.org',
  license: 'IMF PortWatch terms (FAQ: "For questions about commercial redistribution of the datasets, please contact copyright@imf.org")',
  license_url: 'https://portwatch.imf.org/pages/faqs',
  commercial_use: false,
  attribution_text: 'Sources: Kpler; UN Global Platform; IMF PortWatch (portwatch.imf.org).',
  attribution_url: 'https://portwatch.imf.org',
  notes: 'Required citation per the PortWatch FAQ (read 2026-09-26). Non-commercial display with that citation; EarthAtlas is '
    + 'non-commercial conservation use. The general IMF terms page (imf.org/external/terms.htm) returned 403 and was not read, '
    + 'so redistribution terms beyond the FAQ are UNVERIFIED: we show derived trends with the citation and link to PortWatch, '
    + 'we do not republish the raw series. A port call = a vessel arriving at berth (FAQ); turnarounds < 5 h with no draft '
    + 'change are excluded. Trade = estimates from draft change × deadweight (IMF WP/21/225). Relative trends, not official '
    + 'statistics. Updated weekly (Tuesdays 9 AM ET); series can be revised.',
}
const PW_BASE = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services'
export const PW_PORTS_URL = `${PW_BASE}/PortWatch_ports_database/FeatureServer/0/query`
// The FAQ's example service name "Daily_Trade_Data" answers 400 "Item does not exist" (2026-09-27); this is the real one.
export const PW_DAILY_URL = `${PW_BASE}/Daily_Ports_Data/FeatureServer/0/query`
export const PW_FIRST_DAY = '2019-01-01'
export const PW_DAILY_FIELDS = ['date', 'portid', 'portcalls', 'portcalls_container', 'portcalls_dry_bulk', 'portcalls_general_cargo',
  'portcalls_roro', 'portcalls_tanker', 'import', 'export']
export const PW_TYPES = [['container', 'container'], ['dry_bulk', 'dry bulk'], ['general_cargo', 'general cargo'], ['roro', 'RoRo'], ['tanker', 'tanker']]

export const KIND = { pwPort: 'portwatch_port', pwDaily: 'portwatch_daily', stats: 'gfw_port_visit_stats' }

export const MAX_MONTHS = 12          // same cap as the map's month picker
export const EVENT_PAGE = 1000
export const EVENT_PAGES = 5          // ≤ 5,000 arrivals listed per port-month (Seattle ≈ 3,600 in Aug 2025)
export const DISCOVER_LIMIT = 1000    // one geometry call (15–21 s live), newest first
export const FRESH_HOURS = 24         // GFW caches events 24 h; PortWatch updates weekly
export const SETTLE_DAYS = 14         // a window that ended this long before the fetch is treated as settled: kept for good
export const FULL_REFRESH_DAYS = 30   // (discovery only) how long a "no GFW label near this port" answer is trusted
export const DAILY_GFW_CALLS = 1500   // guardrail: GFW calls per 24 h from port cards (GFW allows 50,000/day for everything)
export const PW_JOIN_KM = 25          // a PortWatch port sharing the WPI port's UN/LOCODE must also lie this close

// ── Pure helpers ─────────────────────────────────────────────────────────────

const YM = /^\d{4}-(0[1-9]|1[0-2])$/
const ymOf = (d) => d.toISOString().slice(0, 7)
const firstOf = (ym) => `${ym}-01`
export function nextMonth(ym) { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }
const dayAfter = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString().slice(0, 10)

/**
 * The card's window: months fromYm..toYm (inclusive, the map's "When" selection), capped to MAX_MONTHS (the latest
 * ones kept) and to the current month; `month` = the month whose ships are listed (default: the latest in the window).
 * Dates are UTC; `to` values are exclusive and never later than tomorrow.
 */
export function parseCardWindow(fromYm, toYm, monthYm, now = new Date()) {
  const cur = ymOf(now)
  let a = fromYm || null, b = toYm || fromYm || null
  if (!a) { b = cur; a = cur }
  if (!YM.test(a) || !YM.test(b)) return { error: 'from/to must be YYYY-MM' }
  if (a > b) [a, b] = [b, a]
  if (a < '2012-01') return { error: 'from must be 2012-01 or later (GFW AIS starts 2012)' }
  if (a > cur) return { error: 'months must not be in the future' }
  if (b > cur) b = cur
  const months = []
  for (let m = a; m <= b; m = nextMonth(m)) months.push(m)
  const kept = months.slice(-MAX_MONTHS)
  const month = monthYm && YM.test(monthYm) && kept.includes(monthYm) ? monthYm : kept[kept.length - 1]
  const tomorrow = dayAfter(now)
  const cap = (d) => (d > tomorrow ? tomorrow : d)
  return {
    months: kept, from: firstOf(kept[0]), to: cap(firstOf(nextMonth(kept[kept.length - 1]))),
    month, monthFrom: firstOf(month), monthTo: cap(firstOf(nextMonth(month))), capped: kept.length < months.length,
  }
}

/**
 * Is a logged fetch still good enough? Fresh for FRESH_HOURS; a window that had already settled (ended SETTLE_DAYS
 * before the fetch) is kept for good (Josh 2026-09-27: port cards should never be slow again once loaded; a
 * deliberate re-pull is `scripts/ships/warm-port-cards.mjs --force`). Pure.
 */
export function fetchIsFresh(row, now = new Date()) {
  if (!row || row.status !== 'succeeded' || !row.finished_at) return false
  const done = new Date(row.finished_at), age = now - done
  if (age < FRESH_HOURS * 3600e3) return true
  const to = Date.parse(`${String(row.range_to instanceof Date ? row.range_to.toISOString() : row.range_to).slice(0, 10)}T00:00:00Z`)
  return to <= done - SETTLE_DAYS * 864e5
}

/**
 * Pick the log row that answers a request: same kind + labels (sorted) + window start, and either the same window
 * end or fresh (the current month's end moves daily). Returns the newest such succeeded row, or null. Pure.
 */
export function matchingFetch(rows, { kind, labels = [], from, to, extKey = null }, now = new Date()) {
  const key = [...labels].sort().join(',')
  const d = (x) => String(x instanceof Date ? x.toISOString() : x).slice(0, 10)
  return (rows || [])
    .filter((r) => r.kind === kind && r.status === 'succeeded' && [...(r.port_labels || [])].sort().join(',') === key
      && (extKey == null || r.ext_key === extKey) && d(r.range_from) === from
      && (d(r.range_to) === to || now - new Date(r.finished_at) < FRESH_HOURS * 3600e3))
    .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at))[0] || null
}

/** GFW labels seen in a list of events (intermediate anchorage = where GFW places the visit), most visits first. Pure. */
export function labelsInEvents(events) {
  const n = new Map()
  for (const e of events || []) {
    const a = e?.port_visit?.intermediateAnchorage
    if (!a?.id) continue
    const l = n.get(a.id) || { label: a.id, name: a.name ?? null, visits: 0 }
    l.visits++
    if (!l.name && a.name) l.name = a.name
    n.set(a.id, l)
  }
  return [...n.values()].sort((x, y) => y.visits - x.visits || x.label.localeCompare(y.label))
}

/** One PortWatch ports-layer feature → { key, row } (the raw attributes are the stored record). Pure. */
export function mapPwPort(f) {
  const a = f?.attributes || f
  if (!a?.portid) return { error: 'PortWatch port without portid' }
  const lat = Number(a.lat), lon = Number(a.lon)
  const loc = a.LOCODE && String(a.LOCODE).trim() ? String(a.LOCODE).trim().toUpperCase().replace(/\s+/g, ' ') : null
  return {
    key: String(a.portid),
    row: { portid: String(a.portid), portname: a.portname ?? null, country: a.country ?? null, iso3: a.ISO3 ?? null,
      locode: loc && /^[A-Z]{2} [A-Z0-9]{3}$/.test(loc) ? loc : null, lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null, pageid: a.pageid ?? null, vessel_count_total: a.vessel_count_total ?? null },
  }
}

/**
 * Which PortWatch port is this WPI port (read-time interpretation)? The WPI unloCode must equal exactly one PortWatch
 * LOCODE, the two positions must lie within PW_JOIN_KM, and when other WPI ports carry the same unloCode (13 codes do)
 * this one must be the nearest of them to the PortWatch port (a wrong join is worse than none).
 * Pure: port {id, unlocode, lat, lon}; pw [{portid, locode, lat, lon}]; peers = WPI ports with the same unloCode.
 */
export function pickPortWatch(port, pw, peers = []) {
  if (!port?.unlocode) return { status: 'no_locode' }
  const same = (pw || []).filter((p) => p.locode === port.unlocode)
  if (!same.length) return { status: 'not_covered' }
  if (same.length > 1) return { status: 'ambiguous', candidates: same.map((p) => p.portid) }
  const p = same[0]
  const km = Number.isFinite(p.lat) && Number.isFinite(port.lat) ? haversineKm(port.lat, port.lon, p.lat, p.lon) : null
  if (km == null || km > PW_JOIN_KM) return { status: 'too_far', portid: p.portid, km }
  const nearer = (peers || []).filter((o) => o.id !== port.id && Number.isFinite(o.lat)
    && haversineKm(o.lat, o.lon, p.lat, p.lon) < km)
  if (nearer.length) return { status: 'other_wpi_nearer', portid: p.portid, km, nearer: nearer.map((o) => o.id) }
  return { status: 'joined', pw: p, km: Math.round(km * 10) / 10 }
}

/**
 * PortWatch daily rows → a daily series with trailing 7-day means (the day and the 6 before; a mean needs ≥ 4 of those
 * 7 days present, otherwise null). Rows are deduplicated by date. Pure.
 */
export function smoothDaily(rows, keys) {
  const byDate = new Map()
  for (const r of rows || []) if (r?.date) byDate.set(String(r.date).slice(0, 10), r)
  const dates = [...byDate.keys()].sort()
  const t = (d) => Date.parse(`${d}T00:00:00Z`)
  return dates.map((d, i) => {
    const out = { date: d }
    const win = []
    for (let j = i; j >= 0 && t(dates[j]) > t(d) - 7 * 864e5; j--) win.push(byDate.get(dates[j]))
    for (const k of keys) {
      const v = byDate.get(d)[k]
      out[k] = v == null ? null : Number(v)
      const vals = win.map((r) => r[k]).filter((x) => x != null && Number.isFinite(Number(x))).map(Number)
      out[`${k}7`] = vals.length >= 4 ? Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 100) / 100 : null
    }
    return out
  })
}

// ── Persistence helpers ──────────────────────────────────────────────────────

export async function ensurePortCardSources(pool, S) {
  await withTx(pool, async (c) => { await upsertSource(c, S, PORTWATCH_SOURCE); await upsertSource(c, S, PORT_VISITS_SOURCE) })
}

/** PortWatch ports-layer features → source records (one entity per portid). Idempotent. */
export async function ingestPortWatchPorts(c, S, features, opts = {}) {
  const items = [], errors = []
  for (const f of features || []) { const m = mapPwPort(f); if (m.error) errors.push(m.error); else items.push({ key: m.key, payload: f.attributes || f }) }
  const r = await storeRawRecords(c, S, PORTWATCH_SOURCE.id, KIND.pwPort, items, opts)
  return { rows: (features || []).length, stored: items.length, recordsCreated: r.created, errors }
}

/** Stored PortWatch ports (latest record per portid), mapped. q(text, params) → rows. */
export async function portWatchPorts(q, S, { locode = null } = {}) {
  const rows = await q(
    `SELECT DISTINCT ON (se.entity_key) se.entity_key, sr.id AS record_id, sr.payload
       FROM ${S}.source_entities se JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
      WHERE se.source_id = $1 AND se.entity_kind = $2 ${locode ? `AND upper(regexp_replace(sr.payload->>'LOCODE', '\\s+', ' ', 'g')) = $3` : ''}
      ORDER BY se.entity_key, sr.last_retrieved_at DESC, sr.id DESC`, locode ? [PORTWATCH_SOURCE.id, KIND.pwPort, locode] : [PORTWATCH_SOURCE.id, KIND.pwPort])
  return rows.map((r) => ({ ...mapPwPort(r.payload).row, record_id: r.record_id }))
}

async function logStart(pool, S, row) {
  const { rows } = await pool.query(
    `INSERT INTO ${S}.port_card_fetches (port_id, kind, port_labels, ext_key, range_from, range_to, import_run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [row.portId, row.kind, [...(row.labels || [])].sort(), row.extKey ?? null, row.from, row.to, row.runId ?? null])
  return rows[0].id
}
async function logEnd(pool, S, id, { status, calls = 0, events = null, complete = null, recordId = null, stats = {}, error = null }) {
  await pool.query(
    `UPDATE ${S}.port_card_fetches SET finished_at = now(), status = $2, calls = $3, events_returned = $4, complete = $5,
       source_record_id = $6, stats = $7, error = $8 WHERE id = $1`,
    [id, status, calls, events, complete, recordId, stats, error ? String(error).slice(0, 500) : null])
}

/** GFW calls made by port cards in the last 24 h (guardrail). */
export async function gfwCallsToday(q, S) {
  const [r] = await q(`SELECT coalesce(sum(calls), 0)::int AS n FROM ${S}.port_card_fetches
                        WHERE kind IN ('discover', 'events', 'stats') AND started_at > now() - interval '24 hours'`)
  return r.n
}

/** The port and the GFW labels accepted as this port (port_aliases, 008). null = not one of our ports on the map. */
export async function portAndLabels(q, S, portId) {
  if (!/^\d{1,12}$/.test(String(portId))) return null
  const [port] = await q(
    `SELECT p.id, p.origin, p.origin_key, p.name, p.name_source_id, p.name_method, p.name_source_record_id, p.iso2, p.iso3,
            p.lat, p.lon, p.harbor_size, p.harbor_type, p.unlocode, p.wpi_number, p.detail,
            cn.name AS country_name, cn.source_record_id AS country_record_id
       FROM ${S}.ports p LEFT JOIN ${S}.countries cn ON cn.iso2 = p.iso2 OR (p.iso2 IS NULL AND cn.iso3 = p.iso3)
      WHERE p.id = $1`, [portId])
  if (!port) return null
  const labels = await q(
    `SELECT key AS label, method, distance_km, name_raw FROM ${S}.port_aliases
      WHERE port_id = $1 AND key_kind = 'gfw_port_label' AND status = 'accepted' ORDER BY key`, [portId])
  // A GFW-label port whose label now belongs to another port (superseded) is no longer one of ours.
  if (port.origin === 'gfw_port_label' && !labels.length) return null
  return { port, labels }
}

/** The PortWatch join for one of our ports (stored PortWatch ports + WPI ports sharing its unloCode). */
export async function portWatchJoin(q, S, port) {
  if (!port?.unlocode || port.origin !== 'wpi') return { status: port?.unlocode ? 'not_wpi' : 'no_locode' }
  const peers = await q(`SELECT id, lat, lon FROM ${S}.ports WHERE origin = 'wpi' AND unlocode = $1`, [port.unlocode])
  return pickPortWatch(port, await portWatchPorts(q, S, { locode: port.unlocode }), peers)
}

async function recentFetches(q, S, portId) {
  return q(`SELECT id, kind, port_labels, ext_key, range_from, range_to, status, finished_at, calls, events_returned, complete,
                   source_record_id, stats
              FROM ${S}.port_card_fetches WHERE port_id = $1 AND status = 'succeeded'
             ORDER BY finished_at DESC LIMIT 200`, [portId])
}

// ── Fetch steps (each logs itself; each can fail alone) ──────────────────────

/** Find GFW labels near a port we have none for: one geometry call around it, stored, then named by the matcher. */
async function discover(pool, S, { port, win, gfw, runId }) {
  const fid = await logStart(pool, S, { portId: port.id, kind: 'discover', from: win.monthFrom, to: win.monthTo, runId })
  let calls = 0
  try {
    const geometry = circlePolygon(port.lat, port.lon, MATCH_KM * 1000, 32)
    const { url, body, datasets } = await gfw.eventsInPolygon({ geometry, from: win.monthFrom, to: win.monthTo, limit: DISCOVER_LIMIT, offset: 0 })
    calls++
    const entries = body.entries || []
    const r = await withTx(pool, (c) => ingestPortVisitEvents(c, S, entries, { runId, retrievalUrl: url, datasetVersion: datasets || 'public-global-port-visits-events:latest' }))
    const found = labelsInEvents(entries)
    const { rows: known } = await pool.query(
      `SELECT DISTINCT key FROM ${S}.port_aliases WHERE key_kind = 'gfw_port_label' AND status = 'accepted' AND key = ANY($1)`, [found.map((l) => l.label)])
    const fresh = found.map((l) => l.label).filter((l) => !known.some((k) => k.key === l))
    const m = fresh.length ? await withTx(pool, (c) => matchPortLabels(c, S, { labels: fresh })) : { labels: 0, byMethod: {} }
    await logEnd(pool, S, fid, { status: 'succeeded', calls, events: entries.length, complete: body.nextOffset == null,
      stats: { total: body.total ?? null, labels: found, matched: m.byMethod, ingest: r } })
    return { calls, found }
  } catch (e) {
    await logEnd(pool, S, fid, { status: 'failed', calls, error: e.message }).catch(() => {})
    throw e
  }
}

/** GFW monthly totals for the port's labels over the window (one call), stored as a raw record. */
async function fetchStats(pool, S, { port, labels, win, gfw, runId }) {
  const fid = await logStart(pool, S, { portId: port.id, kind: 'stats', labels, from: win.from, to: win.to, runId })
  try {
    const { url, body, datasets } = await gfw.portStats({ portIds: labels, from: win.from, to: win.to })
    const rec = await withTx(pool, (c) => storeRawRecords(c, S, PORT_VISITS_SOURCE.id, KIND.stats,
      [{ key: `${[...labels].sort().join(',')}|${win.from}|${win.to}`, payload: { request: { portIds: [...labels].sort(), startDate: win.from, endDate: win.to,
        timeFilterMode: 'START-DATE', timeseriesInterval: 'MONTH' }, response: body } }],
      { runId, retrievalUrl: url, datasetVersion: datasets || 'public-global-port-visits-events:latest' }))
    const recordId = [...rec.byKey.values()][0]?.[0] ?? null
    await logEnd(pool, S, fid, { status: 'succeeded', calls: 1, recordId, stats: { numEvents: body.numEvents ?? null, numVessels: body.numVessels ?? null } })
    return { calls: 1 }
  } catch (e) {
    await logEnd(pool, S, fid, { status: 'failed', calls: 1, error: e.message }).catch(() => {})
    throw e
  }
}

/** Every GFW port visit that began at the port's labels in one month (≤ EVENT_PAGES pages), stored as evidence. */
async function fetchMonthEvents(pool, S, { port, labels, win, gfw, runId }) {
  const fid = await logStart(pool, S, { portId: port.id, kind: 'events', labels, from: win.monthFrom, to: win.monthTo, runId })
  let calls = 0
  const stats = { pages: 0, events: 0, recordsCreated: 0, visitsCreated: 0, visitsSeenAgain: 0, superseded: 0, unmapped: 0, withdrawn: 0 }
  try {
    const seen = []
    let offset = 0, total = null
    for (let page = 0; page < EVENT_PAGES; page++) {
      const { url, body, datasets } = await gfw.portEvents({ portIds: labels, from: win.monthFrom, to: win.monthTo, limit: EVENT_PAGE, offset })
      calls++
      total = body.total ?? total
      const entries = body.entries || []
      const r = await withTx(pool, (c) => ingestPortVisitEvents(c, S, entries, { runId, retrievalUrl: url, datasetVersion: datasets || 'public-global-port-visits-events:latest' }))
      for (const k of ['events', 'recordsCreated', 'visitsCreated', 'visitsSeenAgain', 'superseded', 'unmapped']) stats[k] += r[k]
      stats.pages++
      for (const e of entries) if (e?.id) seen.push(String(e.id))
      if (body.nextOffset == null || !entries.length) { offset = null; break }
      offset = body.nextOffset
    }
    const complete = offset === null
    stats.total = total
    if (complete) {
      // Wholly-inside visits GFW no longer returns for this port and month: kept, marked withdrawn (never deleted).
      stats.withdrawn = (await pool.query(
        `UPDATE ${S}.port_visits SET status = 'withdrawn'
          WHERE source_id = $1 AND status = 'active' AND int_port_label = ANY($2) AND start_at >= $3::date AND start_at < $4::date
            AND NOT (event_id = ANY($5))`, [PORT_VISITS_SOURCE.id, labels, win.monthFrom, win.monthTo, seen])).rowCount
    }
    // Apply the existing label → port decision to the new visits (no re-deciding here).
    await pool.query(
      `UPDATE ${S}.port_visits pv SET port_id = a.port_id FROM ${S}.port_aliases a
        WHERE a.key_kind = 'gfw_port_label' AND a.status = 'accepted' AND a.key = pv.int_port_label
          AND pv.int_port_label = ANY($1) AND pv.port_id IS DISTINCT FROM a.port_id`, [labels])
    await logEnd(pool, S, fid, { status: 'succeeded', calls, events: stats.events, complete, stats })
    return { calls, complete, total }
  } catch (e) {
    await logEnd(pool, S, fid, { status: 'failed', calls, stats, error: e.message }).catch(() => {})
    throw e
  }
}

/** PortWatch daily rows for one port and the window (paged by 1,000 rows), each page stored as a raw record. */
async function fetchPortWatch(pool, S, { port, pw, from, to, fetchJson, runId }) {
  const fid = await logStart(pool, S, { portId: port.id, kind: 'portwatch', extKey: pw.portid, from, to, runId })
  let calls = 0
  try {
    const ids = []
    let rows = 0
    for (let offset = 0; offset < 10000; offset += 1000) {
      const qs = new URLSearchParams({
        where: `portid='${pw.portid.replace(/[^a-z0-9]/gi, '')}' AND date >= DATE '${from}' AND date < DATE '${to}'`,
        outFields: PW_DAILY_FIELDS.join(','), orderByFields: 'date', resultOffset: String(offset), resultRecordCount: '1000', f: 'json',
      })
      const url = `${PW_DAILY_URL}?${qs}`
      const body = await fetchJson(url)
      calls++
      if (body?.error) throw new Error(`PortWatch ${body.error.code}: ${body.error.message}`)
      const feats = body?.features || []
      rows += feats.length
      const rec = await withTx(pool, (c) => storeRawRecords(c, S, PORTWATCH_SOURCE.id, KIND.pwDaily,
        [{ key: `${pw.portid}|${from}|${to}|${offset}`, payload: body }], { runId, retrievalUrl: url }))
      ids.push([...rec.byKey.values()][0][0])
      if (!body.exceededTransferLimit && feats.length < 1000) break
    }
    await logEnd(pool, S, fid, { status: 'succeeded', calls, events: rows, complete: true, recordId: ids[0] ?? null, stats: { record_ids: ids } })
    return { calls }
  } catch (e) {
    await logEnd(pool, S, fid, { status: 'failed', calls, error: e.message }).catch(() => {})
    throw e
  }
}

/** The PortWatch window for a card: the card's window, clamped to PortWatch's first day. null = nothing to ask. */
export function portWatchWindow(win) {
  const from = win.from < PW_FIRST_DAY ? PW_FIRST_DAY : win.from
  return from < win.to ? { from, to: win.to } : null
}

/**
 * Make sure the card's evidence is stored: GFW labels (discovery), monthly totals, the listed month's visits, and the
 * PortWatch series. Each step runs only when its log says so, and GFW steps only under the daily guardrail.
 * Returns what happened per step: 'fresh' | 'fetched' | 'failed' | 'no_gfw' | 'budget' | 'none'.
 */
export async function ensurePortCard(pool, S, portId, { win, gfw = null, fetchJson = null, now = new Date(), budget = DAILY_GFW_CALLS, force = false }) {
  const q = async (text, params) => (await pool.query(text, params)).rows
  const pl = await portAndLabels(q, S, portId)
  if (!pl) return { status: 'not_found' }
  const { port } = pl
  let labels = pl.labels.map((l) => l.label)
  const out = { discover: 'none', stats: 'none', events: 'none', portwatch: 'none', calls: { gfw: 0, portwatch: 0 } }
  const log = force ? [] : await recentFetches(q, S, port.id)
  const budgetLeft = gfw ? budget - (await gfwCallsToday(q, S)) : 0
  const needRun = () => out.runId
  const run = async () => {
    if (out.runId) return out.runId
    await ensurePortCardSources(pool, S)
    out.runId = await withTx(pool, (c) => startRun(c, S, PORT_VISITS_SOURCE.id, { portCard: port.id, from: win.from, to: win.to, month: win.month }))
    return out.runId
  }
  // 1. No GFW label for this port yet: look around it once for the listed month.
  if (!labels.length && Number.isFinite(port.lat)) {
    const done = log.find((r) => r.kind === 'discover' && (r.stats?.labels?.length || String(r.range_from instanceof Date ? r.range_from.toISOString() : r.range_from).slice(0, 10) === win.monthFrom)
      && now - new Date(r.finished_at) < FULL_REFRESH_DAYS * 864e5)
    if (done) out.discover = 'fresh'
    else if (!gfw) out.discover = 'no_gfw'
    else if (budgetLeft < 1) out.discover = 'budget'
    else {
      try {
        const r = await discover(pool, S, { port, win, gfw, runId: await run() })
        out.calls.gfw += r.calls; out.discover = 'fetched'
        labels = (await portAndLabels(q, S, portId))?.labels.map((l) => l.label) || []
      } catch (e) { console.error('ships port discover', port.id, e.message); out.discover = 'failed' }
    }
  }
  // 2 + 3. Totals for the window and the listed month's visits (independent; in parallel).
  const gfwSteps = []
  if (labels.length) {
    const st = matchingFetch(log, { kind: 'stats', labels, from: win.from, to: win.to }, now)
    if (st && fetchIsFresh(st, now)) out.stats = 'fresh'
    else if (!gfw) out.stats = 'no_gfw'
    else if (budgetLeft - out.calls.gfw < 1) out.stats = 'budget'
    else gfwSteps.push(run().then((runId) => fetchStats(pool, S, { port, labels, win, gfw, runId }))
      .then((r) => { out.calls.gfw += r.calls; out.stats = 'fetched' }, (e) => { console.error('ships port stats', port.id, e.message); out.stats = 'failed' }))
    const ev = matchingFetch(log, { kind: 'events', labels, from: win.monthFrom, to: win.monthTo }, now)
    if (ev && fetchIsFresh(ev, now)) out.events = 'fresh'
    else if (!gfw) out.events = 'no_gfw'
    else if (budgetLeft - out.calls.gfw < EVENT_PAGES + 1) out.events = 'budget'
    else gfwSteps.push(run().then((runId) => fetchMonthEvents(pool, S, { port, labels, win, gfw, runId }))
      .then((r) => { out.calls.gfw += r.calls; out.events = 'fetched' }, (e) => { console.error('ships port events', port.id, e.message); out.events = 'failed' }))
  }
  // 4. PortWatch (public ArcGIS, no quota) for a WPI port whose UN/LOCODE joins exactly one PortWatch port.
  const pwWin = portWatchWindow(win)
  if (port.unlocode && pwWin) {
    const join = await portWatchJoin(q, S, port)
    if (join.status === 'joined') {
      const pf = matchingFetch(log, { kind: 'portwatch', from: pwWin.from, to: pwWin.to, extKey: join.pw.portid }, now)
      if (pf && fetchIsFresh(pf, now)) out.portwatch = 'fresh'
      else if (!fetchJson) out.portwatch = 'no_fetch'
      else gfwSteps.push(run().then((runId) => fetchPortWatch(pool, S, { port, pw: join.pw, ...pwWin, fetchJson, runId }))
        .then((r) => { out.calls.portwatch += r.calls; out.portwatch = 'fetched' }, (e) => { console.error('ships portwatch', port.id, e.message); out.portwatch = 'failed' }))
    }
  }
  await Promise.all(gfwSteps)
  if (needRun()) {
    const failed = ['discover', 'stats', 'events', 'portwatch'].some((k) => out[k] === 'failed')
    await withTx(pool, (c) => finishRun(c, S, out.runId, { status: failed ? 'failed' : 'succeeded', stats: out })).catch(() => {})
  }
  return { status: 'ok', ...out }
}

// ── Read (no network) ────────────────────────────────────────────────────────

const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d))

/**
 * Everything the card shows, from the database only. `offset`/`limit` page the ship list.
 * Ships = one row per GFW identity that began a visit at the port's labels in the listed month.
 */
export async function readPortCard(q, S, portId, { win, limit = 50, offset = 0, now = new Date() }) {
  const pl = await portAndLabels(q, S, portId)
  if (!pl) return null
  const { port } = pl
  const labels = pl.labels.map((l) => l.label)
  const log = await recentFetches(q, S, port.id)
  const lim = Math.max(1, Math.min(200, Number(limit) || 50)), off = Math.max(0, Number(offset) || 0)

  // Totals (GFW /events/stats), from the stored response.
  let stats = null
  const st = labels.length ? matchingFetch(log, { kind: 'stats', labels, from: win.from, to: win.to }, now) : null
  if (st?.source_record_id) {
    const [r] = await q(`SELECT id, payload, last_retrieved_at, dataset_version FROM ${S}.source_records WHERE id = $1`, [st.source_record_id])
    const b = r?.payload?.response
    if (b) {
      stats = { recordId: r.id, fetchedAt: iso(st.finished_at), numEvents: b.numEvents ?? null, numVessels: b.numVessels ?? null, numFlags: b.numFlags ?? null,
        months: (b.timeseries || []).map((x) => ({ month: String(x.date).slice(0, 7), n: Number(x.value) || 0 })) }
      // Months with no arrivals are missing from GFW's series: fill them with 0 only inside the asked window.
      const have = new Map(stats.months.map((m) => [m.month, m.n]))
      stats.months = win.months.map((m) => ({ month: m, n: have.get(m) ?? 0 }))
    }
  }

  // Ships in the listed month.
  const ev = labels.length ? matchingFetch(log, { kind: 'events', labels, from: win.monthFrom, to: win.monthTo }, now) : null
  let ships = { month: win.month, total: 0, arrivals: 0, list: [], kinds: [], fetchedAt: iso(ev?.finished_at), complete: ev?.complete ?? null, gfwTotal: ev?.stats?.total ?? null }
  if (labels.length) {
    const where = `pv.status = 'active' AND pv.source_id = 'gfw-port-visits' AND pv.int_port_label = ANY($1) AND pv.start_at >= $2::date AND pv.start_at < $3::date`
    const args = [labels, win.monthFrom, win.monthTo]
    const [[sum], list, kinds] = await Promise.all([
      q(`SELECT count(*)::int AS arrivals, count(DISTINCT pv.gfw_vessel_id)::int AS ships FROM ${S}.port_visits pv WHERE ${where}`, args),
      q(`SELECT pv.gfw_vessel_id, count(*)::int AS calls, min(pv.start_at) AS first_at, max(pv.start_at) AS last_at,
                sum(pv.duration_hrs) AS hours, max(pv.confidence) AS best_conf,
                (array_agg(pv.ssvid ORDER BY pv.start_at DESC))[1] AS ssvid,
                (array_agg(pv.vessel_name_raw ORDER BY pv.start_at DESC) FILTER (WHERE pv.vessel_name_raw IS NOT NULL))[1] AS name,
                (array_agg(pv.detail->>'vessel_type' ORDER BY pv.start_at DESC))[1] AS gfw_type,
                (array_agg(pv.detail->>'vessel_flag' ORDER BY pv.start_at DESC))[1] AS flag,
                (array_agg(pv.last_source_record_id ORDER BY pv.start_at DESC))[1] AS record_id,
                (array_agg(pv.event_id ORDER BY pv.start_at DESC))[1] AS event_id
           FROM ${S}.port_visits pv WHERE ${where}
          GROUP BY pv.gfw_vessel_id ORDER BY calls DESC, last_at DESC, pv.gfw_vessel_id LIMIT ${lim} OFFSET ${off}`, args),
      q(`SELECT coalesce(nullif(pv.detail->>'vessel_type', ''), 'NA') AS kind, count(*)::int AS arrivals, count(DISTINCT pv.gfw_vessel_id)::int AS ships
           FROM ${S}.port_visits pv WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`, args),
    ])
    // Which EarthAtlas ship each row is: the exact GFW identity first; else the MMSI at the time of the last arrival.
    const gfwIds = list.map((r) => r.gfw_vessel_id)
    const byGfw = gfwIds.length ? await q(
      `SELECT sub_record_ref AS gfw_id, array_agg(DISTINCT vessel_id) AS vessel_ids FROM ${S}.vessel_assertions
        WHERE source_id = 'gfw-vessel-identity' AND sub_record_ref = ANY($1) GROUP BY 1`, [gfwIds]) : []
    const g = new Map(byGfw.map((r) => [r.gfw_id, r.vessel_ids]))
    const needMmsi = list.filter((r) => (g.get(r.gfw_vessel_id) || []).length !== 1 && /^\d{9}$/.test(String(r.ssvid || '')))
    const byMmsi = needMmsi.length ? await q(
      `SELECT x.gfw_id, array_agg(DISTINCT v.vessel_id) AS vessel_ids
         FROM unnest($1::text[], $2::text[], $3::timestamptz[]) AS x(gfw_id, mmsi, at)
         CROSS JOIN LATERAL ${S}.vessels_for_mmsi_at(x.mmsi, x.at) v GROUP BY 1`,
      [needMmsi.map((r) => r.gfw_vessel_id), needMmsi.map((r) => String(r.ssvid)), needMmsi.map((r) => iso(r.last_at))]) : []
    const m = new Map(byMmsi.map((r) => [r.gfw_id, r.vessel_ids]))
    ships = {
      ...ships, total: sum.ships, arrivals: sum.arrivals, kinds, offset: off, limit: lim,
      list: list.map((r) => {
        const ids = g.get(r.gfw_vessel_id) || []
        const mm = m.get(r.gfw_vessel_id) || []
        const vesselId = ids.length === 1 ? ids[0] : mm.length === 1 ? mm[0] : null
        return { gfwId: r.gfw_vessel_id, name: r.name, mmsi: r.ssvid, flag: r.flag, gfwType: r.gfw_type, calls: r.calls,
          firstAt: iso(r.first_at), lastAt: iso(r.last_at), hours: r.hours == null ? null : Number(r.hours), bestConfidence: r.best_conf,
          recordId: r.record_id, eventId: r.event_id, vesselId,
          resolvedBy: vesselId ? (ids.length === 1 ? 'gfw_identity' : 'mmsi_at_time') : (ids.length > 1 || mm.length > 1 ? 'ambiguous' : null) }
      }),
    }
  }

  // No labels: what the discovery found nearby (labels that are other ports).
  let nearby = []
  if (!labels.length) {
    const d = log.find((r) => r.kind === 'discover' && r.stats?.labels?.length)
    if (d) {
      const ls = d.stats.labels.map((l) => l.label)
      nearby = await q(`SELECT a.key AS label, p.id AS port_id, p.name, p.origin FROM ${S}.port_aliases a JOIN ${S}.ports p ON p.id = a.port_id
                         WHERE a.key_kind = 'gfw_port_label' AND a.status = 'accepted' AND a.key = ANY($1) ORDER BY p.name`, [ls])
    }
  }
  const discovered = log.find((r) => r.kind === 'discover') || null

  // PortWatch (read-time join, stored series).
  let portwatch = null
  if (port.unlocode) {
    const join = await portWatchJoin(q, S, port)
    portwatch = { join: join.status, km: join.km ?? null }
    const pwWin = portWatchWindow(win)
    if (join.status === 'joined' && pwWin) {
      const pf = matchingFetch(log, { kind: 'portwatch', from: pwWin.from, to: pwWin.to, extKey: join.pw.portid }, now)
      const ids = pf?.stats?.record_ids || []
      const recs = ids.length ? await q(`SELECT id, payload FROM ${S}.source_records WHERE id = ANY($1)`, [ids]) : []
      const rows = recs.flatMap((r) => (r.payload?.features || []).map((f) => f.attributes))
      const keys = ['portcalls', ...PW_TYPES.map(([k]) => `portcalls_${k}`), 'import', 'export']
      const series = smoothDaily(rows, keys)
      const totals = Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)]))
      portwatch = { ...portwatch, portid: join.pw.portid, name: join.pw.portname, country: join.pw.country, pageid: join.pw.pageid,
        portRecordId: join.pw.record_id, window: pwWin, fetchedAt: iso(pf?.finished_at), days: series.length,
        lastDate: series.length ? series[series.length - 1].date : null, totals,
        // Compact columns for the card: 7-day means only (the daily values stay in the stored records).
        series: { dates: series.map((r) => r.date), calls7: series.map((r) => r.portcalls7), import7: series.map((r) => r.import7),
          export7: series.map((r) => r.export7), byType7: Object.fromEntries(PW_TYPES.map(([k]) => [k, series.map((r) => r[`portcalls_${k}7`])])) } }
    }
  }
  return { port, labels: pl.labels, window: win, stats, ships, nearby, discovered: discovered ? { at: iso(discovered.finished_at), month: iso(discovered.range_from)?.slice(0, 7) } : null, portwatch }
}

// ── The map layer ─────────────────────────────────────────────────────────────

/** Name methods that give a real name to a GFW-label port ("near X" approximations and unnamed labels stay off the map). */
export const MAP_NAME_METHODS = ['gfw_override_label', 'gfw_override_label_majority', 'gfw_event_name', 'gfw_override_nearest',
  'gfw_override_label_over_wpi_facility', 'gfw_override_label_majority_over_wpi_facility', 'gfw_override_nearest_over_wpi_facility', 'gfw_event_name_over_wpi_facility']

// GFW's names come upper-case ("DEER HARBOR"); WPI's are shown as WPI writes them (same rule as the ship card).
const titleCase = (x) => String(x).toLowerCase().replace(/(^|[\s\-'/(])([a-z])/g, (_, a, c) => a + c.toUpperCase())

/** Every port for the map as a compact GeoJSON FeatureCollection: WPI ports + GFW-label ports with a real name + Climate TRACE-only
 * and DFO small-craft-harbour-only ports (g = 1: drawn as a hollow ring, "Port outside the World Port Index"). */
export async function portsLayer(q, S) {
  const rows = await q(
    `SELECT p.id, p.origin, p.name, p.harbor_size, p.lat, p.lon FROM ${S}.ports p
      WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL AND p.name IS NOT NULL
        AND (p.origin IN ('wpi', 'climate_trace') OR (p.name_method = ANY($1) AND EXISTS (SELECT 1 FROM ${S}.port_aliases a
              WHERE a.port_id = p.id AND a.key_kind = 'gfw_port_label' AND a.status = 'accepted'))
             -- A DFO small craft harbour with no other map port within 4 km (lib/ships/officialPorts.js), while that decision stands.
             OR (p.origin = 'dfo_sch' AND EXISTS (SELECT 1 FROM ${S}.port_aliases a
              WHERE a.port_id = p.id AND a.key_kind = 'dfo_sch_harbour' AND a.status = 'accepted' AND a.key = p.origin_key)))
      ORDER BY p.id`, [MAP_NAME_METHODS])
  const r5 = (x) => Math.round(Number(x) * 1e5) / 1e5
  return {
    type: 'FeatureCollection',
    features: rows.map((p) => ({ type: 'Feature', id: Number(p.id), geometry: { type: 'Point', coordinates: [r5(p.lon), r5(p.lat)] },
      properties: { i: Number(p.id), n: p.origin === 'gfw_port_label' ? titleCase(p.name) : p.name, s: p.harbor_size || null, g: p.origin === 'wpi' ? 0 : 1 } })),
  }
}

// ── A listed ship not in our database yet ────────────────────────────────────

/**
 * Save GFW's identity for a ship listed on a port card (one GFW detail call; the normal ingest + resolver).
 * Guardrail: only a GFW identity that appears in a stored port visit. Returns { status, vesselId? }.
 */
export async function savePortShip(pool, S, gfwId, gfw) {
  if (!/^[0-9a-f-]{20,64}$/i.test(String(gfwId))) return { status: 'bad_id' }
  const { rows: seen } = await pool.query(`SELECT 1 FROM ${S}.port_visits WHERE gfw_vessel_id = $1 LIMIT 1`, [gfwId])
  if (!seen.length) return { status: 'not_in_port_visits' }
  const known = async () => (await pool.query(
    `SELECT DISTINCT vessel_id FROM ${S}.vessel_assertions WHERE source_id = 'gfw-vessel-identity' AND sub_record_ref = $1`, [gfwId])).rows
  let v = await known()
  if (v.length === 1) return { status: 'db', vesselId: v[0].vessel_id }
  if (v.length > 1) return { status: 'ambiguous' }
  if (!gfw) return { status: 'no_gfw' }
  await ensureGfwSource(pool, S)
  const { url, body } = await gfw.byIds([gfwId])
  for (const e of body.entries || []) await ingestGfwEntry(pool, S, e, { retrievalUrl: url })
  v = await known()
  return v.length === 1 ? { status: 'saved', vesselId: v[0].vessel_id } : { status: v.length ? 'ambiguous' : 'unknown' }
}

export const PORT_CARD_SOURCE_IDS = [PORT_VISITS_SOURCE.id, PORTWATCH_SOURCE.id]
// For tests / callers that want the content hash of a stored payload.
export const payloadSha = (p) => sha256(canonicalJson(p))
