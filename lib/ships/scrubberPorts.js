/**
 * "Where else these ships call": port visits worldwide by the scrubber-fitted ships of the scrubber report (docs/SHIPS_SCRUBBER_REPORT.md
 * step 5; Josh 2026-10-07). Port visits are Global Fishing Watch's apparent port visits (lib/ships/portVisits.js, the ship card's
 * Ports tab), fetched once per ship and refreshed by the same plan the card uses, so a ship already fetched costs nothing.
 *
 *   fetch   scrubberPortsBatch: one time-boxed batch of ships (POST /api/ships?op=scrubberPortVisits, CRON_SECRET), resumable by offset
 *   read    scrubberWorldPorts: visits in a period grouped by port and by country, each port named as on the ship cards
 *           (World Port Index first, then GFW); a ship's visits are read through the GFW identities its latest fetch used (ownIdentities)
 */
import { SCRUBBER_SOURCES } from './scrubberFilter.js'
import { ensurePortVisits, PORT_VISITS_SOURCE } from './portVisits.js'
import { nameVisits } from './ports.js'
import { BAKE_VERSION as CALLS_VERSION } from './terminalCalls.js'
import { ACTIVITY_BAKE_VERSION } from './activityEstimates.js'

export const WORLD_FROM = '2025-01-01'   // the report's first month; the fetch window runs from here to today

/** Every scrubber-fitted vessel (scrubberFilter.js's rule), in a stable order for resumable batches. */
export async function scrubberVesselIds(q, S) {
  const rows = await q(
    `SELECT DISTINCT va.vessel_id::text AS id FROM ${S}.vessel_assertions va
       JOIN ${S}.entity_links l ON l.source_entity_id = va.source_entity_id AND l.status = 'accepted'
      WHERE va.attribute = 'scrubber' AND (va.source_id = $1 OR va.source_id = ANY($2)) ORDER BY 1`,
    [SCRUBBER_SOURCES.gisis, SCRUBBER_SOURCES.mep])
  return rows.map((r) => r.id)
}

/**
 * Fetch / refresh port visits for ships [offset, …) until `budgetMs` is spent (a Vercel function has 300 s). Each ship: the card's
 * ensurePortVisits over [WORLD_FROM, tomorrow) (nothing is fetched when its last fetch is fresh), then its ports are named.
 * → { total, next, done, ships: { fetched, fresh, noIdentity, failed }, calls }
 */
export async function scrubberPortsBatch(pool, S, gfw, { offset = 0, budgetMs = 240_000, max = Infinity, now = new Date() } = {}) {
  const q = async (t, a) => (await pool.query(t, a)).rows
  const ids = await scrubberVesselIds(q, S)
  const to = new Date(now.getTime() + 86400e3).toISOString().slice(0, 10)
  const out = { fetched: 0, fresh: 0, noIdentity: 0, failed: 0 }
  let calls = 0, i = Math.max(0, Number(offset) || 0)
  const t0 = Date.now()
  const stop = Math.min(ids.length, i + max)
  for (; i < stop && Date.now() - t0 < budgetMs; i++) {
    try {
      const r = await ensurePortVisits(pool, S, ids[i], gfw, { from: WORLD_FROM, to, now })
      calls += r.calls || 0
      if (r.status === 'fetched') { out.fetched++; await nameVisits(pool, S, r.gfwIds) }
      else if (r.status === 'fresh') out.fresh++
      else if (r.status === 'no_gfw_identity') out.noIdentity++
      else out.failed++
    } catch (e) {
      out.failed++
      console.error('scrubber port visits', ids[i], String(e.message).slice(0, 200))
      if (/429|rate|quota/i.test(String(e.message))) { i++; break }   // GFW says slow down: stop this batch, resume later
    }
  }
  return { total: ids.length, next: i, done: i >= ids.length, ships: out, calls }
}

/**
 * Visits by scrubber ships in [from, to) months, worldwide, grouped by port and by country. Only ships whose port visits have been
 * fetched count; `coverage` says how many. → { coverage: { ships, fetched, since }, ports: [...], countries: [...] }
 */
