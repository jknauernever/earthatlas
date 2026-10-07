/**
 * WA DNR aquatic land use authorizations + Whatcom County shoreline pilot, offline tests (lib/ships/dnrLeases.js,
 * lib/ships/countyShoreline.js). REAL features and documents recorded 2026-10-07 (fixtures/wa-leases-live-2026-10-07.json).
 * Cases built by hand are marked SYNTHETIC.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildIndex, useFields, usePayload, resolveEntry, useCandidates, nearestPma, validateLeaseSites, validateLeaseEntry, loadLeaseSites,
  metresToPolygon, inPolygon, lesseeHas, dnrDate, leaseQueryUrl, CONTRACT_TYPE,
} from '../dnrLeases.js'
import { fileNamed, quoteIn, resolveShoreline, validateShorelineEntry } from '../countyShoreline.js'
import { fixture } from './scenarios.js'

const fx = fixture('wa-leases-live-2026-10-07.json')
const index = buildIndex(Object.entries(fx.layers).map(([layer, features]) => ({ layer: Number(layer), body: { features } })))
const terminals = JSON.parse(await readFile(new URL('../data/salish-terminals.json', import.meta.url), 'utf8')).terminals
const T = (id) => terminals.find((t) => t.id === id)
const data = await loadLeaseSites()

test('fields: the BP lease reads as DNR publishes it (no end date in the public service)', () => {
  const bp = index.uses.get(1).filter((p) => p.attributes.LEASE_JKT_NO === '20-A09122').map(useFields)
  assert.ok(bp.length >= 3)
  const a = bp.find((f) => f.site === 'Parcel A')
  assert.equal(a.lessee, 'BP WEST COAST PRODUCTS LLC')
  assert.equal(a.effective, '1999-04-01')
  assert.equal(a.ends, null)
  assert.equal(a.typeName, 'Aquatic land lease')
  assert.equal(a.statusWords, 'active')
  assert.equal(Math.round(a.acres * 100) / 100, 81.53)
  assert.equal(dnrDate(922924800000), '1999-04-01')
  assert.equal(CONTRACT_TYPE[22], 'Harbor area lease')
})

test('payload: DNR staff-name fields are dropped and said so', () => {
  const p = usePayload({ attributes: { OBJECTID: 1, EDIT_NM: 'x', PERSON_RESPONSIBLE: 'y', LEASE_JKT_NO: '20-A00000' } }, 1)   // SYNTHETIC
  assert.deepEqual(Object.keys(p.attributes), ['OBJECTID', 'LEASE_JKT_NO'])
  assert.deepEqual(p.dropped_fields, ['EDIT_NM', 'PERSON_RESPONSIBLE'])
  assert.equal(p.layer_name, 'Active Uses Points')
})

test('resolve: the pilot terminals take their own leases; a nearby lease of another company is only a candidate', () => {
  const bp = resolveEntry(T('wa-bp-cherry-point'), data.terminals['wa-bp-cherry-point'], index)
  assert.deepEqual(bp.problems, [])
  assert.equal(bp.uses[0].main.f.lease, '20-A09122')
  const mpc = resolveEntry(T('wa-marathon-anacortes'), data.terminals['wa-marathon-anacortes'], index)
  assert.deepEqual(mpc.problems, [])
  assert.equal(mpc.uses[0].main.f.lessee, 'TESORO REFINING AND MARKETING CO LL')
  const cands = useCandidates(T('wa-marathon-anacortes'), index, 1).map((c) => c.lease)
  assert.ok(cands.includes('20-A12561'))   // HF Sinclair's lease, 0.79 km away: listed for review, not accepted
  assert.ok(!mpc.uses.some((u) => u.main.f.lease === '20-A12561'))
})

test('resolve: lessee words are required (distance alone never links)', () => {
  const wrong = { dnr: { uses: [{ lease: '20-A12561', lessee_words: ['MARATHON'], why: 'SYNTHETIC: wrong company' }] } }
  const r = resolveEntry(T('wa-marathon-anacortes'), wrong, index)
  assert.equal(r.uses.length, 0)
  assert.match(r.problems[0], /lacks MARATHON/)
  assert.ok(lesseeHas('HF SINCLAIR PUGET SOUND REFINING LL', ['hf', 'sinclair']))
  assert.ok(!lesseeHas('SHORE TERMINALS LLC', ['SHORE', 'TERMINAL']))   // whole words only
})

test('resolve: a lease far from the berths is refused', () => {
  const far = { dnr: { uses: [{ lease: '20-A09122', lessee_words: ['BP'], why: 'SYNTHETIC: BP lease on the wrong terminal' }] } }
  const r = resolveEntry(T('wa-marathon-anacortes'), far, index)
  assert.equal(r.uses.length, 0)
  assert.match(r.problems[0], /km from the berths/)
})

test('resolve: an extended lease keeps its renewal application; the holdover is the record shown', () => {
  const r = resolveEntry(T('wa-nustar-tacoma'), data.terminals['wa-nustar-tacoma'], index)
  assert.deepEqual(r.problems, [])
  assert.equal(r.uses[0].main.f.status, 'EX')
  assert.equal(r.uses[0].main.f.statusWords, 'extended or in holdover')
})

test('PMA: the Port of Anacortes petcoke berth is inside the port management area; the port name comes from DNR points', () => {
  const r = resolveEntry(T('wa-anacortes-petcoke'), data.terminals['wa-anacortes-petcoke'], index)
  assert.deepEqual(r.problems, [])
  assert.equal(r.pma.metres, 0)
  assert.equal(r.pma.port, 'PORT OF ANACORTES')
  const b = T('wa-anacortes-petcoke').berths[0]
  assert.ok(inPolygon(b.lon, b.lat, r.pma.area.geometry.rings))
  assert.ok(metresToPolygon(-122.6, 48.6, r.pma.area.geometry.rings) > 5000)   // SYNTHETIC point far away
  const tooFar = { dnr: { uses: [], pma: { ...data.terminals['wa-anacortes-petcoke'].dnr.pma } } }
  assert.match(resolveEntry(T('wa-marathon-anacortes'), tooFar, index).problems[0], /m from PMA area 670/)
  assert.equal(nearestPma(T('wa-anacortes-petcoke'), index).metres, 0)
})

test('the data file covers every WA terminal and validates; a silent entry is refused', () => {
  assert.deepEqual(validateLeaseSites(data, terminals), [])
  assert.equal(Object.keys(data.terminals).length, terminals.filter((t) => t.country === 'US').length)
  assert.deepEqual(validateLeaseEntry('x', { dnr: { uses: [] } }), ['x: dnr.uses, dnr.pma or dnr.none'])   // SYNTHETIC
  for (const [k, e] of Object.entries(data.terminals)) for (const s of e.county?.shoreline || []) assert.deepEqual(validateShorelineEntry(k, s), [])
})

test('county: SHR2020-00002 is named by its SEPA records and its notice says it is a shoreline substantial development permit', () => {
  const s = data.terminals['wa-intalco-wharf'].county.shoreline.find((x) => x.file === 'SHR2020-00002')
  const r = resolveShoreline('wa-intalco-wharf', s, new Map(Object.entries(fx.sepa)), new Map([[s.notice_doc, fx.notice]]))
  assert.deepEqual(r.problems, [])
  assert.ok(r.ok)
  assert.deepEqual(r.sepa.map((x) => x.r.type), ['ODNS/NOA', 'ODNS'])
  assert.ok(fileNamed('SEP2020-00007, SHR2020-00002', 'SHR2020-00002'))
  assert.ok(!fileNamed('SEP2020-00007, SHR2020-000021', 'SHR2020-00002'))   // SYNTHETIC
  assert.ok(quoteIn(fx.notice.text, 'Required Permits:   Shoreline Substantial Development Permit'))
  const bad = { ...s, says: 'Shoreline Conditional Use Permit' }   // SYNTHETIC: a quote the notice doesn't contain
  assert.match(resolveShoreline('wa-intalco-wharf', bad, new Map(Object.entries(fx.sepa)), new Map([[s.notice_doc, fx.notice]])).problems[0], /quote not found/)
})

test('links: the inline source opens DNR’s own record for the lease number', () => {
  assert.equal(leaseQueryUrl('20-A09122', 1),
    'https://gis.dnr.wa.gov/site3/rest/services/Aquatics/AQ_ENC_Public_Prod/MapServer/1/query?where=LEASE_JKT_NO%3D\'20-A09122\'&outFields=*&returnGeometry=false&f=html')
})
