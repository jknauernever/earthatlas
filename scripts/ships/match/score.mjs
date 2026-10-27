#!/usr/bin/env node
/**
 * A (Josh 2026-10-20): fit the match score (lib/ships/matchScore.js) on the exported pairs and score every pair the rules
 * leave open. Offline: reads cache/pairs.json + cache/features.json (export-pairs.mjs → profile.py), writes
 * cache/scores-<db>.json (model + one row per open pair) and prints the weights and band counts. No database access.
 *   node scripts/ships/match/score.mjs [--bands 0.9,0.1] [--sample 200]   # --sample also writes cache/label-sample-<db>.json
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { judgePair, mmsiContexts } from '../../../lib/ships/matchRules.js'
import { pairFeatures, fitEM, weightsOf, scorePair, SCORE_MODEL, DEFAULT_BANDS, FEATURES } from '../../../lib/ships/matchScore.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const D = JSON.parse(await readFile(path.join(HERE, 'cache', 'pairs.json'), 'utf8'))
const F = JSON.parse(await readFile(path.join(HERE, 'cache', 'features.json'), 'utf8'))
const pos = new Map(F.map((f) => [`${f.a}|${f.b}`, f.pos || null]))
const R = D.records

// MMSI-wide context (C, 2026-10-20): records on each MMSI, signs of many boats, hosts for R3 (lib/ships/matchRules.js).
const ctxOf = mmsiContexts(D.pairs, D.records)

const rows = [], verdicts = {}
for (const p of D.pairs) {
  const ctx = ctxOf(p), j = judgePair(R[p.a], R[p.b], p.mmsi, pos.get(`${p.a}|${p.b}`), ctx)
  verdicts[j.verdict] = (verdicts[j.verdict] || 0) + 1
  const label = j.verdict.startsWith('merge_') ? 1 : ['two_ships', 'numbered_fleet'].includes(j.verdict) ? 0 : j.verdict === 'open' ? null : undefined
  if (label === undefined) continue // blank / lumped / shared MMSI: not scored
  rows.push({ p, x: pairFeatures(R[p.a], R[p.b], p.mmsi, ctx), label, rule: j.verdict })
}
// Chance agreement: identity features between RANDOM pairs of records on different MMSIs (almost all two different ships).
let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
const ids = Object.keys(R), cnt = {}, ID_FEATURES = ['name', 'callsign', 'length', 'type', 'flag']
for (let i = 0; i < 20000; i++) {
  const a = ids[Math.floor(rnd() * ids.length)], b = ids[Math.floor(rnd() * ids.length)]
  if (a === b || R[a].mmsi.some((x) => R[b].mmsi.some((y) => y.mmsi === x.mmsi))) continue
  const x = pairFeatures(R[a], R[b], '-')
  for (const k of ID_FEATURES) { cnt[k] ||= {}; cnt[k][x[k]] = (cnt[k][x[k]] || 0) + 1 }
}
const fixedU = Object.fromEntries(ID_FEATURES.map((k) => {
  const levels = FEATURES[k]
  const tot = levels.filter((v) => !['missing', 'one_missing', 'both_missing'].includes(v)).reduce((s, v) => s + (cnt[k][v] || 0) + 1, 0)
  return [k, Object.fromEntries(levels.filter((v) => !['missing', 'one_missing', 'both_missing'].includes(v)).map((v) => [v, ((cnt[k][v] || 0) + 1) / tot]))]
}))
// Supervised by default (2026-10-20): EM over the open pairs, with or without random-pair chance rates, found the wrong split
// (stubs vs full records, or "everything sharing an MMSI matches"). --em brings it back for comparison.
const fit = args.includes('--em') ? fitEM(rows, { fixedU }) : fitEM(rows, { unlabeled: false })
const bands = opt('bands') ? Object.fromEntries(['probably', 'separate'].map((k, i) => [k, Number(opt('bands').split(',')[i])])) : DEFAULT_BANDS
const model = { model: SCORE_MODEL, db: D.db, exported_at: D.exported_at, fitted_at: new Date().toISOString(), lambda: +fit.lambda.toFixed(4), weights: weightsOf(fit), bands }
const scored = rows.filter((r) => r.label === null).map((r) => ({ a: r.p.a, b: r.p.b, mmsi: r.p.mmsi, x: r.x, ...scorePair(r.x, model) }))

console.log(D.db, 'verdicts', verdicts)
console.log(`EM: ${rows.length} rows (${rows.filter((r) => r.label === 1).length} rule matches, ${rows.filter((r) => r.label === 0).length} rule non-matches), prior same-ship among open = ${model.lambda}`)
for (const [k, lv] of Object.entries(model.weights)) console.log(`  ${k.padEnd(9)} ${Object.entries(lv).map(([v, w]) => `${v} ${w > 0 ? '+' : ''}${w}`).join('  ')}`)
const bc = {}; for (const s of scored) bc[s.band] = (bc[s.band] || 0) + 1
console.log('bands (open pairs):', bc)
await writeFile(path.join(HERE, 'cache', `scores-${D.db}.json`), JSON.stringify({ ...model, pairs: scored }))

// Evidence pattern of an open pair: the strata the labeling sample is drawn from.
export const stratum = (x) => x.callsign === 'conflict' ? 'call sign conflict'
  : x.name === 'one_missing' ? 'nameless vs named' : x.name === 'both_missing' ? 'both nameless'
  : ['typo', 'prefix'].includes(x.name) ? 'near name' : x.callsign === 'agree' ? `${x.name} name, same call sign` : `${x.name} name`
// Labeling sample (A): n pairs drawn per evidence pattern (QUOTA shares; fixed seed, so it can be re-drawn exactly).
const QUOTA = { 'nameless vs named': 60, 'different name': 40, 'call sign conflict': 35, 'different name, same call sign': 25, 'near name': 23, 'both nameless': 15, 'exact name': 1, 'exact name, same call sign': 1 }
if (opt('sample')) {
  const n = Number(opt('sample')), tot = Object.values(QUOTA).reduce((x, y) => x + y, 0); let sd = 42
  const r2 = () => (sd = (sd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const sample = Object.entries(QUOTA).flatMap(([k, q]) => scored.filter((s) => stratum(s.x) === k).map((s) => [r2(), s]).sort((x, y) => x[0] - y[0])
    .slice(0, Math.max(1, Math.round(q * n / tot))).map(([, s]) => ({ stratum: k, a: s.a, b: s.b, mmsi: s.mmsi, x: s.x, label: null, evidence: '' })))
  await writeFile(path.join(HERE, 'cache', `label-sample-${D.db}.json`), JSON.stringify(sample, null, 1))
  console.log(`label sample: ${sample.length} pairs → cache/label-sample-${D.db}.json`)
}
if (args.includes('--strata')) {
  const c = {}; for (const s of scored) { const k = stratum(s.x); c[k] = (c[k] || 0) + 1 }
  console.log('strata (open pairs):', Object.entries(c).sort((a, b) => b[1] - a[1]))
}
