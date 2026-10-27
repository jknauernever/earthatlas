#!/usr/bin/env node
/**
 * Apply Josh's reviews of same-MMSI pairs (lib/ships/data/matchReviewed.json; review lists from apply.mjs typos-*.md and
 * store-scores.mjs merge-band-*.md). "same" → the smaller record merged into the fuller one (lib/ships/mergeSplits.js
 * mergeVessel: reversible, links superseded, ids keep working); "different" → the pair's candidate links marked two_ships.
 * Records are found by the reviewed ids when those exist and are active on this database (the one the review was made on),
 * else by MMSI + names (production): each side must then match exactly one ACTIVE record carrying that MMSI and one of its
 * names, or the pair is skipped. A merged id resolves to the record it was merged into. Interpretation only: no claim or raw record
 * changes.
 *
 * DEV unless run through prod.sh (not wired yet: needs Josh's go-ahead).
 *   node --env-file=.env.local scripts/ships/match/merge-reviewed.mjs --dry-run
 *   node --env-file=.env.local scripts/ships/match/merge-reviewed.mjs
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA as S, withTx } from '../../../lib/ships/db.js'
import { mergeVessel, refreshReview } from '../../../lib/ships/mergeSplits.js'
import { RESOLVER } from '../../../lib/ships/resolve.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const dry = process.argv.includes('--dry-run')
const host = new URL(process.env.SHIPS_DATABASE_URL).host.split('.')[0]
const R = JSON.parse(await readFile(path.join(HERE, '..', '..', '..', 'lib', 'ships', 'data', 'matchReviewed.json'), 'utf8'))

const pool = shipsPool()
const q = async (t, p) => (await pool.query(t, p)).rows
// The one active record on this MMSI carrying one of these (normalized) names, with its claim count; null when 0 or 2+.
async function find(mmsi, names) {
  const rows = await q(`
    SELECT v.id::text, (SELECT count(*) FROM ${S}.vessel_assertions x WHERE x.vessel_id = v.id)::int AS claims
      FROM ${S}.vessels v
     WHERE v.status = 'active'
       AND EXISTS (SELECT 1 FROM ${S}.vessel_assertions m WHERE m.vessel_id = v.id AND m.attribute = 'mmsi' AND m.value_norm = $1)
       AND EXISTS (SELECT 1 FROM ${S}.vessel_assertions n WHERE n.vessel_id = v.id AND n.attribute = 'name' AND n.value_norm = ANY($2))`, [mmsi, names])
  return rows.length === 1 ? rows[0] : null
}

// A reviewed id on this database, following merges (merged_into) to the active record; null when unknown here.
async function byId(id) {
  for (let hop = 0, cur = id; hop < 5 && cur; hop++) {
    const [v] = await q(`SELECT id::text, status, merged_into::text FROM ${S}.vessels WHERE id = $1`, [cur])
    if (!v) return null
    if (v.status === 'active') return (await q(`SELECT $1::text AS id, (SELECT count(*) FROM ${S}.vessel_assertions x WHERE x.vessel_id = $1::uuid)::int AS claims`, [v.id]))[0]
    cur = v.merged_into
  }
  return null
}

const tally = {}
try {
  for (const p of R.pairs) {
    const [a, b] = [(await byId(p.a)) ?? (await find(p.mmsi, p.names[0])), (await byId(p.b)) ?? (await find(p.mmsi, p.names[1]))]
    const tag = `${p.names[0][0]} / ${p.names[1][0]} (MMSI ${p.mmsi})`
    if (!a || !b || a.id === b.id) { tally.skipped = (tally.skipped || 0) + 1; console.log(`  skip ${tag}: ${!a || !b ? 'not exactly one active record per side' : 'already one record'}`); continue }
    tally[p.label] = (tally[p.label] || 0) + 1
    const [keep, merge] = a.claims >= b.claims ? [a, b] : [b, a]
    console.log(`  ${p.label.padEnd(9)} ${tag}${p.label === 'same' ? ` → keep ${keep.id.slice(0, 8)} (${keep.claims} claims), merge ${merge.id.slice(0, 8)}` : ''}`)
    if (dry) continue
    await withTx(pool, async (c) => {
      if (p.label === 'same') {
        await mergeVessel(c, S, { keep: keep.id, merge: merge.id, mmsi: p.mmsi, rule: `Reviewed by ${p.by} ${p.at}: same boat (${p.why})` })
      } else if (p.label === 'different') {
        await c.query(`UPDATE ${S}.entity_links l SET evidence = l.evidence || jsonb_build_object('verdict', 'two_ships', 'rule', 'reviewed', 'why', $3::text, 'judged_by', $4::text)
                         FROM ${S}.entity_links x
                        WHERE x.source_entity_id = l.source_entity_id AND x.status = 'accepted' AND l.status = 'candidate' AND l.method = 'MMSI_TEMPORAL'
                          AND ((x.vessel_id = $1 AND l.vessel_id = $2) OR (x.vessel_id = $2 AND l.vessel_id = $1))`,
          [a.id, b.id, `reviewed by ${p.by}: ${p.why}`, RESOLVER])
        for (const id of [a.id, b.id]) await refreshReview(c, S, id)
      }
    })
  }
  console.log(`${dry ? 'DRY RUN ' : ''}${host}:`, tally)
} finally {
  await pool.end()
}
