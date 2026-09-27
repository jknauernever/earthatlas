/**
 * Database tests for port visits. DEV database in SHIPS_DATABASE_URL, throwaway schema
 * (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN)
 * without the URL. No live GFW calls: a replay client serves the REAL responses recorded
 * 2026-09-26 (fixtures/README.md, "Port visits"). Edited copies are marked SYNTHETIC.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { ensurePortVisits, ensurePortVisitSource, ingestPortVisitEvents, vesselPortVisits, PORT_VISITS_SOURCE } from '../portVisits.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const count = async (sql, params) => Number((await q(sql, params))[0].n)

const ed = fixture('gfw-live-portvisits-eurodam-2026-09-26.json')
const lr = fixture('gfw-live-portvisits-linnea-rose-2026-09-26.json')
const EURODAM_MAIN = '6d8a6e1eb-b3d2-0380-37fd-33d6c9a79741'
const NOW = new Date('2026-09-26T20:00:00Z')
const WIN = { from: '2024-09-26', to: '2026-09-27' }

/** Replays recorded GFW events like the API does: filter by ids + overlap, oldest first, limit/offset. */
function replay(entries, { pageLimit } = {}) {
  const r = { calls: 0, requests: [] }
  r.portVisits = async ({ vesselIds, from, to, limit, offset }) => {
    r.calls++; r.requests.push({ vesselIds: [...vesselIds], from, to, offset })
    const lim = pageLimit ?? limit
    const hits = entries.filter((e) => vesselIds.includes(e.vessel.id) && e.start < `${to}T00:00:00Z` && e.end >= `${from}T00:00:00Z`)
      .sort((a, b) => a.start.localeCompare(b.start))
    const page = hits.slice(offset, offset + lim)
    return { url: `https://gateway.api.globalfishingwatch.org/v3/events?replay&offset=${offset}`, datasets: 'public-global-port-visits-events:v4.0',
      body: { total: hits.length, limit: lim, offset, nextOffset: offset + lim < hits.length ? offset + lim : null, entries: structuredClone(page) } }
  }
  return r
}

