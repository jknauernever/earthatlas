#!/usr/bin/env node
/**
 * Writes scripts/ships/bake-gfw/activity_inputs.json for activity.py (docs/SHIPS_ACTIVITY_FUSION.md Part 2): every active berth of
 * a listed terminal and every active anchorage polygon in the Salish GFW area, read-only from a ships database. Re-run (and commit)
 * when terminals, berths or anchorages change.
 *
 *   node scripts/ships/activity-inputs.mjs [--prod]     # --prod reads production (SHIPS_PROD_DATABASE_URL), read-only
 *
 * `cluster` on each berth is the old chained grouping (1.5 km, kept for --neighbour-km 0); activity.py now groups by neighbours.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const envVar = process.argv.includes('--prod') ? 'SHIPS_PROD_DATABASE_URL' : 'SHIPS_DATABASE_URL'
const line = readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith(envVar + '='))
const sql = neon(line.split('=').slice(1).join('=').replace(/^["']|["']$/g, ''))
const W = -126.3, S = 46.9, E = -122.0, N = 49.6, CLUSTER_KM = 1.5   // areas.py 'salish'

const berths = await sql`SELECT t.key AS terminal, t.kind, b.berth_key AS berth, b.lat, b.lon FROM ships.terminal_berths b
  JOIN ships.terminals t ON t.id = b.terminal_id WHERE b.status = 'active' AND t.list_status = 'listed' ORDER BY 1, 3`
const km = (a, c) => { const r = Math.PI / 180, dl = (c.lat - a.lat) * r, dn = (c.lon - a.lon) * r
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(c.lat * r) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)) }
const keys = [...new Set(berths.map((b) => b.terminal))], parent = Object.fromEntries(keys.map((k) => [k, k]))
const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])))
for (const a of berths) for (const b of berths) if (a.terminal < b.terminal && km(a, b) < CLUSTER_KM) parent[find(a.terminal)] = find(b.terminal)
const groups = {}
for (const k of keys) (groups[find(k)] ||= []).push(k)
const clusterOf = {}
for (const ms of Object.values(groups)) { const id = ms.length > 1 ? 'c:' + [...ms].sort().join('+') : ms[0]; for (const k of ms) clusterOf[k] = id }
const anch = await sql`SELECT id, source_id, source_key, name, geometry FROM ships.anchorages WHERE status = 'active' AND geometry IS NOT NULL
  AND max_lon >= ${W} AND min_lon <= ${E} AND max_lat >= ${S} AND min_lat <= ${N}`
writeFileSync('scripts/ships/bake-gfw/activity_inputs.json', JSON.stringify({
  made: new Date().toISOString(), source: `${envVar === 'SHIPS_PROD_DATABASE_URL' ? 'prod' : 'dev'} ships DB (read-only)`, cluster_km: CLUSTER_KM,
  berths: berths.map((b) => ({ terminal: b.terminal, kind: b.kind, berth: b.berth, lat: b.lat, lon: b.lon, cluster: clusterOf[b.terminal] })),
  // key = the anchorage's stable identity (source_id|source_key); row ids differ between databases and change when a source edits a feature
  anchorages: anch.map((a) => ({ key: `${a.source_id}|${a.source_key}`, id: Number(a.id), name: a.name, geometry: a.geometry })),
}))
console.log(`berths ${berths.length}, terminals ${keys.length}, anchorages ${anch.length}`)
