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
import { upsertSource, findOrCreateEntity, upsertRecord, upsertAssertions } from '../../lib/ships/store.js'
import { lengthsAgree } from '../../lib/ships/resolve.js'
import { partyPrivacy } from '../../lib/ships/registry.js'
import { splitLine, SH_FIELDS as SH, LICENSE_STATUS } from '../../lib/ships/fccUls.js'
import { parseDataset } from '../../lib/ships/psix.js'
import { operatorSource, intakeProblems, boatKey, boatClaims, boatPayload, pagePayload,
  PAGE_KIND, BOAT_KIND, INTAKE_DECIDER } from '../../lib/ships/operatorSite.js'
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

// ── Signals ──────────────────────────────────────────────────────────────────

// Words that say nothing about which company it is.
const FILLER = new Set(['LLC', 'INC', 'CO', 'CORP', 'COMPANY', 'LTD', 'THE', 'AND', 'OF', 'CHARTERS', 'CHARTER', 'MARINE', 'SERVICES',
  'SERVICE', 'TOURS', 'CRUISES', 'BOATS', 'BOAT', 'WATER', 'TAXI', 'FERRY', 'TRANSPORTATION'])
const words = (s) => new Set(String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !FILLER.has(w)))
// A party names the operator when it shares the operator's distinctive words: all of them for a one- or two-word name,
// else at least two ("Fishers Island Ferry District" shares only ISLAND with "Island Express Charters": not a tie).
const namesOperator = (party, op) => { const O = words(op), P = words(party); const n = [...O].filter((w) => P.has(w)).length
  return O.size > 0 && n >= Math.min(O.size, 2) }
const US_MID = /^(303|338|366|367|368|369)/
const midPlace = (mmsi) => (!mmsi ? null : US_MID.test(mmsi) ? (mmsi.startsWith('303') ? 'US (Alaska)' : 'US')
  : /^31[06]/.test(mmsi) ? 'Canada' : `MID ${mmsi.slice(0, 3)}`)
const toM = (raw) => { const n = parseFloat(String(raw)); if (!Number.isFinite(n)) return null; return /ft/i.test(String(raw)) ? n * 0.3048 : n }

function signals(boat, { lengths = [], parties = [], salishAis = false, mmsis = [] }) {
  const out = []
  const ft = Number(boat.facts?.length_ft)
  if (ft > 0 && lengths.length) {
    const m = ft * 0.3048
    out.push(lengths.some((x) => lengthsAgree(m, x)) ? `✓ length ${ft} ft agrees` : `✗ length differs (${lengths.map((x) => `${(x / 0.3048).toFixed(0)} ft`).join(', ')})`)
  }
  const tied = parties.filter((p) => namesOperator(p, intake.operator.name))
  if (tied.length) out.push(`✓ licensee/owner names the operator (${tied.join('; ')})`)
  if (salishAis) out.push('✓ seen on Salish Sea AIS (NOAA)')
  const country = intake.operator.country
  if (country && mmsis.length) {
    const places = [...new Set(mmsis.map(midPlace))]
    const want = country === 'US' ? /^US/ : country === 'CA' ? /^Canada/ : null
    if (want) out.push(places.some((p) => want.test(p)) ? `✓ MMSI country ${places.join(', ')}` : `✗ MMSI country ${places.join(', ')}`)
  }
  return out
}

// ── Our DB ──────────────────────────────────────────────────────────────────

async function ourVessels(norm) {
  const ids = (await q(`SELECT DISTINCT vessel_id FROM ${S}.vessel_assertions WHERE attribute = 'name' AND value_norm = $1
                          AND evidence_class <> 'operator_published'`, [norm])).map((r) => r.vessel_id)
  const out = []
  for (const id of ids) {
    const rows = await q(`SELECT attribute, value_raw, value_norm, evidence_class, source_id, detail, upper(period) AS "to"
                            FROM ${S}.vessel_assertions WHERE vessel_id = $1
                             AND attribute IN ('name', 'mmsi', 'length_m', 'radio_licensee', 'registry_owner', 'owner', 'registered_owner', 'operator', 'official_number')`, [id])
    const vals = (a, f = () => true) => [...new Set(rows.filter((r) => r.attribute === a && f(r)).map((r) => r.value_raw))]
    const lastSeen = rows.filter((r) => r.attribute === 'mmsi' && /^ais/.test(r.evidence_class) && r.to).map((r) => String(r.to.toISOString?.() ?? r.to).slice(0, 10)).sort().at(-1) || null
    const parties = [...vals('radio_licensee', (r) => r.detail?.display !== false), ...vals('registry_owner'), ...vals('owner'), ...vals('registered_owner'), ...vals('operator')]
    const mmsis = vals('mmsi')
    const v = { vessel_id: id, names: vals('name').slice(0, 6), mmsis, last_ais: lastSeen, parties,
      official_numbers: vals('official_number'), lengths_m: [...new Set(rows.filter((r) => r.attribute === 'length_m').map((r) => toM(r.value_raw)).filter(Boolean).map((x) => +x.toFixed(1)))],
      salish_ais: rows.some((r) => r.source_id === 'marinecadastre-ais') }
    out.push(v)
  }
  return out
}

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

