/**
 * Climate TRACE port stays at terminals on the DEV database, throwaway schema (ships_t_<random>), dropped afterwards; never
 * "ships", never production. Skipped (NOT RUN) without SHIPS_DATABASE_URL. Stays and berths are REAL
 * (fixtures/ct-voyages-salish-v5_11_0.json); the terminals are the REAL list entries (terminals-live-2026-09-27.json). The bake
 * metadata passed to storeCtStays (start dates, box) is SYNTHETIC where marked.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { loadTerminalData, importTerminals, ensureTerminalSources, parseCsv, allBerths } from '../terminals.js'
import { terminalCtStays } from '../terminalCard.js'
import { planCtStays, storeCtStays, notCoveredTerminals, CT_PULL_BOX } from '../ctStays.js'
import { parseCardWindow } from '../portCard.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const fx = fixture('terminals-live-2026-09-27.json')
const ct = fixture('ct-voyages-salish-v5_11_0.json')
const full = await loadTerminalData()
const data = { main: { ...full.main, terminals: full.main.terminals.filter((t) => fx.terminals.includes(t.id)) },
  osm: { ...full.osm, berths: full.osm.berths.filter((b) => fx.terminals.includes(b.terminal)) } }
const raw = {
  usace: fx.usace.features, ecology: fx.ecology.features, bcpt: fx.bcpt.features,
  osm: { elements: fx.osm.elements, osmBase: fx.osm.osm_base }, gem: parseCsv(fx.gem.csv), ctRefinery: fx.ct_refinery.features,
  release: fx.ct_refinery.release, urls: { usace: fx.usace.url, ecology: fx.ecology.url, bcpt: fx.bcpt.url, osm: fx.osm.url, gem: fx.gem.url, ct: 'x' },
}

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, (c) => ensureTerminalSources(c, S))
  await withTx(pool, (c) => importTerminals(c, S, data, raw))
})
after(async () => { if (skip) return; await pool.query(`DROP SCHEMA ${S} CASCADE`); await pool.end() })

test('stays matched against the schema\'s own berths are stored with a bake record; the card sums only fitting kinds by month', { skip }, async () => {
  const berths = await allBerths(q, S)
  const { matched, summary } = planCtStays(ct.stays, berths)
  const cherry = matched.filter((m) => m.terminal === 'wa-bp-cherry-point')
  assert.equal(cherry.length, 2, 'the oil tanker and the chemical tanker at Cherry Point')
  // SYNTHETIC bake metadata (release label and dates as the real pull; the rest minimal).
  // notCovered uses the OLD 49.0° N box (SYNTHETIC here) so the "not covered" path is exercised on a real terminal.
  const bake = { release: 'v5_11_0', pulled: '2026-09-29', pullBox: CT_PULL_BOX, startDates: { from: '2024-01-01', to: '2025-12-31' },
    notCovered: notCoveredTerminals(berths, [-124.85, 47.0, -122.05, 49.0]) }
  const r = await withTx(pool, (c) => storeCtStays(c, S, { matched, summary, bake }))
  assert.equal(r.rows, matched.length)
  const again = await withTx(pool, (c) => storeCtStays(c, S, { matched, summary, bake }))
  assert.equal(again.recordCreated, false, 'same payload → same record')
  assert.equal((await q(`SELECT count(*)::int n FROM ${S}.terminal_ct_stays`))[0].n, matched.length, 'a re-import replaces, never doubles')

  const card = await terminalCtStays(q, S, 'wa-bp-cherry-point', parseCardWindow('2024-01', '2024-12', null, new Date('2026-09-29T00:00:00Z')))
  assert.equal(card.state, 'ok')
  assert.equal(card.fits.stays, 1, 'the oil tanker (March 2024) counts at a refinery dock')
  const y25 = await terminalCtStays(q, S, 'wa-bp-cherry-point', parseCardWindow('2025-01', '2025-12', null, new Date('2026-09-29T00:00:00Z')))
  assert.equal(y25.fits.stays, 1, 'the chemical tanker (September 2025) counts at a refinery dock for Climate TRACE stays (Josh 2026-09-29)')
  assert.equal(y25.other.stays, 0)
  assert.ok(y25.fitWords.includes('chemical tanker'))
  const oil = ct.stays.find((s) => s.id === 'om-imo-9642083')
  assert.ok(Math.abs(card.fits.co2e - oil.co2e) < 1e-6, 'Climate TRACE\'s own figure, unchanged')
  assert.equal(card.fits.perMonth.find((m) => m.month === '2024-03').n.toFixed(3), oil.co2e.toFixed(3))
  assert.equal(card.fits.perMonth.find((m) => m.month === '2024-04').n, 0, 'a covered month with no stay is 0')
  assert.equal(card.fits.trackers.oceanmind, 1)

  const late = await terminalCtStays(q, S, 'wa-bp-cherry-point', parseCardWindow('2025-11', '2026-02', null, new Date('2026-09-29T00:00:00Z')))
  assert.deepEqual(late.months.missing, ['2026-01', '2026-02'])
  assert.equal(late.fits.perMonth.find((m) => m.month === '2026-01').n, null, 'outside the pull: missing, never 0')
  const north = await terminalCtStays(q, S, 'bc-westshore', parseCardWindow('2025-01', '2025-12', null, new Date('2026-09-29T00:00:00Z')))
  assert.equal(north.state, 'not_covered')
})
