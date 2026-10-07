/**
 * GFW-estimated terminal visits (lib/ships/activityEstimates.js, migration 025). Pure tests run offline; DB tests run on the DEV
 * database in a throwaway schema (ships_t_<random>), dropped afterwards; never "ships", never production. DB tests are skipped
 * (NOT RUN) without SHIPS_DATABASE_URL. Inputs are REAL: activity.py's June 2026 stops at the fixture terminals
 * (fixtures/gfw-activity-stops-2026-06.json) and the terminals of terminals-live-2026-09-27.json.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { loadTerminalData, importTerminals, ensureTerminalSources, parseCsv } from '../terminals.js'
import { normalizeStops, storeActivityEstimates, ACTIVITY_RULE, TERMINAL_ESTIMATES_SOURCE } from '../activityEstimates.js'
import { fixture } from './scenarios.js'

const stops = fixture('gfw-activity-stops-2026-06.json').rows

test('normalizeStops: keeps one kind, nearest terminal first, ISO times, bad MMSI → null', () => {
  const r = normalizeStops('terminal', stops)
  assert.equal(r.length, stops.length)
  const hfs = r.find((x) => x.candidates.length === 2 && x.nearest === 'wa-marathon-anacortes')
  assert.ok(hfs, 'a Marathon-nearest stop in the HF Sinclair + Marathon group')
  assert.deepEqual(hfs.candidates, ['wa-marathon-anacortes', 'wa-hfs-puget-sound'])
  assert.match(r[0].t0, /^2026-06-\d\dT\d\d:00:00\.000Z$/)
  assert.equal(normalizeStops('anchorage', stops).length, 0)
  assert.equal(normalizeStops('terminal', [{ ...stops[0], mmsi: 'x1' }])[0].mmsi, null)
})

test('normalizeStops: refuses malformed rows (nothing half-stored)', () => {
  assert.throws(() => normalizeStops('terminal', [{ ...stops[0], t1: stops[0].t0 }]), /bad t0\/t1/)
  assert.throws(() => normalizeStops('terminal', [{ ...stops[0], vid: '' }]), /no GFW vessel id/)
  assert.throws(() => normalizeStops('anchorage', [{ ...stops[0], kind: 'anchorage', target: 'wa-x' }]), /anchorage wa-x/)
  assert.deepEqual(normalizeStops('anchorage', [{ ...stops[0], kind: 'anchorage', target: 'noaa-mc-anchorages|1234' }]).map((x) => [x.anchorageSourceId, x.anchorageSourceKey]), [['noaa-mc-anchorages', '1234']])
})

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

before(async () => {
  if (skip) return
  const fx = fixture('terminals-live-2026-09-27.json')
  const full = await loadTerminalData()
  const data = { main: { ...full.main, terminals: full.main.terminals.filter((t) => fx.terminals.includes(t.id)) },
    osm: { ...full.osm, berths: full.osm.berths.filter((b) => fx.terminals.includes(b.terminal)) } }
  const raw = { usace: fx.usace.features, ecology: fx.ecology.features, bcpt: fx.bcpt.features, osm: { elements: fx.osm.elements, osmBase: fx.osm.osm_base },
    gem: parseCsv(fx.gem.csv), ctRefinery: fx.ct_refinery.features, release: fx.ct_refinery.release,
    urls: { usace: fx.usace.url, ecology: fx.ecology.url, bcpt: fx.bcpt.url, osm: fx.osm.url, gem: fx.gem.url, ct: 'x' } }
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, (c) => ensureTerminalSources(c, S))
  await withTx(pool, (c) => importTerminals(c, S, data, raw))
})
after(async () => { if (skip) return; await pool.query(`DROP SCHEMA ${S} CASCADE`); await pool.end() })

test('store: a month of estimates with its record and source; a re-import replaces the month, never adds', { skip }, async () => {
  const rows = normalizeStops('terminal', stops)
  const r1 = await withTx(pool, (c) => storeActivityEstimates(c, S, { kind: 'terminal', month: '2026-06', through: '2026-06-30', rows }))
  assert.equal(r1.rows, 438)
  const [n1] = await q(`SELECT count(*)::int n, count(DISTINCT bake_record_id)::int recs FROM ${S}.terminal_call_estimates`)
  assert.deepEqual(n1, { n: 438, recs: 1 })
  const [src] = await q(`SELECT license, commercial_use FROM ${S}.sources WHERE id = $1`, [TERMINAL_ESTIMATES_SOURCE.id])
  assert.deepEqual(src, { license: 'CC BY-NC 4.0', commercial_use: false })
  const [bake] = await q(`SELECT rows, through::text, rule FROM ${S}.activity_estimate_bakes WHERE kind = 'terminal' AND month = '2026-06'`)
  assert.deepEqual(bake, { rows: 438, through: '2026-06-30', rule: { ...ACTIVITY_RULE } })
  const shared = await q(`SELECT candidates FROM ${S}.terminal_call_estimates WHERE 'wa-hfs-puget-sound' = ANY(candidates) LIMIT 1`)
  assert.equal(shared[0].candidates.length, 2)
  // Daily re-run: the month comes again with fewer rows (GFW revised); the month is replaced whole.
  await withTx(pool, (c) => storeActivityEstimates(c, S, { kind: 'terminal', month: '2026-06', through: '2026-06-30', rows: rows.slice(0, 100) }))
  const [n2] = await q(`SELECT count(*)::int n FROM ${S}.terminal_call_estimates`)
  assert.equal(n2.n, 100)
})

test('store: refuses a terminal not in the database (whole month rolled back)', { skip }, async () => {
  const rows = normalizeStops('terminal', stops).slice(0, 3)
  rows[2] = { ...rows[2], candidates: [...rows[2].candidates, 'wa-not-a-terminal'] }
  await assert.rejects(withTx(pool, (c) => storeActivityEstimates(c, S, { kind: 'terminal', month: '2026-05', rows })), /wa-not-a-terminal/)
  const [n] = await q(`SELECT count(*)::int n FROM ${S}.terminal_call_estimates WHERE month = '2026-05'`)
  assert.equal(n.n, 0)
})

test('containsGridPoint: Anacortes Center (a ~1.1 km circle between grid centres) is too small; Smith Cove West is not', async () => {
  const { containsGridPoint } = await import('../activityEstimates.js')
  const { pointInGeometry } = await import('../anchorages.js')
  const { readFileSync } = await import('node:fs')
  // REAL: the production anchorage polygons in scripts/ships/bake-gfw/activity_inputs.json (read-only export, 2026-10-07).
  const inp = JSON.parse(readFileSync(new URL('../../../scripts/ships/bake-gfw/activity_inputs.json', import.meta.url), 'utf8'))
  const box = (a) => {
    const c = a.geometry.type === 'MultiPolygon' ? a.geometry.coordinates.flatMap((p) => p[0]) : a.geometry.coordinates[0]
    return { geometry: a.geometry, min_lat: Math.min(...c.map((x) => x[1])), max_lat: Math.max(...c.map((x) => x[1])), min_lon: Math.min(...c.map((x) => x[0])), max_lon: Math.max(...c.map((x) => x[0])) }
  }
  const by = (n) => box(inp.anchorages.find((a) => a.name === n))
  assert.equal(containsGridPoint(by('Anacortes Center'), 0.01, pointInGeometry), false)
  assert.equal(containsGridPoint(by('Smith Cove West'), 0.01, pointInGeometry), true)
})