// ── USCG PSIX (one name search per boat) ────────────────────────────────────

async function psixByName(client, name) {
  const r = await client.call('summary', { VesselName: String(name).toUpperCase() })
  const want = normName(name)
  return parseDataset(r.xml).filter((x) => normName(x.VesselName || '') === want).map((x) => ({
    psix_id: x.VesselId, name: x.VesselName, callsign: /^N\/?A$/i.test(x.VesselCallSign || '') ? null : x.VesselCallSign,
    official_number: x.Identification || null, service: x.ServiceType || null, built: x.ConstructionCompletedYear || null,
    status: x.StatusLookupName || null, country: x.CountryLookupName || null }))
}

// ── review ──────────────────────────────────────────────────────────────────

async function review() {
  const norms = new Set(intake.boats.map((b) => normName(b.name)))
  const fcc = await fccByName(norms)
  const psix = args.includes('--no-psix') ? null : psixClient()
  const heldUsis = new Set((await q(`SELECT entity_key FROM ${S}.source_entities WHERE source_id = 'fcc-uls-ship' AND entity_key = ANY($1)`,
    [Object.values(fcc.hits).flat().map((h) => h.usi)])).map((r) => r.entity_key))
  const report = { file, page: intake.page.url, operator: intake.operator.name, db: host, reviewed_at: new Date().toISOString(), boats: [] }
  for (const b of intake.boats) {
    const n = normName(b.name)
    const ours = await ourVessels(n)
    // FCC licences under this name whose MMSI one of our vessels carries: shown on that vessel (held or not).
    for (const v of ours) {
      v.fcc = (fcc.hits[n] || []).filter((h) => h.mmsi && v.mmsis.includes(h.mmsi))
      for (const h of v.fcc) if (h.licensee && !v.parties.includes(h.licensee)) v.parties.push(h.licensee)
      v.signals = signals(b, { lengths: v.lengths_m, parties: v.parties, salishAis: v.salish_ais, mmsis: v.mmsis })
    }
    const onOurs = new Set(ours.flatMap((v) => v.fcc.map((h) => h.usi)))
    const fccNew = (fcc.hits[n] || []).filter((h) => !heldUsis.has(h.usi) && !onOurs.has(h.usi)).map((h) => ({ ...h,
      signals: signals(b, { lengths: h.length_m ? [h.length_m] : [], parties: h.licensee ? [h.licensee] : [], mmsis: h.mmsi ? [h.mmsi] : [] }) }))
    const ourOfficial = new Set(ours.flatMap((v) => v.official_numbers))
    let psixAll = null, psixError = null
    if (psix) try { psixAll = (await psixByName(psix, b.name)).filter((x) => !ourOfficial.has(x.official_number)) }
    catch (e) { psixError = String(e.message).slice(0, 80) }
    // Shown: licences with an MMSI and commercial (non-recreational) USCG records; the rest are counted, kept in the report.
    report.boats.push({ name: b.name, ours, decision: b.match ?? null, psix_error: psixError,
      fcc_not_held: fccNew.filter((h) => h.mmsi), fcc_hidden: fccNew.filter((h) => !h.mmsi),
      psix_not_held: psixAll?.filter((x) => !/^Recreational$/i.test(x.service || '')) ?? null,
      psix_hidden: psixAll?.filter((x) => /^Recreational$/i.test(x.service || '')) ?? null })
  }
  // A licensee / owner that also holds a same-name vessel for ANOTHER boat on this page ties the operator's boats together.
  const holders = new Map()
  for (const r of report.boats) for (const v of r.ours) for (const p of v.parties) {
    const k = normName(p); if (!holders.has(k)) holders.set(k, new Set()); holders.get(k).add(r.name)
  }
  for (const r of report.boats) for (const v of r.ours) {
    const others = [...new Set(v.parties.flatMap((p) => [...holders.get(normName(p))].filter((x) => x !== r.name).map((x) => `${x} (${p})`)))]
    if (others.length) v.signals.push(`✓ same licensee/owner as ${others.join(', ')}`)
  }
  await mkdir(CACHE, { recursive: true })
  const out = path.join(CACHE, path.basename(file).replace(/\.json$/, '.review.json'))
  await writeFile(out, JSON.stringify(report, null, 2))

  console.log(`\n${intake.operator.name} · ${intake.page.url} · DB ${host}${fcc.missing ? ' · FCC file missing (run ships:import-fcc --fetch)' : ''}\n`)
  for (const r of report.boats) {
    console.log(`■ ${r.name}${r.decision ? `   [decided: ${r.decision.vessel_id ? `→ ${r.decision.vessel_id.slice(0, 8)}` : `none — ${r.decision.none}`}]` : ''}`)
    if (!r.ours.length) console.log('   our DB: no vessel under this name')
    for (const v of r.ours) {
      console.log(`   our DB  ${v.vessel_id}  MMSI ${v.mmsis.join(', ') || '—'} (${v.mmsis.map(midPlace).filter(Boolean).join(', ') || '—'})  last AIS ${v.last_ais || '—'}`)
      console.log(`           names ${v.names.join(' / ')}${v.parties.length ? `  ·  licensee/owner ${v.parties.join('; ')}` : ''}${v.official_numbers.length ? `  ·  USCG ${v.official_numbers.join(', ')}` : ''}`)
      for (const h of v.fcc) console.log(`           FCC licence ${h.usi} ${h.callsign} ${h.status || ''}  ${h.licensee ? `${h.licensee}${h.place ? `, ${h.place}` : ''}` : '(licensee name not shown: individual or unknown type)'}`)
      if (v.signals.length) console.log(`           ${v.signals.join('  ')}`)
    }
    for (const h of r.fcc_not_held) console.log(`   FCC new  licence ${h.usi} ${h.callsign} ${h.status || ''}  MMSI ${h.mmsi || '—'}  ${h.length_m ? `${h.length_m} m` : ''}  ${h.licensee ? `${h.licensee}${h.place ? `, ${h.place}` : ''}` : '(licensee name not shown)'}${h.held_mmsi_vessel ? `  · MMSI already on ${h.held_mmsi_vessel.slice(0, 8)}` : ''}  ${h.signals.join('  ')}`)
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
  const src = operatorSource(intake)
  for (const b of intake.boats) if (b.match?.vessel_id) {
    const [v] = await q(`SELECT id, status, merged_into FROM ${S}.vessels WHERE id = $1`, [b.match.vessel_id])
    if (!v) throw new Error(`${b.name}: vessel ${b.match.vessel_id} not in ${host}`)
    if (v.status === 'merged') throw new Error(`${b.name}: vessel ${b.match.vessel_id} was merged into ${v.merged_into}; use that id`)
  }
  console.log(`${src.id}: ${intake.boats.length} boats → schema ${S} on ${host}${dry ? ' (dry run)' : ''}`)
  if (dry) {
    for (const b of intake.boats) console.log(`  ${b.match.vessel_id ? `link → ${b.match.vessel_id}` : `keep unlinked (${b.match.none})`}  ${b.name}: ${boatClaims(intake, b).map((c) => c.attribute).join(', ')}`)
    return
  }
  await withTx(pool, async (c) => {
    await upsertSource(c, S, src)
    const pe = await findOrCreateEntity(c, S, { sourceId: src.id, kind: PAGE_KIND, anchor: intake.page.url })
    const pr = await upsertRecord(c, S, { sourceId: src.id, entityId: pe.id, payload: pagePayload(intake), datasetVersion: intake.page.retrieved_at, retrievalUrl: intake.page.url })
    console.log(`  page record ${pr.id}${pr.created ? ' (new)' : ''}`)
    for (const b of intake.boats) {
      const ent = await findOrCreateEntity(c, S, { sourceId: src.id, kind: BOAT_KIND, anchor: boatKey(intake, b) })
      const rec = await upsertRecord(c, S, { sourceId: src.id, entityId: ent.id, payload: boatPayload(intake, b), datasetVersion: intake.page.retrieved_at, retrievalUrl: intake.page.url })
      const a = await upsertAssertions(c, S, { entityId: ent.id, recordId: rec.id, assertions: boatClaims(intake, b) })
      const [cur] = (await c.query(`SELECT id, vessel_id FROM ${S}.entity_links WHERE source_entity_id = $1 AND status = 'accepted'`, [ent.id])).rows
      let link = 'unlinked'
      if (b.match.vessel_id && cur?.vessel_id !== b.match.vessel_id) {
        if (cur) await c.query(`UPDATE ${S}.entity_links SET status = 'superseded', superseded_at = now() WHERE id = $1`, [cur.id])
        await c.query(`INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, confidence, decided_by)
                       VALUES ($1, $2, 'accepted', 'MANUAL_REVIEW', $3, $4, $5)`,
          [ent.id, b.match.vessel_id, { basis: b.match.basis, reviewed: b.match.decided ?? null, page: intake.page.url }, b.match.confidence || 'high', INTAKE_DECIDER])
        link = cur ? `moved → ${b.match.vessel_id}` : `linked → ${b.match.vessel_id}`
      } else if (b.match.vessel_id) link = `already linked → ${b.match.vessel_id}`
      else if (cur) { await c.query(`UPDATE ${S}.entity_links SET status = 'superseded', superseded_at = now() WHERE id = $1`, [cur.id]); link = 'unlinked (was linked)' }
      console.log(`  ${b.name}: record ${rec.id}${rec.created ? ' (new)' : ''}, claims ${JSON.stringify(a)}, ${link}`)
    }
  })
}

try {
  if (cmd === 'review') await review()
  else await apply()
} finally {
  await pool.end()
}