const V = {}
before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensureGfwSource(pool, S)
  V.eurodam = (await ingestGfwEntry(pool, S, fixture('gfw-live-eurodam-2026-09-25.json'))).resolution.vesselId
  V.linnea = (await ingestGfwEntry(pool, S, fixture('gfw-live-linnea-rose-2026-09-24.json'))).resolution.vesselId
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA ${S} CASCADE`)
  await pool.end()
})

test('migration 007 registers its tables; the source row carries the GFW licence', { skip }, async () => {
  await ensurePortVisitSource(pool, S)
  const [src] = await q(`SELECT license, commercial_use, attribution_text, attribution_url FROM ${S}.sources WHERE id = $1`, [PORT_VISITS_SOURCE.id])
  assert.deepEqual(src, { license: 'CC BY-NC 4.0', commercial_use: false, attribution_text: 'Powered by Global Fishing Watch.', attribution_url: 'https://globalfishingwatch.org' })
  assert.equal(await count(`SELECT count(*) n FROM ${S}.schema_migrations WHERE name = '007_port_visits.sql'`), 1)
})

test('EURODAM: fetch asks GFW for the ship\'s own identity only and stores its visits (tenders skipped)', { skip }, async () => {
  const gfw = replay(ed.body.entries)
  const r = await ensurePortVisits(pool, S, V.eurodam, gfw, { ...WIN, now: NOW })
  assert.equal(r.status, 'fetched')
  assert.deepEqual(gfw.requests.map((x) => x.vesselIds), [[EURODAM_MAIN]])
  assert.equal(r.skipped.length, 14)
  assert.equal(r.stats.visitsCreated, 8)
  assert.equal(await count(`SELECT count(*) n FROM ${S}.port_visits WHERE status = 'active'`), 8)
  assert.equal(await count(`SELECT count(*) n FROM ${S}.source_records WHERE source_id = 'gfw-port-visits'`), 8)
  // Raw payload stored exactly as received.
  const [rec] = await q(`SELECT r.payload FROM ${S}.port_visits pv JOIN ${S}.source_records r ON r.id = pv.last_source_record_id
                          WHERE pv.event_id = $1`, [ed.body.entries[0].id])
  assert.deepEqual(rec.payload, ed.body.entries[0])
  const [log] = await q(`SELECT status, gfw_calls, events_returned, range_from::text, range_to::text, gfw_vessel_ids, jsonb_array_length(skipped) AS skipped
                           FROM ${S}.port_visit_fetches WHERE vessel_id = $1`, [V.eurodam])
  assert.deepEqual(log, { status: 'succeeded', gfw_calls: 1, events_returned: 8, range_from: WIN.from, range_to: WIN.to, gfw_vessel_ids: [EURODAM_MAIN], skipped: 14 })
})

test('a repeat card open within 24 h does not call GFW', { skip }, async () => {
  const gfw = replay(ed.body.entries)
  const r = await ensurePortVisits(pool, S, V.eurodam, gfw, { ...WIN, now: new Date(NOW.getTime() + 3600e3) })
  assert.equal(r.status, 'fresh')
  assert.equal(gfw.calls, 0)
})

test('re-ingesting the same events changes nothing but last_* (idempotent)', { skip }, async () => {
  const before = await q(`SELECT id, content_sha256, status, first_source_record_id FROM ${S}.port_visits ORDER BY id`)
  const recs = await count(`SELECT count(*) n FROM ${S}.source_records`)
  const main = ed.body.entries.filter((e) => e.vessel.id === EURODAM_MAIN)
  const r = await withTx(pool, (c) => ingestPortVisitEvents(c, S, main, {}))
  assert.equal(r.recordsCreated, 0)
  assert.equal(r.visitsCreated, 0)
  assert.equal(r.visitsSeenAgain, 8)
  assert.equal(r.superseded, 0)
  assert.deepEqual(await q(`SELECT id, content_sha256, status, first_source_record_id FROM ${S}.port_visits ORDER BY id`), before)
  assert.equal(await count(`SELECT count(*) n FROM ${S}.source_records`), recs)
})

test('SYNTHETIC edit of a live event: GFW changing a visit supersedes the old claim and keeps both raw versions', { skip }, async () => {
  const ev = structuredClone(ed.body.entries[0]) // EURODAM's newest visit, confidence "3"
  ev.port_visit.confidence = '4'
  const r = await withTx(pool, (c) => ingestPortVisitEvents(c, S, [ev], {}))
  assert.equal(r.superseded, 1)
  assert.equal(r.visitsCreated, 1)
  assert.equal(r.recordsCreated, 1)
  const rows = await q(`SELECT status, confidence FROM ${S}.port_visits WHERE event_id = $1 ORDER BY id`, [ev.id])
  assert.deepEqual(rows, [{ status: 'superseded', confidence: 3 }, { status: 'active', confidence: 4 }])
  assert.equal(await count(`SELECT count(*) n FROM ${S}.source_records r JOIN ${S}.source_entities se ON se.id = r.source_entity_id
                             WHERE se.entity_key = $1`, [ev.id]), 2)
  // GFW reverting restores the first version (no third row).
  const back = await withTx(pool, (c) => ingestPortVisitEvents(c, S, [ed.body.entries[0]], {}))
  assert.equal(back.visitsCreated, 0)
  assert.deepEqual(await q(`SELECT status, confidence FROM ${S}.port_visits WHERE event_id = $1 ORDER BY id`, [ev.id]),
    [{ status: 'active', confidence: 3 }, { status: 'superseded', confidence: 4 }])
})

test('a complete re-fetch that no longer returns a visit marks it withdrawn (kept, not deleted)', { skip }, async () => {
  const main = ed.body.entries.filter((e) => e.vessel.id === EURODAM_MAIN)
  const gone = main[3]
  const gfw = replay(ed.body.entries.filter((e) => e.id !== gone.id))
  const later = new Date(NOW.getTime() + 3 * 864e5)
  const r = await ensurePortVisits(pool, S, V.eurodam, gfw, { from: WIN.from, to: '2026-09-30', now: later })
  assert.equal(r.status, 'fetched')
  assert.equal(r.plan.incremental, true)              // only the unsettled tail was asked for
  assert.equal(gfw.requests[0].from, '2026-09-13')
  assert.equal(r.stats.withdrawn, 1)
  assert.deepEqual(await q(`SELECT status FROM ${S}.port_visits WHERE event_id = $1`, [gone.id]), [{ status: 'withdrawn' }])
  // It comes back: re-activated, still one row.
  await withTx(pool, (c) => ingestPortVisitEvents(c, S, [gone], {}))
  assert.deepEqual(await q(`SELECT status FROM ${S}.port_visits WHERE event_id = $1`, [gone.id]), [{ status: 'active' }])
})

test('paging: a multi-page fetch stores everything once (LINNEA ROSE, 3 per page)', { skip }, async () => {
  const gfw = replay(lr.body.entries, { pageLimit: 3 })
  const r = await ensurePortVisits(pool, S, V.linnea, gfw, { ...WIN, now: NOW })
  assert.equal(r.status, 'fetched')
  assert.equal(gfw.calls, 4)
  assert.equal(r.stats.visitsCreated, 10)
  assert.equal(r.stats.complete, true)
})

test('the card read: newest first, summary over the window, own identities only, record ids for provenance', { skip }, async () => {
  const out = await vesselPortVisits(q, S, V.eurodam, { ...WIN, limit: 3 })
  assert.equal(out.total, 8)
  assert.equal(out.visits.length, 3)
  const starts = out.visits.map((v) => new Date(v.start_at).getTime())
  assert.deepEqual(starts, [...starts].sort((a, b) => b - a))
  assert.ok(out.visits.every((v) => v.gfw_vessel_id === EURODAM_MAIN && v.last_source_record_id))
  assert.ok(out.topPorts.length > 0 && out.topPorts[0].n >= out.topPorts.at(-1).n)
  assert.equal(out.topPorts.reduce((s, p) => s + p.n, 0) <= 8, true)
  assert.ok(out.fetchedAt)
  const page2 = await vesselPortVisits(q, S, V.eurodam, { ...WIN, limit: 3, offset: 3 })
  assert.equal(page2.visits.length, 3)
  assert.ok(new Date(page2.visits[0].start_at) <= new Date(out.visits[2].start_at))
  const lrOut = await vesselPortVisits(q, S, V.linnea, WIN)
  assert.equal(lrOut.total, 10)
})

test('a vessel with no GFW identity gets nothing and never reaches GFW', { skip }, async () => {
  const [{ id }] = await q(`INSERT INTO ${S}.vessels DEFAULT VALUES RETURNING id`)
  const gfw = replay([])
  assert.deepEqual(await ensurePortVisits(pool, S, id, gfw, { ...WIN, now: NOW }), { status: 'no_gfw_identity' })
  assert.equal(gfw.calls, 0)
})
