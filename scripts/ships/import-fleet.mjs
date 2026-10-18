#!/usr/bin/env node
/**
 * Fleets (migration 034, lib/ships/fleets.js): load a fleet's starting list, or add / remove one boat later.
 * DEV database unless run through `zsh scripts/ships/prod.sh fleet …` (which backs up production first).
 * Idempotent: an unchanged member writes nothing.
 *
 *   npm run ships:import-fleet -- --file lib/ships/data/fleets/whalewatch.json [--dry-run]
 *   npm run ships:import-fleet -- --fleet whalewatch --add --mmsi 368026630 [--at 2026-09-15] \
 *        --company "Western Prince Whale Watching" --basis fcc_licensee \
 *        --source-label "FCC ship radio licence (active): Western Prince Cruises, Inc." \
 *        --source-url "https://wireless2.fcc.gov/UlsApp/UlsSearch/license.jsp?licKey=4009202" [--place "Friday Harbor, WA"] [--country US] [--note "…"]
 *     (--vessel <EarthAtlas vessel id> instead of --mmsi picks the boat directly, e.g. from a /ships link ?v=…)
 *   npm run ships:import-fleet -- --fleet whalewatch --remove --vessel <id> --reason "sold out of the fleet"
 *
 * bases: fcc_licensee | tc_registered_owner | operator_website | manual (manual needs --note)
 */
import { readFile } from 'node:fs/promises'
import { shipsPool, DEFAULT_SCHEMA, schemaIdent } from '../../lib/ships/db.js'
import { ensureFleet, upsertMember, removeMember, memberProblems } from '../../lib/ships/fleets.js'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const S = schemaIdent(opt('schema') || DEFAULT_SCHEMA)
const dry = args.includes('--dry-run')
const by = opt('by') || 'import-fleet'

const pool = shipsPool()
const q = async (sql, params) => (await pool.query(sql, params)).rows
const host = new URL(process.env.SHIPS_DATABASE_URL).host.split('.')[0]
try {
  if (opt('file')) {
    const doc = JSON.parse(await readFile(opt('file'), 'utf8'))
    const bad = doc.members.map((m, i) => [m.name || i, memberProblems(m)]).filter(([, e]) => e.length)
    if (bad.length) throw new Error(`invalid members:\n  ${bad.map(([n, e]) => `${n}: ${e.join('; ')}`).join('\n  ')}`)
    console.log(`${doc.fleet.key}: ${doc.members.length} members from ${opt('file')} → schema ${S} on ${host}${dry ? ' (dry run)' : ''}`)
    if (dry) {
      const { vesselForMember } = await import('../../lib/ships/fleets.js')
      for (const m of doc.members) { const v = await vesselForMember(q, S, m); console.log(`  ${v.id ? 'ok ' : 'NO '} ${m.name} ${m.mmsi} ${v.id || v.reason}`) }
    } else {
      await ensureFleet(q, S, doc.fleet)
      const tally = {}
      for (const m of doc.members) {
        const r = await upsertMember(q, S, doc.fleet.key, m, by)
        tally[r.action] = (tally[r.action] || 0) + 1
        if (r.action !== 'unchanged') console.log(`  ${r.action.padEnd(10)} ${m.name} ${m.mmsi || ''} ${r.vessel_id || r.reason}`)
      }
      console.log(tally)
    }
  } else if (args.includes('--add')) {
    const fleet = opt('fleet')
    const m = { mmsi: opt('mmsi'), vessel_id: opt('vessel'), at: opt('at') ? new Date(opt('at')).toISOString() : undefined,
      company: opt('company'), company_place: opt('place'), country: opt('country'), basis: opt('basis'),
      source_label: opt('source-label'), source_url: opt('source-url'), note: opt('note') }
    const [f] = await q(`SELECT key FROM ${S}.fleets WHERE key = $1`, [fleet])
    if (!f) throw new Error(`no fleet "${fleet}" in ${S} (load its file first)`)
    if (dry) { console.log(memberProblems(m)); } else console.log(await upsertMember(q, S, fleet, m, by))
  } else if (args.includes('--remove')) {
    if (dry) console.log('dry run: nothing removed')
    else console.log(`removed ${await removeMember(q, S, opt('fleet'), opt('vessel'), opt('reason'))}`)
  } else {
    console.error('use --file F, --add … or --remove … (see the header of this script)')
    process.exitCode = 2
  }
} finally {
  await pool.end()
}
