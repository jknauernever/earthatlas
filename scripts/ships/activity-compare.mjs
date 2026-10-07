#!/usr/bin/env node
/**
 * Compare GFW-estimated terminal calls / anchorage stays (activity.py stops.csv, from the ships-gfw-activity-check
 * workflow) with the NOAA-counted ones in the database, for one month (docs/SHIPS_ACTIVITY_FUSION.md, Part 2). Read-only.
 *
 *   node scripts/ships/activity-compare.mjs --stops DIR/stops.csv --month 2026-06 [--prod] [--label "m0.65 a0.5"] [--out X.md]
 *
 * Terminals use the terminal cards' own ship-kind rule (terminalCard.js: the EarthAtlas ship holding the MMSI at the call,
 * classifyVessels → shipFit; a NOAA call falls back to the AIS type it broadcast). A GFW stop at a cluster of terminals is
 * CREDITED to the one terminal its ship's kind fits, SHARED when it fits several, and not counted when it fits none. GFW
 * presence rows carry no tanker type, so a GFW stop with no EarthAtlas kind takes the AIS type its MMSI broadcast in NOAA's
 * records, else GFW's own type.
 *
 * Only the current rule versions are read (terminal calls tc4, anchorage stays as1): older versions stay in the tables as
 * evidence. A NOAA call is "found" when GFW has a stop (any kind) of the same MMSI at the same cluster / anchorage within
 * ±1 h; a counted GFW stop is "confirmed" when it overlaps a NOAA call (any kind) the same way. NOAA's receivers are US-only,
 * so unconfirmed GFW stops in Canadian waters can be real.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { classifyVessels, fitRule, shipFit } from '../../lib/ships/terminalCard.js'
import { fromAisCode, fromGfwType } from '../../lib/ships/taxonomy.js'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const month = opt('month') || '2026-06'
const envVar = args.includes('--prod') ? 'SHIPS_PROD_DATABASE_URL' : 'SHIPS_DATABASE_URL'
const line = readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith(envVar + '='))
const sql = neon(line.split('=').slice(1).join('=').replace(/^["']|["']$/g, ''))
const q = (text, params) => sql.query(text, params)
const S = 'ships'
const inputs = JSON.parse(readFileSync('scripts/ships/bake-gfw/activity_inputs.json', 'utf8'))
const clusterOf = Object.fromEntries(inputs.berths.map((b) => [b.terminal, b.cluster]))
const members = {}
for (const [t, c] of Object.entries(clusterOf)) (members[c] ||= new Set()).add(t)
const candidates = (target) => members[target] || new Set(target.split('+'))
const anchName = Object.fromEntries(inputs.anchorages.map((a) => [a.key, a.name]))

// activity.py writes CSV with \r\n line ends and quotes names that contain commas.
const parseCsvLine = (l) => { const out = []; let cur = '', qd = false
  for (let i = 0; i < l.length; i++) { const ch = l[i]
    if (qd) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') qd = false; else cur += ch }
    else if (ch === '"') qd = true; else if (ch === ',') { out.push(cur); cur = '' } else cur += ch }
  out.push(cur); return out }
const [hdr, ...rows] = readFileSync(opt('stops'), 'utf8').trim().split(/\r?\n/).map(parseCsvLine)
const gfw = rows.map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i]]))).map((r) => ({ ...r, t0: +r.t0, t1: +r.t1 }))

const from = `${month}-01T00:00:00Z`
const to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString()
const terms = new Map((await q(`SELECT key, kind, detail FROM ${S}.terminals WHERE list_status = 'listed'`)).map((t) => [t.key, fitRule(t.kind, t.detail?.ship_fit)]))
const noaaCalls = (await q(`SELECT t.key AS terminal, c.mmsi::text AS mmsi, c.ais_vessel_type::int AS ais_vessel_type,
    extract(epoch from c.t0)::bigint AS t0, extract(epoch from c.t1)::bigint AS t1
    FROM ${S}.terminal_calls c JOIN ${S}.terminals t ON t.id = c.terminal_id
    WHERE c.bake_version = 'tc4' AND c.t0 >= $1 AND c.t0 < $2`, [from, to]))
  .map((c) => ({ ...c, kind: 'terminal', target: clusterOf[c.terminal] || c.terminal, t0: +c.t0, t1: +c.t1 }))
const noaaStays = (await q(`SELECT anchorage_source_id || '|' || anchorage_source_key AS target, mmsi::text AS mmsi, extract(epoch from t0)::bigint AS t0, extract(epoch from t1)::bigint AS t1
    FROM ${S}.anchorage_stays WHERE bake_version = 'as1' AND t0 >= $1 AND t0 < $2`, [from, to])).map((s) => ({ ...s, kind: 'anchorage', t0: +s.t0, t1: +s.t1 }))

// The EarthAtlas ship holding each MMSI at each call / stop (1 = resolved; several = ambiguous, left unresolved).
const all = [...noaaCalls, ...gfw.filter((g) => g.kind === 'terminal')]
const res = await q(`SELECT x.i, array_agg(DISTINCT v.vessel_id) AS ids FROM unnest($1::int[], $2::text[], $3::timestamptz[]) AS x(i, mmsi, at)
    CROSS JOIN LATERAL ${S}.vessels_for_mmsi_at(x.mmsi, x.at) v GROUP BY 1`,
  [all.map((_, i) => i), all.map((c) => String(c.mmsi)), all.map((c) => new Date(c.t0 * 1000).toISOString())])
for (const r of res) if (r.ids.length === 1) all[r.i].vesselId = r.ids[0]
const byVessel = await classifyVessels(q, S, [...new Set(all.map((c) => c.vesselId).filter(Boolean))])
const aisType = new Map((await q(`SELECT mmsi::text AS mmsi, max(ais_vessel_type)::int AS t FROM ${S}.terminal_calls
    WHERE bake_version = 'tc4' AND ais_vessel_type IS NOT NULL GROUP BY 1`)).map((r) => [r.mmsi, r.t]))
const stated = (e) => e && e.group && e.group !== 'unknown' && !(e.group === 'other' && (!e.class || e.class === 'other_unspecified'))
const asKind = (g) => ({ group: g.group, class: g.class ?? (g.group && g.group !== 'unknown' ? `${g.group}_unspecified` : null) })
const kindOf = (c) => {
  const e = c.vesselId ? byVessel.get(c.vesselId) : null
  if (stated(e)) return e
  if (c.ais_vessel_type != null) return asKind(fromAisCode(c.ais_vessel_type))
  if (aisType.has(String(c.mmsi))) return asKind(fromAisCode(aisType.get(String(c.mmsi))))
  return asKind(fromGfwType(c.gfw_type))
}
for (const c of noaaCalls) { c.k = kindOf(c); c.fits = shipFit(terms.get(c.terminal), c.k) === 'fits' }
for (const g of gfw.filter((x) => x.kind === 'terminal')) {
  const k = g.k = kindOf(g)
  g.fitting = [...candidates(g.target)].filter((t) => terms.has(t) && shipFit(terms.get(t), k) === 'fits')
}

const SLACK = 3600
const key = (x) => `${x.kind}|${x.target}|${x.mmsi}`
const index = (xs) => { const m = new Map(); for (const x of xs) (m.get(key(x)) || m.set(key(x), []).get(key(x))).push(x); return m }
const overlaps = (a, b) => a.t0 <= b.t1 + SLACK && a.t1 >= b.t0 - SLACK
// --tug-km X: a tug stop counts only within X km of a berth, OR while a cargo ship / tanker (EarthAtlas kind) has a GFW stop at the
// same terminals at the same time (a tug assisting it). Tugs moor at their own bases next to terminals (2026-10-06 tug study).
if (opt('tug-km')) {
  const lim = +opt('tug-km'), bigK = (k) => k && ['tanker', 'cargo'].includes(k.group)
  const tStops = gfw.filter((x) => x.kind === 'terminal')
  for (const g of tStops) g.k = kindOf(g)
  const keep = new Set(tStops.filter((g) => g.k?.group !== 'tug_tow' || +g.min_km <= lim
    || tStops.some((o) => o !== g && o.target === g.target && bigK(o.k) && overlaps(o, g))))
  for (let i = gfw.length - 1; i >= 0; i--) if (gfw[i].kind === 'terminal' && !keep.has(gfw[i])) gfw.splice(i, 1)
}
const gfwBy = index(gfw.filter((g) => g.kind === 'anchorage')), noaaBy = index(noaaStays)
const tStopsBy = new Map(), tCallsBy = new Map()
for (const g of gfw.filter((x) => x.kind === 'terminal')) (tStopsBy.get(g.mmsi) || tStopsBy.set(g.mmsi, []).get(g.mmsi)).push(g)
for (const c of noaaCalls) (tCallsBy.get(c.mmsi) || tCallsBy.set(c.mmsi, []).get(c.mmsi)).push(c)
const stopsFor = (c) => (tStopsBy.get(c.mmsi) || []).filter((g) => overlaps(g, c) && candidates(g.target).has(c.terminal))
const callsFor = (g) => (tCallsBy.get(g.mmsi) || []).filter((c) => overlaps(g, c) && candidates(g.target).has(c.terminal))
const isTug = (k) => k?.group === 'tug_tow'
const G = Object.fromEntries(['tug_us', 'tug_bc', 'other_us', 'other_bc'].map((k) => [k, { noaa: 0, found: 0, gfw: 0, confirmed: 0 }]))
const gk = (k, t) => `${isTug(k) ? 'tug' : 'other'}_${String(t).startsWith('bc-') ? 'bc' : 'us'}`
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—')

// Terminals, one row per terminal.
const T = new Map()
const row = (t) => T.get(t) || T.set(t, { t, noaa: 0, noaa2h: 0, found: 0, found2h: 0, noaaShips: new Set(), gfw: 0, gfwShips: new Set(), shared: 0, confirmed: 0, attrN: 0, attrOk: 0 }).get(t)
for (const c of noaaCalls.filter((c) => c.fits)) {
  const r = row(c.terminal), long = c.t1 - c.t0 >= 7200
  r.noaa++; if (long) r.noaa2h++; r.noaaShips.add(c.mmsi)
  const f = stopsFor(c).length > 0
  if (f) { r.found++; if (long) r.found2h++ }
  const gg = G[gk(c.k, c.terminal)]; gg.noaa++; if (f) gg.found++
}
let sharedStops = 0, sharedConfirmed = 0
for (const g of gfw.filter((x) => x.kind === 'terminal' && x.fitting.length)) {
  const hits = callsFor(g)
  const gg = G[gk(g.k, g.target)]; gg.gfw++; if (hits.length) gg.confirmed++
  if (g.fitting.length === 1) {
    const r = row(g.fitting[0])
    r.gfw++; r.gfwShips.add(g.mmsi); if (hits.length) r.confirmed++
    if (hits.length) { r.attrN++; if (hits.some((n) => n.terminal === g.fitting[0])) r.attrOk++ }
  } else {
    sharedStops++; if (hits.length) sharedConfirmed++
    for (const t of g.fitting) row(t).shared++
  }
}
const sum = (k) => [...T.values()].reduce((s, r) => s + r[k], 0)
const tRows = [...T.values()].sort((a, b) => b.noaa + b.gfw - a.noaa - a.gfw)
const termMd = `| Terminal | Visits NOAA | Visits GFW (credited) | Shared with a neighbour | Ships NOAA / GFW | NOAA found by GFW | NOAA ≥2 h found | GFW confirmed | Right terminal |\n|---|---|---|---|---|---|---|---|---|\n`
  + `| **All** | **${sum('noaa')}** | **${sum('gfw')}** | **${sharedStops} stops** | | **${pct(sum('found'), sum('noaa'))}** | **${pct(sum('found2h'), sum('noaa2h'))}** | **${pct(sum('confirmed'), sum('gfw'))}** | **${pct(sum('attrOk'), sum('attrN'))}** |\n`
  + tRows.map((r) => `| ${r.t} | ${r.noaa} | ${r.gfw} | ${r.shared} | ${r.noaaShips.size} / ${r.gfwShips.size} | ${pct(r.found, r.noaa)} | ${pct(r.found2h, r.noaa2h)} | ${pct(r.confirmed, r.gfw)} | ${pct(r.attrOk, r.attrN)} |`).join('\n')

// Anchorages: every kind of ship (the anchorage card lists all kinds, split by kind).
const A = new Map()
const arow = (t) => A.get(t) || A.set(t, { t, noaa: 0, noaa2h: 0, found: 0, found2h: 0, gfw: 0, confirmed: 0, noaaShips: new Set(), gfwShips: new Set() }).get(t)
for (const s of noaaStays) {
  const r = arow(s.target), long = s.t1 - s.t0 >= 7200
  r.noaa++; if (long) r.noaa2h++; r.noaaShips.add(s.mmsi)
  if ((gfwBy.get(key(s)) || []).some((g) => overlaps(g, s))) { r.found++; if (long) r.found2h++ }
}
for (const g of gfw.filter((x) => x.kind === 'anchorage')) {
  const r = arow(g.target); r.gfw++; r.gfwShips.add(g.mmsi)
  if ((noaaBy.get(key(g)) || []).some((n) => overlaps(g, n))) r.confirmed++
}
const asum = (k) => [...A.values()].reduce((s, r) => s + r[k], 0)
const anchMd = `| Anchorage | Stays NOAA | Stays GFW | Ships NOAA / GFW | NOAA found by GFW | NOAA ≥2 h found | GFW confirmed |\n|---|---|---|---|---|---|---|\n`
  + `| **All** | **${asum('noaa')}** | **${asum('gfw')}** | | **${pct(asum('found'), asum('noaa'))}** | **${pct(asum('found2h'), asum('noaa2h'))}** | **${pct(asum('confirmed'), asum('gfw'))}** |\n`
  + [...A.values()].sort((a, b) => b.noaa + b.gfw - a.noaa - a.gfw).slice(0, 40)
    .map((r) => `| ${anchName[r.t] || r.t} | ${r.noaa} | ${r.gfw} | ${r.noaaShips.size} / ${r.gfwShips.size} | ${pct(r.found, r.noaa)} | ${pct(r.found2h, r.noaa2h)} | ${pct(r.confirmed, r.gfw)} |`).join('\n')

const summary = { label: opt('label') || '', terminals: { noaa: sum('noaa'), gfw: sum('gfw'), shared: sharedStops, found: pct(sum('found'), sum('noaa')),
  found2h: pct(sum('found2h'), sum('noaa2h')), confirmed: pct(sum('confirmed'), sum('gfw')), sharedConfirmed: pct(sharedConfirmed, sharedStops), rightTerminal: pct(sum('attrOk'), sum('attrN')) },
  byKind: Object.fromEntries(Object.entries(G).map(([k, v]) => [k, { noaa: v.noaa, gfw: v.gfw, found: pct(v.found, v.noaa), confirmed: pct(v.confirmed, v.gfw) }])),
  anchorages: { noaa: asum('noaa'), gfw: asum('gfw'), found: pct(asum('found'), asum('noaa')), found2h: pct(asum('found2h'), asum('noaa2h')), confirmed: pct(asum('confirmed'), asum('gfw')) } }
// --dump DIR: one row per tug-relevant GFW terminal stop and per NOAA call, for pattern analysis (2026-10-06 tug study).
if (opt('dump')) {
  const big = (k) => k && k.group !== 'tug_tow' && ['tanker', 'cargo', 'bulk', 'gas_carrier', 'container'].some((g) => String(k.group).includes(g) || String(k.class || '').includes(g))
  const gStops = gfw.filter((x) => x.kind === 'terminal')
  const csvq = (v) => (v == null ? '' : /[",]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v))
  const out = [['mmsi', 'name', 'group', 'class', 'target', 'nearest', 'fitting', 'dur_h', 'rows', 'min_km', 't0', 'confirmed', 'noaa_same_mmsi_any_terminal', 'big_gfw_same_group', 'big_noaa_same_group', 'month_rows_here', 'month_stops_here']]
  const here = new Map(); for (const g of gStops) { const k = `${g.mmsi}|${g.target}`; const h = here.get(k) || { rows: 0, n: 0 }; h.rows += +g.rows; h.n++; here.set(k, h) }
  for (const g of gStops) {
    const cands = candidates(g.target), h = here.get(`${g.mmsi}|${g.target}`)
    const bigG = gStops.some((o) => o !== g && o.target === g.target && big(o.k) && overlaps(o, g))
    const bigN = noaaCalls.some((c) => cands.has(c.terminal) && big(c.k) && overlaps(c, g))
    const anyN = (tCallsBy.get(g.mmsi) || []).some((c) => overlaps(g, c))
    out.push([g.mmsi, g.name, g.k?.group, g.k?.class, g.target, g.terminal_nearest, (g.fitting || []).join('+'), ((g.t1 - g.t0) / 3600).toFixed(0), g.rows, g.min_km, g.t0,
      callsFor(g).length ? 1 : 0, anyN ? 1 : 0, bigG ? 1 : 0, bigN ? 1 : 0, h.rows, h.n])
  }
  writeFileSync(`${opt('dump')}/gfw_terminal_stops.csv`, out.map((r) => r.map(csvq).join(',')).join('\n'))
  const nout = [['mmsi', 'terminal', 'group', 'class', 'fits', 'dur_h', 't0', 'found', 'big_noaa_same_terminal']]
  for (const c of noaaCalls) nout.push([c.mmsi, c.terminal, c.k?.group, c.k?.class, c.fits ? 1 : 0, ((c.t1 - c.t0) / 3600).toFixed(2), c.t0, stopsFor(c).length ? 1 : 0,
    noaaCalls.some((o) => o !== c && o.terminal === c.terminal && big(o.k) && overlaps(o, c)) ? 1 : 0])
  writeFileSync(`${opt('dump')}/noaa_calls.csv`, nout.map((r) => r.map(csvq).join(',')).join('\n'))
}
if (opt('out')) writeFileSync(opt('out'), `# GFW-estimated vs NOAA-counted activity, ${month} (Salish)${summary.label ? ` — ${summary.label}` : ''}\n\n`
  + `Made ${new Date().toISOString().slice(0, 16)}Z by scripts/ships/activity-compare.mjs from ${envVar === 'SHIPS_PROD_DATABASE_URL' ? 'production (read-only)' : 'the dev database'}. `
  + `Terminal visits use the terminal cards' ship-kind rule on both sides; NOAA = current rules (tc4 / as1).\n\n## Terminals\n\n${termMd}\n\n## Anchorages (top 40)\n\n${anchMd}\n`)
console.log(JSON.stringify(summary))
