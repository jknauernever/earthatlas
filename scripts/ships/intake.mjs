#!/usr/bin/env node
/**
 * /ship-intake: boats from an operator's website → the ships DB (migration 037, lib/ships/operatorSite.js,
 * .claude/skills/ship-intake/SKILL.md). DEV database unless run through `zsh scripts/ships/prod.sh intake …`.
 *
 *   npm run ships:intake -- review --file lib/ships/data/intake/<name>.json [--no-psix]
 *       For each boat: the vessels we hold under that name (MMSIs, last AIS sighting, licensee / owner, length) and the
 *       FCC ship licences + USCG PSIX records under that name that we do NOT hold yet, each with the signals that tie
 *       it to this operator (same length, licensee/owner name, Salish AIS). Writes nothing to the DB. Prints a review
 *       table and saves it to scripts/ships/intake/cache/<name>.review.json. PSIX: one name search per boat (~0.5 s each).
 *   npm run ships:intake -- apply --file lib/ships/data/intake/<name>.json [--dry-run]
 *       Needs a decision on every boat (match.vessel_id + match.basis, or match.none + why). Stores the page and each boat
 *       as raw records, the boats' claims, and links each matched boat to its vessel (MANUAL_REVIEW). Unmatched boats are
 *       kept, unlinked (not on the site). Idempotent: an unchanged file writes nothing new.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, schemaIdent, withTx } from '../../lib/ships/db.js'
import { normName } from '../../lib/ships/normalize.js'
import { partyPrivacy } from '../../lib/ships/registry.js'
import { splitLine, SH_FIELDS as SH, LICENSE_STATUS } from '../../lib/ships/fccUls.js'
import { intakeProblems, boatClaims, operatorSourceId } from '../../lib/ships/operatorSite.js'
import { reviewIntake, fccFromTable, midPlace } from '../../lib/ships/intakeMatch.js'
import { applyIntake, matchProblems } from '../../lib/ships/intakeApply.js'
import { psixClient } from './psixClient.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FCC_DIR = path.join(HERE, 'bake-ais', 'build', 'registries', 'l_ship')
const CACHE = path.join(HERE, 'intake', 'cache')
const args = process.argv.slice(2)
const cmd = args[0]
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const S = schemaIdent(opt('schema') || DEFAULT_SCHEMA)
const file = opt('file')
if (!['review', 'apply'].includes(cmd) || !file) { console.error('usage: intake.mjs review|apply --file <intake.json> [--dry-run] [--no-psix]'); process.exit(2) }

const intake = JSON.parse(await readFile(file, 'utf8'))
const errs = intakeProblems(intake, { forApply: cmd === 'apply' })
if (errs.length) { console.error(`${file}:\n  ${errs.join('\n  ')}`); process.exit(1) }

const pool = shipsPool()
const q = async (sql, params) => (await pool.query(sql, params)).rows
const host = new URL(process.env.SHIPS_DATABASE_URL).host.split('.')[0]

// ── FCC ship licences (local weekly file) ───────────────────────────────────

async function* lines(f) { for await (const l of createInterface({ input: createReadStream(f), crlfDelay: Infinity })) yield l }

async function fccByName(norms) {
  if (!existsSync(path.join(FCC_DIR, 'SH.dat'))) return { missing: true, hits: {} }
  const hits = {}, usis = new Map()
  for await (const l of lines(path.join(FCC_DIR, 'SH.dat'))) {
    if (!l.startsWith('SH|')) continue
    const f = splitLine(l)
    const n = normName(f[SH.ship_name] || '')
    if (!norms.has(n)) continue
    const h = { usi: f[1], callsign: f[SH.callsign], name: f[SH.ship_name], mmsi: f[SH.station_number] || null,
      length_m: f[SH.ship_length] ? Number(f[SH.ship_length]) : null } // FCC ship length is in meters
    ;(hits[n] ||= []).push(h); usis.set(h.usi, h)
  }
  if (usis.size) {
    for await (const l of lines(path.join(FCC_DIR, 'HD.dat'))) {
      const usi = l.split('|', 3)[1]; const h = usis.get(usi); if (!h) continue
      const f = splitLine(l); h.status = LICENSE_STATUS[f[5]] || f[5]; h.service = f[6]
    }
    for await (const l of lines(path.join(FCC_DIR, 'EN.dat'))) {
      const usi = l.split('|', 3)[1]; const h = usis.get(usi); if (!h) continue
      // Organisations only; a person's name never leaves the file (lib/ships/registry.js partyPrivacy, as for FCC claims).
      const f = splitLine(l)
      if (partyPrivacy({ applicantType: f[23], recreational: false }).storeName && f[7]) { h.licensee = f[7]; h.place = [f[16], f[17]].filter(Boolean).join(' ') }
    }
  }
  return { missing: false, hits }
}

// ── review ──────────────────────────────────────────────────────────────────

const mark = (x) => `${x.ok === false ? '✗' : '✓'} ${x.text}`

async function review() {
  const norms = new Set(intake.boats.map((b) => normName(b.name)))
  // The FCC lookup table (migration 038) when it's loaded; otherwise the local weekly file.
  let fcc = await fccFromTable(q, S, norms).catch(() => ({ missing: true, hits: {} }))
  if (fcc.missing) fcc = await fccByName(norms)
  const psix = args.includes('--no-psix') ? null : psixClient()
  const report = { file, page: intake.page.url, operator: intake.operator.name, db: host, ...(await reviewIntake(q, S, intake, { fcc, psix })) }
  await mkdir(CACHE, { recursive: true })
  const out = path.join(CACHE, path.basename(file).replace(/\.json$/, '.review.json'))
  await writeFile(out, JSON.stringify(report, null, 2))

  console.log(`\n${intake.operator.name} · ${intake.page.url} · DB ${host}${fcc.missing ? ' · FCC file missing (run ships:import-fcc --fetch)' : ''}\n`)
  for (const r of report.boats) {
    console.log(`■ ${r.name}${r.decision ? `   [decided: ${r.decision.vessel_id ? `→ ${r.decision.vessel_id.slice(0, 8)}` : `none — ${r.decision.none}`}]` : ''}${r.suggestion ? `   [suggested: ${r.suggestion.vessel_id.slice(0, 8)}]` : ''}`)
    if (!r.ours.length) console.log('   our DB: no vessel under this name')
    for (const v of r.ours) {
      console.log(`   our DB  ${v.vessel_id}  MMSI ${v.mmsis.join(', ') || '—'} (${v.mmsis.map(midPlace).filter(Boolean).join(', ') || '—'})  last AIS ${v.last_ais || '—'}`)
      console.log(`           names ${v.names.join(' / ')}${v.parties.length ? `  ·  licensee/owner ${v.parties.join('; ')}` : ''}${v.official_numbers.length ? `  ·  USCG ${v.official_numbers.join(', ')}` : ''}`)
      for (const h of v.fcc) console.log(`           FCC licence ${h.usi} ${h.callsign} ${h.status || ''}  ${h.licensee ? `${h.licensee}${h.place ? `, ${h.place}` : ''}` : '(licensee name not shown: individual or unknown type)'}`)
      if (v.signals.length) console.log(`           ${v.signals.map(mark).join('  ')}`)
    }
    for (const h of r.fcc_not_held) console.log(`   FCC new  licence ${h.usi} ${h.callsign} ${h.status || ''}  MMSI ${h.mmsi || '—'}  ${h.length_m ? `${h.length_m} m` : ''}  ${h.licensee ? `${h.licensee}${h.place ? `, ${h.place}` : ''}` : '(licensee name not shown)'}  ${h.signals.map(mark).join('  ')}`)
    if (r.psix_not_held) for (const x of r.psix_not_held) console.log(`   PSIX new ${x.psix_id}  USCG ${x.official_number || '—'}  ${x.service || ''}  built ${x.built || '?'}  ${x.status || ''}  call ${x.callsign || '—'}`)
    if (r.psix_error) console.log(`   USCG PSIX unavailable (${r.psix_error}); re-run review later for USCG records`)
    const hidden = [r.fcc_hidden.length && `${r.fcc_hidden.length} FCC licence(s) with no MMSI`, r.psix_hidden?.length && `${r.psix_hidden.length} recreational USCG record(s)`].filter(Boolean)
    if (hidden.length) console.log(`   (not shown: ${hidden.join(', ')}; in the saved report)`)
    console.log('')
  }
  console.log(`saved ${path.relative(process.cwd(), out)}`)
}

// ── apply ───────────────────────────────────────────────────────────────────

async function apply() {
  const dry = args.includes('--dry-run')
  const errs = await matchProblems(q, S, intake)
  if (errs.length) throw new Error(errs.join('; '))
  console.log(`${operatorSourceId(intake.page.url)}: ${intake.boats.length} boats → schema ${S} on ${host}${dry ? ' (dry run)' : ''}`)
  if (dry) {
    for (const b of intake.boats) console.log(`  ${b.match.vessel_id ? `link → ${b.match.vessel_id}` : `keep unlinked (${b.match.none})`}  ${b.name}: ${boatClaims(intake, b).map((c) => c.attribute).join(', ')}`)
    return
  }
  const r = await withTx(pool, (c) => applyIntake(c, S, intake))
  console.log(`  page record ${r.page_record.id}${r.page_record.created ? ' (new)' : ''}`)
  for (const b of r.boats) console.log(`  ${b.name}: record ${b.record.id}${b.record.created ? ' (new)' : ''}, claims ${JSON.stringify(b.claims)}, ${b.link}${b.vessel_id ? ` → ${b.vessel_id}` : ''}`)
}

try {
  if (cmd === 'review') await review()
  else await apply()
} finally {
  await pool.end()
}
