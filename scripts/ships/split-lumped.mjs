#!/usr/bin/env node
/**
 * B2: split vessel records that lump different boats together (lib/ships/splitLumped.js; Josh 2026-10-20, option A).
 * DEV database unless run through `zsh scripts/ships/prod.sh split-lumped` (backs up production first).
 *
 *   node --env-file=.env.local scripts/ships/split-lumped.mjs --dry-run              # every lumped record: split plan or why not
 *   node --env-file=.env.local scripts/ships/split-lumped.mjs --vessel <id> [--vessel <id>]   # only these records (prove it on one boat)
 *   node --env-file=.env.local scripts/ships/split-lumped.mjs --limit 1              # the first N records that split
 *   node --env-file=.env.local scripts/ships/split-lumped.mjs                        # every record that splits
 * Records that don't split (one MMSI for every number, or no MMSI evidence) are listed for manual review, never touched.
 * A log of every plan and move goes to scripts/ships/match/cache/split-<db>-<time>.json.
 */
import { writeFile } from 'node:fs/promises'
import { shipsPool, DEFAULT_SCHEMA, schemaIdent, withTx } from '../../lib/ships/db.js'
import { findLumped, planVessel, applySplit } from '../../lib/ships/splitLumped.js'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const all = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []))
const dry = args.includes('--dry-run')
const limit = opt('limit') ? Number(opt('limit')) : null
const S = schemaIdent(opt('schema') || DEFAULT_SCHEMA)
const pool = shipsPool()
const q = async (t, p) => (await pool.query(t, p)).rows
const host = new URL(process.env.SHIPS_DATABASE_URL).host.split('.')[0]
const short = (id) => (id ? id.slice(0, 8) : 'NEW')
try {
  const lumped = await findLumped(q, S, { vesselIds: all('vessel').length ? all('vessel') : null })
  console.log(`${lumped.length} lumped record(s) → schema ${S} on ${host}${dry ? ' (dry run)' : ''}`)
  const tally = { split: 0, manual: 0, skipped: 0, moved_groups: 0, new_records: 0 }, log = []
  for (const l of lumped) {
    const plan = await planVessel(pool, S, l.id)
    const label = `${short(l.id)} ${plan.names.join('/') || '(no name)'} [${[...l.docs, ...l.imos.map((i) => `imo:${i}`)].join(' ')}]`
    if (!plan.split) { tally.manual++; log.push({ plan }); console.log(`  manual  ${label}: ${plan.reason}`); continue }
    if (limit && tally.split >= limit) continue
    console.log(`  split   ${label}`)
    console.log(`          keeps ${plan.keep.docs.join('/') || '-'} MMSI ${plan.keep.mmsis.join('/')}: ${plan.keep.entities.length} entr(ies)${plan.mixed.length ? `, ${plan.mixed.length} mixed` : ''}`)
    for (const m of plan.moves) console.log(`          ${m.stays ? 'stays' : `→ ${short(m.into)}`} ${m.docs.join('/')} MMSI ${m.mmsis.join('/')}: ${m.entities.length} entr(ies)${m.stays ? ` (${m.stays})` : ''}`)
    if (dry) { tally.split++; log.push({ plan }); continue }
    const r = await withTx(pool, (c) => applySplit(c, S, plan))
    log.push({ plan, result: r })
    if (r.skipped) { tally.skipped++; console.log(`          skipped: ${r.skipped}`); continue }
    tally.split++; tally.moved_groups += r.moves.length; tally.new_records += r.moves.filter((m) => m.created).length
    for (const m of r.moves) console.log(`          moved ${m.entities.length} → ${m.into}${m.created ? ' (new)' : ''}`)
  }
  const file = `scripts/ships/match/cache/split-${host}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  await writeFile(file, JSON.stringify({ db: host, dry, limit, tally, log }, null, 2))
  console.log(dry ? 'dry run' : 'done', tally, `→ ${file}`)
} finally {
  await pool.end()
}