export async function scrubberWorldPorts(q, S, { from, to, states = null }) {
  // states (e.g. ['WA']): only the scrubber ships that called at a terminal there in the period, counted by NOAA (terminal_calls) or
  // estimated from hourly positions (the stop's nearest terminal), the MMSI held at the time.
  const params = [SCRUBBER_SOURCES.gisis, SCRUBBER_SOURCES.mep, `${from}-01`, `${to}-01`, states || []]
  const base = `
    WITH sv0 AS (
      SELECT DISTINCT va.vessel_id FROM ${S}.vessel_assertions va
        JOIN ${S}.entity_links l ON l.source_entity_id = va.source_entity_id AND l.status = 'accepted'
       WHERE va.attribute = 'scrubber' AND (va.source_id = $1 OR va.source_id = ANY($2))),
    sm AS (
      SELECT m.vessel_id, m.value_norm AS mmsi, m.period, m.period_kind FROM ${S}.vessel_assertions m JOIN sv0 ON sv0.vessel_id = m.vessel_id
       WHERE m.attribute = 'mmsi'),
    sv AS (
      SELECT vessel_id FROM sv0 WHERE cardinality($5::text[]) = 0
      UNION
      SELECT sm.vessel_id FROM ${S}.terminal_calls tc JOIN ${S}.terminals t ON t.key = tc.terminal_key AND t.state_code = ANY($5::text[])
        JOIN sm ON sm.mmsi = tc.mmsi AND (sm.period_kind = 'unknown' OR sm.period IS NULL OR sm.period @> tc.t0)
       WHERE tc.bake_version = '${CALLS_VERSION}' AND tc.t0 >= $3::date AND tc.t0 < ($4::date + interval '1 month')
      UNION
      SELECT sm.vessel_id FROM ${S}.terminal_call_estimates e JOIN ${S}.terminals t ON t.key = e.nearest_terminal AND t.state_code = ANY($5::text[])
        JOIN sm ON sm.mmsi = e.mmsi AND (sm.period_kind = 'unknown' OR sm.period IS NULL OR sm.period @> e.t0)
       WHERE e.bake_version = '${ACTIVITY_BAKE_VERSION}' AND e.t0 >= $3::date AND e.t0 < ($4::date + interval '1 month')),
    f AS (
      SELECT DISTINCT ON (pf.vessel_id) pf.vessel_id, pf.gfw_vessel_ids, pf.finished_at FROM ${S}.port_visit_fetches pf
        JOIN sv ON sv.vessel_id = pf.vessel_id
       WHERE pf.status = 'succeeded' ORDER BY pf.vessel_id, pf.finished_at DESC),
    g AS (SELECT f.vessel_id, unnest(f.gfw_vessel_ids) AS gfw_id FROM f),
    v AS (
      SELECT pv.id, g.vessel_id, pv.port_id, pv.int_port_label, pv.int_name, pv.int_iso3, pv.start_at
        FROM ${S}.port_visits pv JOIN g ON g.gfw_id = pv.gfw_vessel_id
       WHERE pv.status = 'active' AND pv.start_at >= $3::date AND pv.start_at < ($4::date + interval '1 month'))`
  const [cov, ports, countries] = await Promise.all([
    q(`${base} SELECT (SELECT count(*) FROM sv)::int AS ships, (SELECT count(*) FROM f)::int AS fetched, (SELECT min(finished_at) FROM f) AS oldest_fetch`, params),
    q(`${base}
       SELECT coalesce('p' || v.port_id::text, 'l' || v.int_port_label) AS key, max(p.name) AS port_name, max(v.int_name) AS gfw_name,
              min(v.int_port_label) AS port_label, coalesce(max(p.iso3), max(v.int_iso3)) AS iso3, max(cn.name) AS country,
              max(p.name_source_id) AS name_source_id, count(*)::int AS visits, count(DISTINCT v.vessel_id)::int AS ships,
              max(p.lat) AS lat, max(p.lon) AS lon
         FROM v LEFT JOIN ${S}.ports p ON p.id = v.port_id LEFT JOIN ${S}.countries cn ON cn.iso3 = coalesce(p.iso3, v.int_iso3)
        GROUP BY 1 ORDER BY visits DESC, key LIMIT 300`, params),
    q(`${base}
       SELECT v.int_iso3 AS iso3, max(cn.name) AS country, count(*)::int AS visits, count(DISTINCT v.vessel_id)::int AS ships
         FROM v LEFT JOIN ${S}.countries cn ON cn.iso3 = v.int_iso3 GROUP BY 1 ORDER BY visits DESC`, params),
  ])
  return { source: PORT_VISITS_SOURCE.id, coverage: cov[0], ports, countries }
}
