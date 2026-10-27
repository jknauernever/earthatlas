#!/usr/bin/env node
/**
 * A (Josh 2026-10-20): store the match score for the same-MMSI pairs the rules leave open. Uses the model fitted from the
 * hand labels (cache/model-<db>.json, evaluate.mjs --write) and this database's export (export-pairs.mjs → profile.py).
 * Per pair, in one transaction: a match_pair_scores row (migration 041) and { match: { band, p, model, reasons } } on the
 * pair's open candidate links, then the records' "needs review" flags. Nothing is merged: the merge band is only listed
 * (cache/merge-band-<db>.md) for Josh. Interpretation only; re-running with a new model adds rows, links show the newest.
 *
 * DEV unless run through prod.sh (not wired yet: needs Josh's go-ahead).
 *   node --env-file=.env.local scripts/ships/match/store-scores.mjs --dry-run
 *   node --env-file=.env.local scripts/ships/match/store-scores.mjs --per-band 2      # prove it: 2 pairs of each band
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA as S, withTx } from '../../../lib/ships/db.js'
import { judgePair, mmsiContexts } from '../../../lib/ships/matchRules.js'
import { pairFeatures, scorePair, reasons } from '../../../lib/ships/matchScore.js'
import { refreshReview } from '../../../lib/ships/mergeSplits.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const dry = args.includes('--dry-run'), perBand = opt('per-band') ? Number(opt('per-band')) : null
const host = new URL(process.env.SHIPS_DATABASE_URL).host.split('.')[0]
const D = JSON.parse(await readFile(path.join(HERE, 'cache', 'pairs.json'), 'utf8'))
if (D.db !== host) throw new Error(`pairs.json was exported from ${D.db}, not ${host}: re-export first`)
const F = JSON.parse(await readFile(path.join(HERE, 'cache', 'features.json'), 'utf8'))
// The committed model (lib/ships/data/matchModel.json), or --model <file> (e.g. a fresh evaluate.mjs --write in cache/).
const model = JSON.parse(await readFile(opt('model') ?? path.join(HERE, '..', '..', '..', 'lib', 'ships', 'data', 'matchModel.json'), 'utf8'))
const pos = new Map(F.map((f) => [`${f.a}|${f.b}`, f.pos || null]))
const ctxOf = mmsiContexts(D.pairs, D.records)

const pool = shipsPool()
const tally = {}, merges = []
try {
  for (const p of D.pairs) {
    const [A, B] = [D.records[p.a], D.records[p.b]], ctx = ctxOf(p)
    if (judgePair(A, B, p.mmsi, pos.get(`${p.a}|${p.b}`), ctx).verdict !== 'open') continue
    const x = pairFeatures(A, B, p.mmsi, ctx), s = scorePair(x, model)
    if (perBand && (tally[s.band] || 0) >= perBand) continue
    tally[s.band] = (tally[s.band] || 0) + 1
    if (s.band === 'merge') merges.push({ p, A, B, s })
    if (dry) continue
    await withTx(pool, async (c) => {
      await c.query(`INSERT INTO ${S}.match_pair_scores (vessel_a, vessel_b, mmsi, model, model_detail, features, parts, total_bits, p_same, band)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                     ON CONFLICT (vessel_a, vessel_b, mmsi, model) DO UPDATE SET model_detail = EXCLUDED.model_detail, features = EXCLUDED.features,
                       parts = EXCLUDED.parts, total_bits = EXCLUDED.total_bits, p_same = EXCLUDED.p_same, band = EXCLUDED.band, scored_at = now()`,
        // jsonb params as JSON text (a JS array would be sent as a Postgres array).
        [p.a, p.b, p.mmsi, model.model, JSON.stringify({ weights: model.weights, lambda: model.lambda, bands: model.bands, trained_on: model.trained_on, fitted_at: model.fitted_at, precision: model.precision }),
          JSON.stringify(x), JSON.stringify(s.parts), s.total, s.p, s.band])
      await c.query(`UPDATE ${S}.entity_links l SET evidence = l.evidence || jsonb_build_object('match', $4::jsonb)
                       FROM ${S}.entity_links a
                      WHERE a.source_entity_id = l.source_entity_id AND a.status = 'accepted' AND l.status = 'candidate' AND l.method = 'MMSI_TEMPORAL'
                        AND coalesce(l.evidence->>'verdict', '') NOT IN ('two_ships', 'shared_mmsi') AND l.evidence->>'mmsi' = $3
                        AND ((a.vessel_id = $1 AND l.vessel_id = $2) OR (a.vessel_id = $2 AND l.vessel_id = $1))`,
        [p.a, p.b, p.mmsi, JSON.stringify({ band: s.band, p: s.p, model: model.model, reasons: reasons(s), checked: model.precision?.[s.band] ?? null })])
      for (const id of [p.a, p.b]) await refreshReview(c, S, id)
    })
  }
  if (merges.length) {
    const md = merges.map(({ p, A, B, s }) => `| ${p.mmsi} | ${A.names.join(', ') || '—'} | ${B.names.join(', ') || '—'} | ${A.callsigns.join(', ') || '—'} / ${B.callsigns.join(', ') || '—'} | ${s.p} | [${p.a.slice(0, 8)}](http://localhost:5173/ships?v=${p.a}) / [${p.b.slice(0, 8)}](http://localhost:5173/ships?v=${p.b}) |`)
    await writeFile(path.join(HERE, 'cache', `merge-band-${host}.md`), `# Merge band (${model.model}, ${host}): review only, nothing merged\n\n| MMSI | names A | names B | call signs | p | records |\n|---|---|---|---|---|---|\n${md.join('\n')}\n`)
  }
  console.log(`${dry ? 'DRY RUN ' : ''}${host} ${model.model}:`, tally, merges.length ? `; merge band listed → cache/merge-band-${host}.md` : '')
} finally {
  await pool.end()
}
