/**
 * IMO GISIS, database tests (migration 014, lib/ships/gisis.js, resolver v1.6). DEV database in SHIPS_DATABASE_URL,
 * throwaway schema (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL.
 * No network. GISIS rows: REAL, copied verbatim from the exports downloaded 2026-09-28 UTC (fixtures/gisis-*-live-2026-09-28.json).
 * Terminals: the REAL recorded rows of terminals-db.test.js (fixtures/terminals-live-2026-09-27.json) and the real crosswalk.
 * The vessel is SYNTHETIC: the real GFW EURODAM entry with its IMO swapped to 9751509 (NORWEGIAN BLISS), because we hold no
 * recorded GFW entry for that ship.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { getVessel, getRecordView } from '../queries.js'
import { resolveEntity } from '../resolve.js'
import { loadTerminalData, importTerminals, ensureTerminalSources, listTerminals, parseCsv } from '../terminals.js'
import {
  parseGisisCsv, groupReg42, importReg42Chunk, finishReg42, importFacilities, linkFacilitiesToTerminals, loadCrosswalk,
  ensureGisisSources, SCRUBBERS_SOURCE, FACILITIES_SOURCE,
} from '../gisis.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const count = async (t, where = 'true', params = []) => Number((await q(`SELECT count(*) FROM ${S}.${t} WHERE ${where}`, params))[0].count)

const reg = parseGisisCsv(fixture('gisis-reg42-live-2026-09-28.json').csv)
const fac = parseGisisCsv(fixture('gisis-isps-facilities-live-2026-09-28.json').csv).filter((r) => ['CAN', 'USA'].includes(r['Country Code']))
const groups = groupReg42(reg)
const gfwBliss = () => JSON.parse(readFileSync(new URL('./fixtures/gfw-live-eurodam-2026-09-25.json', import.meta.url), 'utf8').replaceAll('9378448', '9751509'))

const tfx = fixture('terminals-live-2026-09-27.json')
const full = await loadTerminalData()
const tdata = { main: { ...full.main, terminals: full.main.terminals.filter((t) => tfx.terminals.includes(t.id)) },
  osm: { ...full.osm, berths: full.osm.berths.filter((b) => tfx.terminals.includes(b.terminal)) } }
const traw = {
  usace: tfx.usace.features, ecology: tfx.ecology.features, bcpt: tfx.bcpt.features,
  osm: { elements: tfx.osm.elements, osmBase: tfx.osm.osm_base }, gem: parseCsv(tfx.gem.csv), ctRefinery: tfx.ct_refinery.features,
  release: tfx.ct_refinery.release, urls: {},
}
let blissId

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensureGfwSource(pool, S)
  await withTx(pool, (c) => ensureTerminalSources(c, S))
  await withTx(pool, (c) => ensureGisisSources(c, S))
  const g = await ingestGfwEntry(pool, S, gfwBliss())
  blissId = g.vesselId ?? g.resolution?.vesselId ?? (await q(`SELECT vessel_id FROM ${S}.vessel_assertions WHERE attribute = 'imo' AND value_norm = '9751509' LIMIT 1`))[0]?.vessel_id
  await withTx(pool, (c) => importTerminals(c, S, tdata, traw))
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('migration 014: the new attributes and the terminal link role are allowed; sources carry the permission note', { skip }, async () => {
  const src = await q(`SELECT id, commercial_use, notes FROM ${S}.sources WHERE id = ANY($1) ORDER BY id`, [[SCRUBBERS_SOURCE.id, FACILITIES_SOURCE.id]])
  assert.equal(src.length, 2)
  for (const s of src) {
    assert.equal(s.commercial_use, false)
    assert.match(s.notes, /Used on Josh's instruction assuming IMO permission; written permission not yet obtained; the IMO Web Accounts policy otherwise forbids republishing\./)
  }
  const [chk] = await q(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'terminal_links_role_check' AND connamespace = $1::regnamespace`, [S])
  assert.match(chk.d, /imo_port_facility/)
})

test('Reg. 4.2 (REAL rows): evidence per IMO; NORWEGIAN BLISS attaches by registry IMO only; the rest stay unresolved; idempotent', { skip }, async () => {
  assert.ok(blissId, 'the SYNTHETIC GFW vessel exists')
  const r1 = await withTx(pool, (c) => importReg42Chunk(c, S, groups, { file: 'fixture' }))
  assert.equal(r1.groups, groups.length)
  assert.equal(r1.recordsCreated, groups.length)
  assert.equal(r1.resolved.accept, 1)
  assert.equal(r1.resolved['unresolved:no_vessel_with_imo'], groups.filter((g) => g.imo?.valid).length - 1)
  assert.equal(r1.resolved['unresolved:imo_checksum_invalid'], 2)
  assert.equal(r1.resolved['unresolved:no_imo_in_row'], 2)
  // No vessel is ever created from a notification.
  assert.equal(await count('vessels'), 1)
  const v = await getVessel(q, S, blissId)
  const sc = v.assertions.filter((a) => a.source_id === SCRUBBERS_SOURCE.id)
  assert.equal(sc.length, 1)
  assert.equal(sc[0].attribute, 'scrubber')
  assert.equal(sc[0].value_raw, 'Lang Tech Oy Ab Lang Tech Hybrid Scrubber')
  assert.equal(sc[0].period_kind, 'unknown')
  assert.equal(sc[0].detail.flag, 'Bahamas')
  assert.equal(sc[0].detail.submitted, '2018-04-20')
  assert.deepEqual(sc[0].detail.loop, ['hybrid'])
  assert.equal(sc[0].link_method, 'IMO_EXACT')
  assert.ok(v.sources.some((s) => s.id === SCRUBBERS_SOURCE.id))
  const view = await getRecordView(q, S, sc[0].last_source_record_id)
  assert.deepEqual(view.identifiers, [{ label: 'IMO Number', value: '9751509' }])
  assert.equal(view.vessels[0].id, blissId)
  // Re-import: nothing new.
  const r2 = await withTx(pool, (c) => importReg42Chunk(c, S, groups, { file: 'fixture' }))
  assert.equal(r2.recordsCreated, 0)
  assert.equal(r2.claimsCreated, 0)
  assert.equal(r2.resolved.keep, 1)
})

test('an IMO no longer in the export: its claims become superseded, never deleted (SYNTHETIC: export without 9880855)', { skip }, async () => {
  const before = await count('assertions')
  const r = await withTx(pool, (c) => finishReg42(c, S, groups.filter((g) => g.key !== 'IMO 9880855').map((g) => g.key)))
  assert.equal(r.superseded, 2)
  assert.equal(await count('assertions'), before)
  // Back in the export: re-activated.
  await withTx(pool, (c) => importReg42Chunk(c, S, groups.filter((g) => g.key === 'IMO 9880855'), { file: 'fixture' }))
  assert.equal(await count('assertions a JOIN ' + S + '.source_entities se ON se.id = a.source_entity_id', "se.entity_key = 'IMO 9880855' AND a.status = 'active'"), 2)
})

test('ISPS facilities (REAL rows): stored without personal fields; a facility entity never becomes a vessel', { skip }, async () => {
  const r = await withTx(pool, (c) => importFacilities(c, S, fac, { file: 'fixture' }))
  assert.equal(r.facilities, fac.length)
  assert.deepEqual(r.errors, [])
  const [row] = await q(`SELECT sr.payload FROM ${S}.source_records sr JOIN ${S}.source_entities se ON se.id = sr.source_entity_id
                          WHERE se.source_id = $1 AND se.entity_key = 'CAVAN-0022'`, [FACILITIES_SOURCE.id])
  assert.equal(row.payload.row['Facility Name'], 'Westridge Marine Terminal')
  assert.ok(!/officer|e-?mail|phone/i.test(Object.keys(row.payload.row).join(' ')))
  const [e] = await q(`SELECT id FROM ${S}.source_entities WHERE source_id = $1 AND entity_key = 'CAVAN-0022'`, [FACILITIES_SOURCE.id])
  const d = await withTx(pool, (c) => resolveEntity(c, S, e.id))
  assert.equal(d.reason, 'not_a_vessel_source')
  assert.equal(await count('vessels'), 1)
  const again = await withTx(pool, (c) => importFacilities(c, S, fac, { file: 'fixture' }))
  assert.equal(again.recordsCreated, 0)
})

test('crosswalk → terminal links: Westridge / Shellburn / Westshore by name + position, Parkland by name with GISIS\'s wrong point noted; a terminal re-import keeps them', { skip }, async () => {
  const cw = await loadCrosswalk()
  const l = await withTx(pool, (c) => linkFacilitiesToTerminals(c, S, cw))
  const linked = l.checks.filter((x) => x.ok).map((x) => `${x.terminal}:${x.facility}`).sort()
  assert.deepEqual(linked, ['bc-parkland-burnaby:CAVAN-0021', 'bc-shellburn:CABUB-0004', 'bc-westridge:CAVAN-0022', 'bc-westshore:CADEL-0002'])
  // Rows for terminals / facilities this cut-down schema doesn't hold are reported, not linked.
  assert.ok(l.notLinked.every((x) => x.problems.some((p) => /not stored|not listed/.test(p))))
  const t = Object.fromEntries((await listTerminals(q, S)).map((x) => [x.key, x]))
  const w = t['bc-westridge'].links.find((x) => x.role === 'imo_port_facility')
  assert.equal(w.entity_key, 'CAVAN-0022')
  assert.equal(w.detail.position_agrees, true)
  const p = t['bc-parkland-burnaby'].links.find((x) => x.role === 'imo_port_facility')
  assert.equal(p.detail.position_agrees, false)
  assert.match(p.detail.position_note, /Victoria/)
  // The record page names the terminal and the facility number.
  const view = await getRecordView(q, S, w.source_record_id)
  assert.deepEqual(view.identifiers, [{ label: 'IMO Port Facility Number', value: 'CAVAN-0022' }])
  assert.deepEqual(view.terminals.map((x) => x.key), ['bc-westridge'])
  // importTerminals retires links it no longer lists, but never the GISIS ones.
  await withTx(pool, (c) => importTerminals(c, S, tdata, traw))
  assert.equal(await count('terminal_links', `role = 'imo_port_facility' AND status = 'active'`), 4)
  // Idempotent; a crosswalk row dropped from the file → its link retired (SYNTHETIC crosswalk).
  const l2 = await withTx(pool, (c) => linkFacilitiesToTerminals(c, S, { ...cw, rows: cw.rows.filter((x) => x.facility !== 'CADEL-0002') }))
  assert.equal(l2.retired, 1)
  assert.equal(await count('terminal_links', `role = 'imo_port_facility' AND status = 'retired' AND entity_key = 'CADEL-0002'`), 1)
})
