import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TAXA, INDEX } from '../lists.js'
import { obscuredCellNearestKm, distanceKm } from '../sources.js'

const taxon = (sci) => TAXA.find(t => t.scientific_name === sci)
const status = (sci, list) => taxon(sci).statuses.find(s => s.list === list)
const inatHits = (id) => (INDEX.inat.get(String(id)) || []).map(h => [h.taxon.scientific_name, h.status.list, h.confirms])

test('killer whale: every orca is state listed; only Southern Residents are federal', () => {
  assert.ok(status('Orcinus orca', 'wa-state').ids.confirm.inat.size > 0, 'state confirms species records')
  assert.equal(status('Orcinus orca', 'us-federal').ids.confirm.inat.size, 0, 'federal: no record names the DPS')
})

test('a listed subspecies is confirmed by its own ID, not by its species', () => {
  const lark = status('Eremophila alpestris strigata', 'wa-state')
  assert.equal(lark.ids.confirm.inat.size, 1)
  assert.ok(lark.ids.partial.inat.size >= 1)
  const species = [...lark.ids.partial.inat][0]
  assert.ok(inatHits(species).every(([, , confirms]) => confirms === false), 'horned lark records never confirm streaked horned lark')
})

test('an all-of-WA subspecies listing accepts species-level records (northern spotted owl)', () => {
  const owl = status('Strix occidentalis caurina', 'us-federal')
  assert.equal(owl.match_level, 'species')
  assert.ok(owl.ids.confirm.inat.size >= 1)
})

test('Thurber\'s reedgrass: northern reedgrass records never confirm it', () => {
  assert.ok(inatHits(140213).length > 0)
  assert.ok(inatHits(140213).every(([, , confirms]) => confirms === false))
})

test('a blurred iNaturalist record counts only if its 0.2° cell touches the circle', () => {
  // public point inside the cell 48.4–48.6, -122.8 to -122.6; search point just west of that cell
  assert.ok(obscuredCellNearestKm(48.55, -122.65, 48.5, -122.81) < 1)
  // same search point, record in a cell two cells east: nearest edge ~15 km away
  assert.ok(obscuredCellNearestKm(48.5, -122.3, 48.5, -122.81) > 10)
  assert.ok(Math.abs(distanceKm(48.5, -122.8, 48.6, -122.8) - 11.12) < 0.05)
})

test('distance to a polygon: 0 inside, edge distance outside, holes count as outside', async () => {
  const { distanceToGeometry } = await import('../geometry.js')
  // a 0.2° square around 48.5,-123 with a 0.02° hole in the middle
  const sq = (c, r) => [[c[0] - r, c[1] - r], [c[0] + r, c[1] - r], [c[0] + r, c[1] + r], [c[0] - r, c[1] + r], [c[0] - r, c[1] - r]]
  const g = { type: 'MultiPolygon', coordinates: [[sq([-123, 48.5], 0.1), sq([-123, 48.5], 0.01)]] }
  assert.equal(distanceToGeometry(48.55, -123.05, g).inside, true)
  assert.equal(distanceToGeometry(48.5, -123, g).inside, false)            // in the hole
  const out = distanceToGeometry(48.5, -122.85, g)                          // 0.05° east of the east edge
  assert.equal(out.inside, false)
  assert.ok(Math.abs(out.km - 0.05 * 111.32 * Math.cos(48.5 * Math.PI / 180)) < 0.05)
})

test('outline keeps a closed boundary, drops shared seams and view-box cuts', async () => {
  const { mapShapes } = await import('../geometry.js')
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
  const box = [-123.1, 48.4, -122.9, 48.6]
  // one lone square, and two squares sharing an edge (a mosaic) that should outline as one rectangle
  const lone = { type: 'MultiPolygon', coordinates: [[sq(-123.05, 48.45, -123.04, 48.46)]] }
  const pair = { type: 'MultiPolygon', coordinates: [[sq(-123.013, 48.513, -123.003, 48.523)], [sq(-123.003, 48.513, -122.993, 48.523)]] }
  // a real edge on a 0.25° line (the 49th-parallel kind) is kept
  const onGrid = { type: 'MultiPolygon', coordinates: [[sq(-123.03, 48.5, -123.02, 48.51)]] }
  const len = (g) => g.coordinates.reduce((n, l) => { for (let i = 1; i < l.length; i++) n += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return n }, 0)
  assert.ok(Math.abs(len(mapShapes([lone], box).outline) - 0.04) < 1e-6, 'lone square: full perimeter')
  assert.ok(Math.abs(len(mapShapes([pair], box).outline) - 0.06) < 1e-6, 'pair: outer perimeter only, shared edge dropped')
  assert.ok(Math.abs(len(mapShapes([onGrid], box).outline) - 0.04) < 1e-6, 'edge on 48.5° kept')
  // a square cut by the view box: the cut edge is not outlined
  const cutSq = { type: 'MultiPolygon', coordinates: [[sq(-122.95, 48.55, -122.85, 48.65)]] }
  assert.ok(Math.abs(len(mapShapes([cutSq], box).outline) - 0.1) < 1e-6, 'only the two real edges inside the box')
})
