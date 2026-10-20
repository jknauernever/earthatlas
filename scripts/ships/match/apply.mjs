#!/usr/bin/env node
/**
 * B, apply the same-MMSI match rules (lib/ships/matchRules.js; Josh 2026-10-19 "all three merge rules"). Reads the pairs and
 * position checks made from THIS database (export-pairs.mjs → profile.py), re-checks each pair in the database right before
 * acting, then:
 *   merge_r1 / merge_r2 / merge_r3  smaller record merged into the fuller one (lib/ships/mergeSplits.js mergeVessel)
 *   blank_mmsi                       the pair's same-MMSI candidate links are retired (a blank MMSI is no evidence)
 *   two_ships                        the candidate links are kept, marked verdict 'two_ships' (cards: another ship used this MMSI)
 * and recomputes each touched record's "needs review" flag. lumped / open: nothing. Interpretation only: no claim or raw record
 * is changed; every action is reversible from the links it supersedes or marks.
 *
 * DEV unless run through `zsh scripts/ships/prod.sh match-apply` (backs up production first).
 *   node --env-file=.env.local scripts/ships/match/apply.mjs --dry-run                 # counts per verdict, nothing written
 *   node --env-file=.env.local scripts/ships/match/apply.mjs --per-rule 2              # prove it: 2 pairs of each verdict
 *   node --env-file=.env.local scripts/ships/match/apply.mjs [--only merge_r2,blank_mmsi]
 * Merges take one step per record per run; re-export, re-profile and run again until nothing merges.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA as S, withTx } from '../../../lib/ships/db.js'
import { judgePair } from '../../../lib/ships/matchRules.js'
import { mergeVessel, refreshReview } from '../../../lib/ships/mergeSplits.js'
import { RESOLVER } from '../../../lib/ships/resolve.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const dry = args.includes('--dry-run')
const perRule = opt('per-rule') ? Number(opt('per-rule')) : null
const only = opt('only') ? new Set(opt('only').split(',')) : null
const host = new URL(process.env.SHIPS_DATABASE_URL).host.split('.')[0]

const D = JSON.parse(await readFile(path.join(HERE, 'cache', 'pairs.json'), 'utf8'))
if (D.db && D.db !== host) throw new Error(`pairs.json was exported from ${D.db}, not ${host}: re-export first`)
const F = JSON.parse(await readFile(path.join(HERE, 'cache', 'features.json'), 'utf8'))
const pos = new Map(F.map((f) => [`${f.a}|${f.b}`, f.pos || null]))
const RULE = { merge_r1: 'B rule R1: same registry id (IMO or USCG number), none conflicting',
  merge_r2: 'B rule R2: exactly the same name, no conflicting call sign or length, real MMSI, no position conflict',
  merge_r3: 'B rule R3: a nameless entry whose MMSI dates lie inside the named record’s; nothing conflicting' }

const pool = shipsPool()
const q = async (t, p) => (await pool.query(t, p)).rows
const tally = {}, used = new Set(), done = []
try {
  for (const p of D.pairs) {
    const j = judgePair(D.records[p.a], D.records[p.b], p.mmsi, pos.get(`${p.a}|${p.b}`))
    tally[j.verdict] = (tally[j.verdict] || 0) + 0
    if (['open', 'lumped'].includes(j.verdict) || (only && !only.has(j.verdict))) { tally[j.verdict]++; continue }
    if (perRule && done.filter((d) => d.verdict === j.verdict).length >= perRule) continue
    // One MERGE per record per run (a merge changes the records; chains settle over runs). Retiring a blank-MMSI link or
    // marking two ships changes no record, so those are not limited.
    const merging = j.verdict.startsWith('merge_')
    if (merging && (used.has(p.a) || used.has(p.b))) continue
    // Re-check now: both records still active, and the same-MMSI candidate link between them still open.
    const live = await q(`SELECT l.id FROM ${S}.entity_links l JOIN ${S}.entity_links a ON a.source_entity_id = l.source_entity_id AND a.status = 'accepted'
                           JOIN ${S}.vessels va ON va.id = a.vessel_id AND va.status = 'active' JOIN ${S}.vessels vb ON vb.id = l.vessel_id AND vb.status = 'active'
                          WHERE l.status = 'candidate' AND l.method = 'MMSI_TEMPORAL' AND coalesce(l.evidence->>'verdict', '') <> 'two_ships'
                            AND ((a.vessel_id = $1 AND l.vessel_id = $2) OR (a.vessel_id = $2 AND l.vessel_id = $1))`, [p.a, p.b])
    if (!live.length) { tally.skipped_changed = (tally.skipped_changed || 0) + 1; continue }
    tally[j.verdict]++
    done.push({ verdict: j.verdict, a: p.a, b: p.b, mmsi: p.mmsi, why: j.why, ...(j.keep ? { keep: p[j.keep], merge: p[j.merge] } : {}) })
    if (merging) { used.add(p.a); used.add(p.b) }
    if (dry) continue
    await withTx(pool, async (c) => {
      if (j.verdict.startsWith('merge_')) {
        await mergeVessel(c, S, { keep: p[j.keep], merge: p[j.merge], mmsi: p.mmsi, rule: RULE[j.verdict] })
      } else if (j.verdict === 'blank_mmsi') {
        await c.query(`UPDATE ${S}.entity_links SET status = 'superseded', superseded_at = now(),
                              evidence = evidence || jsonb_build_object('retired_by', $2::text, 'verdict', 'blank_mmsi')
                        WHERE id = ANY($1)`, [live.map((l) => l.id), RESOLVER])
        for (const id of [p.a, p.b]) await refreshReview(c, S, id)
      } else if (j.verdict === 'two_ships') {
        await c.query(`UPDATE ${S}.entity_links SET evidence = evidence || jsonb_build_object('verdict', 'two_ships', 'why', $2::text, 'judged_by', $3::text)
                        WHERE id = ANY($1)`, [live.map((l) => l.id), j.why, RESOLVER])
        for (const id of [p.a, p.b]) await refreshReview(c, S, id)
      }
    })
  }
  const log = path.join(HERE, 'cache', `apply-${host}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  await writeFile(log, JSON.stringify({ db: host, dry, perRule, only: only && [...only], tally, done }, null, 2))
  console.log(`${dry ? 'DRY RUN ' : ''}${host}:`, tally, `\n${done.length} pair(s) acted on → ${path.relative(process.cwd(), log)}`)
  if (done.length <= 20) for (const d of done) console.log(`  ${d.verdict.padEnd(10)} ${d.a.slice(0, 8)} ~ ${d.b.slice(0, 8)} MMSI ${d.mmsi}${d.keep ? ` → keep ${d.keep.slice(0, 8)}` : ''}  (${d.why})`)
} finally {
  await pool.end()
}
