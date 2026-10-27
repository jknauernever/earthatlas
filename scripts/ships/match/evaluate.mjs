#!/usr/bin/env node
/**
 * A (Josh 2026-10-20): fit the match score from the HAND labels and measure it honestly. Offline (no database, no API).
 * Reads cache/label-sample-<db>.json (score.mjs --sample) + cache/labels-<db>.json ([{ i, label: same|different|unclear,
 * evidence }]); the rule-decided pairs can't train it (their rules ARE the features: see lib/ships/matchScore.js).
 *
 *   - weights: supervised m/u from the "same" / "different" labels (missing values carry no weight; Laplace smoothing)
 *   - prior: share of "same" per evidence pattern, weighted by how many open pairs each pattern has (the sample is stratified)
 *   - precision per band by leave-one-out: each pair is banded by a fit made WITHOUT it, so no pair grades itself
 *   - 95% Wilson ranges, since 0 errors in 20 pairs still allows a real error rate up to ~16%
 *   node scripts/ships/match/evaluate.mjs [--bands 0.9,0.1] [--write]   # --write stores the final model in cache/model-<db>.json,
 *                                                                        # with each band's leave-one-out counts (the card quotes them)
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fitEM, weightsOf, scorePair, SCORE_MODEL, DEFAULT_BANDS } from '../../../lib/ships/matchScore.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const host = opt('db') ?? 'ep-frosty-feather-autlwmb7-pooler'
const sample = JSON.parse(await readFile(path.join(HERE, 'cache', `label-sample-${host}.json`), 'utf8'))
const labels = JSON.parse(await readFile(path.join(HERE, 'cache', `labels-${host}.json`), 'utf8'))
const scores = JSON.parse(await readFile(path.join(HERE, 'cache', `scores-${host}.json`), 'utf8'))
const bands = opt('bands') ? Object.fromEntries(['probably', 'separate'].map((k, i) => [k, Number(opt('bands').split(',')[i])])) : DEFAULT_BANDS

const L = new Map(labels.map((l) => [l.i, l]))
// Port-visit test per sampled pair (label-evidence.mjs); --no-ports scores identity features only, for comparison.
const portsOf = args.includes('--no-ports') ? new Map() : new Map(JSON.parse(await readFile(path.join(HERE, 'cache', 'label-dossiers', 'index.json'), 'utf8')).map((d) => [d.i, d.ports]))
const rows = sample.map((s, i) => ({ ...s, x: { ...s.x, ports: portsOf.get(i) ?? 'missing' }, i, truth: L.get(i)?.label ?? 'unlabeled' }))
const known = rows.filter((r) => ['same', 'different'].includes(r.truth))
const tally = (xs, k) => xs.reduce((a, x) => ((a[x[k]] = (a[x[k]] || 0) + 1), a), {})
console.log(`${rows.length} sampled, labels:`, tally(rows, 'truth'))

// Open-pair counts per evidence pattern (population), to weight the prior. Same patterns as score.mjs `stratum`.
const popOf = {}
for (const p of scores.pairs) { const k = stratumOf(p.x); popOf[k] = (popOf[k] || 0) + 1 }
function stratumOf(x) {
  return x.callsign === 'conflict' ? 'call sign conflict' : x.name === 'one_missing' ? 'nameless vs named' : x.name === 'both_missing' ? 'both nameless'
    : ['typo', 'prefix'].includes(x.name) ? 'near name' : x.callsign === 'agree' ? `${x.name} name, same call sign` : `${x.name} name`
}
const prior = (xs) => {
  let same = 0, tot = 0
  for (const [k, n] of Object.entries(popOf)) {
    const ls = xs.filter((r) => r.stratum === k); if (!ls.length) continue
    same += n * ls.filter((r) => r.truth === 'same').length / ls.length; tot += n
  }
  return Math.min(0.98, Math.max(0.02, tot ? same / tot : 0.5))
}
const fit = (xs) => {
  const f = fitEM(xs.map((r) => ({ x: r.x, label: r.truth === 'same' ? 1 : 0 })), { unlabeled: false })
  return { lambda: prior(xs), weights: weightsOf(f), bands }
}
const wilson = (k, n) => {
  if (!n) return [0, 1]
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
  return [(c - h) / d, (c + h) / d]
}

// Leave-one-out bands.
const loo = known.map((r) => ({ ...r, band: scorePair(r.x, fit(known.filter((o) => o !== r))).band }))
console.log('\nband (leave-one-out) × hand label:')
const precision = {}
for (const b of ['merge', 'probably', 'unknown', 'separate']) {
  const xs = loo.filter((r) => r.band === b), same = xs.filter((r) => r.truth === 'same').length
  const right = b === 'separate' ? xs.length - same : same
  if (b !== 'unknown') precision[b] = { right, checked: xs.length }
  const [lo, hi] = wilson(right, xs.length)
  const unclear = rows.filter((r) => r.truth === 'unclear' && scorePair(r.x, fit(known)).band === b).length
  console.log(`  ${b.padEnd(9)} ${xs.length} labeled: ${same} same, ${xs.length - same} different` +
    (['merge', 'probably', 'separate'].includes(b) && xs.length ? `  → precision ${(100 * right / xs.length).toFixed(0)}% (95% range ${(100 * lo).toFixed(0)}–${(100 * hi).toFixed(0)}%)` : '') +
    `; + ${unclear} unclear`)
}
const model = { model: SCORE_MODEL, db: host, fitted_at: new Date().toISOString(), trained_on: `${known.length} hand-labeled pairs`, ...fit(known), precision }
console.log('\nweights from all labels (bits; + = same ship):')
for (const [k, lv] of Object.entries(model.weights)) console.log(`  ${k.padEnd(9)} ${Object.entries(lv).map(([v, w]) => `${v} ${w > 0 ? '+' : ''}${w}`).join('  ')}`)
console.log(`prior same ship among open pairs: ${model.lambda.toFixed(2)}`)
const bc = tally(scores.pairs.map((p) => ({ band: scorePair(p.x, model).band })), 'band')
console.log('all open pairs by band with this model:', bc)
if (args.includes('--write')) { await writeFile(path.join(HERE, 'cache', `model-${host}.json`), JSON.stringify(model, null, 1)); console.log(`→ cache/model-${host}.json`) }
