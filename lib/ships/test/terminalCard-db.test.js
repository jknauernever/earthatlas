/**
 * Terminal card on the DEV database, throwaway schema (ships_t_<random>), dropped afterwards; never "ships", never production.
 * Skipped (NOT RUN) without SHIPS_DATABASE_URL. No live calls: the GFW client is a stub that replays the REAL recorded
 * port-visit events (fixtures/gfw-live-portvisits-salish-terminals-2026.json); the stub itself (which events it returns for
 * which request) is SYNTHETIC.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensurePortVisitSource } from '../portVisits.js'
import { loadTerminalData, importTerminals, ensureTerminalSources, parseCsv } from '../terminals.js'
import { ensureTerminalCard, readTerminalCard, terminalsLayer, terminalEmissions } from '../terminalCard.js'
import { parseCardWindow } from '../portCard.js'
import { stoppedHits, callSplitter, storeTerminalCalls, CALL_RULE } from '../terminalCalls.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const fx = fixture('terminals-live-2026-09-27.json')
const ev = fixture('gfw-live-portvisits-salish-terminals-2026.json')
const full = await loadTerminalData()
const data = { main: { ...full.main, terminals: full.main.terminals.filter((t) => fx.terminals.includes(t.id)) },
  osm: { ...full.osm, berths: full.osm.berths.filter((b) => fx.terminals.includes(b.terminal)) } }
const raw = {
  usace: fx.usace.features, ecology: fx.ecology.features, bcpt: fx.bcpt.features,
  osm: { elements: fx.osm.elements, osmBase: fx.osm.osm_base }, gem: parseCsv(fx.gem.csv), ctRefinery: fx.ct_refinery.features,
  release: fx.ct_refinery.release, urls: { usace: fx.usace.url, ecology: fx.ecology.url, bcpt: fx.bcpt.url, osm: fx.osm.url, gem: fx.gem.url, ct: 'x' },
}
// SYNTHETIC stub over REAL events: any request returns the recorded events that begin in the asked month.
const calls = []
const inMonth = (e, from, to) => e.start >= from && e.start < `${to}T00:00:00Z`
const gfw = {
  eventsInPolygon: async ({ from, to }) => { calls.push('discover'); return { url: 'stub', body: { entries: ev.entries.filter((e) => inMonth(e, from, to)), nextOffset: null } } },
  portEvents: async ({ portIds, from, to }) => {
    calls.push(`events ${portIds.join(',')} ${from}`)
    return { url: 'stub', body: { entries: ev.entries.filter((e) => inMonth(e, from, to) && portIds.includes(e.port_visit?.intermediateAnchorage?.id)), nextOffset: null, total: null } }
  },
}

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, (c) => ensureTerminalSources(c, S))
  await ensurePortVisitSource(pool, S)
  await withTx(pool, (c) => importTerminals(c, S, data, raw))
})
after(async () => { if (skip) return; await pool.query(`DROP SCHEMA ${S} CASCADE`); await pool.end() })

test('ensureTerminalCard: discovers labels, fetches each picked month once, logs under the terminal; a re-open is free', { skip }, async () => {
  const win = parseCardWindow('2026-05', '2026-06', null, new Date('2026-09-28T00:00:00Z'))
  const r1 = await ensureTerminalCard(pool, S, 'wa-bp-cherry-point', { win, gfw, now: new Date('2026-09-28T00:00:00Z') })
  assert.equal(r1.discover, 'fetched')
  assert.deepEqual(r1.labels, ['usa-cherrypoint'])
  assert.equal(r1.months.fetched, 2)
  const log = await q(`SELECT kind, terminal_id IS NOT NULL AS t, port_id FROM ${S}.port_card_fetches ORDER BY id`)
  assert.ok(log.every((x) => x.t), 'every fetch is logged under the terminal (shared budget)')
  const n = calls.length
  const r2 = await ensureTerminalCard(pool, S, 'wa-bp-cherry-point', { win, gfw, now: new Date('2026-09-28T01:00:00Z') })
  assert.equal(calls.length, n, 'settled months and a recent discovery are not asked again')
  assert.equal(r2.months.fresh, 2)
  const budget = await ensureTerminalCard(pool, S, 'bc-westridge', { win, gfw, budget: 0 })
  assert.equal(budget.discover, 'budget')
})

test('readTerminalCard (REAL events): GFW visits are only a comparison now; with no AIS bake stored nothing is counted (never 0 by default)', { skip }, async () => {
  const win = parseCardWindow('2026-01', '2026-06', null, new Date('2026-09-28T00:00:00Z'))
  const c = await readTerminalCard(q, S, 'wa-bp-cherry-point', { win })
  assert.equal(c.terminal.operator, 'BP (BP Products North America)')
  assert.ok(c.berths.length >= 1 && c.links.some((l) => l.role === 'ct_refinery'))
  // Josh 2026-09-28: counts come from our own AIS calls; the 4 stored GFW visits stay visible as a comparison only.
  assert.equal(c.gfw.visits, 4)
  assert.equal(c.summary.visits, 0)
  assert.equal(c.coverage.bake, null, 'no AIS bake in this schema yet')
  assert.deepEqual(c.coverage.months, [])
  assert.ok(c.summary.months.every((m) => m.n === null), 'months without AIS are "no AIS yet", not 0')
  const layer = await terminalsLayer(q, S)
  assert.equal(layer.features.length, fx.terminals.length)
  const em = await terminalEmissions(q, S, 'wa-bp-cherry-point', 'refinery')
  assert.deepEqual(em.joined.map((j) => j.id), [1753291])
})

test('AIS calls (REAL MarineCadastre rows at Shellburn, Jan 2026): stored, read, tug counted as likely moving a barge, no-type ship kept apart', { skip }, async () => {
  const shell = fixture('mc-ais-terminal-calls-shellburn-2026-01-07.json')
  const calls = []
  const sp = callSplitter((c) => calls.push(c))
  for (const h of stoppedHits(shell.rows, shell.berths).sort((a, b) => a.terminal.localeCompare(b.terminal) || a.mmsi.localeCompare(b.mmsi) || a.p.t - b.p.t)) sp.push(h.terminal, h.mmsi, h.p)
  sp.end()
  assert.ok(calls.length >= 2)
  // SYNTHETIC bake coverage: the fixture holds 2 days, but the test declares January 2026 fully read; and it lists Westshore
  // as outside the AIS box (in reality it is inside; the three real ones are north of 49.6 N and not in this schema).
  const bake = { rule: CALL_RULE, days: shell.days, months: [{ month: '2026-01', complete: true }], notCovered: ['bc-westshore'], berths: shell.berths }
  const r1 = await withTx(pool, (c) => storeTerminalCalls(c, S, { calls, bake }))
  const r2 = await withTx(pool, (c) => storeTerminalCalls(c, S, { calls, bake }))
  assert.equal(r2.recordId, r1.recordId, 'same bake payload → same record')
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM ${S}.terminal_calls`)
  assert.equal(n, calls.length, 're-import of the same version does not double count')
  const c = await readTerminalCard(q, S, 'bc-shellburn', { win: parseCardWindow('2025-12', '2026-02', null, new Date('2026-09-28T00:00:00Z')) })
  const harrier = c.ships.find((x) => x.mmsi === '316046128')
  assert.ok(harrier, 'SEASPAN HARRIER (AIS type 52 tug) counts at an oil dock')
  assert.equal(harrier.kind, 'Tug (likely moving a barge)')
  assert.equal(harrier.kindBasis, 'ais', 'not in this schema’s ship database: the AIS reported type is used, and labelled so')
  assert.equal(harrier.bakeRecordId, Number(r1.recordId))
  assert.ok(c.unknown.ships.some((x) => x.mmsi === '316052572'), 'TWC ENDURANCE broadcast no type: kind not known, never counted')
  assert.deepEqual(c.summary.months.map((m) => m.n === null), [true, false, true], 'Dec / Feb: no AIS for this month yet (not 0)')
  assert.equal(c.summary.months[1].n, c.summary.visits)
  assert.deepEqual(c.rule.radii, [{ berth: 'bcpt-258', m: 150 }])
  const w = await readTerminalCard(q, S, 'bc-westshore', { win: parseCardWindow('2026-01', '2026-01', null, new Date('2026-09-28T00:00:00Z')) })
  assert.equal(w.coverage.notCovered, true)
  assert.deepEqual(w.summary.months, [{ month: '2026-01', n: null }])
})
