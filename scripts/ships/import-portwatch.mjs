#!/usr/bin/env node
/**
 * IMF PortWatch ports database → ships evidence (Phase 3 step 3; docs/PORTS_SOURCES.md "Step 3"). Dev DB only unless
 * Josh says otherwise. The port card joins a WPI port to one of these by UN/LOCODE + distance at read time
 * (lib/ships/portCard.js pickPortWatch); the daily series is fetched per port by the card itself.
 *
 *   npm run ships:import-portwatch -- [--schema <name>] [--check]
 *     --check  after import, print the WPI ↔ PortWatch join summary (how many join, and why the others don't)
 *
 * Public ArcGIS FeatureServer, no key: ≤ 1,000 features per request, paged by resultOffset (3 requests for 2,065 ports).
 */
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import { ensurePortCardSources, ingestPortWatchPorts, portWatchPorts, pickPortWatch, PORTWATCH_SOURCE, PW_PORTS_URL } from '../../lib/ships/portCard.js'

const UA = 'Mozilla/5.0 (compatible; EarthAtlas-ships/0.1)'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA

const pool = shipsPool()
try {
  await ensurePortCardSources(pool, schema)
  const runId = await withTx(pool, (c) => startRun(c, schema, PORTWATCH_SOURCE.id, { what: 'ports' }))
  const totals = { requests: 0, rows: 0, stored: 0, recordsCreated: 0, errors: [] }
  for (let offset = 0; offset < 20000; offset += 1000) {
    const qs = new URLSearchParams({ where: '1=1', outFields: '*', returnGeometry: 'false', orderByFields: 'ObjectId',
      resultOffset: String(offset), resultRecordCount: '1000', f: 'json' })
    const url = `${PW_PORTS_URL}?${qs}`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    totals.requests++
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    const body = await res.json()
    if (body.error) throw new Error(`PortWatch ${body.error.code}: ${body.error.message}`)
    const feats = body.features || []
    const r = await withTx(pool, (c) => ingestPortWatchPorts(c, schema, feats, { runId, retrievalUrl: url }))
    totals.rows += r.rows; totals.stored += r.stored; totals.recordsCreated += r.recordsCreated; totals.errors.push(...r.errors)
    console.log(`offset ${offset}: ${feats.length} ports (${r.recordsCreated} new records)`)
    if (!body.exceededTransferLimit && feats.length < 1000) break
  }
  await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats: totals }))
  console.log(JSON.stringify(totals))
  if (args.includes('--check')) {
    const q = async (t, p) => (await pool.query(t, p)).rows
    const pw = await portWatchPorts(q, schema)
    const wpi = await q(`SELECT id, wpi_number, name, unlocode, lat, lon FROM ${schema}.ports WHERE origin = 'wpi' AND unlocode IS NOT NULL`)
    const by = {}
    const joinedPw = new Map()
    for (const p of wpi) {
      const j = pickPortWatch(p, pw, wpi.filter((o) => o.unlocode === p.unlocode))
      by[j.status] = (by[j.status] || 0) + 1
      if (j.status === 'joined') joinedPw.set(j.pw.portid, [...(joinedPw.get(j.pw.portid) || []), p.wpi_number])
      if (j.status === 'too_far' || j.status === 'ambiguous' || j.status === 'other_wpi_nearer') console.log(`  ${j.status}: WPI ${p.wpi_number} ${p.name} ${p.unlocode} ${j.km != null ? `${j.km.toFixed(1)} km` : ''} ${j.candidates ? j.candidates.join(',') : j.portid ?? ''}`)
    }
    const withLocode = pw.filter((p) => p.locode).length
    const shared = [...joinedPw.entries()].filter(([, w]) => w.length > 1)
    console.log(`WPI ports with a UN/LOCODE: ${wpi.length}; join result:`, by)
    console.log(`PortWatch ports: ${pw.length}, with LOCODE: ${withLocode}, joined to ≥1 WPI port: ${joinedPw.size}, joined to several WPI ports: ${shared.length}`)
    for (const [k, w] of shared) console.log(`  ${k} ← WPI ${w.join(', ')}`)
  }
} finally {
  await pool.end()
}
