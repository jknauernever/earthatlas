/**
 * Place search for the "Fly to a place" box (lib/ships/placeSearch.js). DEV database, throwaway schema (ships_t_<random>), dropped
 * afterwards; never "ships", never production. Skipped (NOT RUN) without SHIPS_DATABASE_URL. Inputs are REAL: the terminals of
 * terminals-live-2026-09-27.json.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { loadTerminalData, importTerminals, ensureTerminalSources, parseCsv } from '../terminals.js'
import { searchPlaces } from '../placeSearch.js'
import { fixture } from './scenarios.js'

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

test('searchPlaces: finds terminals by part of the name, case-insensitively, with a position', { skip }, async () => {
  const r = await searchPlaces(q, S, 'cherry point')
  const bp = r.find((x) => x.id === 'wa-bp-cherry-point')
  assert.ok(bp, 'BP Cherry Point found')
  assert.equal(bp.kind, 'terminal'); assert.equal(bp.terminalKey, 'wa-bp-cherry-point')
  assert.ok(Number.isFinite(bp.lat) && Number.isFinite(bp.lon))
  assert.ok((await searchPlaces(q, S, 'MARATHON')).some((x) => x.id === 'wa-marathon-anacortes'))
  assert.deepEqual(await searchPlaces(q, S, 'x'), [])   // under 2 characters: nothing
})
