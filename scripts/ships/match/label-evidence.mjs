#!/usr/bin/env node
/**
 * A (Josh 2026-10-20): one evidence dossier per pair of the labeling sample (score.mjs --sample), so the hand labels rest on
 * the same facts every time. Read-only on the database (DEV unless SHIPS_DATABASE_URL says otherwise). GFW calls are made
 * here only, cached in cache/label-gfw/ (never fetched twice) and capped by --budget (default 250 calls):
 *   - identity detail for every GFW entry in the sample (50 ids per call), incl. GFW's own "potentially related" entries
 *   - port visits of a pair's GFW entries (one call per pair) when its two records were on the MMSI at overlapping dates
 * Port visits give a real "two places at once" test: both records in different ports at the same time = two ships.
 *   node --env-file=.env.local scripts/ships/match/label-evidence.mjs [--budget 250] [--dry-run]
 * → cache/label-dossiers/<nnn>.txt (one per pair) + cache/label-dossiers/index.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA as S } from '../../../lib/ships/db.js'
import { gfwClient } from '../gfwClient.js'
import { portRelation } from '../../../lib/ships/matchScore.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const budget = Number(opt('budget') ?? 250), dry = args.includes('--dry-run')
const host = new URL(process.env.SHIPS_DATABASE_URL).host.split('.')[0]
const sample = JSON.parse(await readFile(path.join(HERE, 'cache', `label-sample-${host}.json`), 'utf8'))
const GC = path.join(HERE, 'cache', 'label-gfw'), OUT = path.join(HERE, 'cache', 'label-dossiers')
await mkdir(GC, { recursive: true }); await mkdir(OUT, { recursive: true })

const pool = shipsPool()
const q = async (t, p) => (await pool.query(t, p)).rows
const ids = [...new Set(sample.flatMap((p) => [p.a, p.b]))]
const claims = await q(`
  SELECT l.vessel_id::text v, se.source_id, se.entity_key, a.attribute, a.value_raw, a.value_norm, a.evidence_class,
         to_char(lower(a.period), 'YYYY-MM-DD') f, to_char(upper(a.period), 'YYYY-MM-DD') t
    FROM ${S}.entity_links l JOIN ${S}.source_entities se ON se.id = l.source_entity_id
    JOIN ${S}.assertions a ON a.source_entity_id = se.id AND a.status = 'active'
   WHERE l.status = 'accepted' AND l.vessel_id = ANY($1::uuid[]) AND a.evidence_class <> 'community_curated'
   ORDER BY a.attribute, lower(a.period) NULLS FIRST`, [ids])
const byV = {}; for (const c of claims) (byV[c.v] ||= []).push(c)
const gfwIdsOf = (v) => [...new Set((byV[v] || []).filter((c) => c.source_id === 'gfw-vessel-identity').map((c) => c.entity_key.replace(/^ais:/, '')))]

// GFW, cached + counted.
const gfw = gfwClient(process.env.GFW_API_TOKEN, { minIntervalMs: 300, log: () => {} })
let calls = 0
async function cached(key, fn) {
  const f = path.join(GC, `${key}.json`)
  if (existsSync(f)) return JSON.parse(await readFile(f, 'utf8'))
  if (dry || calls >= budget) return null
  calls++
  const r = await fn(); await writeFile(f, JSON.stringify(r.body)); return r.body
}
const allGfw = [...new Set(ids.flatMap(gfwIdsOf))]
const detail = {}
for (let i = 0; i < allGfw.length; i += 50) {
  const chunk = allGfw.slice(i, i + 50), body = await cached(`ids-${host}-${i / 50}-${chunk.length}`, () => gfw.byIds(chunk))
  for (const e of body?.entries || []) for (const s of e.selfReportedInfo || []) detail[s.id] = { self: s, related: (e.potentialRelatedSelfReportedInfo || []).map((r) => r.id ?? r.vesselId).filter(Boolean), registries: (e.registryInfo || []).length }
}

const winOf = (v, m) => { const ps = (byV[v] || []).filter((c) => c.attribute === 'mmsi' && c.value_norm === m && c.f && c.t); return ps.length ? [ps.map((c) => c.f).sort()[0], ps.map((c) => c.t).sort().at(-1)] : null }
const hav = (a, b) => { const r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r; return 6371 * 2 * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2)) }
// Both sides' port visits in ONE call per pair (each event names its vessel id).
const visitsOf = async (gids, from, to) => {
  const body = await cached(`pv-${gids.join('+').slice(0, 180)}-${from}-${to}`, () => gfw.portVisits({ vesselIds: gids, from, to }))
  return body ? (body.entries || []).map((e) => ({ vid: e.vessel?.id, s: e.start, e: e.end, lat: e.position?.lat, lon: e.position?.lon, port: e.port_visit?.intermediateAnchorage?.name || e.port_visit?.startAnchorage?.name || '?' })) : null
}

const index = []
for (const [i, p] of sample.entries()) {
  const lines = [`PAIR ${i}  MMSI ${p.mmsi}  stratum: ${p.stratum}`, `features: ${JSON.stringify(p.x)}`]
  const wa = winOf(p.a, p.mmsi), wb = winOf(p.b, p.mmsi)
  const pv = {}
  for (const [tag, v, w] of [['A', p.a, wa], ['B', p.b, wb]]) {
    lines.push('', `RECORD ${tag} ${v}  (MMSI ${p.mmsi} dates ${w ? w.join('..') : '?'})`)
    const seen = new Set()
    for (const c of byV[v] || []) {
      const k = `${c.attribute}|${c.value_raw}|${c.source_id}`; if (seen.has(k)) continue; seen.add(k)
      lines.push(`  ${c.attribute.padEnd(16)} ${String(c.value_raw).slice(0, 60).padEnd(30)} ${c.source_id} (${c.evidence_class}) ${c.f || ''}..${c.t || ''}`)
    }
    for (const g of gfwIdsOf(v)) {
      const d = detail[g]
      if (d) lines.push(`  GFW ${g}: ${d.self.shipname ?? '-'} / ${d.self.ssvid} / ${d.self.callsign ?? '-'} / ${d.self.flag ?? '-'}; transmitted ${String(d.self.transmissionDateFrom).slice(0, 10)}..${String(d.self.transmissionDateTo).slice(0, 10)}; ${d.self.messagesCounter ?? '?'} messages, ${d.self.positionsCounter ?? '?'} positions; registries ${d.registries}; GFW-related: ${d.related.length}`)
    }
  }
  // GFW's own grouping: does either side list the other's entry as potentially related?
  const ga = gfwIdsOf(p.a), gb = gfwIdsOf(p.b)
  const rel = ga.some((g) => detail[g]?.related.some((r) => gb.includes(r))) || gb.some((g) => detail[g]?.related.some((r) => ga.includes(r)))
  lines.push('', `GFW lists the two entries as potentially related: ${ga.length && gb.length ? (rel ? 'YES' : 'no') : 'n/a (not both GFW entries)'}`)
  // Two places at once: port visits of both sides over their overlapping MMSI dates.
  let test = 'n/a', ports = 'missing'
  if (wa && wb && ga.length && gb.length && wa[0] <= wb[1] && wb[0] <= wa[1]) {
    const from = [wa[0], wb[0]].sort()[1], to = [wa[1], wb[1]].sort()[0]
    const to2 = to > new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : to
    if (from < to2) {
      const vs = await visitsOf([...ga, ...gb], from, to2)
      if (vs) { pv.A = vs.filter((v) => ga.includes(v.vid)); pv.B = vs.filter((v) => gb.includes(v.vid)) }
      if (pv.A && pv.B) {
        // Impossible travel: a moment A was seen at a port (a visit's start or end) and a moment B was, more than 50 km apart
        // and closer in time than a 50-knot boat could cover. Long overlapping "visits" alone don't count (GFW visits can last
        // months while a transponder is off).
        const clash = [], inst = (v) => [v.s, v.e].map((t) => ({ t: Date.parse(t), lat: v.lat, lon: v.lon, port: v.port, at: t }))
        for (const x of pv.A.flatMap(inst)) for (const y of pv.B.flatMap(inst)) {
          if (x.lat == null || y.lat == null) continue
          const km = hav(x, y), h = Math.abs(x.t - y.t) / 36e5
          if (km > 50 && km / Math.max(h, 0.25) > 50 * 1.852) clash.push(`A at ${x.port} ${x.at.slice(0, 16)} / B at ${y.port} ${y.at.slice(0, 16)}: ${Math.round(km)} km in ${h.toFixed(1)} h`)
        }
        test = `${pv.A.length} A visits, ${pv.B.length} B visits ${from}..${to2}; impossible-travel moments: ${clash.length}${clash.length ? '\n    ' + clash.slice(0, 5).join('\n    ') : ''}`
        ports = portRelation([...pv.A.map((v) => ({ ...v, who: 'A' })), ...pv.B.map((v) => ({ ...v, who: 'B' }))])
        const all = [...pv.A.map((v) => ({ ...v, w: 'A' })), ...pv.B.map((v) => ({ ...v, w: 'B' }))].sort((x, y) => x.s.localeCompare(y.s))
        if (all.length) lines.push('', 'Port visits (time order):', ...all.slice(0, 40).map((v) => `  ${v.w} ${v.s.slice(0, 16)}..${v.e.slice(0, 16)} ${v.port}`))
      } else test = `not fetched (budget)`
    }
  }
  lines.push('', `TWO PLACES AT ONCE (GFW port visits): ${test}`)
  const file = `${String(i).padStart(3, '0')}.txt`
  await writeFile(path.join(OUT, file), lines.join('\n') + '\n')
  index.push({ i, file, a: p.a, b: p.b, mmsi: p.mmsi, stratum: p.stratum, ports })
}
await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1))
console.log(`${dry ? 'DRY RUN ' : ''}${index.length} dossiers → ${path.relative(process.cwd(), OUT)}; GFW calls this run ${calls} (budget ${budget})`)
await pool.end()
